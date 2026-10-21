import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createHandler } from "../api/account.js";
import { configuration, PRODUCTION_REF } from "../server/database.js";
import {
  digest,
  normalizeName,
  readSession,
  sessionCookie,
  hashPin,
  checkPin,
} from "../server/security.js";

const env = {
  EXPRESS_ACCOUNTS_ENABLED: "true",
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_SERVICE_ROLE_KEY: "test-only",
  EXPRESS_RATE_LIMIT_SECRET: "s".repeat(64),
  EXPRESS_ORIGIN: "http://localhost:5173",
};
async function fixture() {
  const db = new PGlite();
  await db.exec(
    `create role anon; create role authenticated; create role service_role bypassrls; create table public.locations(id bigint primary key,location_code text unique,school_name text,active boolean default true); grant select on public.locations to service_role; insert into public.locations values(1,'1111','School A',true),(2,'2222','School B',true);`,
  );
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20261020184637_express_account_foundation.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const call = async (_config, action, data = {}) =>
    (
      await db.query("select public.express_service($1,$2::jsonb) result", [
        action,
        JSON.stringify(data),
      ])
    ).rows[0].result;
  await call(null, "import", {
    locationCode: "1111",
    rows: [
      { employeeNumber: "000101", name: "JORDAN LEE", nameKey: "jordan lee" },
      { employeeNumber: "000102", name: "JORDAN LEE", nameKey: "jordan lee" },
    ],
  });
  await call(null, "import", {
    locationCode: "2222",
    rows: [
      { employeeNumber: "000201", name: "ALEX SMITH", nameKey: "alex smith" },
    ],
  });
  await db.exec("update express_private.schools set registration_enabled=true");
  const emails = [];
  const handler = createHandler({
    env: {
      ...env,
      RESEND_API_KEY: "test",
      EXPRESS_EMAIL_FROM: "test@example.com",
    },
    call,
    deliver: async (...args) => emails.push(args),
  });
  const request = async (action, body = {}, cookie = "", headers = {}) => {
    const response = {
      headers: {},
      statusCode: 200,
      setHeader(k, v) {
        this.headers[k.toLowerCase()] = v;
      },
      end(text) {
        this.body = JSON.parse(text);
      },
    };
    await handler(
      {
        method: action ? "POST" : "GET",
        headers: {
          origin: env.EXPRESS_ORIGIN,
          "content-type": "application/json",
          cookie,
          ...headers,
        },
        socket: { remoteAddress: "127.0.0.1" },
        body: action ? { action, ...body } : undefined,
      },
      response,
    );
    return {
      ...response,
      cookie: response.headers["set-cookie"]?.split(";")[0],
    };
  };
  return { db, call, request, emails };
}
test("secure configuration isolates production and preview environments", () => {
  const production = {
    ...env,
    SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`,
    EXPRESS_ORIGIN: "https://express.cafelalistens.org",
    EXPRESS_ALLOW_PRODUCTION_DATABASE: "true",
  };
  assert.throws(() => configuration(production), /Preview/);
  assert.throws(
    () =>
      configuration({
        ...production,
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "main",
      }),
    /Preview/,
  );
  assert.equal(
    configuration({
      ...production,
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "main",
    }).ready,
    true,
  );
  assert.equal(configuration({}).ready, false);
  assert.throws(
    () => configuration({ ...env, SUPABASE_URL: "http://untrusted.example" }),
    /secure/,
  );
  assert.throws(
    () =>
      configuration({ ...env, EXPRESS_ORIGIN: "https://express.example/path" }),
    /without a path/,
  );
});
test("PINs are salted and sessions use host-only HttpOnly cookies", async () => {
  const a = await hashPin("123456"),
    b = await hashPin("123456");
  assert.notEqual(a, b);
  assert.equal(await checkPin("123456", a), true);
  assert.equal(await checkPin("654321", a), false);
  assert.equal(await checkPin("123456", "invalid"), false);
  const token = "a".repeat(64);
  assert.match(
    sessionCookie(token, true),
    /__Host-express_session=.*HttpOnly; SameSite=Strict.*Secure/,
  );
  assert.equal(readSession(`__Host-express_session=${token}`, true), token);
  assert.equal(readSession(`express_session=${token}`, true), null);
  assert.equal(normalizeName("  Jordan   LEE "), "jordan lee");
});
test("registration, duplicate names, own-account sessions, recovery, and revocation", async (t) => {
  const f = await fixture();
  t.after(() => f.db.close());
  const first = await f.request("register", {
    employeeNumber: "000101",
    pin: "123456",
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.account.schoolCode, "1111");
  assert.equal(first.body.account.name, "JORDAN LEE");
  assert.ok(first.body.recoveryCode);
  assert.ok(first.cookie);
  assert.equal(JSON.stringify(first.body).includes("pinHash"), false);
  assert.equal(JSON.stringify(first.body).includes("000101"), false);
  const claimed = await f.request("register", {
    employeeNumber: "000101",
    pin: "654321",
  });
  assert.equal(claimed.statusCode, 400);
  assert.equal(
    (await f.request("register", { employeeNumber: "999999", pin: "654321" }))
      .body.error,
    claimed.body.error,
  );
  const second = await f.request("register", {
    employeeNumber: "000102",
    pin: "123456",
  });
  assert.equal(second.statusCode, 200);
  const third = await f.request("register", {
    employeeNumber: "000201",
    pin: "456789",
  });
  assert.equal(third.body.account.schoolCode, "2222");
  const ambiguous = await f.request("login", {
    name: "Jordan Lee",
    pin: "123456",
  });
  assert.equal(ambiguous.statusCode, 401);
  assert.equal(ambiguous.body.account, undefined);
  const login = await f.request("login", {
    name: " JORDAN   LEE ",
    pin: "123456",
    employeeNumber: "000101",
  });
  assert.equal(login.statusCode, 200);
  assert.equal(login.body.account.id, first.body.account.id);
  const mine = await f.request(null, {}, first.cookie);
  assert.equal(mine.body.account.id, first.body.account.id);
  const other = await f.request(null, {}, third.cookie);
  assert.equal(other.body.account.id, third.body.account.id);
  assert.notEqual(mine.body.account.id, other.body.account.id);
  const reset = await f.request("recover", {
    employeeNumber: "000101",
    recoveryCode: first.body.recoveryCode,
    pin: "777777",
  });
  assert.equal(reset.statusCode, 200);
  assert.notEqual(reset.body.recoveryCode, first.body.recoveryCode);
  assert.equal((await f.request(null, {}, first.cookie)).body.account, null);
  assert.equal((await f.request(null, {}, login.cookie)).body.account, null);
  assert.equal(
    (await f.request(null, {}, second.cookie)).body.account.id,
    second.body.account.id,
  );
  assert.equal(
    (
      await f.request("recover", {
        employeeNumber: "000101",
        recoveryCode: first.body.recoveryCode,
        pin: "777777",
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await f.request("login", {
        name: "Jordan Lee",
        pin: "123456",
        employeeNumber: "000101",
      })
    ).statusCode,
    401,
  );
  const newLogin = await f.request("login", {
    name: "Jordan Lee",
    pin: "777777",
    employeeNumber: "000101",
  });
  assert.equal(newLogin.statusCode, 200);
  assert.equal(
    (await f.request("logout", {}, newLogin.cookie)).statusCode,
    200,
  );
  assert.equal((await f.request(null, {}, newLogin.cookie)).body.account, null);
});
test("email ownership must be verified; reset tokens expire and are single use", async (t) => {
  const f = await fixture();
  t.after(() => f.db.close());
  const a = await f.request("register", {
    employeeNumber: "000101",
    pin: "123456",
  });
  const b = await f.request("register", {
    employeeNumber: "000201",
    pin: "654321",
  });
  await f.request("email_recover", { email: "teacher@example.com" });
  assert.equal(f.emails.length, 0);
  assert.equal(
    (await f.request("email_send", { email: "teacher@example.com" }, a.cookie))
      .statusCode,
    200,
  );
  const code = f.emails[0][2].match(/code is (\d{6})/)[1];
  assert.equal(
    (await f.request("email_verify", { code }, b.cookie)).statusCode,
    400,
  );
  const verified = await f.request("email_verify", { code }, a.cookie);
  assert.equal(verified.statusCode, 200);
  assert.equal(verified.body.account.email, "teacher@example.com");
  assert.equal(
    (await f.request("email_verify", { code }, a.cookie)).statusCode,
    400,
  );
  await f.request("email_recover", { email: "teacher@example.com" });
  const token = f.emails.at(-1)[2].match(/#reset=([a-f0-9]{64})/)[1];
  const reset = await f.request("email_reset", { token, pin: "777777" });
  assert.equal(reset.statusCode, 200);
  assert.equal(
    (await f.request("email_reset", { token, pin: "777777" })).statusCode,
    400,
  );
  assert.equal((await f.request(null, {}, a.cookie)).body.account, null);
  await f.request("email_recover", { email: "teacher@example.com" });
  const expired = f.emails.at(-1)[2].match(/#reset=([a-f0-9]{64})/)[1];
  await f.db.exec(
    "update express_private.email_tokens set expires_at=now()-interval '1 second'",
  );
  assert.equal(
    (await f.request("email_reset", { token: expired, pin: "999999" }))
      .statusCode,
    400,
  );
});
test("PIN guessing is limited in the database and cross-origin mutations are rejected", async (t) => {
  const f = await fixture();
  t.after(() => f.db.close());
  const a = await f.request("register", {
    employeeNumber: "000101",
    pin: "123456",
  });
  for (let i = 0; i < 10; i++)
    assert.equal(
      (await f.request("login", { name: "Jordan Lee", pin: "111111" }))
        .statusCode,
      401,
    );
  assert.equal(
    (
      await f.request("login", {
        name: "JORDAN LEE",
        pin: "123456",
        employeeNumber: "000101",
      })
    ).statusCode,
    429,
  );
  assert.equal(
    (
      await f.request("logout", {}, a.cookie, {
        origin: "https://evil.example",
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await f.request("logout", {}, a.cookie, { origin: undefined })).statusCode,
    403,
  );
  assert.equal(
    (await f.request(null, {}, a.cookie)).body.account.id,
    a.body.account.id,
  );
  assert.equal(
    (await f.request("logout", {}, a.cookie, { "content-type": "text/plain" }))
      .statusCode,
    415,
  );
});
test("anonymous and ordinary authenticated roles cannot read rosters or call privileged functions", async (t) => {
  const f = await fixture();
  t.after(() => f.db.close());
  for (const role of ["anon", "authenticated"]) {
    await f.db.exec(`set role ${role}`);
    await assert.rejects(
      () => f.db.query("select * from express_private.roster"),
      /permission denied/,
    );
    await assert.rejects(
      () => f.db.query("select public.express_service('roster_lookup','{}')"),
      /permission denied/,
    );
    await f.db.exec("reset role");
  }
  const rls = (
    await f.db.query(
      "select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='express_private' and c.relkind='r'",
    )
  ).rows;
  assert.equal(rls.length, 6);
  assert.ok(rls.every((r) => r.relrowsecurity));
  await f.db.exec("set role service_role");
  assert.equal(await f.call(null, "status"), true);
  await f.db.exec("reset role");
});
test("imports cannot reassign an existing employee to another school and registration fails closed", async (t) => {
  const f = await fixture();
  t.after(() => f.db.close());
  await assert.rejects(
    () =>
      f.call(null, "import", {
        locationCode: "2222",
        rows: [
          {
            employeeNumber: "000101",
            name: "JORDAN LEE",
            nameKey: "jordan lee",
          },
        ],
      }),
    /another school/,
  );
  await f.db.exec(
    "update express_private.schools set registration_enabled=false where location_id=1",
  );
  assert.equal(
    (await f.request("register", { employeeNumber: "000101", pin: "123456" }))
      .statusCode,
    400,
  );
  const disabled = createHandler({ env: {} });
  const response = {
    setHeader() {},
    end(text) {
      this.body = JSON.parse(text);
    },
  };
  await disabled({ method: "GET", headers: {} }, response);
  assert.equal(response.body.available, false);
});
