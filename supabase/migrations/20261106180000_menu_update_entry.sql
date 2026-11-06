-- 20261106180000_menu_update_entry
--
-- The menu editor on the kiosk tablet (owner, 2026-11-06: the full editor on the tablet, behind the staff PIN — names, prices,
-- adding and removing items and types, through the same rules as the dashboard). Adding/removing items and types already have
-- their functions (add_menu_item, remove_menu_item, add_menu_item_type, remove_menu_item_type, set_menu_item_container — migrations
-- 015/016). Renaming or repricing ONE existing item or type did not: the desktop editor rewrites the whole draft for that. This adds
-- it, with the same posture as set_availability(): the row is locked, the draft always changes, the published (customer-facing)
-- menu only when p_publish (the caller passes "within opening hours", src/lib/menu/tablet-write.ts). docs/SARCAFE_KIOSK_MENU.md.
--
--   menu_update_entry(menu, item uid, type uid | null, new Hebrew name | null, new price | null, publish)
--     name: 1–80 characters (trimmed) or null = unchanged
--     price: null = unchanged, '' = no price, digits = a number, anything else up to 20 characters (e.g. "20/24") = kept as text;
--            on an item it is `price`, on a type `priceDelta`
--
-- Additive, idempotent, one signature each (no overloads), both revoked from browser roles, service role only.

create or replace function public.menu_update_entry_in_doc(
  p_doc jsonb, p_item_uid text, p_type_uid text, p_name text, p_price text
) returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_cats  jsonb := '[]'::jsonb;
  v_items jsonb;
  v_types jsonb;
  v_c     jsonb;
  v_i     jsonb;
  v_t     jsonb;
  v_price jsonb;
begin
  if p_doc is null then return null; end if;
  if p_price is not null and btrim(p_price) <> '' then
    v_price := case when btrim(p_price) ~ '^[0-9]+(\.[0-9]+)?$' then to_jsonb(btrim(p_price)::numeric) else to_jsonb(btrim(p_price)) end;
  end if;
  for v_c in select value from jsonb_array_elements(coalesce(p_doc->'categories', '[]'::jsonb)) loop
    v_items := '[]'::jsonb;
    for v_i in select value from jsonb_array_elements(coalesce(v_c->'items', '[]'::jsonb)) loop
      if (v_i->>'uid') = p_item_uid then
        if p_type_uid is null then
          if p_name is not null then v_i := jsonb_set(v_i, '{he}', to_jsonb(btrim(p_name))); end if;
          if p_price is not null then
            v_i := case when v_price is null then v_i - 'price' else jsonb_set(v_i, '{price}', v_price) end;
          end if;
        else
          v_types := '[]'::jsonb;
          for v_t in select value from jsonb_array_elements(coalesce(v_i->'types', '[]'::jsonb)) loop
            if (v_t->>'uid') = p_type_uid then
              if p_name is not null then v_t := jsonb_set(v_t, '{he}', to_jsonb(btrim(p_name))); end if;
              if p_price is not null then
                v_t := case when v_price is null then v_t - 'priceDelta' else jsonb_set(v_t, '{priceDelta}', v_price) end;
              end if;
            end if;
            v_types := v_types || jsonb_build_array(v_t);
          end loop;
          v_i := jsonb_set(v_i, '{types}', v_types);
        end if;
      end if;
      v_items := v_items || jsonb_build_array(v_i);
    end loop;
    v_cats := v_cats || jsonb_build_array(jsonb_set(v_c, '{items}', v_items));
  end loop;
  return jsonb_set(p_doc, '{categories}', v_cats);
end;
$$;
revoke all on function public.menu_update_entry_in_doc(jsonb, text, text, text, text) from public, anon, authenticated;
grant execute on function public.menu_update_entry_in_doc(jsonb, text, text, text, text) to service_role;

create or replace function public.menu_update_entry(
  p_menu_id uuid, p_item_uid text, p_type_uid text, p_name text, p_price text, p_publish boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft     jsonb;
  v_published jsonb;
begin
  if p_item_uid is null or char_length(p_item_uid) > 64 then
    raise exception 'invalid item' using errcode = '22023';
  end if;
  if p_name is not null and (char_length(btrim(p_name)) < 1 or char_length(btrim(p_name)) > 80) then
    raise exception 'invalid name' using errcode = '22023';
  end if;
  if p_price is not null and char_length(btrim(p_price)) > 20 then
    raise exception 'invalid price' using errcode = '22023';
  end if;

  select draft, published into v_draft, v_published from public.menus where id = p_menu_id for update;
  if not found then
    raise exception 'menu % not found', p_menu_id using errcode = 'P0002';
  end if;

  update public.menus
     set draft      = public.menu_update_entry_in_doc(v_draft, p_item_uid, p_type_uid, p_name, p_price),
         published  = case when p_publish then public.menu_update_entry_in_doc(v_published, p_item_uid, p_type_uid, p_name, p_price) else published end,
         updated_at = now()
   where id = p_menu_id;
end;
$$;
revoke all on function public.menu_update_entry(uuid, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.menu_update_entry(uuid, text, text, text, text, boolean) to service_role;

-- Check after applying (all true / 0):
--   select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--            where n.nspname = 'public' and p.proname in ('menu_update_entry', 'menu_update_entry_in_doc')) = 2 as functions_2,
--          not has_function_privilege('anon', 'public.menu_update_entry(uuid, text, text, text, text, boolean)', 'execute') as locked,
--          (select count(*) from (select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
--            group by proname having count(*) > 1) d) as overloaded_names_0;
-- Ledger row:
--   insert into supabase_migrations.schema_migrations (version, name) values ('20261106180000', 'menu_update_entry') on conflict do nothing;
