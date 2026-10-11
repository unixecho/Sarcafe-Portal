# Cross-agent continuity

At the beginning of every session, read root `handoff.md` before inspecting or editing the application. Then read the referenced planning/implementation documents, including `chatGPT/README.md` when ChatGPT work is involved.

Treat the handoff as a continuity record: distinguish confirmed user requirements, inspected current behavior, proposals, implemented changes, and deployed changes. The user's latest instructions take precedence. Verify current branch/status before continuing and preserve other sessions' work.

At the end of every session, update `handoff.md` with decisions, files changed, migrations applied or not applied, verification outcomes, remaining issues, and the exact next step. Update relevant domain documentation when behavior changes. Never record credentials, employee codes, secret environment values, or personal staff data.

# Database naming and migrations (applies to every agent, Claude and Codex alike)

Follow what the schema already does. Do not invent a new scheme.

- **Migration files:** `supabase/migrations/YYYYMMDDHHMMSS_snake_case_summary.sql`, a UTC timestamp later than the newest file. The old `000`–`024` numbered files are history; never add one. The production ledger version must equal the filename timestamp and the name must equal the summary (`20261011140000_drop_integer_pos_verify_pin.sql` is version `20261011140000`, name `drop_integer_pos_verify_pin`). Migrations are additive and idempotent (`if not exists`, `create or replace`, `drop ... if exists`); never edit one already applied.
- **Names are snake_case with a domain prefix.** Functions: `sched_*` (scheduling), `pos_*` (point of sale), `staff_*` (people, invitations, Google link), `checklist_*`, `order_*`; helpers keep their verb (`is_`, `can_`). Tables: `pos_*`, `shift*`/`schedule_*`, `staff_*`, `order*`, `menu*`, `checklist_*`. Parameters are `p_<name>`. `internal_*` functions are never callable by `service_role` or browser roles.
- **Never overload a function.** One name, one signature. A second signature (even a different argument type) makes the Supabase REST layer reject every JSON call with PGRST203 and the feature goes down: this locked every employee out of PIN login on 2026-10-09. To change a signature, `drop function` the old one in the same migration and update every caller. If both must briefly coexist, the new one gets a new name or distinct argument names. `scripts/verify-onboarding-sql.mjs` fails on any function name with two signatures.
- **Identifiers that can start with zero are `text`,** never `integer` (`employee_code`, not `employee_no`).
- **Access:** every new function is `revoke all ... from public, anon, authenticated` then `grant execute ... to service_role` (exact signature). New tables enable RLS; browser roles get nothing unless a policy is deliberate.
- **Before applying to production:** run `npm run verify:schedule-sql`, `verify:checklist-sql` and `verify:onboarding-sql`, check `pg_proc` for duplicate names, and record the ledger row. Say in `handoff.md` whether it was applied.
