import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { createDemoStore } from "../src/ordering/demo.js";
import { createOrderingHandler } from "../api/ordering.js";
import { digest } from "../server/security.js";

async function fixture() {
  const db = new PGlite();
  await db.exec(
    "create role anon; create role authenticated; create role service_role bypassrls; create table public.locations(id bigint primary key,location_code text,school_name text,active boolean default true); grant select on public.locations to service_role; insert into public.locations values(1,'1111','Test A',true),(2,'2222','Test B',true)",
  );
  for (const file of [
    "20261020184637_express_account_foundation.sql",
    "20261021141529_express_faculty_ordering.sql",
  ])
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/" + file, import.meta.url),
        "utf8",
      ),
    );
  const service = async (action, data) =>
    (
      await db.query("select public.express_service($1,$2::jsonb) result", [
        action,
        JSON.stringify(data),
      ])
    ).rows[0].result;
  await service("import", {
    locationCode: "1111",
    rows: [
      {
        employeeNumber: "001",
        name: "SYNTHETIC FACULTY",
        nameKey: "synthetic faculty",
      },
    ],
  });
  await service("import", {
    locationCode: "2222",
    rows: [
      {
        employeeNumber: "002",
        name: "SYNTHETIC OTHER",
        nameKey: "synthetic other",
      },
    ],
  });
  await db.exec(
    "update express_private.schools set registration_enabled=true,ordering_enabled=true,opens_at='00:00',cutoff_at='23:59:59'",
  );
  const token = "a".repeat(64),
    otherToken = "b".repeat(64),
    pinHash = "scrypt:" + "c".repeat(32) + ":" + "c".repeat(64);
  for (const [number, session] of [
    ["001", token],
    ["002", otherToken],
  ]) {
    const roster = await service("roster_lookup", { employeeNumber: number });
    const account = await service("register", {
      rosterId: roster.id,
      pinHash,
      recoveryHash: "d".repeat(64),
    });
    await service("session_create", {
      accountId: account,
      pinHash,
      tokenHash: digest(session),
    });
  }
  const menus = (
    await db.query(
      "insert into express_private.menus(location_id,service_date,published) values(1,(clock_timestamp() at time zone 'America/Los_Angeles')::date,true),(1,(clock_timestamp() at time zone 'America/Los_Angeles')::date+1,true),(2,(clock_timestamp() at time zone 'America/Los_Angeles')::date,true) returning id,location_id,service_date",
    )
  ).rows;
  const menu = menus[0],
    future = menus[1],
    otherMenu = menus[2],
    selections = {};
  for (const category of ["entree", "fruit", "vegetable", "milk"]) {
    const option = (
      await db.query(
        "insert into express_private.menu_options(menu_id,category,name) values($1,$2,$3) returning id",
        [menu.id, category, "Test " + category],
      )
    ).rows[0];
    selections[category] = option.id;
  }
  const foreignOption = (
    await db.query(
      "insert into express_private.menu_options(menu_id,category,name) values($1,'fruit','Other school fruit') returning id",
      [otherMenu.id],
    )
  ).rows[0].id;
  const call = async (action, data = {}, session = token) =>
    (
      await db.query("select public.express_ordering($1,$2::jsonb) result", [
        action,
        JSON.stringify({ tokenHash: digest(session), ...data }),
      ])
    ).rows[0].result;
  const order = () => ({
    requestId: randomUUID(),
    menuId: menu.id,
    revision: 1,
    selections: { ...selections },
  });
  return {
    db,
    call,
    order,
    menu,
    future,
    otherMenu,
    foreignOption,
    token,
    otherToken,
  };
}
test("faculty see only today’s school menu and their own orders", async (t) => {
  const f = await fixture();
  t.after(() => f.db.close());
  const today = await f.call("today");
  assert.equal(today.orderingOpen, true);
  assert.equal(today.menu.id, f.menu.id);
  assert.equal(today.menu.options.length, 4);
  assert.equal(today.menu.priceCents, 684);
  assert.equal(today.orders.length, 0);
  assert.equal(JSON.stringify(today).includes(f.future.id), false);
  const placed = await f.call("submit", {
    ...f.order(),
    priceCents: 1,
    status: "Fulfilled",
    schoolId: 2,
    now: "2099-01-01",
  });
  assert.ok(placed.order);
  assert.equal(placed.order.status, "Ordered");
  assert.equal(placed.order.priceCents, 684);
  assert.match(placed.order.number, /^\d{8}-001$/);
  assert.equal(placed.order.items.length, 4);
  assert.equal((await f.call("today")).orders.length, 1);
  assert.equal((await f.call("today", {}, f.otherToken)).orders.length, 0);
  assert.equal((await f.call("today", {}, "c".repeat(64))).status, 401);
  await f.db.query(
    "update express_private.menu_options set name='Renamed later' where menu_id=$1",
    [f.menu.id],
  );
  assert.equal((await f.call("today")).orders[0].items[0].name, "Test entree");
});
test("submission is idempotent and numbering remains unique across concurrent requests", async (t) => {
  const f = await fixture();
  t.after(() => f.db.close());
  const request = f.order();
  const pair = await Promise.all([
    f.call("submit", request),
    f.call("submit", request),
  ]);
  assert.equal(pair[0].order.id, pair[1].order.id);
  const placed = await Promise.all(
    Array.from({ length: 8 }, () => f.call("submit", f.order())),
  );
  assert.equal(new Set(placed.map((x) => x.order.number)).size, 8);
  assert.equal(
    (await f.db.query("select count(*) n from express_private.orders")).rows[0]
      .n,
    9,
  );
  const different = {
    ...request,
    selections: { ...request.selections, fruit: randomUUID() },
  };
  assert.equal((await f.call("submit", different)).status, 409);
  await f.db.exec(
    "update express_private.schools set cutoff_at='00:00:01' where location_id=1; update express_private.schools set opens_at='00:00:00' where location_id=1",
  );
  assert.equal((await f.call("submit", request)).order.id, pair[0].order.id);
});
test("server rejects late, future, unpublished, changed, and cross-school menu selections", async (t) => {
  const f = await fixture();
  t.after(() => f.db.close());
  assert.equal(
    (await f.call("submit", { ...f.order(), menuId: f.future.id })).status,
    409,
  );
  assert.equal(
    (await f.call("submit", { ...f.order(), revision: 2 })).status,
    409,
  );
  const foreign = f.order();
  foreign.selections.fruit = f.foreignOption;
  assert.equal((await f.call("submit", foreign)).status, 409);
  const incomplete = f.order();
  delete incomplete.selections.milk;
  assert.equal((await f.call("submit", incomplete)).status, 400);
  await f.db.exec(
    "update express_private.schools set cutoff_at='00:00:01',opens_at='00:00:00' where location_id=1",
  );
  const closed = await f.call("today");
  assert.equal(closed.orderingOpen, false);
  assert.ok(closed.nextOpening);
  assert.equal((await f.call("submit", f.order())).status, 409);
  await f.db.exec(
    "update express_private.schools set opens_at=null,cutoff_at=null where location_id=1",
  );
  const noSchedule = await f.call("today");
  assert.equal(noSchedule.orderingOpen, false);
  assert.equal(noSchedule.nextOpening, null);
  await f.db.query(
    "update express_private.menus set published=false where id=$1",
    [f.menu.id],
  );
  assert.equal((await f.call("today")).menu, null);
});
test("new order tables and functions are closed to browser roles", async (t) => {
  const f = await fixture();
  t.after(() => f.db.close());
  for (const role of ["anon", "authenticated"]) {
    await f.db.exec(`set role ${role}`);
    await assert.rejects(
      () => f.db.query("select public.express_ordering('today','{}')"),
      /permission denied/,
    );
    await assert.rejects(
      () => f.db.query("select * from express_private.orders"),
      /permission denied/,
    );
    await f.db.exec("reset role");
  }
  const tables = (
    await f.db.query(
      "select relrowsecurity from pg_class c join pg_namespace n on c.relnamespace=n.oid where n.nspname='express_private' and c.relkind='r'",
    )
  ).rows;
  assert.ok(tables.every((x) => x.relrowsecurity));
});
test("ordering HTTP handler enforces session and origin and strips untrusted fields", async () => {
  const calls = [];
  const env = {
    EXPRESS_ACCOUNTS_ENABLED: "true",
    SUPABASE_URL: "http://localhost:54321",
    SUPABASE_SERVICE_ROLE_KEY: "test",
    EXPRESS_RATE_LIMIT_SECRET: "s".repeat(64),
    EXPRESS_ORIGIN: "http://localhost:5173",
  };
  const handler = createOrderingHandler({
    env,
    limit: async () => true,
    call: async (config, action, data) => {
      calls.push({ action, data });
      return { order: { id: "test-order" } };
    },
  });
  async function request(
    body,
    cookie = "express_session=" + "a".repeat(64),
    origin = env.EXPRESS_ORIGIN,
  ) {
    const res = {
      setHeader() {},
      end(text) {
        this.body = JSON.parse(text);
      },
    };
    await handler(
      {
        method: "POST",
        headers: { origin, cookie, "content-type": "application/json" },
        body,
      },
      res,
    );
    return res;
  }
  const selections = Object.fromEntries(
    ["entree", "fruit", "vegetable", "milk"].map((x) => [x, randomUUID()]),
  );
  const valid = {
    requestId: randomUUID(),
    menuId: randomUUID(),
    revision: 1,
    selections,
  };
  assert.equal((await request(valid, "")).statusCode, 401);
  assert.equal(
    (await request(valid, undefined, "https://other.example")).statusCode,
    403,
  );
  assert.equal(
    (await request({ ...valid, requestId: "demo-order" })).statusCode,
    400,
  );
  assert.equal(
    (
      await request({
        ...valid,
        priceCents: 0,
        accountId: "other",
        tokenHash: "fake",
      })
    ).statusCode,
    200,
  );
  assert.equal(calls[0].data.priceCents, undefined);
  assert.equal(calls[0].data.accountId, undefined);
  assert.equal(calls[0].data.tokenHash, digest("a".repeat(64)));
});
test("dummy workflow stays local, prevents duplicates, and checks matching pickup", async () => {
  const store = createDemoStore(() => new Date("2026-10-21T16:00:00Z"));
  const page = await store.load();
  const selections = Object.fromEntries(
    ["entree", "fruit", "vegetable", "milk"].map((c) => [
      c,
      page.menu.options.find((x) => x.category === c).id,
    ]),
  );
  const request = { requestId: "practice", selections };
  const order = await store.place(request);
  assert.equal((await store.place(request)).id, order.id);
  assert.match(order.number, /^DEMO-20261021-001$/);
  store.advance(order.id);
  store.advance(order.id);
  assert.equal((await store.load()).orders[0].status, "Ready for Pickup");
  assert.throws(() => store.fulfill(order.id, false), /another faculty/);
  assert.equal((await store.load()).orders[0].status, "Ready for Pickup");
  store.fulfill(order.id, true);
  assert.equal((await store.load()).orders[0].status, "Fulfilled");
  assert.throws(() => store.fulfill(order.id, true), /ready/);
  store.setClosed(true);
  await assert.rejects(
    () => store.place({ requestId: "new", selections }),
    /closed/,
  );
  store.reset();
  assert.equal((await store.load()).orders.length, 0);
});
