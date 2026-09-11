-- Explicit GRANTs. RLS policies (in 000/001/002/003) control WHICH rows a
-- role can see/touch; they say nothing about whether the role can access
-- the table's columns at all — that's a separate, more basic permission
-- layer, and none of the earlier migrations ever granted it. This is the
-- direct cause of "permission denied for table staff" (and would hit
-- every other table via the service-role client the same way, just not
-- yet observed for the others).

grant usage on schema public to anon, authenticated, service_role;

-- service_role: every API route already gates access with
-- requireOwner()/requireMenuEditor()/requireStaff() before running a
-- query — this grant is what lets that query actually execute at all,
-- same as it needing to bypass RLS.
grant all on public.branches, public.staff, public.menus, public.menu_versions,
  public.menu_variants, public.menu_audit, public.app_settings, public.rate_limits
  to service_role;

-- authenticated: only the two direct-from-browser paths that exist today
-- (MenuEditor.tsx saves a draft and calls publish_menu() using the
-- signed-in user's own session, not a service-role API route) — both
-- still gated by the is_menu_editor() RLS policy on `menus`, this just
-- lets the role reach the table to have that policy evaluated at all.
grant select, update on public.menus to authenticated;

-- anon + authenticated: public-safe reads.
grant select on public.branches to anon, authenticated;
