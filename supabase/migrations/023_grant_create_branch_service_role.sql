-- =====================================================================
-- 023_grant_create_branch_service_role.sql — let the server create a branch
--
-- Why
--   005 created create_branch_with_menu() and revoked EXECUTE from PUBLIC with the
--   note "service-role bypasses grants entirely". That holds for row-level security,
--   not for GRANTs: service_role still needs EXECUTE on a function, the same lesson
--   004_grants.sql / DEPLOYMENT.md §2.1 record for tables. On a project whose default
--   privileges no longer hand new functions to service_role, the revoke left the
--   function callable by NOBODY, so POST /api/owner/branches failed with
--   "permission denied for function create_branch_with_menu" (which the route reports
--   as a 400 "check the details"). That broke the owner's "add a branch" and, because
--   the POS builds an event on the very same function, "create event".
--
-- What it does
--   Grants EXECUTE on that one function to service_role and keeps it closed to PUBLIC,
--   anon and authenticated: the posture 005 intended, now actually reachable.
--   Safe to re-run; ends with a self-check that raises if anything is off.
-- =====================================================================

revoke all on function public.create_branch_with_menu(text, jsonb) from public;
revoke all on function public.create_branch_with_menu(text, jsonb) from anon;
revoke all on function public.create_branch_with_menu(text, jsonb) from authenticated;
grant execute on function public.create_branch_with_menu(text, jsonb) to service_role;

-- Verify
do $$
begin
  if not has_function_privilege('service_role', 'public.create_branch_with_menu(text, jsonb)', 'execute') then
    raise exception 'verify: service_role cannot execute create_branch_with_menu';
  end if;
  if has_function_privilege('public', 'public.create_branch_with_menu(text, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.create_branch_with_menu(text, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.create_branch_with_menu(text, jsonb)', 'execute') then
    raise exception 'verify: a browser role can execute create_branch_with_menu';
  end if;
end;
$$;
