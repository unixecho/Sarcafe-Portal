-- 20261106140000_kiosk_enrollments
--
-- The kiosk install wizard (owner, 2026-11-06: "an install wizard and a private internal link I can use to install the kiosk on any
-- tablet"). The owner chooses a branch, a tablet name and the staff PIN on /owner/kiosk/install; the portal registers the tablet
-- (kiosk_devices) and makes a ONE-TIME install code shown only inside the QR on that page. A factory-reset tablet scans the QR
-- (Android's own device-owner setup), downloads the kiosk app, and the app trades the code ONCE at POST /api/kiosk/enroll for its
-- settings (the portal address, the realtime channel, the kiosk key, its name, the PIN record). docs/SARCAFE_KIOSK_INSTALL.md.
--
-- Only the SHA-256 of the code is stored, never the code. The PIN is stored only as the app's own PBKDF2 record (StaffPin.java),
-- never the PIN. A code works once, for 24 hours. Additive and idempotent; no functions; RLS on, browser roles get nothing.

create table if not exists public.kiosk_enrollments (
  id          uuid primary key default gen_random_uuid(),
  code_hash   text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  device_id   uuid not null references public.kiosk_devices(id) on delete cascade,
  pin_record  text check (pin_record is null or pin_record ~ '^pbkdf2\$[0-9]{4,7}\$[0-9a-f]{32}\$[0-9a-f]{64}$'),
  created_by  uuid references public.staff(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);
create index if not exists kiosk_enrollments_device_idx on public.kiosk_enrollments (device_id, created_at desc);
alter table public.kiosk_enrollments enable row level security;
revoke all on public.kiosk_enrollments from public, anon, authenticated;
grant all on public.kiosk_enrollments to service_role;

-- Check after applying (all true):
--   select to_regclass('public.kiosk_enrollments') is not null as enrollments,
--          (select relrowsecurity from pg_class where oid = 'public.kiosk_enrollments'::regclass) as rls_on;
-- Ledger row:
--   insert into supabase_migrations.schema_migrations (version, name) values ('20261106140000', 'kiosk_enrollments') on conflict do nothing;
