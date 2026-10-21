-- Faculty ordering. No published menus or ordering schedules are seeded.
alter table express_private.schools add column ordering_enabled boolean not null default false;
alter table express_private.schools add column opens_at time;
alter table express_private.schools add column cutoff_at time;
alter table express_private.schools add constraint express_school_hours check (opens_at is null or cutoff_at is null or opens_at<cutoff_at);
create table express_private.menus (
  id uuid primary key default gen_random_uuid(),
  location_id bigint not null references public.locations(id),
  service_date date not null,
  published boolean not null default false,
  revision integer not null default 1 check(revision>0),
  unique(location_id,service_date)
);
create table express_private.menu_options (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null references express_private.menus(id) on delete cascade,
  category text not null check(category in ('entree','fruit','vegetable','milk')),
  name text not null check(length(name) between 1 and 160),
  description text check(length(description)<=400),
  active boolean not null default true,
  sort_order integer not null default 0
);
create index express_options_menu on express_private.menu_options(menu_id,category,sort_order);
create table express_private.order_counters (
  service_date date primary key,
  last_number integer not null check(last_number>0)
);
create table express_private.orders (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references express_private.accounts(id),
  location_id bigint not null references public.locations(id),
  menu_id uuid not null references express_private.menus(id),
  request_id uuid not null,
  service_date date not null,
  order_number text not null unique,
  selections jsonb not null check(jsonb_array_length(selections)=4),
  price_cents integer not null default 684 check(price_cents=684),
  status text not null default 'Ordered' check(status in ('Ordered','Preparing','Ready for Pickup','Fulfilled')),
  submitted_at timestamptz not null default clock_timestamp(),
  unique(account_id,request_id)
);
create index express_orders_faculty_date on express_private.orders(account_id,service_date,submitted_at);
create index express_orders_school_date on express_private.orders(location_id,service_date,submitted_at);
create table express_private.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references express_private.orders(id),
  status text not null,
  recorded_at timestamptz not null default clock_timestamp()
);
create index express_order_events_order on express_private.order_events(order_id,recorded_at);
alter table express_private.menus enable row level security;
alter table express_private.menu_options enable row level security;
alter table express_private.order_counters enable row level security;
alter table express_private.orders enable row level security;
alter table express_private.order_events enable row level security;
revoke all on express_private.menus,express_private.menu_options,express_private.order_counters,express_private.orders,express_private.order_events from public,anon,authenticated;
grant select,insert,update,delete on express_private.menus,express_private.menu_options,express_private.order_counters,express_private.orders,express_private.order_events to service_role;

