-- ============================================================
-- Lets the live-availability tablet (TabletAvailability.tsx) add and remove
-- items within a category, not just toggle available/quantity on ones that
-- already exist — the owner's own framing: "inside [a category] I can add
-- and remove sub items, and for each subitem there's a quantity." Same
-- live posture as set_availability() (007/012/014): draft AND published
-- are written atomically, so a new item (or a removal) shows up for
-- customers immediately, not at the next unrelated Publish. Also shares
-- set_availability's p_publish flag — outside operating hours the app
-- layer passes false, so an owner testing the tool only ever touches
-- draft.
-- ============================================================

create or replace function public.add_item_to_doc(p_doc jsonb, p_category_id text, p_item jsonb) returns jsonb
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
          case
            when (cat->>'id') = p_category_id
              then jsonb_set(cat, '{items}', coalesce(cat->'items', '[]'::jsonb) || jsonb_build_array(p_item))
            else cat
          end
        )
        from jsonb_array_elements(coalesce(p_doc->'categories', '[]'::jsonb)) as cat
      ),
      '[]'::jsonb
    )
  )
$$;

-- No-op (returns the doc unchanged) if the uid isn't found in this
-- document — same "safe against draft/published disagreeing on which uids
-- exist yet" posture set_item_availability_in_doc already documents.
create or replace function public.remove_item_from_doc(p_doc jsonb, p_item_uid text) returns jsonb
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
                select jsonb_agg(item)
                from jsonb_array_elements(coalesce(cat->'items', '[]'::jsonb)) as item
                where (item->>'uid') is distinct from p_item_uid
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

create or replace function public.add_menu_item(
  p_menu_id uuid, p_category_id text, p_item jsonb, p_publish boolean default true
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
    set draft      = public.add_item_to_doc(v_draft, p_category_id, p_item),
        published  = public.add_item_to_doc(v_published, p_category_id, p_item),
        updated_at = now()
    where id = p_menu_id;
  else
    update public.menus
    set draft      = public.add_item_to_doc(v_draft, p_category_id, p_item),
        updated_at = now()
    where id = p_menu_id;
  end if;
end;
$$;

create or replace function public.remove_menu_item(
  p_menu_id uuid, p_item_uid text, p_publish boolean default true
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
    set draft      = public.remove_item_from_doc(v_draft, p_item_uid),
        published  = public.remove_item_from_doc(v_published, p_item_uid),
        updated_at = now()
    where id = p_menu_id;
  else
    update public.menus
    set draft      = public.remove_item_from_doc(v_draft, p_item_uid),
        updated_at = now()
    where id = p_menu_id;
  end if;
end;
$$;

revoke execute on function public.add_item_to_doc(jsonb, text, jsonb) from public;
grant execute on function public.add_item_to_doc(jsonb, text, jsonb) to service_role;

revoke execute on function public.remove_item_from_doc(jsonb, text) from public;
grant execute on function public.remove_item_from_doc(jsonb, text) to service_role;

revoke execute on function public.add_menu_item(uuid, text, jsonb, boolean) from public;
grant execute on function public.add_menu_item(uuid, text, jsonb, boolean) to service_role;

revoke execute on function public.remove_menu_item(uuid, text, boolean) from public;
grant execute on function public.remove_menu_item(uuid, text, boolean) to service_role;
