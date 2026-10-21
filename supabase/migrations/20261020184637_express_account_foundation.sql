-- Additive foundation. Apply to an isolated database first. No SPARK/SSS changes.
-- Roster, credentials, and sessions are not exposed through the Data API.
create schema express_private;
revoke all on schema express_private from public, anon, authenticated;
grant usage on schema express_private to service_role;

create table express_private.schools (
  location_id bigint primary key references public.locations(id),
  registration_enabled boolean not null default false
);
create table express_private.roster (
  id uuid primary key default gen_random_uuid(),
  employee_number text not null unique check (employee_number ~ '^[0-9]{1,20}$'),
  full_name text not null check (length(full_name) between 1 and 160),
  name_key text not null,
  location_id bigint not null references public.locations(id),
  active boolean not null default true,
  imported_at timestamptz not null default now()
);
create index express_roster_name on express_private.roster(name_key);
create index express_roster_school on express_private.roster(location_id);
create table express_private.accounts (
  id uuid primary key default gen_random_uuid(),
  roster_id uuid not null unique references express_private.roster(id),
  pin_hash text not null check (pin_hash ~ '^scrypt:[a-f0-9]{32}:[a-f0-9]{64}$'),
  recovery_hash text not null check (recovery_hash ~ '^[a-f0-9]{64}$'),
  verified_email text unique,
  created_at timestamptz not null default now()
);
create table express_private.sessions (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  account_id uuid not null references express_private.accounts(id) on delete cascade,
  expires_at timestamptz not null default now()+interval '12 hours'
);
create index express_sessions_account on express_private.sessions(account_id);
create table express_private.rate_limits (
  key text primary key,
  attempts integer not null default 1,
  window_start timestamptz not null default now()
);
create table express_private.email_tokens (
  account_id uuid not null references express_private.accounts(id) on delete cascade,
  purpose text not null check (purpose in ('verify','reset')),
  token_hash text not null,
  email text not null,
  expires_at timestamptz not null default now()+interval '15 minutes',
  primary key(account_id,purpose)
);
create index express_email_tokens_hash on express_private.email_tokens(token_hash);

alter table express_private.schools enable row level security;
alter table express_private.roster enable row level security;
alter table express_private.accounts enable row level security;
alter table express_private.sessions enable row level security;
alter table express_private.rate_limits enable row level security;
alter table express_private.email_tokens enable row level security;
revoke all on all tables in schema express_private from public,anon,authenticated;
grant select,insert,update,delete on all tables in schema express_private to service_role;

