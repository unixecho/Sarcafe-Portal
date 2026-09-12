-- Enables the owner-facing "add a new branch" feature: per-branch quick-link
-- columns (folding in what was previously hardcoded in
-- src/lib/portal-config.ts) and an atomic branch+menu creation function.

-- ---------------------------------------------------------------------
-- Per-branch portal links — real business data, migrated from
-- src/lib/portal-config.ts's PORTAL_BRANCHES, not re-typed. Nullable
-- because a newly-created branch starts without them; the portal UI hides
-- an action tile whose link is null rather than showing a dead link.
-- ---------------------------------------------------------------------
alter table public.branches
  add column nav_google_maps text,
  add column nav_waze text,
  add column nav_apple_maps text,
  add column instagram_url text,
  add column review_url text,
  add column bit_url text;

update public.branches set
  nav_google_maps = 'https://www.google.com/search?q=%D7%A9%D7%A8%D7%A7%D7%A4%D7%94+%D7%9E%D7%90%D7%95%D7%A8',
  nav_waze = 'https://waze.com/ul/hsvbbkw6z7',
  nav_apple_maps = 'https://maps.apple/p/qpTdR-CW92-k85',
  instagram_url = 'https://www.instagram.com/sarcafe_maor/',
  review_url = 'https://www.google.com/search?q=%D7%A9%D7%A8%D7%A7%D7%A4%D7%94+%D7%9E%D7%90%D7%95%D7%A8+Reviews#lrd=0x151d11a50c80e89b:0x96d561f512db6ca9,3,,,,',
  bit_url = 'https://www.bitpay.co.il/app/me/E651C59A-1BFE-BEC5-4393-DC2A3AB120825472'
where slug = 'maor';

update public.branches set
  nav_google_maps = 'https://www.google.com/search?q=%D7%A9%D7%A8%D7%A7%D7%A4%D7%94+%D7%92%D7%91%D7%A2%D7%AA+%D7%97%D7%91%D7%99%D7%91%D7%94+Reviews',
  nav_waze = 'https://www.waze.com/live-map/directions?to=ll.32.458484%2C35.021689',
  nav_apple_maps = 'https://maps.apple/p/eB5XbpUbv.RmXQ',
  instagram_url = 'https://www.instagram.com/sarcafe_givat.haviva/',
  review_url = 'https://www.google.com/search?q=%D7%A9%D7%A8%D7%A7%D7%A4%D7%94+%D7%92%D7%91%D7%A2%D7%AA+%D7%97%D7%91%D7%99%D7%91%D7%94+Reviews#lrd=0x151d0ff513e8629d:0xa96e0271dcb22bc9,3,,,,',
  bit_url = 'https://www.bitpay.co.il/app/me/E651C59A-1BFE-BEC5-4393-DC2A3AB120825472'
where slug = 'givat-haviva';

-- ---------------------------------------------------------------------
-- create_branch_with_menu() — atomically inserts a branch, its menus row,
-- and a default menu_variants row (mirrors the seed step in
-- 001_menus_schema.sql). security definer + revoked from public/anon/
-- authenticated: only callable via the service-role client, from the new
-- owner-only POST /api/owner/branches route (src/lib/owner/guard.ts's
-- requireOwner() gates who ever reaches that route).
-- ---------------------------------------------------------------------
create or replace function public.create_branch_with_menu(p_slug text, p_name jsonb)
returns table(branch_id uuid, menu_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_id uuid;
  v_menu_id uuid;
  v_variant_id uuid;
begin
  insert into public.branches (slug, name) values (p_slug, p_name) returning id into v_branch_id;
  insert into public.menus (branch_id, slug, name) values (v_branch_id, p_slug, p_name) returning id into v_menu_id;
  insert into public.menu_variants (menu_id, name, is_default, sort_order)
    values (v_menu_id, '{"he":"רגיל","en":"Regular","ar":"عادي"}'::jsonb, true, 0)
    returning id into v_variant_id;
  update public.menus set active_variant_id = v_variant_id where id = v_menu_id;

  return query select v_branch_id, v_menu_id;
end;
$$;

revoke execute on function public.create_branch_with_menu(text, jsonb) from public;
-- Deliberately no grant to anon/authenticated — service-role bypasses
-- grants entirely, same posture as every other owner-only write path in
-- this schema (e.g. staff creation has no RPC/grant either, it's a plain
-- service-role insert).
