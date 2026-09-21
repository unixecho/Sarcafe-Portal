-- ============================================================
-- Safe to re-run, same discipline as migration 010: every CREATE is
-- IF NOT EXISTS / OR REPLACE, every policy is dropped first.
--
-- The POS order system — Phase 2 from SarCafe-ARCHITECTURE-AUDIT.md §7/§9.
-- Scope for this pass: order creation (staff-entered, register-style),
-- the state machine (new -> preparing -> ready -> completed, cancel as a
-- separate owner/GM-only branch), and a live order board. NOT in this
-- pass: customer self-order/QR/recovery codes, Web Push, a real payment
-- API — those need a customer-session model this app doesn't have yet
-- (see the audit's Phase 2+3 list) and are deliberately deferred, same
-- as Phase 1's own status section deferred the a11y widget and the wheel
-- picker.
--
-- AUTHORIZATION POSTURE, same as migration 010: the app layer
-- (lib/orders/guard.ts, requireOrderStaff()/requireOrderManager()) is the
-- PRIMARY gate, using the service-role client. RLS below is real and
-- still enforced (defense in depth), not the only thing standing between
-- a request and a write.
--
-- PRICE, deliberately staff-entered, not derived from the menu doc here:
-- MenuItem.price can be a plain number OR a free-text range string
-- ("20/24"), and MenuItemType.priceDelta is free text too (see
-- lib/menu/types.ts) — there's no reliable numeric parse for either. A
-- real cash register already works this way: the person ringing it up
-- reads the price and confirms it, same trust boundary as "the cashier
-- can also give a discount." This is NOT the same trust gap the
-- architecture audit warns about for order STATUS ("client cannot
-- simply send {status:'COMPLETED'}") — that's enforced entirely
-- server-side below (advance_order_status()'s fixed transition table).
--
-- INVENTORY, best-effort only: create_order() decrements any ordered
-- item/type that currently tracks `quantity` (migration 012/015), using
-- the exact same whole-menu-row lock + read + write shape
-- set_availability() already uses — the row-locking-RPC pattern flagged
-- in the audit as worth reusing from giftcard-demo, applied here to
-- "checkout" instead of a gift-card balance. An item/type not found in
-- the doc (stale uid, published mid-order) is left untouched rather than
-- failing the order — same "no-op if uid not found" posture
-- remove_item_from_doc already established.
-- ============================================================

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

create table if not exists public.orders (
  id               uuid primary key default gen_random_uuid(),
  branch_id        uuid not null references public.branches(id) on delete cascade,
  -- Per-branch, resets daily (see create_order()) — a receipt number, not
  -- a global identifier. Deliberately NOT unique-constrained: today's #5
  -- and yesterday's #5 both legitimately exist.
  order_number     integer not null,
  status           text not null default 'new' check (status in ('new', 'preparing', 'ready', 'completed', 'cancelled')),
  customer_name    text,
  notes            text,
  subtotal         numeric(10, 2) not null default 0,
  total            numeric(10, 2) not null default 0,
  payment_status   text not null default 'unpaid' check (payment_status in ('unpaid', 'paid')),
  payment_method   text check (payment_method is null or payment_method in ('cash', 'card', 'bit', 'other')),
  created_by       uuid references public.staff(id) on delete set null,
  created_by_name  text,
  cancelled_by     uuid references public.staff(id) on delete set null,
  cancel_reason    text,
  started_at       timestamptz,
  ready_at         timestamptz,
  completed_at     timestamptz,
  cancelled_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists orders_branch_status_idx on public.orders (branch_id, status);
create index if not exists orders_branch_created_idx on public.orders (branch_id, created_at desc);

create table if not exists public.order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id) on delete cascade,
  -- The menu item's stable uid (ensureUids()) — same reference discipline
  -- as menu_variants.excluded_uids and the customer cart's CartLine.
  item_uid     text not null,
  item_name    jsonb not null default '{}'::jsonb,  -- snapshot at order time, never re-derived
  type_uid     text,
  type_name    jsonb,
  unit_price   numeric(10, 2) not null default 0,
  quantity     integer not null check (quantity > 0),
  line_total   numeric(10, 2) not null default 0,
  notes        text,
  sort_order   integer not null default 0
);

create index if not exists order_items_order_id_idx on public.order_items (order_id);

-- One counter row per branch — the atomic upsert in create_order() locks
-- exactly this row, so two simultaneous orders at the same branch never
-- collide on the same display number.
create table if not exists public.order_counters (
  branch_id   uuid primary key references public.branches(id) on delete cascade,
  order_date  date not null default current_date,
  counter     integer not null default 0
);

insert into public.order_counters (branch_id)
select id from public.branches
on conflict (branch_id) do nothing;

-- ---------------------------------------------------------------------
-- Access functions — SQL twins of lib/orders/access.ts. Same shape as
-- migration 010's can_view_schedule()/is_schedule_manager(), independent
-- of them on purpose (each feature re-derives from `staff` rather than
-- cross-calling another feature's function).
-- ---------------------------------------------------------------------

create or replace function public.can_work_orders(p_branch_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff s
    where s.auth_user_id = auth.uid()
      and s.active
      and (s.branch_id is null or s.branch_id = p_branch_id)
  );
$$;

-- Cancel is deliberately narrower than take/advance/pay — the audit's
-- explicit rule ("kitchen must never get cancellation authority"). Same
-- two tiers is_menu_editor() already uses (owner, or general_manager
-- scoped to their branch), no wider 'manager' carve-out invented here.
create or replace function public.can_cancel_order(p_branch_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff s
    where s.auth_user_id = auth.uid()
      and s.active
      and (
        s.role = 'owner'
        or s.badge = 'owner'
        or (s.badge = 'general_manager' and (s.branch_id is null or s.branch_id = p_branch_id))
      )
  );
$$;

revoke execute on function public.can_work_orders(uuid) from public;
revoke execute on function public.can_cancel_order(uuid) from public;
grant execute on function public.can_work_orders(uuid) to authenticated, service_role;
grant execute on function public.can_cancel_order(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- decrement_item_quantity_in_doc() — same traversal shape as
-- set_item_availability_in_doc() (015), reusing patch_availability_fields()
-- so the "quantity hits 0 forces available=false" rule stays in the one
-- place that already owns it. Only touches an item/type that currently
-- HAS a `quantity` key (absent means "not tracked", per lib/menu/types.ts)
-- — never invents tracking for an item that never had it.
-- ---------------------------------------------------------------------

create or replace function public.decrement_item_quantity_in_doc(
  p_doc jsonb, p_item_uid text, p_type_uid text, p_delta integer
) returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_set(
    p_doc,
    '{categories}',
    coalesce(
      (
        select jsonb_agg(
          jsonb_set(
            cat,
            '{items}',
            coalesce(
              (
                select jsonb_agg(
                  case
                    when (item->>'uid') = p_item_uid and p_type_uid is null and (item ? 'quantity')
                      then public.patch_availability_fields(
                        item, null, greatest(0, coalesce((item->>'quantity')::integer, 0) - p_delta)
                      )
                    when (item->>'uid') = p_item_uid and p_type_uid is not null
                      then jsonb_set(
                        item,
                        '{types}',
                        coalesce(
                          (
                            select jsonb_agg(
                              case when (tp->>'uid') = p_type_uid and (tp ? 'quantity')
                                then public.patch_availability_fields(
                                  tp, null, greatest(0, coalesce((tp->>'quantity')::integer, 0) - p_delta)
                                )
                                else tp
                              end
                            )
                            from jsonb_array_elements(coalesce(item->'types', '[]'::jsonb)) as tp
                          ),
                          '[]'::jsonb
                        )
                      )
                    else item
                  end
                )
                from jsonb_array_elements(coalesce(cat->'items', '[]'::jsonb)) as item
              ),
              '[]'::jsonb
            )
          )
        )
        from jsonb_array_elements(coalesce(p_doc->'categories', '[]'::jsonb)) as cat
      ),
      '[]'::jsonb
    )
  )
$$;

revoke execute on function public.decrement_item_quantity_in_doc(jsonb, text, text, integer) from public;
grant execute on function public.decrement_item_quantity_in_doc(jsonb, text, text, integer) to service_role;

-- ---------------------------------------------------------------------
-- create_order() — the one write that starts an order. Computes the
-- per-branch daily order_number, inserts the order + its lines, and
-- best-effort decrements live inventory, all under one lock on this
-- branch's menu row (mirrors set_availability()'s own lock/read/write).
--
-- p_items: jsonb array of
--   { itemUid, itemName, typeUid, typeName, unitPrice, quantity, notes }
-- — camelCase keys because the Route Handler passes the same shape
-- straight through from the client's OrderLineInput (lib/orders/actions.ts).
-- ---------------------------------------------------------------------

create or replace function public.create_order(
  p_branch_id uuid,
  p_created_by uuid,
  p_created_by_name text,
  p_customer_name text,
  p_notes text,
  p_payment_method text,
  p_items jsonb
) returns table(id uuid, order_number integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz         text;
  v_local_date date;
  v_counter    integer;
  v_order_id   uuid := gen_random_uuid();
  v_subtotal   numeric(10, 2) := 0;
  v_item       jsonb;
  v_menu_id    uuid;
  v_draft      jsonb;
  v_published  jsonb;
  v_sort       integer := 0;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'An order needs at least one item.';
  end if;

  select timezone into v_tz from public.branches where id = p_branch_id;
  if v_tz is null then
    raise exception 'Branch not found.';
  end if;
  v_local_date := (now() at time zone v_tz)::date;

  -- Atomic per-branch daily counter. Locks and updates this branch's one
  -- counter row in a single statement (no separate SELECT ... FOR UPDATE
  -- needed — the UPDATE itself takes the row lock).
  update public.order_counters
  set counter = case when order_date = v_local_date then counter + 1 else 1 end,
      order_date = v_local_date
  where branch_id = p_branch_id
  returning counter into v_counter;

  if not found then
    insert into public.order_counters (branch_id, order_date, counter)
    values (p_branch_id, v_local_date, 1)
    returning counter into v_counter;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if coalesce((v_item->>'unitPrice')::numeric, -1) < 0 or coalesce((v_item->>'quantity')::integer, 0) < 1 then
      raise exception 'Invalid order line.';
    end if;
    v_subtotal := v_subtotal + (v_item->>'unitPrice')::numeric * (v_item->>'quantity')::integer;
  end loop;

  insert into public.orders (
    id, branch_id, order_number, status, customer_name, notes, subtotal, total,
    payment_status, payment_method, created_by, created_by_name
  ) values (
    v_order_id, p_branch_id, v_counter, 'new',
    nullif(trim(coalesce(p_customer_name, '')), ''), nullif(trim(coalesce(p_notes, '')), ''),
    v_subtotal, v_subtotal, 'unpaid', p_payment_method, p_created_by, p_created_by_name
  );

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.order_items (
      order_id, item_uid, item_name, type_uid, type_name, unit_price, quantity, line_total, notes, sort_order
    ) values (
      v_order_id,
      v_item->>'itemUid',
      coalesce(v_item->'itemName', '{}'::jsonb),
      v_item->>'typeUid',
      v_item->'typeName',
      (v_item->>'unitPrice')::numeric,
      (v_item->>'quantity')::integer,
      (v_item->>'unitPrice')::numeric * (v_item->>'quantity')::integer,
      nullif(trim(coalesce(v_item->>'notes', '')), ''),
      v_sort
    );
    v_sort := v_sort + 1;
  end loop;

  select id into v_menu_id from public.menus where branch_id = p_branch_id;
  if v_menu_id is not null then
    select draft, published into v_draft, v_published from public.menus where id = v_menu_id for update;

    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_draft := public.decrement_item_quantity_in_doc(
        v_draft, v_item->>'itemUid', v_item->>'typeUid', (v_item->>'quantity')::integer
      );
      v_published := public.decrement_item_quantity_in_doc(
        v_published, v_item->>'itemUid', v_item->>'typeUid', (v_item->>'quantity')::integer
      );
    end loop;

    update public.menus
    set draft = v_draft, published = v_published, updated_at = now()
    where id = v_menu_id;
  end if;

  return query select v_order_id, v_counter;
end;
$$;

-- ---------------------------------------------------------------------
-- advance_order_status() — the ENTIRE state machine, enforced here and
-- nowhere else. Fixed forward-only transition table; anything not an
-- exact match raises. Cancellation is deliberately NOT reachable through
-- this function at all (see cancel_order() below, gated separately).
-- ---------------------------------------------------------------------

create or replace function public.advance_order_status(p_order_id uuid, p_to_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from text;
  v_next text;
begin
  select status into v_from from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.';
  end if;

  v_next := case v_from
    when 'new' then 'preparing'
    when 'preparing' then 'ready'
    when 'ready' then 'completed'
    else null
  end;

  if v_next is null or v_next <> p_to_status then
    raise exception 'Cannot move order from % to %.', v_from, p_to_status;
  end if;

  update public.orders
  set status = p_to_status,
      started_at = case when p_to_status = 'preparing' then now() else started_at end,
      ready_at = case when p_to_status = 'ready' then now() else ready_at end,
      completed_at = case when p_to_status = 'completed' then now() else completed_at end,
      updated_at = now()
  where id = p_order_id;
end;
$$;

create or replace function public.cancel_order(p_order_id uuid, p_cancelled_by uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.';
  end if;
  if v_status in ('completed', 'cancelled') then
    raise exception 'Order is already %.', v_status;
  end if;

  update public.orders
  set status = 'cancelled',
      cancelled_by = p_cancelled_by,
      cancel_reason = nullif(trim(coalesce(p_reason, '')), ''),
      cancelled_at = now(),
      updated_at = now()
  where id = p_order_id;
end;
$$;

create or replace function public.set_order_payment(p_order_id uuid, p_status text, p_method text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('unpaid', 'paid') then
    raise exception 'Invalid payment status.';
  end if;

  update public.orders
  set payment_status = p_status,
      payment_method = coalesce(p_method, payment_method),
      updated_at = now()
  where id = p_order_id;

  if not found then
    raise exception 'Order not found.';
  end if;
end;
$$;

revoke execute on function public.create_order(uuid, uuid, text, text, text, text, jsonb) from public;
revoke execute on function public.advance_order_status(uuid, text) from public;
revoke execute on function public.cancel_order(uuid, uuid, text) from public;
revoke execute on function public.set_order_payment(uuid, text, text) from public;
grant execute on function public.create_order(uuid, uuid, text, text, text, text, jsonb) to service_role;
grant execute on function public.advance_order_status(uuid, text) to service_role;
grant execute on function public.cancel_order(uuid, uuid, text) to service_role;
grant execute on function public.set_order_payment(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_counters enable row level security;

drop policy if exists "orders readable by branch staff" on public.orders;
create policy "orders readable by branch staff" on public.orders
  for select using (public.can_work_orders(branch_id));

-- Every WRITE goes through the RPCs above (each does its own state-machine
-- and authorization work), so there is no insert/update/delete policy on
-- `orders` for authenticated at all — a select-only policy denies every
-- other operation by construction, same posture migration 010 documents
-- for shift_swaps.

drop policy if exists "order items readable by branch staff" on public.order_items;
create policy "order items readable by branch staff" on public.order_items
  for select using (
    exists (select 1 from public.orders o where o.id = order_id and public.can_work_orders(o.branch_id))
  );

-- order_counters: service-role/RPC only, no policies — an implementation
-- detail of create_order(), never read or written directly by the app.

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
grant all on public.orders, public.order_items, public.order_counters to service_role;
grant select on public.orders, public.order_items to authenticated;
