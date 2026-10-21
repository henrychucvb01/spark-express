# SPARK Express

Faculty lunch preordering for CAFELA at **https://express.cafelalistens.org**.
Pilot: Banning High School. Managers continue using the existing SPARK dashboard.

## Current milestone: faculty ordering and workflow demo

Open **https://spark-express.vercel.app/?demo=1** to try the dummy account:

- Name: **Demo Faculty**
- PIN: **246810**

The demo uses fictional menu choices and browser-memory-only orders. No demo order, employee record, or payment is sent to Supabase, SPARK, a cafeteria, or the district POS. Refreshing clears the demo. It walks through meal selection, review, automatic acceptance, preparation, readiness, and a simulated matching/mismatched pickup check. Camera scanning and district POS QR display remain in the pickup implementation phase.

Faculty ordering now includes today's menu, four required meal components, $6.84 complete lunch pricing, review, idempotent submission, and status refresh. The additive ordering migration validates the account, school, published service date, active options, menu revision, opening time, and cutoff entirely on the server. Orders preserve selected-item snapshots and receive a globally unique date/sequence number atomically. A reused request returns the original order, while changed selections under that request are rejected.

Real ordering remains closed until the isolated-test setup, production backend configuration, manager menu tools, and school schedule are completed. No menus or opening times are seeded in the production database. Milk decline stays unavailable pending district rule confirmation. The demo schedule is explicitly fictional.

Implemented in this branch:

- Responsive café landing page and faculty account screens.
- Private roster validation/import with exact district employee numbers preserved as text.
- Registration with employee number and a six-digit personal PIN.
- Name/PIN login; optional employee number distinguishes duplicate names without a directory.
- Salted scrypt PIN hashes, HttpOnly sessions, database-backed attempt limits, and origin validation.
- Single-use recovery codes that rotate on reset and revoke all existing account sessions.
- Optional verified email and single-use email reset links (requires a configured sender).
- Additive Supabase migration, tested against an isolated Postgres instance using PGlite.

**This is not a launch-ready ordering system.** Manager menu publishing, kitchen tickets, camera pickup scanning, POS QR display, SPARK manager integration, and notifications are subsequent phases. No production migration or live roster import has been performed by this branch. Without configuration, account access stays closed; the separate demo remains usable.

## Local development

Use Node 24.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

The frontend runs on port 5173 and the local API on 5174. Leave `EXPRESS_ACCOUNTS_ENABLED=false` to inspect the UI without a database. To test accounts, configure an **isolated** Supabase project, apply the migration, import the roster, and enable registration for the relevant verified location. Do not point local/Preview environments at the production SPARK database.

```sh
npm test
npm run build
npm run test:ui
```

Tests exercise the real migration and the API handler with synthetic employees. They cover registration, roster privacy, duplicate names, isolated sessions, reset/revocation, email verification, reset expiry/reuse, CSRF, attempt limits, and database-role restrictions.

Ordering tests also cover today's-only visibility, cutoff enforcement, cross-school item rejection, snapshots, atomic sequence numbers, and retry deduplication. The UI test exercises the built React app in a DOM environment, including demo login, component selections, review, cutoff preview, status changes, and mismatch/match pickup outcomes. It verifies no order POST is sent. This checks interactions; it does not replace visual testing on actual phones or camera testing.

## Roster validation and import

The roster must stay **outside** the repository. All CSV/TSV files are ignored as a second safeguard. Never add employee data, credentials, PINs, or recovery codes to source control.

Dry-run validation is the default:

```sh
npm run roster:check -- --file /private/path/roster.csv --location-code 8529
```

After applying the migration to the isolated target, set the server-only environment variables in the shell and run:

```sh
npm run roster:import -- --file /private/path/roster.csv --location-code 8529
```

The importer resolves `public.locations.location_code` on the target database. It rejects invalid/duplicate employee numbers and attempts to reassign an existing employee to another school. It does not delete absent employees or enable registration. Counts are logged; employee records are not.

Enable registration only after validating the import, using an administrative connection:

```sql
update express_private.schools s
set registration_enabled = true
from public.locations l
where l.id = s.location_id and l.location_code = '8529' and l.active;
```

