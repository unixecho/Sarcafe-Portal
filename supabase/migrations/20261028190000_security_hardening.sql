-- Security hardening from the 2026-10-28 audit (docs/SECURITY_AUDIT_2026-10-28.md). Privileges and settings only:
-- no table, column, policy or function body changes, so nothing the app does today stops working.
-- Idempotent: every statement can run twice. NOT applied to production by the audit; the owner applies it.
--
-- 1. log_shift_audit() is SECURITY DEFINER and writes to shift_audit. Nothing in the app calls it (the server writes
--    the audit with the service role), but any signed-in Google account could call it over /rest/v1/rpc and add
--    made-up rows to the schedule's audit trail. Browser roles lose it; the server keeps it.
-- 2. rls_auto_enable() is the event-trigger function that switches RLS on for new tables. Event triggers do not need
--    EXECUTE to fire, so the anon/authenticated grant (flagged by the Supabase advisor) is only an exposed RPC name.
-- 3. publish_menu / set_default_variant / reap_expired_variants are SECURITY INVOKER (RLS still applies), but anon
--    never needs them. publish_menu stays callable by authenticated (the owner's own session calls it); the other two
--    are only called by the server with the service role.
-- 4. Trigger functions are never called directly; no browser role needs EXECUTE on them.
-- 5. The seven sched_* helpers had no fixed search_path (advisor: function_search_path_mutable).

do $$
begin
  if to_regprocedure('public.log_shift_audit(uuid, text, text, jsonb)') is not null then
    revoke all on function public.log_shift_audit(uuid, text, text, jsonb) from public, anon, authenticated;
    grant execute on function public.log_shift_audit(uuid, text, text, jsonb) to service_role;
  end if;

  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
  end if;

  if to_regprocedure('public.publish_menu(uuid)') is not null then
    revoke all on function public.publish_menu(uuid) from public, anon;
    grant execute on function public.publish_menu(uuid) to authenticated, service_role;
  end if;

  if to_regprocedure('public.set_default_variant(uuid)') is not null then
    revoke all on function public.set_default_variant(uuid) from public, anon, authenticated;
    grant execute on function public.set_default_variant(uuid) to service_role;
  end if;

  if to_regprocedure('public.reap_expired_variants()') is not null then
    revoke all on function public.reap_expired_variants() from public, anon, authenticated;
    grant execute on function public.reap_expired_variants() to service_role;
  end if;

  if to_regprocedure('public.branches_parent_guard()') is not null then
    revoke all on function public.branches_parent_guard() from public, anon, authenticated;
  end if;

  if to_regprocedure('public.pos_sync_employee_code()') is not null then
    revoke all on function public.pos_sync_employee_code() from public, anon, authenticated;
  end if;
end $$;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.sched_lock_staff(uuid)',
    'public.sched_lock_staff_many(uuid[])',
    'public.sched_range(date, text, text)',
    'public.sched_range_text(text, text)',
    'public.sched_fmt(date, text, text)',
    'public.sched_fail(text, jsonb)',
    'public.sched_needed(jsonb)'
  ] loop
    if to_regprocedure(v_fn) is not null then
      execute format('alter function %s set search_path = public, pg_temp', to_regprocedure(v_fn));
    end if;
  end loop;
end $$;
