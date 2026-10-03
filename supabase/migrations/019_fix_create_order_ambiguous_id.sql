-- ============================================================
-- Fixes a real bug hit in production: creating an order failed with
-- "column reference \"id\" is ambiguous".
--
-- ROOT CAUSE: migration 018 changed create_order()'s signature to
-- RETURNS TABLE(id uuid, order_number integer, token text,
-- recovery_code text, expires_at timestamptz). Every OUT column of a
-- RETURNS TABLE function becomes an implicitly-declared variable, scoped
-- to the WHOLE function body — so `id` was ALSO a plpgsql variable name
-- from that point on, alongside every table's own `id` column. Four
-- places inside create_order() reference a bare, unqualified `id` in a
-- query (not an INSERT column list, which is exempt): Postgres can't
-- tell whether that means "the OUT parameter" or "this table's id
-- column", and refuses instead of guessing:
--   - `select timezone into v_tz from public.branches where id = ...`
--   - `select id into v_menu_id from public.menus where branch_id = ...`
--   - `select draft, published ... from public.menus where id = ... for update`
--   - `update public.menus set ... where id = v_menu_id`
-- This is a genuine plpgsql gotcha (an OUT parameter shadowing a common
-- column name like "id"), not a data/logic bug — every one of those four
-- statements always meant the table's own id column. Fixed by qualifying
-- each with its table name; behavior is otherwise byte-for-byte
-- identical to 018's version.
-- ============================================================

create or replace function public.create_order(
  p_branch_id uuid,
  p_created_by uuid,
  p_created_by_name text,
  p_customer_name text,
  p_notes text,
  p_payment_method text,
  p_items jsonb
) returns table(id uuid, order_number integer, token text, recovery_code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
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
  v_access     record;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'An order needs at least one item.';
  end if;

  select timezone into v_tz from public.branches where public.branches.id = p_branch_id;
  if v_tz is null then
    raise exception 'Branch not found.';
  end if;
  v_local_date := (now() at time zone v_tz)::date;

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

  select public.menus.id into v_menu_id from public.menus where branch_id = p_branch_id;
  if v_menu_id is not null then
    select draft, published into v_draft, v_published from public.menus where public.menus.id = v_menu_id for update;

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
    where public.menus.id = v_menu_id;
  end if;

  select * into v_access from public.issue_order_access(v_order_id);

  return query select v_order_id, v_counter, v_access.token, v_access.recovery_code, v_access.expires_at;
end;
$$;

revoke execute on function public.create_order(uuid, uuid, text, text, text, text, jsonb) from public;
grant execute on function public.create_order(uuid, uuid, text, text, text, text, jsonb) to service_role;
