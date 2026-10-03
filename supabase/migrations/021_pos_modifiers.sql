-- =====================================================================
-- 021_pos_modifiers.sql — structured order-line modifiers
--
-- Why this exists. 020 snapshots `type_uid` / `type_label` / `variant_label` /
-- `note` / `for_name` onto a line. That covers "which flavour" and free text,
-- but not what a counter actually does all day: oat milk, extra shot, no ice,
-- no onion, "milk instead of water", "sauce on the side". Jamming those into
-- `note` as one string cannot be priced, audited, reported on, or rendered
-- consistently on a station card.
--
-- What it adds (and ONLY this — no table, status or function from 020 is
-- replaced; three of its functions are re-declared because they are the ones
-- that touch line columns):
--   * pos_order_items.modifiers   jsonb array — the HISTORICAL SNAPSHOT of
--       everything the cashier selected on the line, one entry per selection:
--         { group_uid, group:{he,en,ar}, kind, option_uid, label:{he,en,ar},
--           price_delta_agorot, qty, source:{he,en,ar}|null }
--       kind: 'choice' | 'add' | 'remove' | 'substitute' | 'prep'
--       Labels and prices are copied in at order time, so a later menu edit
--       can never change how a past order reads or what it cost.
--   * pos_order_items.base_agorot — the per-unit price BEFORE modifiers.
--       unit_agorot stays the FINAL per-unit price, so every total, report
--       and pos_recompute_order() keeps working unchanged. The database
--       checks   unit_agorot = base_agorot + sum(price_delta_agorot * qty)
--       so a bug in the (trusted, server-side) pricing code is caught here
--       instead of silently mis-charging.
--
-- Where modifier DEFINITIONS live: inside the menu document (menus.draft /
-- menus.published JSONB), exactly like `types` — a content change, never a
-- migration, so draft / publish / versioning / the audit trail all keep
-- working. See docs/POS_BLUEPRINT.md §7.1a.
--
-- Re-runnable: guarded DDL, create or replace.
-- =====================================================================

alter table public.pos_order_items add column if not exists base_agorot integer;
alter table public.pos_order_items add column if not exists modifiers   jsonb not null default '[]'::jsonb;

-- Back-fill BEFORE the immutability trigger learns about the new columns.
update public.pos_order_items set base_agorot = unit_agorot where base_agorot is null;
alter table public.pos_order_items alter column base_agorot set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pos_order_items_modifiers_array') then
    alter table public.pos_order_items
      add constraint pos_order_items_modifiers_array
      check (jsonb_typeof(modifiers) = 'array' and jsonb_array_length(modifiers) <= 24);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pos_order_items_base_range') then
    alter table public.pos_order_items
      add constraint pos_order_items_base_range check (base_agorot between 0 and 500000);
  end if;
end;
$$;

-- Σ price_delta_agorot × qty over a modifiers array (0 for null / empty).
create or replace function public.pos_modifiers_delta(p_mods jsonb)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(sum(
           (m ->> 'price_delta_agorot')::int * coalesce(nullif(m ->> 'qty', '')::int, 1)
         ), 0)::int
    from jsonb_array_elements(case when jsonb_typeof(p_mods) = 'array' then p_mods else '[]'::jsonb end) m;
$$;

