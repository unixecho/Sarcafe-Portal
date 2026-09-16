-- ============================================================
-- Live item/type availability — the tablet editor's write path.
--
-- Every existing "available" toggle (CategoryAccordion's per-item switch)
-- is draft-only until the next Publish — deliberately, since it travels
-- with whatever else is mid-edit in the draft. The tablet page is
-- different: a barista marking oat-milk shakes out of stock needs that
-- live on the customer-facing menu NOW, not at the next unrelated publish.
--
-- set_availability() flips ONE item's (or one of its types') `available`
-- flag in BOTH draft and published jsonb, atomically, via a row lock —
-- never a wholesale draft overwrite, so it can never clobber someone
-- else's in-progress unpublished edit. If the target uid only exists in
-- one of the two documents (e.g. a brand new draft-only item), the other
-- document is returned unchanged — same "no-op is safe" posture as
-- reap_expired_variants().
-- ============================================================

-- Returns a copy of one menu document (the shape menus.draft/published
-- both carry) with the named item's (or item+type's) `available` flag set.
-- No-ops (returns the input unchanged) if the uid isn't found — callers
-- run this against draft and published separately, and a brand-new
-- draft-only item simply isn't in `published` yet.
create or replace function public.set_item_availability_in_doc(
  p_doc jsonb, p_item_uid text, p_type_uid text, p_available boolean
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
                      then jsonb_set(item, '{available}', to_jsonb(p_available))
                    when (item->>'uid') = p_item_uid and p_type_uid is not null
                      then jsonb_set(
                        item,
                        '{types}',
                        coalesce(
                          (
                            select jsonb_agg(
                              case when (tp->>'uid') = p_type_uid
                                then jsonb_set(tp, '{available}', to_jsonb(p_available))
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
  p_menu_id uuid, p_item_uid text, p_type_uid text, p_available boolean
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
  set draft      = public.set_item_availability_in_doc(v_draft, p_item_uid, p_type_uid, p_available),
      published  = public.set_item_availability_in_doc(v_published, p_item_uid, p_type_uid, p_available),
      updated_at = now()
  where id = p_menu_id;
end;
$$;

-- Service-role only — called from POST /api/owner/menu-availability after
-- requireMenuEditor(), never directly from the browser. Same revoke-then-
-- grant idiom as check_rate_limit() (003_rate_limiting.sql): Postgres
-- grants EXECUTE to PUBLIC by default, so revoking anon/authenticated
-- alone would be cosmetic.
revoke execute on function public.set_item_availability_in_doc(jsonb, text, text, boolean) from public;
grant execute on function public.set_item_availability_in_doc(jsonb, text, text, boolean) to service_role;

revoke execute on function public.set_availability(uuid, text, text, boolean) from public;
grant execute on function public.set_availability(uuid, text, text, boolean) to service_role;