## Server configuration

All variables in `.env.example` are **server-only**, including the service-role key. Do not use `VITE_` prefixes. The frontend calls only `/api/account`; it does not receive Supabase keys or the roster.

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Isolated test project, then the verified SPARK production project at launch |
| `SUPABASE_SERVICE_ROLE_KEY` | Server credential for that exact project |
| `EXPRESS_RATE_LIMIT_SECRET` | Random secret of at least 32 characters for HMAC rate-limit identifiers |
| `EXPRESS_ORIGIN` | Exact website origin, with no path |
| `EXPRESS_ACCOUNTS_ENABLED` | Explicit account-access gate; default false |
| `EXPRESS_ALLOW_PRODUCTION_DATABASE` | Additional production-only opt-in; never enable in Preview |
| `RESEND_API_KEY` | Optional email provider credential |
| `EXPRESS_EMAIL_FROM` | Optional verified email sender |

Production database access requires Vercel Production, the `main` branch, the exact Express origin, and the explicit production opt-in. Vercel Preview must have its own test credentials. Production variables must not be shared with Preview, even though the runtime also blocks the known production project in Preview/local.

Email recovery is optional for faculty. Without a configured provider and sender, only saved recovery codes are offered. Email delivery and Vercel deployment must still be tested against real configured services before launch.

## Database boundary

The existing SPARK connection was verified as **Manager Checklist**, project `kkrcxqhfzepifhkryodd`. The separate `cafela-listens` project is not assumed to be the same backend. Banning HS is currently `public.locations.id = 8`, district location code `8529`; application logic resolves location codes rather than hardcoding that ID.

All new credential/roster/session tables are in `express_private`, have RLS enabled, and deny browser roles all access. The only public RPC is `express_service`, with `SECURITY INVOKER` and execution granted only to `service_role`. Every browser action is validated by the server; a faculty session exposes only its own profile. The existing SPARK and SSS tables, functions, credentials, and interfaces are untouched.

The migration depends on the existing `public.locations` table. The test suite creates a minimal synthetic equivalent. Do not create a competing schools directory in production.

## Next integration steps

1. Test this migration and import against an isolated Supabase project.
2. Verify registration/recovery on phones, including email delivery when configured.
3. Add Express menus/orders and the Express Orders screen inside SPARK.
4. Enforce manager location access explicitly using current server-validated SPARK sessions and employee/location assignments. The shared `require_actor(location_id)` helper alone does not check assignment. Covering-manager Express permissions require an explicit scoped assignment before implementation.
5. Implement server-validated Pacific-time menu dates and cutoff/opening times; no assumed reopening time.
6. Implement atomic order numbering, idempotent submission, and private live order updates. SPARK currently uses polling; no production tables were published through `supabase_realtime` at inspection.
7. Reuse SSS's working POS encoding (`QRCode.toDataURL(employeeNumber, {errorCorrectionLevel:'M', margin:4, width:600})`). Order-ticket QR codes remain separate and identify unique orders.

Complete lunch is **$6.84 including tax**, as supplied by the project requirements. No payment collection, POS transaction integration, inventory system, or separate manager dashboard belongs in Express. Component-decline policy still needs district confirmation before it is enabled.

## Ordering integration contract

`GET /api/ordering` returns only the signed-in faculty member's published menu and orders for the current Pacific service date. `POST /api/ordering` accepts `menuId`, `revision`, a UUID `requestId`, and four option UUIDs under `selections` (`entree`, `fruit`, `vegetable`, `milk`). Identity, school, price, status, and time are derived by the server. Future menus are never returned as choices; a configured next published opening can be shown after closure.

The second migration creates private menus, menu options, daily sequence counters, orders, and status events. It exposes only a service-role-only `SECURITY INVOKER` RPC, `express_ordering`. Browser roles cannot read any of these tables. The existing SPARK/SSS infrastructure is unchanged. Manager mutation functions in the next phase must lock the menu row, increment its revision when choices change, explicitly authorize the manager's school, and record preparation-status events. Faculty endpoints cannot change preparation status or mark real orders fulfilled.
