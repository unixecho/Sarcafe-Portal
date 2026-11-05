-- 20261105223000_kiosk_remote_control
--
-- The kiosk managed from the dashboard (owner, 2026-11-05: "I want the kiosk to be manageable from the dashboard … I want to be
-- able to reset the kiosk pin as well from the dashboard"). The settings were already the owner's (kiosk_devices.settings); this
-- adds what the tablet's own control panel could do and the dashboard could not:
--
--   1. kiosk_devices.pending_command: ONE thing for the tablet to do the next time it reports (every 5 minutes): reload its page,
--      or look for updates now. Written by the owner (POST /api/owner/kiosk/devices/actions), handed to the tablet in the answer
--      to its report, cleared when the tablet says it was done. Older pages ignore it (nothing breaks).
--   2. kiosk_pin_resets: a new staff PIN for one tablet, chosen on the dashboard. ONLY its PBKDF2 record is stored (the same
--      "pbkdf2$<iterations>$<salt>$<hash>" the app keeps, StaffPin.java), never the PIN; at most one pending per tablet (a new
--      one replaces it); the app fetches it with the kiosk key, adopts it, says so, and the row is deleted. Needs app 0.4+.
--
-- Additive and idempotent. No functions. Nothing here is reachable from a browser role: RLS on, every grant revoked, service role
-- only. Before this is applied the dashboard answers "not ready" for the two actions; nothing else changes.

alter table public.kiosk_devices add column if not exists pending_command jsonb
  check (pending_command is null or (jsonb_typeof(pending_command) = 'object' and pg_column_size(pending_command) <= 512));
alter table public.kiosk_devices add column if not exists pin_reset_applied_at timestamptz;

create table if not exists public.kiosk_pin_resets (
  device_id     uuid primary key references public.kiosk_devices(id) on delete cascade,
  id            uuid not null default gen_random_uuid(),
  record        text not null check (record ~ '^pbkdf2\$[0-9]{4,7}\$[0-9a-f]{32}\$[0-9a-f]{64}$'),
  created_by    uuid references public.staff(id) on delete set null,
  created_at    timestamptz not null default now(),
  delivered_at  timestamptz
);
alter table public.kiosk_pin_resets enable row level security;
revoke all on public.kiosk_pin_resets from public, anon, authenticated;
grant all on public.kiosk_pin_resets to service_role;

-- Check after applying (all must be true):
--   select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'kiosk_devices'
--            and column_name in ('pending_command', 'pin_reset_applied_at')) = 2 as columns_2,
--          to_regclass('public.kiosk_pin_resets') is not null as pin_table,
--          (select relrowsecurity from pg_class where oid = 'public.kiosk_pin_resets'::regclass) as rls_on;
-- Ledger row:
--   insert into supabase_migrations.schema_migrations (version, name) values ('20261105223000', 'kiosk_remote_control') on conflict do nothing;
