-- ============================================================
-- Adds live quantity tracking to the tablet availability editor (item AND
-- type level), alongside the existing `available` boolean written by
-- 007_menu_item_availability.sql's set_availability(). Same atomic,
-- both-draft-and-published, row-locked write path — a quantity update is
-- exactly as live-now as an availability flip already is.
--
-- Setting quantity to exactly 0 also forces available=false in the same
-- write. Raising it back above 0 does NOT auto-restore availability —
-- matches "החזרה למלאי" already being a deliberate, separate action
-- elsewhere in the app (MenuEditor's out-of-stock rollup): a quantity
-- bump alone must never silently un-hide something turned off for an
-- unrelated reason (e.g. a recipe issue, not a stock-out).
--
-- Both existing functions are DROPPED before being recreated with an
-- extra parameter, rather than relying on CREATE OR REPLACE — adding a
-- parameter changes the function's arg-count signature, so CREATE OR
-- REPLACE would have created a second overload alongside the old one
-- instead of replacing it, and calling with the original argument names
-- would then be ambiguous between the two.
-- ============================================================

drop function if exists public.set_availability(uuid, text, text, boolean);
drop function if exists public.set_item_availability_in_doc(jsonb, text, text, boolean);

-- Computes the patched item/type object for whichever of p_available /
-- p_quantity the caller actually wants to change (each null = leave that
-- field alone).
create or replace function public.patch_availability_fields(
  p_obj jsonb, p_available boolean, p_quantity integer
) returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_obj jsonb := p_obj;
  v_available boolean;
begin
  if p_quantity is not null then
    v_obj := jsonb_set(v_obj, '{quantity}', to_jsonb(p_quantity));
  end if;

  if p_quantity = 0 then
    v_available := false;
  elsif p_available is not null then
    v_available := p_available;
  else
    v_available := null; -- leave the existing flag untouched
  end if;

  if v_available is not null then
    v_obj := jsonb_set(v_obj, '{available}', to_jsonb(v_available));
  end if;

  return v_obj;
end;
$$;

create or replace function public.set_item_availability_in_doc(
  p_doc jsonb, p_item_uid text, p_type_uid text, p_available boolean default null, p_quantity integer default null
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
                    when (item->>'uid') = p_item_uid and p_type_uid is null
                      then public.patch_availability_fields(item, p_available, p_quantity)
                    when (item->>'uid') = p_item_uid and p_type_uid is not null
                      then jsonb_set(
                        item,
                        '{types}',
                        coalesce(
                          (
                            select jsonb_agg(
                              case when (tp->>'uid') = p_type_uid
                                then public.patch_availability_fields(tp, p_available, p_quantity)
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

create or replace function public.set_availability(
  p_menu_id uuid, p_item_uid text, p_type_uid text, p_available boolean default null, p_quantity integer default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft     jsonb;
  v_published jsonb;
begin
  select draft, published into v_draft, v_published
  from public.menus
  where id = p_menu_id
  for update;

  if not found then
    raise exception 'menu % not found', p_menu_id;
  end if;

  update public.menus
  set draft      = public.set_item_availability_in_doc(v_draft, p_item_uid, p_type_uid, p_available, p_quantity),
      published  = public.set_item_availability_in_doc(v_published, p_item_uid, p_type_uid, p_available, p_quantity),
      updated_at = now()
  where id = p_menu_id;
end;
$$;

-- Same revoke-then-grant idiom as every other SECURITY DEFINER function in
-- this schema: Postgres grants EXECUTE to PUBLIC by default.
revoke execute on function public.patch_availability_fields(jsonb, boolean, integer) from public;
grant execute on function public.patch_availability_fields(jsonb, boolean, integer) to service_role;

revoke execute on function public.set_item_availability_in_doc(jsonb, text, text, boolean, integer) from public;
grant execute on function public.set_item_availability_in_doc(jsonb, text, text, boolean, integer) to service_role;

revoke execute on function public.set_availability(uuid, text, text, boolean, integer) from public;
grant execute on function public.set_availability(uuid, text, text, boolean, integer) to service_role;