create function public.express_ordering(p_action text,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare
  v_account uuid; v_location bigint;
  v_school express_private.schools; v_menu express_private.menus; v_order express_private.orders;
  v_now timestamp:=clock_timestamp() at time zone 'America/Los_Angeles';
  v_date date; v_open boolean; v_next timestamp; v_reason text; v_items jsonb; v_orders jsonb;
  v_category text; v_choice express_private.menu_options; v_sequence integer; v_request uuid; v_result jsonb;
begin
  v_date:=v_now::date;
  select a.id,r.location_id into v_account,v_location from express_private.sessions se
    join express_private.accounts a on a.id=se.account_id
    join express_private.roster r on r.id=a.roster_id and r.active
    join public.locations l on l.id=r.location_id and l.active
    join express_private.schools s on s.location_id=r.location_id and s.registration_enabled
    where se.token_hash=p_data->>'tokenHash' and se.expires_at>clock_timestamp();
  if v_account is null then return jsonb_build_object('error','Sign in again to view your lunch.','status',401); end if;
  if p_action not in ('today','submit') then return jsonb_build_object('error','Unknown ordering request.','status',400); end if;
  if p_action='submit' then
    v_request:=(p_data->>'requestId')::uuid;
    -- Serialize requests from this account and recheck idempotency after locking.
    perform 1 from express_private.accounts where id=v_account for update;
    select * into v_order from express_private.orders where account_id=v_account and request_id=v_request;
    if v_order.id is not null then
      if v_order.menu_id::text<>p_data->>'menuId' or exists(select from jsonb_array_elements(v_order.selections) x where x->>'optionId' is distinct from p_data->'selections'->>(x->>'category')) then
        return jsonb_build_object('error','This request was already used for different selections.','status',409);
      end if;
      return jsonb_build_object('order',jsonb_build_object('id',v_order.id,'number',v_order.order_number,'serviceDate',v_order.service_date,'items',v_order.selections,'status',v_order.status,'priceCents',v_order.price_cents,'submittedAt',v_order.submitted_at));
    end if;
  end if;
  -- Share row locks with manager edits; every writer must lock/increment the menu revision.
  select * into v_school from express_private.schools where location_id=v_location for share;
  select * into v_menu from express_private.menus where location_id=v_location and service_date=v_date and published for share;
  v_now:=clock_timestamp() at time zone 'America/Los_Angeles';
  v_open:=v_school.ordering_enabled and v_school.opens_at is not null and v_school.cutoff_at is not null and v_menu.id is not null
    and v_now::date=v_date and v_now::time>=v_school.opens_at and v_now::time<v_school.cutoff_at;
  v_open:=coalesce(v_open,false);
  v_reason:=case when not v_school.ordering_enabled then 'Your school’s lunch ordering is being prepared.'
    when v_menu.id is null then 'Today’s menu has not been published yet.'
    when v_school.opens_at is null or v_school.cutoff_at is null then 'Ordering times have not been configured yet.'
    when v_now::time<v_school.opens_at then 'Ordering has not opened yet.'
    when not v_open then 'Ordering is closed for today.' else '' end;
  if not v_open and v_school.ordering_enabled and v_school.opens_at is not null then
    select min(m.service_date+v_school.opens_at) into v_next from express_private.menus m
      where m.location_id=v_location and m.published and m.service_date>=v_date and m.service_date+v_school.opens_at>v_now;
  end if;
  if p_action='submit' then
    if not v_open then return jsonb_build_object('error',v_reason,'status',409); end if;
    if v_menu.id::text is distinct from p_data->>'menuId' or v_menu.revision is distinct from (p_data->>'revision')::integer then
      return jsonb_build_object('error','The menu changed. Refresh today’s menu and review your choices.','status',409);
    end if;
    if jsonb_typeof(p_data->'selections') is distinct from 'object' or (select count(*) from jsonb_object_keys(p_data->'selections'))<>4 then
      return jsonb_build_object('error','Choose one item from each meal component.','status',400);
    end if;
    v_items:='[]'::jsonb;
    foreach v_category in array array['entree','fruit','vegetable','milk'] loop
      select * into v_choice from express_private.menu_options where menu_id=v_menu.id and category=v_category and active and id::text=p_data->'selections'->>v_category for share;
      if v_choice.id is null then return jsonb_build_object('error','One of your choices is no longer available. Refresh the menu.','status',409); end if;
      v_items:=v_items||jsonb_build_array(jsonb_build_object('category',v_category,'name',v_choice.name,'optionId',v_choice.id));
    end loop;
    -- Check the clock again immediately before accepting, after any lock waits.
    perform pg_advisory_xact_lock(hashtextextended('express-order-counter:'||v_date::text,0));
    v_now:=clock_timestamp() at time zone 'America/Los_Angeles';
    if v_now::date<>v_date or v_now::time>=v_school.cutoff_at then return jsonb_build_object('error','Ordering is closed for today.','status',409); end if;
    insert into express_private.order_counters(service_date,last_number) values(v_date,1)
      on conflict(service_date) do update set last_number=express_private.order_counters.last_number+1 returning last_number into v_sequence;
    insert into express_private.orders(account_id,location_id,menu_id,request_id,service_date,order_number,selections)
      values(v_account,v_location,v_menu.id,v_request,v_date,to_char(v_date,'YYYYMMDD')||'-'||lpad(v_sequence::text,greatest(3,length(v_sequence::text)),'0'),v_items) returning * into v_order;
    insert into express_private.order_events(order_id,status) values(v_order.id,'Ordered');
    return jsonb_build_object('order',jsonb_build_object('id',v_order.id,'number',v_order.order_number,'serviceDate',v_order.service_date,'items',v_order.selections,'status',v_order.status,'priceCents',v_order.price_cents,'submittedAt',v_order.submitted_at));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'number',o.order_number,'serviceDate',o.service_date,'items',o.selections,'status',o.status,'priceCents',o.price_cents,'submittedAt',o.submitted_at) order by o.submitted_at desc),'[]'::jsonb) into v_orders
    from express_private.orders o where o.account_id=v_account and o.service_date=v_date;
  return jsonb_build_object('available',true,'serviceDate',v_date,'orderingOpen',v_open,'reason',v_reason,
    'cutoffLabel',case when v_school.cutoff_at is not null then to_char(v_date+v_school.cutoff_at,'FMHH12:MI AM') else null end,
    'nextOpening',case when v_next is not null then to_char(v_next,'Mon DD, YYYY "at" FMHH12:MI AM')||' Pacific time' else null end,
    'menu',case when v_menu.id is null then null else jsonb_build_object('id',v_menu.id,'revision',v_menu.revision,'serviceDate',v_menu.service_date,'priceCents',684,'options',
      (select coalesce(jsonb_agg(jsonb_build_object('id',op.id,'category',op.category,'name',op.name,'description',op.description) order by op.sort_order,op.name),'[]'::jsonb) from express_private.menu_options op where op.menu_id=v_menu.id and op.active)) end,
    'orders',v_orders);
end;
$$;
revoke all on function public.express_ordering(text,jsonb) from public,anon,authenticated;
grant execute on function public.express_ordering(text,jsonb) to service_role;