-- 020's validator, extended. Still returns NULL when fine, otherwise the reason.
create or replace function public.pos_validate_lines(p_branch uuid, p_lines jsonb)
returns text
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  l    jsonb;
  m    jsonb;
  mods jsonb;
  base int;
  unit int;
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
    unit := (l ->> 'unit_agorot')::int;
    if coalesce(jsonb_typeof(l -> 'name'), '') <> 'object' or public.pos_pick_name(l -> 'name') = '' then
      return 'bad_line';
    end if;
    if char_length(coalesce(l ->> 'note', '')) > 120 or char_length(coalesce(l ->> 'for_name', '')) > 40 then
      return 'bad_line';
    end if;

    -- ---- modifiers (021) ----------------------------------------------
    mods := coalesce(l -> 'modifiers', '[]'::jsonb);
    if jsonb_typeof(mods) = 'null' then mods := '[]'::jsonb; end if;
    if jsonb_typeof(mods) <> 'array' or jsonb_array_length(mods) > 24 then return 'bad_line'; end if;

    if jsonb_array_length(mods) > 0 and coalesce(l ->> 'is_custom', 'false') = 'true' then
      return 'bad_line';                       -- a hand-typed item has no menu modifiers
    end if;

    for m in select * from jsonb_array_elements(mods) loop
      if jsonb_typeof(m) <> 'object' then return 'bad_line'; end if;
      if coalesce(m ->> 'kind', '') not in ('choice', 'add', 'remove', 'substitute', 'prep') then return 'bad_line'; end if;
      if coalesce(jsonb_typeof(m -> 'label'), '') <> 'object' or public.pos_pick_name(m -> 'label') = '' then return 'bad_line'; end if;
      if char_length(coalesce(m ->> 'group_uid', '')) not between 1 and 80 then return 'bad_line'; end if;
      if char_length(coalesce(m ->> 'option_uid', '')) not between 1 and 80 then return 'bad_line'; end if;
      if coalesce(m ->> 'price_delta_agorot', '') !~ '^-?[0-9]{1,6}$'
         or abs((m ->> 'price_delta_agorot')::int) > 500000 then return 'bad_line'; end if;
      if m ? 'qty' and coalesce(m ->> 'qty', '') !~ '^[1-9]$' then return 'bad_line'; end if;
      if m ? 'source' and jsonb_typeof(m -> 'source') not in ('object', 'null') then return 'bad_line'; end if;
      if m ? 'group' and jsonb_typeof(m -> 'group') not in ('object', 'null') then return 'bad_line'; end if;
    end loop;

    -- The arithmetic the whole feature rests on: final = base + modifiers.
    if l ? 'base_agorot' and jsonb_typeof(l -> 'base_agorot') <> 'null' then
      if coalesce(l ->> 'base_agorot', '') !~ '^[0-9]{1,6}$' then return 'bad_line'; end if;
      base := (l ->> 'base_agorot')::int;
    elsif jsonb_array_length(mods) > 0 then
      return 'bad_line';                       -- modifiers without a base price cannot be checked
    else
      base := unit;
    end if;
    if base + public.pos_modifiers_delta(mods) <> unit then return 'bad_line'; end if;
  end loop;

  return null;
end;
$$;

-- 020's line insert, now carrying the modifier snapshot and the base price.
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
    category_title, name, type_uid, type_label, variant_label, unit_agorot, base_agorot,
    modifiers, qty, for_name, note, is_custom, created_by
  )
  select
    p_order, p_branch, v_base + e.ord::int, p_batch, (e.l ->> 'point_id')::uuid, p.name,
    nullif(e.l ->> 'item_uid', ''), nullif(e.l ->> 'category_id', ''),
    e.l -> 'category_title', e.l -> 'name',
    nullif(e.l ->> 'type_uid', ''), e.l -> 'type_label',
    nullif(btrim(e.l ->> 'variant_label'), ''),
    (e.l ->> 'unit_agorot')::int,
    coalesce(nullif(e.l ->> 'base_agorot', '')::int, (e.l ->> 'unit_agorot')::int),
    case when jsonb_typeof(e.l -> 'modifiers') = 'array' then e.l -> 'modifiers' else '[]'::jsonb end,
    (e.l ->> 'qty')::int,
    nullif(btrim(e.l ->> 'for_name'), ''), nullif(btrim(e.l ->> 'note'), ''),
    coalesce(e.l ->> 'is_custom', 'false') = 'true', p_staff
  from jsonb_array_elements(p_lines) with ordinality as e(l, ord)
  join public.pos_points p on p.id = (e.l ->> 'point_id')::uuid
  order by e.ord;

  get diagnostics v_added = row_count;
  return v_added;
end;
$$;

-- 020's immutability guard, now also covering the money breakdown and the
-- modifier snapshot: what was sold, and for how much, can never be edited.
create or replace function public.pos_items_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (new.order_id, new.branch_id, new.seq, new.batch_no, new.point_id, new.point_name,
      new.item_uid, new.name, new.type_uid, new.variant_label, new.unit_agorot, new.base_agorot,
      new.modifiers, new.qty, new.is_custom, new.created_by, new.created_at, new.sent_at)
     is distinct from
     (old.order_id, old.branch_id, old.seq, old.batch_no, old.point_id, old.point_name,
      old.item_uid, old.name, old.type_uid, old.variant_label, old.unit_agorot, old.base_agorot,
      old.modifiers, old.qty, old.is_custom, old.created_by, old.created_at, old.sent_at)
  then
    raise exception 'pos_order_items: identity / money / modifier columns are immutable (void and re-add instead)'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Same grant discipline as 020: nothing here may be callable by a browser role.
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

-- Verify
do $$
declare
  n int;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'pos_order_items' and column_name = 'modifiers') then
    raise exception 'verify: pos_order_items.modifiers is missing';
  end if;
  select count(*) into n
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname like 'pos\_%'
     and (has_function_privilege('public', p.oid, 'execute')
          or has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute'));
  if n > 0 then
    raise exception 'verify: % pos_* function(s) are executable by public/anon/authenticated', n;
  end if;
end;
$$;
