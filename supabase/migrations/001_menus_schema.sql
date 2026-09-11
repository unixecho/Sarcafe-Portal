-- Menu system: draft/published JSONB documents, publish-history snapshots,
-- and named/scheduled "variants" (subtractive exclusion lists). Mirrors
-- AyekaBar's menus/menu_versions/menu_variants design (that repo's
-- migrations 000, 013, 015, 017) almost exactly — it was already
-- multi-tenant-shaped (one row per business) — the only change is that
-- Sarcafe's two rows are two branches of one business rather than two
-- separate client businesses.

create table public.menus (
  id                uuid primary key default gen_random_uuid(),
  branch_id         uuid not null unique references public.branches(id),
  slug              text not null unique, -- denormalized copy of branches.slug for fast lookup
  name              jsonb not null default '{}'::jsonb,
  draft             jsonb not null default '{"categories":[]}'::jsonb,
  published         jsonb not null default '{"categories":[]}'::jsonb,
  active_variant_id uuid, -- FK added below, after menu_variants exists
  updated_at        timestamptz not null default now(),
  published_at      timestamptz
);

insert into public.menus (branch_id, slug, name)
select id, slug, name from public.branches;

create table public.menu_versions (
  id           bigint generated always as identity primary key,
  menu_id      uuid not null references public.menus(id) on delete cascade,
  data         jsonb not null,
  published_by uuid references auth.users(id),
  created_at   timestamptz not null default now()
);
create index menu_versions_menu_id_idx on public.menu_versions (menu_id, created_at desc);

create table public.menu_variants (
  id               uuid primary key default gen_random_uuid(),
  menu_id          uuid not null references public.menus(id) on delete cascade,
  name             jsonb not null default '{}'::jsonb,
  excluded_uids    text[] not null default '{}', -- item uids this variant HIDES (subtractive)
  is_default       boolean not null default false,
  sort_order       integer not null default 0,
  schedule_enabled boolean not null default false,
  schedule_days    smallint[] not null default '{}', -- JS getDay(): 0=Sun..6=Sat, empty = every day
  schedule_start   text, -- "HH:MM", branch-local
  schedule_end     text, -- end <= start wraps past midnight
  active_until     timestamptz, -- one-off temp deadline, null = indefinite
  expire_action    text not null default 'revert' check (expire_action in ('revert', 'delete')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index menu_variants_menu_id_idx on public.menu_variants (menu_id);
-- At most one is_default = true per menu.
create unique index menu_variants_one_default_per_menu
  on public.menu_variants (menu_id) where is_default;

alter table public.menus
  add constraint menus_active_variant_id_fkey
  foreign key (active_variant_id) references public.menu_variants(id) on delete set null;

-- Seed one default variant per branch so `resolveVariant()` always has a
-- fallback to land on.
insert into public.menu_variants (menu_id, name, is_default, sort_order)
select id, '{"he":"רגיל","en":"Regular","ar":"عادي"}'::jsonb, true, 0
from public.menus;

update public.menus m
set active_variant_id = v.id
from public.menu_variants v
where v.menu_id = m.id and v.is_default;

create table public.menu_audit (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid references auth.users(id),
  actor_name text,
  actor_email text,
  action     text not null,
  summary    text,
  detail     jsonb,
  created_at timestamptz not null default now()
);
create index menu_audit_created_at_idx on public.menu_audit (created_at desc);

-- ---------------------------------------------------------------------
-- publish_menu() — copies draft -> published, snapshots it into
-- menu_versions. security invoker so the caller's own RLS still applies
-- (the owner's/editor's own update permission on `menus` is what gates
-- this, not a service-role bypass).
-- ---------------------------------------------------------------------
create or replace function public.publish_menu(p_menu_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_published jsonb;
begin
  update public.menus
  set published = draft, published_at = now(), updated_at = now()
  where id = p_menu_id
  returning published into v_published;

  if not found then
    raise exception 'menu % not found or not permitted', p_menu_id;
  end if;

  insert into public.menu_versions (menu_id, data, published_by)
  values (p_menu_id, v_published, auth.uid());
end;
$$;

-- ---------------------------------------------------------------------
-- set_default_variant() — atomically clears the old default and sets the
-- new one, to dodge the partial unique index above.
-- ---------------------------------------------------------------------
create or replace function public.set_default_variant(p_variant_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_menu_id uuid;
begin
  select menu_id into v_menu_id from public.menu_variants where id = p_variant_id;
  if v_menu_id is null then
    raise exception 'variant % not found or not permitted', p_variant_id;
  end if;

  update public.menu_variants set is_default = false where menu_id = v_menu_id and is_default;
  update public.menu_variants set is_default = true where id = p_variant_id;
end;
$$;

-- ---------------------------------------------------------------------
-- reap_expired_variants() — pure housekeeping. Nothing has to run exactly
-- at a variant's deadline: resolveVariant() (application code) simply
-- stops selecting an expired variant on its own. This just tidies rows
-- opportunistically (called on the owner's next GET to the variants API,
-- not a required cron).
-- ---------------------------------------------------------------------
create or replace function public.reap_expired_variants()
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.menus m
  set active_variant_id = d.id
  from public.menu_variants d
  where d.menu_id = m.id
    and d.is_default
    and m.active_variant_id in (
      select id from public.menu_variants
      where active_until is not null and active_until < now() and expire_action = 'revert'
    );

  delete from public.menu_variants
  where active_until is not null and active_until < now() and expire_action = 'delete' and not is_default;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.menus enable row level security;
alter table public.menu_versions enable row level security;
alter table public.menu_variants enable row level security;
alter table public.menu_audit enable row level security;

create policy "menu editors can read their branch's menu"
  on public.menus for select
  using (public.is_menu_editor(branch_id));

create policy "menu editors can update their branch's menu"
  on public.menus for update
  using (public.is_menu_editor(branch_id))
  with check (public.is_menu_editor(branch_id));

create policy "menu editors can read their branch's version history"
  on public.menu_versions for select
  using (public.is_menu_editor((select branch_id from public.menus where id = menu_id)));

create policy "menu editors can manage their branch's variants"
  on public.menu_variants for all
  using (public.is_menu_editor((select branch_id from public.menus where id = menu_id)))
  with check (public.is_menu_editor((select branch_id from public.menus where id = menu_id)));

-- menu_audit: append-only from the app's perspective, service-role only —
-- no policies at all (RLS enabled with zero policies denies everything to
-- anon/authenticated by default; only the service-role client, which
-- bypasses RLS, can write here).

-- ---------------------------------------------------------------------
-- Public-safe views — the ONLY thing `anon` can read. Never select
-- draft/owner-only columns.
-- ---------------------------------------------------------------------
create view public.public_menus
with (security_invoker = false) as
select m.id, m.slug, m.name, m.published, m.active_variant_id, m.published_at
from public.menus m;

create view public.public_menu_variants
with (security_invoker = false) as
select v.id, v.menu_id, v.name, v.excluded_uids, v.is_default, v.sort_order,
       v.schedule_enabled, v.schedule_days, v.schedule_start, v.schedule_end,
       v.active_until, (v.menu_id in (select id from public.menus where active_variant_id = v.id)) as is_active
from public.menu_variants v;

grant select on public.public_menus to anon, authenticated;
grant select on public.public_menu_variants to anon, authenticated;
