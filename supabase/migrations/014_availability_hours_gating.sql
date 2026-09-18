-- ============================================================
-- Gates the live-availability tablet feature (TabletAvailability.tsx) to a
-- branch's operating hours (shift_settings — see 010_shift_scheduling.sql),
-- NOT its shift instances: staff clock in before opening and out after
-- closing, so "on shift" and "open to customers" are different windows.
--
-- Only the owner may use the tablet page outside operating hours (to test
-- it), and even then a write made outside operating hours must not reach
-- customers. Rather than teach the public menu to second-guess `available`/
-- `quantity` at read time (those fields are also written by the ordinary
-- draft/publish editor, so the read side can't tell "tablet, outside hours"
-- apart from "editor, any time"), set_availability() itself gains a
-- p_publish flag: true (the existing behavior) writes draft AND published
-- atomically, as before; false writes draft only, so an out-of-hours owner
-- edit is visible back on the tablet (which reads draft) but never on the
-- published, customer-facing menu. The app layer (POST
-- /api/owner/menu-availability) decides which one to pass by checking
-- lib/shifts/hours.ts's isWithinOperatingHours().
--
-- Dropped and recreated (not CREATE OR REPLACE) for the same reason
-- 012_menu_item_quantity.sql's header gives: adding a parameter changes the
-- arg-count signature, so CREATE OR REPLACE would add a second overload
-- instead of replacing the first, leaving a call with the original argument
-- names ambiguous between the two.
-- ============================================================

drop function if exists public.set_availability(uuid, text, text, boolean, integer);

create or replace function public.set_availability(
  p_menu_id uuid, p_item_uid text, p_type_uid text, p_available boolean default null,
  p_quantity integer default null, p_publish boolean default true
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
    set draft      = public.set_item_availability_in_doc(v_draft, p_item_uid, p_type_uid, p_available, p_quantity),
        published  = public.set_item_availability_in_doc(v_published, p_item_uid, p_type_uid, p_available, p_quantity),
        updated_at = now()
    where id = p_menu_id;
  else
    update public.menus
    set draft      = public.set_item_availability_in_doc(v_draft, p_item_uid, p_type_uid, p_available, p_quantity),
        updated_at = now()
    where id = p_menu_id;
  end if;
end;
$$;

revoke execute on function public.set_availability(uuid, text, text, boolean, integer, boolean) from public;
grant execute on function public.set_availability(uuid, text, text, boolean, integer, boolean) to service_role;