-- Called only by the Express server. SECURITY INVOKER preserves caller privileges.
-- No browser role receives EXECUTE, schema usage, or table grants.
create function public.express_service(p_action text,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare
  v_roster express_private.roster;
  v_account express_private.accounts;
  v_id uuid;
  v_location bigint;
  v_attempts integer;
  v_row jsonb;
  v_count integer := 0;
  v_email text;
begin
  if p_action='status' then
    return to_jsonb(exists(select from express_private.schools s join public.locations l on l.id=s.location_id and l.active where s.registration_enabled));
  elsif p_action='rate' then
    delete from express_private.rate_limits where window_start < now()-interval '1 day';
    insert into express_private.rate_limits(key) values(p_data->>'key')
    on conflict(key) do update set
      attempts=case when express_private.rate_limits.window_start <= now()-interval '15 minutes' then 1 else express_private.rate_limits.attempts+1 end,
      window_start=case when express_private.rate_limits.window_start <= now()-interval '15 minutes' then now() else express_private.rate_limits.window_start end
    returning attempts into v_attempts;
    return to_jsonb(v_attempts <= (p_data->>'limit')::integer);
  elsif p_action='import' then
    select id into strict v_location from public.locations where location_code=p_data->>'locationCode' and active;
    insert into express_private.schools(location_id,registration_enabled) values(v_location,false) on conflict do nothing;
    for v_row in select * from jsonb_array_elements(p_data->'rows') loop
      if exists(select from express_private.roster where employee_number=v_row->>'employeeNumber' and location_id<>v_location) then
        raise exception 'An employee is already assigned to another school. Resolve the assignment before import.';
      end if;
      insert into express_private.roster(employee_number,full_name,name_key,location_id)
        values(v_row->>'employeeNumber',v_row->>'name',v_row->>'nameKey',v_location)
      on conflict(employee_number) do update set full_name=excluded.full_name,name_key=excluded.name_key,imported_at=now();
      v_count:=v_count+1;
    end loop;
    return jsonb_build_object('imported',v_count,'registrationEnabled',(select registration_enabled from express_private.schools where location_id=v_location));
  elsif p_action='roster_lookup' then
    select r.* into v_roster from express_private.roster r
      join express_private.schools s on s.location_id=r.location_id and s.registration_enabled
      join public.locations l on l.id=r.location_id and l.active
      where r.employee_number=p_data->>'employeeNumber' and r.active;
    if v_roster.id is null then return null; end if;
    return jsonb_build_object('id',v_roster.id);
  elsif p_action='register' then
    select r.* into v_roster from express_private.roster r
      join express_private.schools s on s.location_id=r.location_id and s.registration_enabled
      join public.locations l on l.id=r.location_id and l.active
      where r.id=(p_data->>'rosterId')::uuid and r.active for update of r;
    if v_roster.id is null then return null; end if;
    insert into express_private.accounts(roster_id,pin_hash,recovery_hash)
      values(v_roster.id,p_data->>'pinHash',p_data->>'recoveryHash') on conflict(roster_id) do nothing returning id into v_id;
    return to_jsonb(v_id);
  elsif p_action='login_lookup' then
    return coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'pinHash',a.pin_hash)) from express_private.accounts a
      join express_private.roster r on r.id=a.roster_id and r.active
      join public.locations l on l.id=r.location_id and l.active
      join express_private.schools s on s.location_id=r.location_id and s.registration_enabled
      where r.name_key=p_data->>'nameKey' and (coalesce(p_data->>'employeeNumber','')='' or r.employee_number=p_data->>'employeeNumber')),'[]'::jsonb);
  elsif p_action='session_create' then
    -- Lock the account against concurrent reset/revocation.
    select * into v_account from express_private.accounts where id=(p_data->>'accountId')::uuid and pin_hash=p_data->>'pinHash' for update;
    if v_account.id is null then return 'false'::jsonb; end if;
    delete from express_private.sessions where expires_at<now();
    insert into express_private.sessions(token_hash,account_id) values(p_data->>'tokenHash',v_account.id);
    return 'true'::jsonb;
  elsif p_action='session' then
    return (select jsonb_build_object('id',a.id,'name',r.full_name,'schoolName',l.school_name,'schoolCode',l.location_code,'email',a.verified_email)
      from express_private.sessions se join express_private.accounts a on a.id=se.account_id
      join express_private.roster r on r.id=a.roster_id and r.active
      join public.locations l on l.id=r.location_id and l.active
      join express_private.schools s on s.location_id=r.location_id and s.registration_enabled
      where se.token_hash=p_data->>'tokenHash' and se.expires_at>now());
  elsif p_action='logout' then
    delete from express_private.sessions where token_hash=p_data->>'tokenHash';
    return 'true'::jsonb;
  elsif p_action='recover_lookup' then
    return (select jsonb_build_object('id',a.id,'recoveryHash',a.recovery_hash) from express_private.accounts a
      join express_private.roster r on r.id=a.roster_id and r.active
      join public.locations l on l.id=r.location_id and l.active
      where r.employee_number=p_data->>'employeeNumber');
  elsif p_action='reset_code' then
    select * into v_account from express_private.accounts
      where id=(p_data->>'accountId')::uuid and recovery_hash=p_data->>'oldRecoveryHash' for update;
    if v_account.id is null then return 'false'::jsonb; end if;
    update express_private.accounts set pin_hash=p_data->>'pinHash',recovery_hash=p_data->>'recoveryHash' where id=v_account.id;
    delete from express_private.sessions where account_id=v_account.id;
    delete from express_private.email_tokens where account_id=v_account.id;
    return 'true'::jsonb;
  elsif p_action='email_lookup' then
    return (select jsonb_build_object('id',a.id,'email',a.verified_email) from express_private.accounts a
      join express_private.roster r on r.id=a.roster_id and r.active
      join public.locations l on l.id=r.location_id and l.active
      where a.verified_email=p_data->>'email');
  elsif p_action='email_token' then
    insert into express_private.email_tokens(account_id,purpose,token_hash,email)
      values((p_data->>'accountId')::uuid,p_data->>'purpose',p_data->>'tokenHash',p_data->>'email')
      on conflict(account_id,purpose) do update set token_hash=excluded.token_hash,email=excluded.email,expires_at=now()+interval '15 minutes';
    return 'true'::jsonb;
  elsif p_action='email_verify' then
    select a.* into v_account from express_private.accounts a where a.id=(p_data->>'accountId')::uuid for update;
    select email into v_email from express_private.email_tokens where account_id=v_account.id and purpose='verify' and token_hash=p_data->>'tokenHash' and expires_at>now();
    if v_email is null then return 'false'::jsonb; end if;
    begin
      update express_private.accounts set verified_email=v_email where id=v_account.id;
    exception when unique_violation then return 'false'::jsonb;
    end;
    delete from express_private.email_tokens where account_id=v_account.id;
    return 'true'::jsonb;
  elsif p_action='reset_email' then
    select a.* into v_account from express_private.accounts a
      join express_private.email_tokens t on t.account_id=a.id and t.purpose='reset' and t.token_hash=p_data->>'tokenHash' and t.expires_at>now() and t.email=a.verified_email
      for update of a;
    if v_account.id is null then return 'false'::jsonb; end if;
    -- Recheck after locking so a concurrent use cannot reuse the token.
    if not exists(select from express_private.email_tokens where account_id=v_account.id and purpose='reset' and token_hash=p_data->>'tokenHash' and expires_at>now()) then return 'false'::jsonb; end if;
    update express_private.accounts set pin_hash=p_data->>'pinHash',recovery_hash=p_data->>'recoveryHash' where id=v_account.id;
    delete from express_private.sessions where account_id=v_account.id;
    delete from express_private.email_tokens where account_id=v_account.id;
    return 'true'::jsonb;
  end if;
  raise exception 'Unknown Express operation.';
end;
$$;
revoke all on function public.express_service(text,jsonb) from public,anon,authenticated;
grant execute on function public.express_service(text,jsonb) to service_role;
