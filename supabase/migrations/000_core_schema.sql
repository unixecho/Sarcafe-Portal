-- Core schema: branches + staff + the role/badge authorization functions.
-- Mirrors AyekaBar's staff model (supabase/migrations/002-006, 016 in that
-- repo), with one addition AyekaBar has no equivalent for: branch_id on
-- staff, since Sarcafe (unlike AyekaBar) operates two physical locations.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- branches
-- ---------------------------------------------------------------------
create table public.branches (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       jsonb not null default '{}'::jsonb, -- { he, en, ar }
  timezone   text not null default 'Asia/Jerusalem',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.branches (slug, name) values
  ('maor', '{"he":"מאור","en":"Maor Settlement Branch","ar":"فرع ماعور"}'::jsonb),
  ('givat-haviva', '{"he":"גבעת חביבה","en":"Givat Haviva Branch","ar":"فرع جفعات حبيبة"}'::jsonb);

alter table public.branches enable row level security;

-- Branches are public read (used to render the branch picker) with no
-- public write policy at all — only ever changed by an owner, via the
-- service-role client.
create policy "branches are publicly readable"
  on public.branches for select
  using (true);

-- ---------------------------------------------------------------------
-- staff
-- ---------------------------------------------------------------------
create table public.staff (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique references auth.users(id) on delete set null,
  email         text,
  first_name    text,
  last_name     text,
  display_name  text,
  role          text not null default 'staff' check (role in ('staff', 'owner')),
  badge         text, -- owner | general_manager | manager | barista | cook | cashier | free text
  branch_id     uuid references public.branches(id), -- null = all branches
  active        boolean not null default true,       -- soft delete (mirrors AyekaBar 041)
  invited_at    timestamptz not null default now(),
  claimed_at    timestamptz,
  created_at    timestamptz not null default now()
);

create index staff_auth_user_id_idx on public.staff (auth_user_id) where auth_user_id is not null;
create index staff_branch_id_idx on public.staff (branch_id) where branch_id is not null;

alter table public.staff enable row level security;
-- Deliberately NO select/update policy for `authenticated` — a staff
-- member does not get to read their own role/badge/branch_id directly and
-- reason about privilege escalation from the client. Every authorization
-- decision is resolved server-side via the service-role client
-- (lib/staff/guard.ts, lib/owner/guard.ts), mirroring AyekaBar's posture.

-- ---------------------------------------------------------------------
-- SQL twins of src/lib/staff/access.ts — every predicate here MUST stay in
-- sync with its TypeScript counterpart. This is the single bug class
-- AyekaBar's own migration history warns about most (015/016 redefining
-- these after the TS and SQL layers had drifted apart).
-- ---------------------------------------------------------------------
create or replace function public.is_op()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff
    where auth_user_id = auth.uid()
      and active
      and (role = 'owner' or badge = 'owner')
  );
$$;

create or replace function public.is_menu_editor(p_branch_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff
    where auth_user_id = auth.uid()
      and active
      and (
        role = 'owner'
        or badge = 'owner'
        or (badge = 'general_manager' and (branch_id is null or branch_id = p_branch_id))
      )
  );
$$;

create or replace function public.is_staff_client()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff where auth_user_id = auth.uid() and active
  );
$$;

-- Postgres grants EXECUTE on every new function to the PUBLIC pseudo-role
-- by default; revoking anon/authenticated alone is cosmetic since both
-- inherit PUBLIC underneath. Revoke PUBLIC explicitly, then grant back only
-- what's actually needed (these three are meant to be called by
-- authenticated users, e.g. from RLS policies and client-side checks).
revoke execute on function public.is_op() from public;
revoke execute on function public.is_menu_editor(uuid) from public;
revoke execute on function public.is_staff_client() from public;
grant execute on function public.is_op() to authenticated;
grant execute on function public.is_menu_editor(uuid) to authenticated;
grant execute on function public.is_staff_client() to authenticated;

-- ---------------------------------------------------------------------
-- claim_staff_invite() — links a pre-created invite row (created by the
-- owner, keyed by email, auth_user_id null) to whichever Google account
-- first signs in with that email. Called unconditionally on every login
-- (see app/auth/callback/route.ts) — idempotent once already linked.
-- Requires a CONFIRMED email and blocks re-linking a deactivated row, so a
-- removed staff member's own Google sign-in can't silently re-admit them.
-- ---------------------------------------------------------------------
create or replace function public.claim_staff_invite()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user record;
begin
  select id, email, email_confirmed_at, raw_app_meta_data ->> 'provider' as provider
    into v_user
    from auth.users
    where id = auth.uid();

  if v_user is null or v_user.email is null or v_user.email_confirmed_at is null then
    return;
  end if;

  if v_user.provider is distinct from 'google' then
    return;
  end if;

  update public.staff
  set auth_user_id = v_user.id,
      claimed_at = now()
  where lower(email) = lower(v_user.email)
    and auth_user_id is null
    and active;
end;
$$;

revoke execute on function public.claim_staff_invite() from public;
grant execute on function public.claim_staff_invite() to authenticated;
