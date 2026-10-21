import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { hashPin, digest } from "../server/security.js";
test("atomic registration and recovery accept a single winner", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(
    "create role anon; create role authenticated; create role service_role bypassrls; create table public.locations(id bigint primary key,location_code text,school_name text,active boolean); insert into public.locations values(1,'1111','Test school',true)",
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
  const call = async (action, data) =>
    (
      await db.query("select public.express_service($1,$2::jsonb) result", [
        action,
        JSON.stringify(data),
      ])
    ).rows[0].result;
  await call("import", {
    locationCode: "1111",
    rows: [
      {
        employeeNumber: "001",
        name: "SYNTHETIC EMPLOYEE",
        nameKey: "synthetic employee",
      },
    ],
  });
  await db.exec("update express_private.schools set registration_enabled=true");
  const roster = await call("roster_lookup", { employeeNumber: "001" }),
    pinHash = await hashPin("123456");
  const data = {
    rosterId: roster.id,
    pinHash,
    recoveryHash: digest("original"),
  };
  const claims = await Promise.all([
    call("register", data),
    call("register", data),
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
  const reset = {
    accountId: claims.find(Boolean),
    oldRecoveryHash: digest("original"),
    pinHash,
    recoveryHash: digest("replacement"),
  };
  const resets = await Promise.all([
    call("reset_code", reset),
    call("reset_code", reset),
  ]);
  assert.deepEqual(resets.sort(), [false, true]);
});
