-- =====================================================================
-- 014_pos_core.sql — Sarcafe POS (docs/POS_BLUEPRINT.md is the spec)
--
-- What this adds
--   1. staff.handle / handle_set_at / colour — the required nickname.
--   2. branches.kind — 'permanent' | 'event' (events are hidden from the
--      public portal's branch picker, never from the owner).
--   3. Selling points, their routing, sessions, orders, order lines, the
--      append-only audit log, point check-ins, ticket counters.
--   4. SECURITY DEFINER functions that do check + write + audit in ONE
--      transaction. Every one is executable by service_role ONLY.
--   5. RLS (select for staff, no client write grant anywhere), the narrow
--      staff-directory view, the Realtime publication, a verify block.
--
-- Written to be re-runnable (create ... if not exists, create or replace,
-- guarded constraints) because the Supabase SQL editor runs a script as one
-- transaction: a failure part-way rolls the whole file back, and re-running
-- it after a fix must not trip over what already landed.
--
-- Lessons from Ayeka's migrations 042-045 that this file applies:
--   * Postgres grants EXECUTE on a new function to PUBLIC. Revoking anon /
--     authenticated alone is cosmetic (both inherit PUBLIC). Every function
--     here does `revoke ... from public` FIRST, then grants service_role.
--   * Table GRANTs are a separate layer from RLS (Sarcafe's own
--     DEPLOYMENT.md §2.1 / migration 004): every new table is granted
--     explicitly or even the service-role client gets "permission denied".
--   * A simple SECURITY DEFINER view is auto-updatable and a write through it
--     bypasses the base table's RLS -> revoke every write privilege.
--   * Pin search_path on every definer function.
-- =====================================================================


-- =====================================================================
-- 1. staff: the nickname
-- =====================================================================
alter table public.staff add column if not exists handle        text;
alter table public.staff add column if not exists handle_set_at timestamptz;
alter table public.staff add column if not exists colour        text;

-- Suggest a unique handle from whatever the row knows about the person.
-- Allowed characters: Latin letters, digits, Hebrew, Arabic, '_', '.', '-'.
-- 2..16 long. Case-insensitively unique (see the index below).
create or replace function public.pos_suggest_handle(p_first text, p_display text, p_email text)
returns text
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  base text;
  cand text;
  n    int := 1;
begin
  base := coalesce(
    nullif(btrim(p_first), ''),
    nullif(btrim(p_display), ''),
    nullif(split_part(coalesce(p_email, ''), '@', 1), ''),
    'staff'
  );
  base := regexp_replace(base, '[^A-Za-z0-9֐-׿؀-ۿ_.-]', '', 'g');
  if char_length(base) < 2 then base := 'staff'; end if;
  base := left(base, 14);

  cand := base;
  while exists (select 1 from public.staff s where lower(s.handle) = lower(cand)) loop
    n := n + 1;
    cand := left(base, 16 - char_length(n::text)) || n::text;
  end loop;
  return cand;
end;
$$;

-- Back-fill existing people. Done row by row so each pick sees the earlier
-- ones (de-duplication). handle_set_at stays NULL: "the system chose this",
-- which /pos turns into "please confirm or change it".
do $$
declare
  r record;
begin
  for r in
    select id, first_name, display_name, email
    from public.staff
    where handle is null
    order by created_at, id
  loop
    update public.staff
       set handle = public.pos_suggest_handle(r.first_name, r.display_name, r.email)
     where id = r.id;
  end loop;
end;
$$;

-- No existing insert path (the first-owner snippet in DEPLOYMENT.md, the
-- invite route, claim_staff_invite) supplies a handle. A BEFORE INSERT trigger
-- fills a placeholder so none of them can break, and handle_set_at = NULL
-- keeps the placeholder visibly unconfirmed. The invite route and /pos make
-- the real choice mandatory; the database never blocks a legacy insert.
create or replace function public.pos_staff_default_handle()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.handle is null or btrim(new.handle) = '' then
    new.handle := public.pos_suggest_handle(new.first_name, new.display_name, new.email);
    new.handle_set_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists staff_default_handle on public.staff;
create trigger staff_default_handle
  before insert on public.staff
  for each row execute function public.pos_staff_default_handle();

alter table public.staff alter column handle set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'staff_handle_format') then
    alter table public.staff
      add constraint staff_handle_format
      check (handle ~ '^[A-Za-z0-9֐-׿؀-ۿ_.-]{2,16}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'staff_colour_format') then
    alter table public.staff
      add constraint staff_colour_format
      check (colour is null or colour ~ '^#[0-9a-fA-F]{6}$');
  end if;
end;
$$;

create unique index if not exists staff_handle_lower_key on public.staff (lower(handle));


-- =====================================================================
-- 2. branches.kind
-- =====================================================================
alter table public.branches add column if not exists kind text not null default 'permanent';
alter table public.branches drop constraint if exists branches_kind_check;
alter table public.branches add constraint branches_kind_check check (kind in ('permanent', 'event'));


-- =====================================================================
-- 3. Tables
-- =====================================================================

-- 3.1 Per-branch POS settings. SEPARATE from `branches` on purpose:
-- `branches` is publicly readable (the portal's branch picker), and the Ready
-- board token must never be. No client role gets any access at all.
create table if not exists public.pos_branch_settings (
  branch_id    uuid primary key references public.branches(id) on delete cascade,
  enabled      boolean not null default false,
  board_token  text,
  unsold_refs  text[] not null default '{}',   -- 'c:<categoryId>' / 'i:<itemUid>': deliberately NOT sold here
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.staff(id) on delete set null,
  constraint pos_branch_settings_token_len check (board_token is null or char_length(board_token) >= 24)
);
create unique index if not exists pos_branch_settings_token_key
  on public.pos_branch_settings (board_token) where board_token is not null;

-- 3.2 Sessions: one service period. One active per branch (partial unique
-- index — Ayeka enforced "one active shift" in the app and it drifted; an
-- invariant like that belongs in an index).
create table if not exists public.pos_sessions (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references public.branches(id),
  kind        text not null default 'live' check (kind in ('live', 'training')),
  status      text not null default 'active' check (status in ('active', 'closed')),
  started_at  timestamptz not null default now(),
  started_by  uuid references public.staff(id) on delete set null,
  ended_at    timestamptz,
  ended_by    uuid references public.staff(id) on delete set null
);
create unique index if not exists pos_sessions_one_active
  on public.pos_sessions (branch_id) where status = 'active';
create index if not exists pos_sessions_branch_started_idx
  on public.pos_sessions (branch_id, started_at desc);

-- 3.3 Selling points. Deactivate, never delete.
create table if not exists public.pos_points (
  id             uuid primary key default gen_random_uuid(),
  branch_id      uuid not null references public.branches(id),
  name           text not null check (char_length(btrim(name)) between 1 and 40),
  icon           text not null default 'utensils' check (icon ~ '^[a-z0-9-]{1,30}$'),
  colour         text not null check (colour ~ '^#[0-9a-fA-F]{6}$'),
  hands_over     boolean not null default true,
  prep_minutes   integer not null default 8 check (prep_minutes between 1 and 120),
  excluded_uids  text[] not null default '{}',  -- items inside this point's categories that it does NOT make
  sort_order     integer not null default 0,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.staff(id) on delete set null,
  updated_at     timestamptz not null default now()
);
create unique index if not exists pos_points_active_name_key
  on public.pos_points (branch_id, lower(name)) where active;
create index if not exists pos_points_branch_idx on public.pos_points (branch_id) where active;

-- 3.4 Routing. unique (branch, kind, ref): an item or a category belongs to at
-- most ONE point, enforced by the database rather than trusted to the wizard.
create table if not exists public.pos_point_routes (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references public.branches(id),
  point_id    uuid not null references public.pos_points(id) on delete cascade,
  kind        text not null check (kind in ('category', 'item')),
  ref         text not null check (char_length(ref) between 1 and 80),
  created_at  timestamptz not null default now(),
  unique (branch_id, kind, ref)
);
create index if not exists pos_point_routes_point_idx on public.pos_point_routes (point_id);

-- 3.5 "Who usually works here". Chooses where a person lands. NOT a permission.
create table if not exists public.pos_point_staff (
  point_id  uuid not null references public.pos_points(id) on delete cascade,
  staff_id  uuid not null references public.staff(id) on delete cascade,
  primary key (point_id, staff_id)
);

-- 3.6 Ticket counters: advanced with insert ... on conflict do update ...
-- returning, so two cashiers can never draw the same number.
create table if not exists public.pos_ticket_counters (
  session_id  uuid primary key references public.pos_sessions(id) on delete cascade,
  last_no     integer not null default 0
);

-- 3.7 Orders — one per customer.
create table if not exists public.pos_orders (
  id                  uuid primary key default gen_random_uuid(),
  branch_id           uuid not null references public.branches(id),
  session_id          uuid not null references public.pos_sessions(id),
  ticket_no           integer not null check (ticket_no > 0),
  client_key          uuid not null,
  customer_name       text not null check (char_length(btrim(customer_name)) between 1 and 40),
  customer_phone      text check (customer_phone is null or customer_phone ~ '^\+?[0-9]{7,15}$'),
  receipt_ref         text check (receipt_ref is null or char_length(receipt_ref) <= 40),
  slip_total_agorot   integer check (slip_total_agorot is null or slip_total_agorot >= 0),
  slip_mismatch       boolean not null default false,
  note                text check (note is null or char_length(note) <= 200),
  status              text not null default 'open' check (status in ('open', 'completed', 'void')),
  total_agorot        integer not null default 0 check (total_agorot >= 0),
  created_by          uuid not null references public.staff(id),
  created_by_handle   text not null,
  created_at          timestamptz not null default now(),
  completed_at        timestamptz,
  voided_at           timestamptz,
  voided_by           uuid references public.staff(id) on delete set null,
  void_reason         text,
  unique (session_id, ticket_no),
  unique (branch_id, client_key)
);
create index if not exists pos_orders_session_created_idx on public.pos_orders (session_id, created_at desc);
create index if not exists pos_orders_branch_created_idx  on public.pos_orders (branch_id, created_at desc);
create index if not exists pos_orders_open_idx            on public.pos_orders (branch_id) where status = 'open';
create index if not exists pos_orders_creator_idx         on public.pos_orders (created_by);

-- 3.8 Order lines. Snapshots (name, price, point) and the whole stamped
-- lifecycle. `picked_up_*` are COLUMNS, not a status — Ayeka learnt that a
-- status value would have rippled through every screen, and that "picked up"
-- is a fact stamped alongside the lifecycle rather than a step in it.
create table if not exists public.pos_order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.pos_orders(id),
  branch_id       uuid not null references public.branches(id),
  seq             integer not null check (seq > 0),
  batch_no        integer not null default 1 check (batch_no >= 1),
  point_id        uuid not null references public.pos_points(id),
  point_name      text not null,
  item_uid        text,
  category_id     text,
  category_title  jsonb,
  name            jsonb not null,
  type_uid        text,
  type_label      jsonb,
  variant_label   text,
  unit_agorot     integer not null check (unit_agorot between 0 and 500000),
  qty             integer not null check (qty between 1 and 99),
  for_name        text check (for_name is null or char_length(for_name) <= 40),
  note            text check (note is null or char_length(note) <= 120),
  is_custom       boolean not null default false,
  status          text not null default 'sent'
                    check (status in ('sent', 'preparing', 'ready', 'delivered', 'voided')),
  created_by      uuid not null references public.staff(id),
  created_at      timestamptz not null default now(),
  sent_at         timestamptz not null default now(),
  claimed_by      uuid references public.staff(id) on delete set null,
  claimed_at      timestamptz,
  ready_at        timestamptz,
  picked_up_by    uuid references public.staff(id) on delete set null,
  picked_up_at    timestamptz,
  delivered_by    uuid references public.staff(id) on delete set null,
  delivered_at    timestamptz,
  voided_by       uuid references public.staff(id) on delete set null,
  voided_at       timestamptz,
  voided_from     text check (voided_from is null or voided_from in ('sent', 'preparing', 'ready', 'delivered')),
  void_reason     text check (void_reason is null or char_length(void_reason) <= 60),
  unique (order_id, seq)
);
create index if not exists pos_order_items_queue_idx
  on public.pos_order_items (point_id, status) where status in ('sent', 'preparing', 'ready');
create index if not exists pos_order_items_order_idx   on public.pos_order_items (order_id);
create index if not exists pos_order_items_branch_idx  on public.pos_order_items (branch_id, created_at desc);
create index if not exists pos_order_items_voided_idx  on public.pos_order_items (point_id, voided_at desc) where status = 'voided';

-- 3.9 The audit log. Append-only, written by the functions below in the same
-- transaction as the change. Real foreign keys (Ayeka's event table had none
-- on order_id and the feed's embed 400'd for weeks). The CHECK vocabulary is
-- COMPLETE from day one: a missing value + a swallowed write = silent loss
-- (Ayeka's `variant.default` audit bug).
create table if not exists public.pos_events (
  id            bigint generated always as identity primary key,
  branch_id     uuid not null references public.branches(id),
  session_id    uuid references public.pos_sessions(id),
  order_id      uuid references public.pos_orders(id),
  item_id       uuid references public.pos_order_items(id),
  point_id      uuid references public.pos_points(id),
  event         text not null check (event in (
    'order_created', 'items_added', 'order_edited',
    'item_claimed', 'item_ready', 'item_picked_up', 'item_delivered', 'item_reverted',
    'item_voided', 'order_voided', 'order_completed',
    'session_opened', 'session_closed', 'training_wiped',
    'point_created', 'point_updated', 'point_deactivated', 'routes_changed',
    'checkin', 'checkout',
    'handle_changed', 'board_token_rotated', 'settings_changed', 'pii_cleared'
  )),
  actor_id      uuid references public.staff(id) on delete set null,
  actor_handle  text,
  payload       jsonb not null default '{}'::jsonb,
  at            timestamptz not null default now()
);
create index if not exists pos_events_branch_at_idx  on public.pos_events (branch_id, at desc);
create index if not exists pos_events_order_idx      on public.pos_events (order_id, at);
create index if not exists pos_events_session_idx    on public.pos_events (session_id);
create index if not exists pos_events_actor_idx      on public.pos_events (actor_id, at desc);

-- 3.10 Presence — append-only.
create table if not exists public.pos_point_checkins (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references public.branches(id),
  session_id  uuid references public.pos_sessions(id),
  point_id    uuid not null references public.pos_points(id),
  staff_id    uuid not null references public.staff(id),
  event       text not null check (event in ('check_in', 'check_out')),
  at          timestamptz not null default now()
);
create index if not exists pos_point_checkins_point_idx on public.pos_point_checkins (point_id, at desc);
create index if not exists pos_point_checkins_staff_idx on public.pos_point_checkins (staff_id, at desc);


-- =====================================================================
-- 4. Triggers: append-only audit, immutable identity/money columns
--    Defence in depth — the functions never touch these columns, and no
--    client holds a write grant, but a trigger also stops a future bug or a
--    careless service-role script.
-- =====================================================================
create or replace function public.pos_events_append_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Only pos_wipe_training() / pos_clear_old_pii() set this, and only for the
  -- duration of their own transaction (set_config(..., true)).
  if coalesce(current_setting('pos.wiping', true), '') = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception 'pos_events is append-only (% refused)', tg_op using errcode = '42501';
end;
$$;

drop trigger if exists pos_events_no_update on public.pos_events;
create trigger pos_events_no_update
  before update or delete on public.pos_events
  for each row execute function public.pos_events_append_only();

create or replace function public.pos_checkins_append_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('pos.wiping', true), '') = 'on' and tg_op = 'DELETE' then
    return old;
  end if;
  raise exception 'pos_point_checkins is append-only (% refused)', tg_op using errcode = '42501';
end;
$$;

drop trigger if exists pos_checkins_no_update on public.pos_point_checkins;
create trigger pos_checkins_no_update
  before update or delete on public.pos_point_checkins
  for each row execute function public.pos_checkins_append_only();

create or replace function public.pos_items_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (new.order_id, new.branch_id, new.seq, new.batch_no, new.point_id, new.point_name,
      new.item_uid, new.name, new.type_uid, new.variant_label, new.unit_agorot, new.qty,
      new.is_custom, new.created_by, new.created_at, new.sent_at)
     is distinct from
     (old.order_id, old.branch_id, old.seq, old.batch_no, old.point_id, old.point_name,
      old.item_uid, old.name, old.type_uid, old.variant_label, old.unit_agorot, old.qty,
      old.is_custom, old.created_by, old.created_at, old.sent_at)
  then
    raise exception 'pos_order_items: identity / money columns are immutable (void and re-add instead)'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists pos_items_immutable on public.pos_order_items;
create trigger pos_items_immutable
  before update on public.pos_order_items
  for each row execute function public.pos_items_immutable();

create or replace function public.pos_orders_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (new.branch_id, new.session_id, new.ticket_no, new.client_key, new.created_by,
      new.created_by_handle, new.created_at)
     is distinct from
     (old.branch_id, old.session_id, old.ticket_no, old.client_key, old.created_by,
      old.created_by_handle, old.created_at)
  then
    raise exception 'pos_orders: identity columns are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists pos_orders_immutable on public.pos_orders;
create trigger pos_orders_immutable
  before update on public.pos_orders
  for each row execute function public.pos_orders_immutable();


-- =====================================================================
-- 5. Functions
--    All SECURITY DEFINER, search_path pinned, EXECUTE: service_role only
--    (grants are at the bottom of this section). The route that calls them
--    has already resolved the actor from the session — `p_staff` is never
--    taken from a request body.
-- =====================================================================

-- 5.1 Internal: write one audit row.  Also the entry point routes use for
-- configuration events (settings, token rotation...).
create or replace function public.pos_log_event(
  p_branch  uuid,
  p_actor   uuid,
  p_event   text,
  p_payload jsonb,
  p_order   uuid default null,
  p_item    uuid default null,
  p_point   uuid default null,
  p_session uuid default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_handle text;
begin
  select handle into v_handle from public.staff where id = p_actor;
  insert into public.pos_events (branch_id, session_id, order_id, item_id, point_id, event, actor_id, actor_handle, payload)
  values (p_branch, p_session, p_order, p_item, p_point, p_event, p_actor, v_handle, coalesce(p_payload, '{}'::jsonb));
end;
$$;

-- 5.2 Internal: the display name of a jsonb {he,en,ar}.
create or replace function public.pos_pick_name(p_name jsonb)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    nullif(btrim(p_name ->> 'he'), ''),
    nullif(btrim(p_name ->> 'en'), ''),
    nullif(btrim(p_name ->> 'ar'), ''),
    ''
  );
$$;

-- 5.3 Internal: validate the already server-resolved lines. Returns NULL when
-- fine, otherwise the failure reason.
create or replace function public.pos_validate_lines(p_branch uuid, p_lines jsonb)
returns text
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  l jsonb;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then return 'bad_line'; end if;
  if jsonb_array_length(p_lines) < 1 or jsonb_array_length(p_lines) > 60 then return 'bad_line'; end if;

  for l in select * from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(l) <> 'object' then return 'bad_line'; end if;

    if coalesce(l ->> 'point_id', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      return 'bad_point';
    end if;
    if not exists (
      select 1 from public.pos_points
      where id = (l ->> 'point_id')::uuid and branch_id = p_branch and active
    ) then
      return 'bad_point';
    end if;

    if coalesce(l ->> 'qty', '') !~ '^[0-9]{1,2}$' or (l ->> 'qty')::int < 1 then return 'bad_line'; end if;
    if coalesce(l ->> 'unit_agorot', '') !~ '^[0-9]{1,6}$' or (l ->> 'unit_agorot')::int > 500000 then
      return 'bad_line';
    end if;
    if coalesce(jsonb_typeof(l -> 'name'), '') <> 'object' or public.pos_pick_name(l -> 'name') = '' then
      return 'bad_line';
    end if;
    if char_length(coalesce(l ->> 'note', '')) > 120 or char_length(coalesce(l ->> 'for_name', '')) > 40 then
      return 'bad_line';
    end if;
  end loop;

  return null;
end;
$$;

-- 5.4 Internal: insert validated lines; returns how many were added.
create or replace function public.pos_insert_lines(
  p_order uuid, p_branch uuid, p_staff uuid, p_lines jsonb, p_batch int
) returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base  int;
  v_added int;
begin
  select coalesce(max(seq), 0) into v_base from public.pos_order_items where order_id = p_order;

  insert into public.pos_order_items (
    order_id, branch_id, seq, batch_no, point_id, point_name, item_uid, category_id,
    category_title, name, type_uid, type_label, variant_label, unit_agorot, qty,
    for_name, note, is_custom, created_by
  )
  select
    p_order, p_branch, v_base + e.ord::int, p_batch, (e.l ->> 'point_id')::uuid, p.name,
    nullif(e.l ->> 'item_uid', ''), nullif(e.l ->> 'category_id', ''),
    e.l -> 'category_title', e.l -> 'name',
    nullif(e.l ->> 'type_uid', ''), e.l -> 'type_label',
    nullif(btrim(e.l ->> 'variant_label'), ''),
    (e.l ->> 'unit_agorot')::int, (e.l ->> 'qty')::int,
    nullif(btrim(e.l ->> 'for_name'), ''), nullif(btrim(e.l ->> 'note'), ''),
    coalesce(e.l ->> 'is_custom', 'false') = 'true', p_staff
  from jsonb_array_elements(p_lines) with ordinality as e(l, ord)
  join public.pos_points p on p.id = (e.l ->> 'point_id')::uuid
  order by e.ord;

  get diagnostics v_added = row_count;
  return v_added;
end;
$$;

-- 5.5 Internal: recompute an order's total and status from its lines.
-- Locks the order row first, so two cashiers/stations finishing the last two
-- lines of one order at once serialize and the second one sees both
-- (otherwise both could compute 'open' from a snapshot missing the other).
-- Lock order everywhere: LINES first, then the order row. pos_add_items is the
-- one function that takes the order row first — it only inserts new rows, so
-- it can never wait on a line lock and cannot form a cycle.
create or replace function public.pos_recompute_order(p_order uuid, p_actor uuid, p_reason text default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o         public.pos_orders%rowtype;
  v_total   int;
  v_live    int;
  v_deliv   int;
  v_status  text;
begin
  select * into o from public.pos_orders where id = p_order for update;
  if not found then return null; end if;

  select
    coalesce(sum(qty * unit_agorot) filter (where status <> 'voided'), 0),
    count(*) filter (where status <> 'voided'),
    count(*) filter (where status = 'delivered')
  into v_total, v_live, v_deliv
  from public.pos_order_items where order_id = p_order;

  v_status := case
    when v_live = 0 then 'void'
    when v_deliv = v_live then 'completed'
    else 'open'
  end;

  update public.pos_orders set
    total_agorot = v_total,
    status       = v_status,
    completed_at = case when v_status = 'completed' then coalesce(o.completed_at, now()) else null end,
    voided_at    = case when v_status = 'void' then coalesce(o.voided_at, now()) else null end,
    voided_by    = case when v_status = 'void' then coalesce(o.voided_by, p_actor) else null end,
    void_reason  = case when v_status = 'void' then coalesce(o.void_reason, p_reason) else null end
  where id = p_order;

  if v_status <> o.status then
    if v_status = 'completed' then
      perform public.pos_log_event(o.branch_id, p_actor, 'order_completed',
        jsonb_build_object('ticket_no', o.ticket_no, 'customer_name', o.customer_name, 'total_agorot', v_total),
        p_order, null, null, o.session_id);
    elsif v_status = 'void' then
      perform public.pos_log_event(o.branch_id, p_actor, 'order_voided',
        jsonb_build_object('ticket_no', o.ticket_no, 'customer_name', o.customer_name, 'reason', p_reason),
        p_order, null, null, o.session_id);
    end if;
  end if;

  return v_status;
end;
$$;

-- 5.6 Sessions ----------------------------------------------------------
create or replace function public.pos_open_session(p_staff uuid, p_branch uuid, p_kind text default 'live')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session uuid;
begin
  if not exists (select 1 from public.staff where id = p_staff and active) then
    return jsonb_build_object('ok', false, 'reason', 'no_actor');
  end if;
  if p_kind not in ('live', 'training') then
    return jsonb_build_object('ok', false, 'reason', 'bad_kind');
  end if;
  if not coalesce((select enabled from public.pos_branch_settings where branch_id = p_branch), false) then
    return jsonb_build_object('ok', false, 'reason', 'not_enabled');
  end if;

  begin
    insert into public.pos_sessions (branch_id, kind, started_by)
    values (p_branch, p_kind, p_staff)
    returning id into v_session;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'already_open');
  end;

  perform public.pos_log_event(p_branch, p_staff, 'session_opened',
    jsonb_build_object('kind', p_kind), null, null, null, v_session);
  return jsonb_build_object('ok', true, 'session_id', v_session);
end;
$$;

create or replace function public.pos_close_session(p_staff uuid, p_branch uuid, p_void_uncollected boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session   uuid;
  v_inflight  int;
  v_ready     int;
  v_orders    uuid[];
  o           uuid;
begin
  if not exists (select 1 from public.staff where id = p_staff and active) then
    return jsonb_build_object('ok', false, 'reason', 'no_actor');
  end if;

  select id into v_session from public.pos_sessions
   where branch_id = p_branch and status = 'active' for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_session');
  end if;

  select
    count(*) filter (where i.status in ('sent', 'preparing')),
    count(*) filter (where i.status = 'ready')
  into v_inflight, v_ready
  from public.pos_order_items i
  join public.pos_orders od on od.id = i.order_id
  where od.session_id = v_session;

  if v_inflight > 0 then
    return jsonb_build_object('ok', false, 'reason', 'in_flight', 'in_flight', v_inflight, 'uncollected', v_ready);
  end if;
  if v_ready > 0 and not p_void_uncollected then
    return jsonb_build_object('ok', false, 'reason', 'uncollected', 'in_flight', 0, 'uncollected', v_ready);
  end if;

  if v_ready > 0 then
    -- Reuse the one voiding path so each line gets its own audit row. With no
    -- in-flight lines left in the session, "every non-delivered line" of an
    -- order that has a ready line is exactly its ready lines.
    select coalesce(array_agg(distinct i.order_id order by i.order_id), '{}') into v_orders
      from public.pos_order_items i join public.pos_orders od on od.id = i.order_id
     where od.session_id = v_session and i.status = 'ready';

    foreach o in array v_orders loop
      perform public.pos_void_items(p_staff, o, null, 'לא נאסף', false);
    end loop;
  end if;

  update public.pos_sessions set status = 'closed', ended_at = now(), ended_by = p_staff where id = v_session;
  perform public.pos_log_event(p_branch, p_staff, 'session_closed',
    jsonb_build_object('voided_uncollected', v_ready), null, null, null, v_session);
  return jsonb_build_object('ok', true, 'voided_uncollected', v_ready);
end;
$$;

-- Training sessions are throwaway. This is the ONE hard delete in the system and it
-- refuses anything that is not a training session. It sets a transaction-local flag
-- so the append-only triggers let the deletes through, then logs that it happened.
create or replace function public.pos_wipe_training(p_staff uuid, p_branch uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sessions uuid[];
  v_orders   int;
begin
  if not exists (select 1 from public.staff where id = p_staff and active) then
    return jsonb_build_object('ok', false, 'reason', 'no_actor');
  end if;

  select coalesce(array_agg(id), '{}') into v_sessions
    from public.pos_sessions where branch_id = p_branch and kind = 'training';
  if cardinality(v_sessions) = 0 then
    return jsonb_build_object('ok', true, 'orders', 0);
  end if;

  select count(*) into v_orders from public.pos_orders where session_id = any(v_sessions);

  perform set_config('pos.wiping', 'on', true);
  delete from public.pos_events
   where session_id = any(v_sessions)
      or order_id in (select id from public.pos_orders where session_id = any(v_sessions));
  delete from public.pos_point_checkins where session_id = any(v_sessions);
  delete from public.pos_order_items    where order_id in (select id from public.pos_orders where session_id = any(v_sessions));
  delete from public.pos_orders         where session_id = any(v_sessions);
  delete from public.pos_ticket_counters where session_id = any(v_sessions);
  delete from public.pos_sessions       where id = any(v_sessions);
  perform set_config('pos.wiping', 'off', true);

  perform public.pos_log_event(p_branch, p_staff, 'training_wiped',
    jsonb_build_object('orders', v_orders, 'sessions', cardinality(v_sessions)));
  return jsonb_build_object('ok', true, 'orders', v_orders);
end;
$$;

-- 5.7 Orders ------------------------------------------------------------
create or replace function public.pos_create_order(
  p_staff              uuid,
  p_branch             uuid,
  p_client_key         uuid,
  p_customer_name      text,
  p_customer_phone     text,
  p_receipt_ref        text,
  p_slip_total_agorot  integer,
  p_note               text,
  p_lines              jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor    record;
  v_existing public.pos_orders%rowtype;
  v_name     text;
  v_phone    text;
  v_receipt  text;
  v_note     text;
  v_reason   text;
  v_session  uuid;
  v_no       int;
  v_order    uuid;
  v_total    int;
  v_summary  jsonb;
begin
  select id, handle into v_actor from public.staff where id = p_staff and active;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_actor'); end if;
  if p_client_key is null then return jsonb_build_object('ok', false, 'reason', 'bad_line'); end if;

  -- Idempotency FIRST: a retry after a lost response must return the original
  -- order, never create a second one — the customer has already paid.
  select * into v_existing from public.pos_orders where branch_id = p_branch and client_key = p_client_key;
  if found then
    return jsonb_build_object('ok', true, 'deduped', true, 'order_id', v_existing.id,
                              'ticket_no', v_existing.ticket_no, 'total_agorot', v_existing.total_agorot);
  end if;

  v_name := regexp_replace(btrim(coalesce(p_customer_name, '')), '\s+', ' ', 'g');
  if char_length(v_name) < 1 or char_length(v_name) > 40 or v_name ~ '[[:cntrl:]]' then
    return jsonb_build_object('ok', false, 'reason', 'bad_customer');
  end if;
  v_phone := nullif(regexp_replace(coalesce(p_customer_phone, ''), '[\s()-]', '', 'g'), '');
  if v_phone is not null and v_phone !~ '^\+?[0-9]{7,15}$' then
    return jsonb_build_object('ok', false, 'reason', 'bad_customer');
  end if;
  v_receipt := nullif(btrim(coalesce(p_receipt_ref, '')), '');
  if v_receipt is not null and char_length(v_receipt) > 40 then
    return jsonb_build_object('ok', false, 'reason', 'bad_customer');
  end if;
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 200 then
    return jsonb_build_object('ok', false, 'reason', 'bad_customer');
  end if;
  if p_slip_total_agorot is not null and p_slip_total_agorot < 0 then
    return jsonb_build_object('ok', false, 'reason', 'bad_customer');
  end if;

  v_reason := public.pos_validate_lines(p_branch, p_lines);
  if v_reason is not null then return jsonb_build_object('ok', false, 'reason', v_reason); end if;

  select id into v_session from public.pos_sessions where branch_id = p_branch and status = 'active';
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_session'); end if;

  begin
    insert into public.pos_ticket_counters (session_id, last_no) values (v_session, 1)
    on conflict (session_id) do update set last_no = public.pos_ticket_counters.last_no + 1
    returning last_no into v_no;

    insert into public.pos_orders (
      branch_id, session_id, ticket_no, client_key, customer_name, customer_phone,
      receipt_ref, slip_total_agorot, note, created_by, created_by_handle
    ) values (
      p_branch, v_session, v_no, p_client_key, v_name, v_phone,
      v_receipt, p_slip_total_agorot, v_note, p_staff, v_actor.handle
    ) returning id into v_order;
  exception when unique_violation then
    -- Two identical retries racing: the loser lands here (the sub-transaction
    -- also rolled the counter increment back). Return the winner's order.
    select * into v_existing from public.pos_orders where branch_id = p_branch and client_key = p_client_key;
    if found then
      return jsonb_build_object('ok', true, 'deduped', true, 'order_id', v_existing.id,
                                'ticket_no', v_existing.ticket_no, 'total_agorot', v_existing.total_agorot);
    end if;
    raise;
  end;

  perform public.pos_insert_lines(v_order, p_branch, p_staff, p_lines, 1);

  select coalesce(sum(qty * unit_agorot), 0) into v_total from public.pos_order_items where order_id = v_order;
  update public.pos_orders
     set total_agorot = v_total,
         slip_mismatch = (p_slip_total_agorot is not null and p_slip_total_agorot <> v_total)
   where id = v_order;

  select jsonb_agg(jsonb_build_object('name', public.pos_pick_name(i.name), 'qty', i.qty,
                                      'point', i.point_name) order by i.seq)
    into v_summary from public.pos_order_items i where i.order_id = v_order;

  perform public.pos_log_event(p_branch, p_staff, 'order_created',
    jsonb_build_object(
      'ticket_no', v_no, 'customer_name', v_name, 'total_agorot', v_total,
      'receipt_ref', v_receipt, 'slip_total_agorot', p_slip_total_agorot,
      'slip_mismatch', (p_slip_total_agorot is not null and p_slip_total_agorot <> v_total),
      'items', v_summary
    ), v_order, null, null, v_session);

  return jsonb_build_object('ok', true, 'deduped', false, 'order_id', v_order,
                            'ticket_no', v_no, 'total_agorot', v_total);
end;
$$;

create or replace function public.pos_add_items(p_staff uuid, p_order uuid, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor   record;
  o         public.pos_orders%rowtype;
  v_reason  text;
  v_batch   int;
  v_added   int;
  v_summary jsonb;
  v_total   int;
begin
  select id, handle into v_actor from public.staff where id = p_staff and active;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_actor'); end if;

  select * into o from public.pos_orders where id = p_order for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if o.status = 'void' then return jsonb_build_object('ok', false, 'reason', 'order_void'); end if;

  v_reason := public.pos_validate_lines(o.branch_id, p_lines);
  if v_reason is not null then return jsonb_build_object('ok', false, 'reason', v_reason); end if;

  select coalesce(max(batch_no), 0) + 1 into v_batch from public.pos_order_items where order_id = p_order;
  v_added := public.pos_insert_lines(p_order, o.branch_id, p_staff, p_lines, v_batch);

  perform public.pos_recompute_order(p_order, p_staff);
  select total_agorot into v_total from public.pos_orders where id = p_order;

  select jsonb_agg(jsonb_build_object('name', public.pos_pick_name(i.name), 'qty', i.qty, 'point', i.point_name) order by i.seq)
    into v_summary from public.pos_order_items i where i.order_id = p_order and i.batch_no = v_batch;

  perform public.pos_log_event(o.branch_id, p_staff, 'items_added',
    jsonb_build_object('ticket_no', o.ticket_no, 'customer_name', o.customer_name,
                       'batch_no', v_batch, 'total_agorot', v_total, 'items', v_summary),
    p_order, null, null, o.session_id);

  return jsonb_build_object('ok', true, 'added', v_added, 'total_agorot', v_total);
end;
$$;

create or replace function public.pos_edit_order(
  p_staff uuid, p_order uuid, p_customer_name text, p_customer_phone text,
  p_note text, p_receipt_ref text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o         public.pos_orders%rowtype;
  v_name    text;
  v_phone   text;
  v_receipt text;
  v_note    text;
begin
  if not exists (select 1 from public.staff where id = p_staff and active) then
    return jsonb_build_object('ok', false, 'reason', 'no_actor');
  end if;
  select * into o from public.pos_orders where id = p_order for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  v_name := regexp_replace(btrim(coalesce(p_customer_name, '')), '\s+', ' ', 'g');
  if char_length(v_name) < 1 or char_length(v_name) > 40 or v_name ~ '[[:cntrl:]]' then
    return jsonb_build_object('ok', false, 'reason', 'bad_customer');
  end if;
  v_phone := nullif(regexp_replace(coalesce(p_customer_phone, ''), '[\s()-]', '', 'g'), '');
  if v_phone is not null and v_phone !~ '^\+?[0-9]{7,15}$' then
    return jsonb_build_object('ok', false, 'reason', 'bad_customer');
  end if;
  v_receipt := nullif(btrim(coalesce(p_receipt_ref, '')), '');
  v_note    := nullif(btrim(coalesce(p_note, '')), '');
  if (v_receipt is not null and char_length(v_receipt) > 40) or (v_note is not null and char_length(v_note) > 200) then
    return jsonb_build_object('ok', false, 'reason', 'bad_customer');
  end if;

  update public.pos_orders
     set customer_name = v_name, customer_phone = v_phone, receipt_ref = v_receipt, note = v_note
   where id = p_order;

  -- The phone is personal data and is NEVER copied into the audit log (it is
  -- cleared on a schedule; events are append-only). Record only that it changed.
  perform public.pos_log_event(o.branch_id, p_staff, 'order_edited',
    jsonb_build_object(
      'ticket_no', o.ticket_no,
      'customer_name', v_name, 'previous_name', o.customer_name,
      'name_changed', v_name <> o.customer_name,
      'phone_changed', coalesce(v_phone, '') <> coalesce(o.customer_phone, ''),
      'receipt_changed', coalesce(v_receipt, '') <> coalesce(o.receipt_ref, ''),
      'note_changed', coalesce(v_note, '') <> coalesce(o.note, '')
    ), p_order, null, null, o.session_id);
  return jsonb_build_object('ok', true);
end;
$$;

-- 5.8 Line lifecycle ----------------------------------------------------
-- The compare-and-swap. ONE UPDATE ... WHERE status = p_from: two tablets
-- tapping the same line at once produce exactly one transition; the loser's
-- row no longer matches and is reported as a CONFLICT (which is normal, not an
-- error). "Picked up" is stamped before "delivered" if still empty — you cannot
-- hand someone a thing you did not first pick up, and a delivered line with no
-- pickup is a hole in the record; stamp, don't block.
create or replace function public.pos_advance_items(
  p_staff uuid, p_ids uuid[], p_from text, p_to text, p_manager boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor    record;
  v_pair     text := coalesce(p_from, '') || '>' || coalesce(p_to, '');
  v_ok       uuid[] := '{}';
  v_conflict uuid[] := '{}';
  v_missing  uuid[] := '{}';
  v_orders   uuid[];
  v_rows     jsonb;
  r          record;
  v_ticket   int;
  v_customer text;
  v_session  uuid;
  v_branch   uuid;
  v_payload  jsonb;
  o          uuid;
begin
  select id, handle into v_actor from public.staff where id = p_staff and active;
  if not found then
    return jsonb_build_object('ok', '[]'::jsonb, 'conflict', '[]'::jsonb, 'missing', '[]'::jsonb, 'invalid', true, 'reason', 'no_actor');
  end if;

  if (v_pair not in ('sent>preparing', 'preparing>ready', 'sent>ready', 'ready>delivered',
                     'ready>preparing', 'preparing>sent')
      and not (v_pair = 'delivered>ready' and p_manager))
     or p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 100
  then
    return jsonb_build_object('ok', '[]'::jsonb, 'conflict', '[]'::jsonb, 'missing', '[]'::jsonb, 'invalid', true);
  end if;

  -- The data-modifying CTE runs as a plain SELECT ... INTO (not as a FOR-loop
  -- query, which would try to open it as a cursor); the rows it changed come
  -- back as one jsonb array that the loop below walks to write the audit rows.
  with cand as (
      select i.id, i.picked_up_at as old_picked
        from public.pos_order_items i
       where i.id = any(p_ids) and i.status = p_from
       order by i.id
         for update
    ), upd as (
      update public.pos_order_items i set
        status       = p_to,
        claimed_by   = case when p_from = 'sent' and p_to in ('preparing', 'ready') then coalesce(i.claimed_by, p_staff)
                            when v_pair = 'preparing>sent' then null
                            else i.claimed_by end,
        claimed_at   = case when p_from = 'sent' and p_to in ('preparing', 'ready') then coalesce(i.claimed_at, now())
                            when v_pair = 'preparing>sent' then null
                            else i.claimed_at end,
        ready_at     = case when p_to = 'ready' then now()
                            when v_pair = 'ready>preparing' then null
                            else i.ready_at end,
        picked_up_by = case when p_to = 'delivered' then coalesce(i.picked_up_by, p_staff)
                            when v_pair = 'delivered>ready' then null
                            else i.picked_up_by end,
        picked_up_at = case when p_to = 'delivered' then coalesce(i.picked_up_at, now())
                            when v_pair = 'delivered>ready' then null
                            else i.picked_up_at end,
        delivered_by = case when p_to = 'delivered' then p_staff
                            when v_pair = 'delivered>ready' then null
                            else i.delivered_by end,
        delivered_at = case when p_to = 'delivered' then now()
                            when v_pair = 'delivered>ready' then null
                            else i.delivered_at end
      from cand
      where i.id = cand.id
      returning i.id, i.order_id, i.point_id, i.point_name, i.name, i.type_label, i.qty, cand.old_picked
    )
  select coalesce(jsonb_agg(to_jsonb(u) order by u.id), '[]'::jsonb) into v_rows from upd u;

  for r in
    select * from jsonb_to_recordset(v_rows) as x(
      id uuid, order_id uuid, point_id uuid, point_name text, name jsonb,
      type_label jsonb, qty int, old_picked timestamptz
    )
  loop
    v_ok := v_ok || r.id;

    select ticket_no, customer_name, session_id, branch_id into v_ticket, v_customer, v_session, v_branch
      from public.pos_orders where id = r.order_id;
    v_payload := jsonb_build_object(
      'name', public.pos_pick_name(r.name), 'type', public.pos_pick_name(r.type_label),
      'qty', r.qty, 'ticket_no', v_ticket, 'customer_name', v_customer, 'point', r.point_name
    );

    if v_pair in ('ready>preparing', 'preparing>sent', 'delivered>ready') then
      perform public.pos_log_event(v_branch, p_staff, 'item_reverted',
        v_payload || jsonb_build_object('from', p_from, 'to', p_to),
        r.order_id, r.id, r.point_id, v_session);
    elsif p_to = 'preparing' then
      perform public.pos_log_event(v_branch, p_staff, 'item_claimed', v_payload,
        r.order_id, r.id, r.point_id, v_session);
    elsif p_to = 'ready' then
      perform public.pos_log_event(v_branch, p_staff, 'item_ready',
        v_payload || jsonb_build_object('skipped_accept', p_from = 'sent'),
        r.order_id, r.id, r.point_id, v_session);
    elsif p_to = 'delivered' then
      if r.old_picked is null then
        perform public.pos_log_event(v_branch, p_staff, 'item_picked_up', v_payload,
          r.order_id, r.id, r.point_id, v_session);
      end if;
      perform public.pos_log_event(v_branch, p_staff, 'item_delivered', v_payload,
        r.order_id, r.id, r.point_id, v_session);
    end if;
  end loop;

  -- Everything we asked for that did not move: either gone, or already in a
  -- different state (somebody else got there first).
  select coalesce(array_agg(i.id), '{}') into v_conflict
    from public.pos_order_items i where i.id = any(p_ids) and not (i.id = any(v_ok));
  select coalesce(array_agg(x), '{}') into v_missing
    from unnest(p_ids) as x where not exists (select 1 from public.pos_order_items i where i.id = x);

  select coalesce(array_agg(distinct i.order_id order by i.order_id), '{}') into v_orders
    from public.pos_order_items i where i.id = any(v_ok);
  foreach o in array v_orders loop
    perform public.pos_recompute_order(o, p_staff);
  end loop;

  return jsonb_build_object('ok', to_jsonb(v_ok), 'conflict', to_jsonb(v_conflict), 'missing', to_jsonb(v_missing));
end;
$$;

create or replace function public.pos_void_items(
  p_staff uuid, p_order uuid, p_item_ids uuid[], p_reason text, p_manager boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  o         public.pos_orders%rowtype;
  r         record;
  v_rows    jsonb;
  v_voided  uuid[] := '{}';
  v_skipped uuid[] := '{}';
  v_status  text;
begin
  if not exists (select 1 from public.staff where id = p_staff and active) then
    return jsonb_build_object('ok', false, 'reason', 'no_actor');
  end if;
  if v_reason is null or char_length(v_reason) > 60 then
    return jsonb_build_object('ok', false, 'reason', 'bad_reason');
  end if;

  -- Plain read (no lock): lines are locked first, the order row inside
  -- pos_recompute_order — the one lock order every function keeps.
  select * into o from public.pos_orders where id = p_order;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  with cand as (
    select i.id, i.status as prev
      from public.pos_order_items i
     where i.order_id = p_order
       and (p_item_ids is null or i.id = any(p_item_ids))
       and (i.status in ('sent', 'preparing', 'ready') or (p_manager and i.status = 'delivered'))
     order by i.id
       for update
  ), upd as (
    update public.pos_order_items i set
      status = 'voided', voided_by = p_staff, voided_at = now(),
      voided_from = cand.prev, void_reason = v_reason
    from cand where i.id = cand.id
    returning i.id, cand.prev as prev, i.name, i.type_label, i.qty, i.point_id, i.point_name
  )
  select coalesce(jsonb_agg(to_jsonb(u) order by u.id), '[]'::jsonb) into v_rows from upd u;

  for r in
    select * from jsonb_to_recordset(v_rows) as x(
      id uuid, prev text, name jsonb, type_label jsonb, qty int, point_id uuid, point_name text
    )
  loop
    v_voided := v_voided || r.id;
    perform public.pos_log_event(o.branch_id, p_staff, 'item_voided',
      jsonb_build_object('name', public.pos_pick_name(r.name), 'type', public.pos_pick_name(r.type_label),
                         'qty', r.qty, 'was', r.prev, 'reason', v_reason, 'ticket_no', o.ticket_no,
                         'customer_name', o.customer_name, 'point', r.point_name),
      p_order, r.id, r.point_id, o.session_id);
  end loop;

  if p_item_ids is not null then
    select coalesce(array_agg(x), '{}') into v_skipped from unnest(p_item_ids) as x where not (x = any(v_voided));
  end if;

  v_status := public.pos_recompute_order(p_order, p_staff, v_reason);
  return jsonb_build_object('ok', true, 'voided', to_jsonb(v_voided), 'skipped', to_jsonb(v_skipped), 'order_status', v_status);
end;
$$;

-- 5.9 Selling points ----------------------------------------------------
create or replace function public.pos_save_point(
  p_staff uuid, p_branch uuid, p_point uuid, p_cfg jsonb, p_move boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name     text;
  v_icon     text;
  v_colour   text;
  v_hands    boolean;
  v_prep     int;
  v_cats     text[];
  v_items    text[];
  v_excl     text[];
  v_staff    uuid[];
  v_id       uuid := p_point;
  v_conf     jsonb;
  v_before   jsonb;
  v_sort     int;
begin
  if not exists (select 1 from public.staff where id = p_staff and active) then
    return jsonb_build_object('ok', false, 'reason', 'no_actor');
  end if;
  if p_cfg is null or jsonb_typeof(p_cfg) <> 'object' then
    return jsonb_build_object('ok', false, 'reason', 'bad_cfg');
  end if;

  v_name := regexp_replace(btrim(coalesce(p_cfg ->> 'name', '')), '\s+', ' ', 'g');
  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    return jsonb_build_object('ok', false, 'reason', 'bad_cfg');
  end if;
  v_icon := coalesce(nullif(p_cfg ->> 'icon', ''), 'utensils');
  if v_icon !~ '^[a-z0-9-]{1,30}$' then return jsonb_build_object('ok', false, 'reason', 'bad_cfg'); end if;
  v_colour := p_cfg ->> 'colour';
  if coalesce(v_colour, '') !~ '^#[0-9a-fA-F]{6}$' then return jsonb_build_object('ok', false, 'reason', 'bad_cfg'); end if;
  if jsonb_typeof(p_cfg -> 'hands_over') is distinct from 'boolean' then
    v_hands := true;
  else
    v_hands := (p_cfg ->> 'hands_over')::boolean;
  end if;
  if coalesce(p_cfg ->> 'prep_minutes', '8') !~ '^[0-9]{1,3}$'
     or coalesce(p_cfg ->> 'prep_minutes', '8')::int not between 1 and 120 then
    return jsonb_build_object('ok', false, 'reason', 'bad_cfg');
  end if;
  v_prep := coalesce(p_cfg ->> 'prep_minutes', '8')::int;

  select coalesce(array_agg(distinct x), '{}') into v_cats
    from jsonb_array_elements_text(coalesce(p_cfg -> 'category_ids', '[]'::jsonb)) x;
  select coalesce(array_agg(distinct x), '{}') into v_items
    from jsonb_array_elements_text(coalesce(p_cfg -> 'item_uids', '[]'::jsonb)) x;
  select coalesce(array_agg(distinct x), '{}') into v_excl
    from jsonb_array_elements_text(coalesce(p_cfg -> 'excluded_uids', '[]'::jsonb)) x;
  -- The cast sits inside a CASE so it can never run on a malformed string, no
  -- matter what order the planner evaluates the WHERE and the select list in.
  select coalesce(array_agg(distinct q.y), '{}') into v_staff
    from (
      select case when x ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                  then x::uuid end as y
        from jsonb_array_elements_text(coalesce(p_cfg -> 'staff_ids', '[]'::jsonb)) x
    ) q
   where q.y is not null;

  if cardinality(v_cats) > 200 or cardinality(v_items) > 400 or cardinality(v_excl) > 400
     or exists (select 1 from unnest(v_cats || v_items || v_excl) z where char_length(z) > 80 or char_length(z) < 1) then
    return jsonb_build_object('ok', false, 'reason', 'bad_cfg');
  end if;

  if p_point is not null then
    perform 1 from public.pos_points where id = p_point and branch_id = p_branch and active for update;
    if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    select jsonb_build_object(
             'name', pp.name, 'colour', pp.colour, 'hands_over', pp.hands_over, 'prep_minutes', pp.prep_minutes,
             'categories', coalesce((select jsonb_agg(ref order by ref) from public.pos_point_routes where point_id = pp.id and kind = 'category'), '[]'::jsonb),
             'items', coalesce((select jsonb_agg(ref order by ref) from public.pos_point_routes where point_id = pp.id and kind = 'item'), '[]'::jsonb),
             'excluded', to_jsonb(pp.excluded_uids))
      into v_before from public.pos_points pp where pp.id = p_point;
  end if;

  if exists (
    select 1 from public.pos_points
     where branch_id = p_branch and active and lower(name) = lower(v_name) and id is distinct from p_point
  ) then
    return jsonb_build_object('ok', false, 'reason', 'name_taken');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('kind', r.kind, 'ref', r.ref, 'point_id', r.point_id, 'point_name', pp.name)), '[]'::jsonb)
    into v_conf
    from public.pos_point_routes r
    join public.pos_points pp on pp.id = r.point_id
   where r.branch_id = p_branch
     and r.point_id is distinct from p_point
     and ((r.kind = 'category' and r.ref = any(v_cats)) or (r.kind = 'item' and r.ref = any(v_items)));

  if jsonb_array_length(v_conf) > 0 and not p_move then
    return jsonb_build_object('ok', false, 'reason', 'conflicts', 'conflicts', v_conf);
  end if;

  if p_point is null then
    select coalesce(max(sort_order), 0) + 1 into v_sort from public.pos_points where branch_id = p_branch;
    insert into public.pos_points (branch_id, name, icon, colour, hands_over, prep_minutes, excluded_uids, sort_order, created_by)
    values (p_branch, v_name, v_icon, v_colour, v_hands, v_prep, v_excl, v_sort, p_staff)
    returning id into v_id;
  else
    update public.pos_points
       set name = v_name, icon = v_icon, colour = v_colour, hands_over = v_hands,
           prep_minutes = v_prep, excluded_uids = v_excl, updated_at = now()
     where id = p_point;
  end if;

  -- Replace this point's claims, and take over any it was told to move.
  delete from public.pos_point_routes
   where branch_id = p_branch
     and (point_id = v_id
          or (kind = 'category' and ref = any(v_cats))
          or (kind = 'item' and ref = any(v_items)));
  insert into public.pos_point_routes (branch_id, point_id, kind, ref)
    select p_branch, v_id, 'category', x from unnest(v_cats) x;
  insert into public.pos_point_routes (branch_id, point_id, kind, ref)
    select p_branch, v_id, 'item', x from unnest(v_items) x;

  delete from public.pos_point_staff where point_id = v_id;
  insert into public.pos_point_staff (point_id, staff_id)
    select v_id, s.id from public.staff s where s.id = any(v_staff) and s.active;

  perform public.pos_log_event(p_branch, p_staff,
    case when p_point is null then 'point_created' else 'point_updated' end,
    jsonb_build_object(
      'name', v_name, 'colour', v_colour, 'hands_over', v_hands, 'prep_minutes', v_prep,
      'categories', to_jsonb(v_cats), 'items', to_jsonb(v_items), 'excluded', to_jsonb(v_excl),
      'before', v_before
    ), null, null, v_id);

  if jsonb_array_length(v_conf) > 0 then
    perform public.pos_log_event(p_branch, p_staff, 'routes_changed',
      jsonb_build_object('moved_to', v_name, 'moved', v_conf), null, null, v_id);
  end if;

  return jsonb_build_object('ok', true, 'point_id', v_id);
end;
$$;

create or replace function public.pos_deactivate_point(p_staff uuid, p_branch uuid, p_point uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_live int;
begin
  if not exists (select 1 from public.staff where id = p_staff and active) then
    return jsonb_build_object('ok', false, 'reason', 'no_actor');
  end if;
  select name into v_name from public.pos_points where id = p_point and branch_id = p_branch and active for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  select count(*) into v_live from public.pos_order_items
   where point_id = p_point and status in ('sent', 'preparing', 'ready');
  if v_live > 0 then return jsonb_build_object('ok', false, 'reason', 'live_items', 'n', v_live); end if;

  update public.pos_points set active = false, updated_at = now() where id = p_point;
  delete from public.pos_point_routes where point_id = p_point;
  delete from public.pos_point_staff  where point_id = p_point;

  perform public.pos_log_event(p_branch, p_staff, 'point_deactivated',
    jsonb_build_object('name', v_name), null, null, p_point);
  return jsonb_build_object('ok', true);
end;
$$;

-- Items / categories the owner has deliberately decided NOT to sell at this
-- event. Without this, an item no point makes is indistinguishable from one
-- somebody forgot — and the dashboard's "unrouted items" signal would cry wolf.
create or replace function public.pos_set_unsold(p_staff uuid, p_branch uuid, p_refs text[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_refs text[];
begin
  if not exists (select 1 from public.staff where id = p_staff and active) then
    return jsonb_build_object('ok', false, 'reason', 'no_actor');
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_refs
    from unnest(coalesce(p_refs, '{}')) x where x ~ '^[ci]:.{1,78}$';
  if cardinality(v_refs) > 600 then return jsonb_build_object('ok', false, 'reason', 'bad_cfg'); end if;

  insert into public.pos_branch_settings (branch_id, unsold_refs, updated_by)
  values (p_branch, v_refs, p_staff)
  on conflict (branch_id) do update set unsold_refs = excluded.unsold_refs, updated_at = now(), updated_by = p_staff;

  perform public.pos_log_event(p_branch, p_staff, 'routes_changed',
    jsonb_build_object('unsold', to_jsonb(v_refs)));
  return jsonb_build_object('ok', true);
end;
$$;

-- Enable/disable POS for a branch and/or rotate its Ready-board token.
create or replace function public.pos_configure_branch(
  p_staff uuid, p_branch uuid, p_enabled boolean default null, p_board_token text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_was boolean;
begin
  if not exists (select 1 from public.staff where id = p_staff and active) then
    return jsonb_build_object('ok', false, 'reason', 'no_actor');
  end if;
  if not exists (select 1 from public.branches where id = p_branch) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if p_board_token is not null and char_length(p_board_token) < 24 then
    return jsonb_build_object('ok', false, 'reason', 'bad_token');
  end if;

  select enabled into v_was from public.pos_branch_settings where branch_id = p_branch;
  if p_enabled is false and coalesce(v_was, false)
     and exists (select 1 from public.pos_sessions where branch_id = p_branch and status = 'active') then
    return jsonb_build_object('ok', false, 'reason', 'session_active');
  end if;

  insert into public.pos_branch_settings (branch_id, enabled, board_token, updated_by)
  values (p_branch, coalesce(p_enabled, false), p_board_token, p_staff)
  on conflict (branch_id) do update set
    enabled     = coalesce(p_enabled, public.pos_branch_settings.enabled),
    board_token = coalesce(p_board_token, public.pos_branch_settings.board_token),
    updated_at  = now(),
    updated_by  = p_staff;

  if p_enabled is not null and p_enabled is distinct from coalesce(v_was, false) then
    perform public.pos_log_event(p_branch, p_staff, 'settings_changed', jsonb_build_object('enabled', p_enabled));
  end if;
  if p_board_token is not null then
    -- the token itself is never logged
    perform public.pos_log_event(p_branch, p_staff, 'board_token_rotated', '{}'::jsonb);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- 5.10 Presence ---------------------------------------------------------
create or replace function public.pos_checkin(p_staff uuid, p_point uuid, p_event text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_branch  uuid;
  v_name    text;
  v_session uuid;
begin
  if not exists (select 1 from public.staff where id = p_staff and active) then
    return jsonb_build_object('ok', false, 'reason', 'no_actor');
  end if;
  if p_event not in ('check_in', 'check_out') then
    return jsonb_build_object('ok', false, 'reason', 'bad_event');
  end if;
  select branch_id, name into v_branch, v_name from public.pos_points where id = p_point and active;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  select id into v_session from public.pos_sessions where branch_id = v_branch and status = 'active';
  insert into public.pos_point_checkins (branch_id, session_id, point_id, staff_id, event)
  values (v_branch, v_session, p_point, p_staff, p_event);

  perform public.pos_log_event(v_branch, p_staff,
    case when p_event = 'check_in' then 'checkin' else 'checkout' end,
    jsonb_build_object('point', v_name), null, null, p_point, v_session);
  return jsonb_build_object('ok', true);
end;
$$;

-- 5.11 Nickname ---------------------------------------------------------
create or replace function public.pos_set_handle(p_actor uuid, p_target uuid, p_handle text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old    text;
  v_handle text := btrim(coalesce(p_handle, ''));
begin
  if not exists (select 1 from public.staff where id = p_actor and active) then
    return jsonb_build_object('ok', false, 'reason', 'no_actor');
  end if;
  if v_handle !~ '^[A-Za-z0-9֐-׿؀-ۿ_.-]{2,16}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select handle into v_old from public.staff where id = p_target for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if exists (select 1 from public.staff where lower(handle) = lower(v_handle) and id <> p_target) then
    return jsonb_build_object('ok', false, 'reason', 'taken');
  end if;

  begin
    update public.staff set handle = v_handle, handle_set_at = now() where id = p_target;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'taken');
  end;

  -- A person's nickname is a staff-level fact, not a branch-level one; log it
  -- against every POS-enabled branch so each audit log can explain the change.
  perform public.pos_log_event(b.branch_id, p_actor, 'handle_changed',
    jsonb_build_object('old', v_old, 'new', v_handle, 'target_staff', p_target))
  from public.pos_branch_settings b where b.enabled;
  return jsonb_build_object('ok', true, 'handle', v_handle);
end;
$$;

-- 5.12 Retention --------------------------------------------------------
-- Phones are cleared N days after their session ended; names after M days.
-- Events are append-only, so the scrub of a name from their payload goes
-- through the same transaction-local flag the training wipe uses.
create or replace function public.pos_clear_old_pii(p_phone_days int default 30, p_name_days int default 365)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phones int;
  v_names  int;
begin
  update public.pos_orders od set customer_phone = null
   where customer_phone is not null
     and exists (select 1 from public.pos_sessions s
                  where s.id = od.session_id and s.status = 'closed'
                    and s.ended_at < now() - make_interval(days => p_phone_days));
  get diagnostics v_phones = row_count;

  perform set_config('pos.wiping', 'on', true);
  update public.pos_orders od set customer_name = 'לקוח'
   where customer_name <> 'לקוח'
     and od.created_at < now() - make_interval(days => p_name_days);
  get diagnostics v_names = row_count;
  update public.pos_events e set payload = (e.payload - 'customer_name') - 'previous_name'
   where e.at < now() - make_interval(days => p_name_days)
     and (e.payload ? 'customer_name' or e.payload ? 'previous_name');
  perform set_config('pos.wiping', 'off', true);

  if v_phones > 0 or v_names > 0 then
    insert into public.pos_events (branch_id, event, payload)
    select b.id, 'pii_cleared', jsonb_build_object('phones', v_phones, 'names', v_names)
      from public.branches b
     where exists (select 1 from public.pos_branch_settings s where s.branch_id = b.id and s.enabled);
  end if;
  return jsonb_build_object('phones', v_phones, 'names', v_names);
end;
$$;

-- Function grants: revoke from PUBLIC first (Postgres hands EXECUTE to PUBLIC on
-- creation, and anon/authenticated inherit it), then service_role only.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'pos\_%'
  loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('revoke all on function %s from anon', f.sig);
    execute format('revoke all on function %s from authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end;
$$;


-- =====================================================================
-- 6. RLS, grants, view, Realtime
-- =====================================================================
alter table public.pos_branch_settings  enable row level security;
alter table public.pos_sessions         enable row level security;
alter table public.pos_points           enable row level security;
alter table public.pos_point_routes     enable row level security;
alter table public.pos_point_staff      enable row level security;
alter table public.pos_ticket_counters  enable row level security;
alter table public.pos_orders           enable row level security;
alter table public.pos_order_items      enable row level security;
alter table public.pos_events           enable row level security;
alter table public.pos_point_checkins   enable row level security;

-- Reads for signed-in STAFF (a customer who signed in with Google is
-- `authenticated` too — authenticated is not staff). No insert/update/delete
-- policy exists anywhere: every write goes through a function.
-- pos_branch_settings and pos_ticket_counters get NO policy at all: service
-- role only (the Ready-board token lives in the former).
do $$
declare
  t text;
begin
  foreach t in array array['pos_sessions', 'pos_points', 'pos_point_routes', 'pos_point_staff',
                           'pos_orders', 'pos_order_items', 'pos_events', 'pos_point_checkins']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_staff_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_staff_client())',
                   t || '_staff_select', t);
  end loop;
end;
$$;

revoke all on public.pos_branch_settings, public.pos_sessions, public.pos_points,
  public.pos_point_routes, public.pos_point_staff, public.pos_ticket_counters,
  public.pos_orders, public.pos_order_items, public.pos_events, public.pos_point_checkins
  from public, anon, authenticated;

grant all on public.pos_branch_settings, public.pos_sessions, public.pos_points,
  public.pos_point_routes, public.pos_point_staff, public.pos_ticket_counters,
  public.pos_orders, public.pos_order_items, public.pos_events, public.pos_point_checkins
  to service_role;

grant select on public.pos_sessions, public.pos_points, public.pos_point_routes, public.pos_point_staff,
  public.pos_orders, public.pos_order_items, public.pos_events, public.pos_point_checkins
  to authenticated;

-- Narrow directory so every device can render "who" without reading `staff`
-- (which deliberately has no select policy for authenticated users). It
-- returns rows ONLY to staff; not filtered by `active`, so history keeps
-- resolving the names of people who were later removed.
create or replace view public.pos_staff_directory
  with (security_invoker = false)
  as
  select id, handle, colour
    from public.staff
   where public.is_staff_client();

revoke all on public.pos_staff_directory from public, anon, authenticated;
grant select on public.pos_staff_directory to authenticated;
grant select on public.pos_staff_directory to service_role;

-- Realtime: signal-don't-reconcile needs the tables in the publication and the
-- old row in UPDATE payloads. Guarded so a re-run does not error.
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['pos_sessions', 'pos_points', 'pos_orders', 'pos_order_items',
                             'pos_events', 'pos_point_checkins']
    loop
      if not exists (
        select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
      execute format('alter table public.%I replica identity full', t);
    end loop;
  end if;
end;
$$;


-- =====================================================================
-- 7. Verify block — raises if anything above did not land as intended.
--    (This checks structure and privileges; behaviour is exercised by
--    scripts/verify-pos-sql.mjs and by the live write-probe in
--    docs/POS_BLUEPRINT.md §12.8.)
-- =====================================================================
do $$
declare
  t text;
  n int;
begin
  foreach t in array array['pos_branch_settings', 'pos_sessions', 'pos_points', 'pos_point_routes',
                           'pos_point_staff', 'pos_ticket_counters', 'pos_orders', 'pos_order_items',
                           'pos_events', 'pos_point_checkins']
  loop
    if not exists (select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace
                    where s.nspname = 'public' and c.relname = t and c.relrowsecurity) then
      raise exception 'verify: % is missing or has RLS off', t;
    end if;
    if has_table_privilege('anon', 'public.' || t, 'select, insert, update, delete') then
      raise exception 'verify: anon still holds a privilege on %', t;
    end if;
    if has_table_privilege('authenticated', 'public.' || t, 'insert, update, delete') then
      raise exception 'verify: authenticated holds a WRITE privilege on %', t;
    end if;
    if not has_table_privilege('service_role', 'public.' || t, 'select, insert, update, delete') then
      raise exception 'verify: service_role cannot use % (the "permission denied" trap)', t;
    end if;
  end loop;

  if has_table_privilege('authenticated', 'public.pos_branch_settings', 'select') then
    raise exception 'verify: authenticated can read pos_branch_settings (the board token!)';
  end if;

  select count(*) into n
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname like 'pos\_%'
     and (has_function_privilege('public', p.oid, 'execute')
          or has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute'));
  if n > 0 then
    raise exception 'verify: % pos_* function(s) are still executable by public/anon/authenticated', n;
  end if;

  if has_table_privilege('anon', 'public.pos_staff_directory', 'select') then
    raise exception 'verify: anon can read pos_staff_directory';
  end if;
  if has_table_privilege('authenticated', 'public.pos_staff_directory', 'insert, update, delete') then
    raise exception 'verify: authenticated can WRITE through pos_staff_directory';
  end if;

  if exists (select 1 from public.staff where handle is null) then
    raise exception 'verify: a staff row has no handle';
  end if;
  if (select count(*) from public.staff) <> (select count(distinct lower(handle)) from public.staff) then
    raise exception 'verify: staff handles are not unique';
  end if;
end;
$$;
