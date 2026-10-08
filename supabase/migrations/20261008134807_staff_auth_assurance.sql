-- Old PIN logins minted Auth JWTs. Their permanent markers must also restrict
-- direct browser Data API access, independently of the application's guards.
create index if not exists pos_point_staff_staff_lookup_idx on public.pos_point_staff(staff_id, point_id);
create function public.staff_has_full_browser_session()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and nullif(auth.jwt()->>'session_id', '') is not null
    and not exists (select 1 from public.pos_quick_sessions q
      where q.session_id::text = auth.jwt()->>'session_id');
$$;
revoke all on function public.staff_has_full_browser_session() from public, anon;
grant execute on function public.staff_has_full_browser_session() to authenticated, service_role;

create or replace function public.is_op()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.staff_has_full_browser_session() and exists (
    select 1 from public.staff where auth_user_id = auth.uid() and active
      and (role = 'owner' or badge = 'owner'));
$$;

create or replace function public.is_menu_editor(p_branch_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.staff_has_full_browser_session() and exists (
    select 1 from public.staff where auth_user_id = auth.uid() and active
      and (role = 'owner' or badge = 'owner'
        or (badge = 'general_manager' and (branch_id is null or branch_id = p_branch_id))));
$$;

-- published_schedule is a definer view, so protect its predicate as well as
-- the underlying tables. Preserve the existing owner/branch scoping.
create or replace function public.can_view_schedule(p_branch_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.staff_has_full_browser_session() and exists (
    select 1 from public.staff s where s.auth_user_id = auth.uid() and s.active
      and (s.role = 'owner' or s.badge = 'owner' or s.branch_id is null or s.branch_id = p_branch_id));
$$;

do $$
declare target text;
begin
  foreach target in array array['shift_settings','schedule_members','schedule_weeks',
    'shifts','shift_assignments','shift_availability','shift_swaps','shift_audit',
    'shift_requests','schedule_notifications','orders','order_items']
  loop
    execute format('create policy full_browser_session on public.%I as restrictive for all to authenticated using (public.staff_has_full_browser_session()) with check (public.staff_has_full_browser_session())', target);
  end loop;
end;
$$;
