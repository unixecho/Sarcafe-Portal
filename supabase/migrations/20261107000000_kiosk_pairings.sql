-- 20261107000000_kiosk_pairings
--
-- Pairing a freshly installed kiosk by a short code on its own screen (owner, 2026-11-06: an install wizard inside the app; the tablet
-- has no QR reader, so the app was installed from a link and came up with no settings). The app's setup screen asks the portal for a
-- pairing (POST /api/kiosk/pair) and shows its short code; the owner types that code in the dashboard's install wizard
-- (/owner/kiosk/install), choosing the branch, the tablet's name and the staff PIN; the app, polling with its own long secret token,
-- then receives its settings once (the same settings as a QR install). docs/SARCAFE_KIOSK_INSTALL.md.
--
-- The short code is NOT a credential: it only lets a signed-in OWNER pick this pairing. The tablet proves itself with its token
-- (32 random bytes; only its SHA-256 is stored). A pairing lives 15 minutes and is claimed once. The PIN is stored only as the app's
-- PBKDF2 record. Additive and idempotent; no functions; RLS on, browser roles get nothing.

create table if not exists public.kiosk_pairings (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  device_id   uuid references public.kiosk_devices(id) on delete cascade,
  pin_record  text check (pin_record is null or pin_record ~ '^pbkdf2\$[0-9]{4,7}\$[0-9a-f]{32}\$[0-9a-f]{64}$'),
  paired_by   uuid references public.staff(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  paired_at   timestamptz,
  claimed_at  timestamptz
);
create index if not exists kiosk_pairings_expires_idx on public.kiosk_pairings (expires_at);
alter table public.kiosk_pairings enable row level security;
revoke all on public.kiosk_pairings from public, anon, authenticated;
grant all on public.kiosk_pairings to service_role;

-- Check after applying (all true):
--   select to_regclass('public.kiosk_pairings') is not null as pairings,
--          (select relrowsecurity from pg_class where oid = 'public.kiosk_pairings'::regclass) as rls_on;
-- Ledger row:
--   insert into supabase_migrations.schema_migrations (version, name) values ('20261107000000', 'kiosk_pairings') on conflict do nothing;
