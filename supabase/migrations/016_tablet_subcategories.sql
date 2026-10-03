-- ============================================================
-- Lets a tablet item become a subcategory: some categories are flat
-- (עוגיות/שייקים — a handful of items, done), others need one more level
-- (מאפים -> מאפה רגיל/מאפה שווה -> the actual pastries sold under each) —
-- the owner's own framing. Rather than a schema change, an item IS a
-- subcategory exactly when its `types` key is present (even as an empty
-- array) — set_menu_item_container() below is the only thing that flips
-- that, and it refuses to drop `types` while any exist, so converting back
-- to a plain item can never silently discard sub-items. Once an item is a
-- subcategory, add_menu_item_type()/remove_menu_item_type() manage its
-- `types` array the same live, draft(+published)/p_publish way
-- add_menu_item()/remove_menu_item() (migration 015) manage a category's
-- `items` array.
-- ============================================================

create or replace function public.add_type_to_doc(p_doc jsonb, p_item_uid text, p_type jsonb) returns jsonb
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
                    when (item->>'uid') = p_item_uid
                      then jsonb_set(item, '{types}', coalesce(item->'types', '[]'::jsonb) || jsonb_build_array(p_type))
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

-- No-op if the type uid isn't found — same "safe against draft/published
-- disagreeing on which uids exist yet" posture as remove_item_from_doc.
create or replace function public.remove_type_from_doc(p_doc jsonb, p_type_uid text) returns jsonb
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
                    when jsonb_typeof(item->'types') = 'array'
                      then jsonb_set(
                        item,
                        '{types}',
                        coalesce(
                          (
                            select jsonb_agg(tp)
                            from jsonb_array_elements(item->'types') as tp
                            where (tp->>'uid') is distinct from p_type_uid
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

-- Flips one item's container-ness. Turning ON just ensures `types` exists
-- (idempotent — a no-op if it's already a subcategory). Turning OFF only
-- takes effect when `types` is already empty; otherwise the item is
-- returned unchanged rather than silently dropping its sub-items — the app
-- layer (PATCH /api/owner/menu-items) is expected to check this first and
-- surface a real error, but the data is protected here too either way.
create or replace function public.set_item_container_in_doc(p_doc jsonb, p_item_uid text, p_is_container boolean) returns jsonb
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
                    when (item->>'uid') = p_item_uid and p_is_container
                      then jsonb_set(item, '{types}', coalesce(item->'types', '[]'::jsonb))
                    when (item->>'uid') = p_item_uid and not p_is_container
                         and jsonb_array_length(coalesce(item->'types', '[]'::jsonb)) = 0
                      then item - 'types'
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

create or replace function public.add_menu_item_type(
  p_menu_id uuid, p_item_uid text, p_type jsonb, p_publish boolean default true
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

  if p_publish then
    update public.menus
    set draft      = public.add_type_to_doc(v_draft, p_item_uid, p_type),
        published  = public.add_type_to_doc(v_published, p_item_uid, p_type),
        updated_at = now()
    where id = p_menu_id;
  else
    update public.menus
    set draft      = public.add_type_to_doc(v_draft, p_item_uid, p_type),
        updated_at = now()
    where id = p_menu_id;
  end if;
end;
$$;

create or replace function public.remove_menu_item_type(
  p_menu_id uuid, p_type_uid text, p_publish boolean default true
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

  if p_publish then
    update public.menus
    set draft      = public.remove_type_from_doc(v_draft, p_type_uid),
        published  = public.remove_type_from_doc(v_published, p_type_uid),
        updated_at = now()
    where id = p_menu_id;
  else
    update public.menus
    set draft      = public.remove_type_from_doc(v_draft, p_type_uid),
        updated_at = now()
    where id = p_menu_id;
  end if;
end;
$$;

create or replace function public.set_menu_item_container(
  p_menu_id uuid, p_item_uid text, p_is_container boolean, p_publish boolean default true
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

  if p_publish then
    update public.menus
    set draft      = public.set_item_container_in_doc(v_draft, p_item_uid, p_is_container),
        published  = public.set_item_container_in_doc(v_published, p_item_uid, p_is_container),
        updated_at = now()
    where id = p_menu_id;
  else
    update public.menus
    set draft      = public.set_item_container_in_doc(v_draft, p_item_uid, p_is_container),
        updated_at = now()
    where id = p_menu_id;
  end if;
end;
$$;

revoke execute on function public.add_type_to_doc(jsonb, text, jsonb) from public;
grant execute on function public.add_type_to_doc(jsonb, text, jsonb) to service_role;

revoke execute on function public.remove_type_from_doc(jsonb, text) from public;
grant execute on function public.remove_type_from_doc(jsonb, text) to service_role;

revoke execute on function public.set_item_container_in_doc(jsonb, text, boolean) from public;
grant execute on function public.set_item_container_in_doc(jsonb, text, boolean) to service_role;

revoke execute on function public.add_menu_item_type(uuid, text, jsonb, boolean) from public;
grant execute on function public.add_menu_item_type(uuid, text, jsonb, boolean) to service_role;

revoke execute on function public.remove_menu_item_type(uuid, text, boolean) from public;
grant execute on function public.remove_menu_item_type(uuid, text, boolean) to service_role;

revoke execute on function public.set_menu_item_container(uuid, text, boolean, boolean) from public;
grant execute on function public.set_menu_item_container(uuid, text, boolean, boolean) to service_role;
