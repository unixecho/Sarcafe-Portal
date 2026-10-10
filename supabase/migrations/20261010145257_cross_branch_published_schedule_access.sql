-- Employees may browse the frozen schedule of every permanent branch and ask
-- to join a published open shift there. Operational scope stays unchanged:
-- sched_can_view still controls drafts, availability, swaps, management and
-- automatic fill eligibility.

create or replace function public.sched_can_browse_published(p_staff uuid, p_branch uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.sched_can_view(p_staff, p_branch)
      or exists (
        select 1
          from public.staff s
          join public.branches b on b.id = p_branch
         where s.id = p_staff
           and s.active
           and s.auth_user_id is not null
           and b.active
           and b.kind = 'permanent'
      );
$$;

-- Keep the existing request contract, but choose authorization and the visible
-- shift fields from the same source the employee saw: live rows for an in-scope
-- draft, or the frozen published snapshot for any permanent branch.
create or replace function public.internal_sched_request_shift_unchecked(p_actor uuid, p_shift uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift public.shifts%rowtype;
  v_week public.schedule_weeks%rowtype;
  v_published jsonb;
  v_date date;
  v_start text;
  v_end text;
  v_requirements jsonb;
  v_requests_open boolean;
  v_conf jsonb;
  v_needed integer;
  v_assigned integer;
  v_id uuid;
  v_label text;
begin
  select * into v_shift from public.shifts where id = p_shift;
  if not found then
    return public.sched_fail('not_found');
  end if;

  select * into v_week from public.schedule_weeks where id = v_shift.week_id for update;
  select * into v_shift from public.shifts where id = p_shift for update;
  if not found then
    return public.sched_fail('not_found');
  end if;

  if p_note is not null and char_length(p_note) > 300 then
    return public.sched_fail('bad_request');
  end if;

  if v_week.status = 'draft' then
    if not public.sched_can_view(p_actor, v_shift.branch_id) then
      return public.sched_fail('forbidden');
    end if;
    if not public.sched_requests_open(v_week.week_start) then
      return public.sched_fail('requests_closed');
    end if;
    v_date := v_shift.shift_date;
    v_start := v_shift.start_time;
    v_end := v_shift.end_time;
    v_requirements := v_shift.requirements;
    v_requests_open := v_shift.requests_open;
  elsif v_week.status = 'published' then
    if not public.sched_can_browse_published(p_actor, v_shift.branch_id) then
      return public.sched_fail('forbidden');
    end if;
    select e.v into v_published
      from jsonb_array_elements(coalesce(v_week.published_snapshot -> 'shifts', '[]'::jsonb)) e(v)
     where e.v ->> 'id' = p_shift::text;
    if v_published is null then
      return public.sched_fail('not_published');
    end if;
    v_date := coalesce(v_published ->> 'shift_date', v_published ->> 'date')::date;
    v_start := coalesce(v_published ->> 'start_time', v_published ->> 'startTime');
    v_end := coalesce(v_published ->> 'end_time', v_published ->> 'endTime');
    v_requirements := coalesce(v_published -> 'requirements', '[]'::jsonb);
    v_requests_open := coalesce((coalesce(v_published ->> 'requests_open', v_published ->> 'requestsOpen'))::boolean, false);
  else
    return public.sched_fail('not_published');
  end if;

  if not coalesce(v_requests_open, false) then
    return public.sched_fail('requests_not_open');
  end if;
  if public.sched_is_past(v_shift.branch_id, v_date, v_start) then
    return public.sched_fail('past');
  end if;
  if exists (
    select 1 from public.schedule_members m
     where m.branch_id = v_shift.branch_id and m.staff_id = p_actor and not m.schedulable
  ) then
    return public.sched_fail('not_schedulable');
  end if;

  if v_week.status = 'published' then
    if exists (
      select 1
        from jsonb_array_elements(coalesce(v_week.published_snapshot -> 'assignments', '[]'::jsonb)) a(v)
       where coalesce(a.v ->> 'shift_id', a.v ->> 'shiftId') = p_shift::text
         and coalesce(a.v ->> 'staff_id', a.v ->> 'staffId') = p_actor::text
    ) then
      return public.sched_fail('already_assigned');
    end if;
  elsif exists (select 1 from public.shift_assignments a where a.shift_id = p_shift and a.staff_id = p_actor) then
    return public.sched_fail('already_assigned');
  end if;

  if exists (
    select 1 from public.shift_requests r
     where r.shift_id = p_shift and r.staff_id = p_actor and r.status = 'pending'
  ) then
    return public.sched_fail('duplicate_request');
  end if;

  v_needed := public.sched_needed(v_requirements);
  if v_week.status = 'published' then
    select count(*) into v_assigned
      from jsonb_array_elements(coalesce(v_week.published_snapshot -> 'assignments', '[]'::jsonb)) a(v)
     where coalesce(a.v ->> 'shift_id', a.v ->> 'shiftId') = p_shift::text;
  else
    select count(*) into v_assigned from public.shift_assignments where shift_id = p_shift;
  end if;
  if v_week.status = 'published' and v_needed > 0 and v_assigned >= v_needed then
    return public.sched_fail('shift_full', jsonb_build_object('needed', v_needed, 'assigned', v_assigned));
  end if;

  perform public.sched_lock_staff(p_actor);
  v_conf := public.sched_conflicts(p_actor, public.sched_range(v_date, v_start, v_end), '{}', p_shift);
  if jsonb_array_length(v_conf) > 0 then
    return public.sched_fail('busy', jsonb_build_object('with', v_conf -> 0));
  end if;
  if exists (
    select 1
      from public.shift_requests r
     where r.staff_id = p_actor
       and r.status = 'pending'
       and r.shift_id <> p_shift
       and public.sched_range((r.terms ->> 'date')::date, r.terms ->> 'start', r.terms ->> 'end')
           && public.sched_range(v_date, v_start, v_end)
  ) then
    return public.sched_fail('overlapping_request');
  end if;
  if exists (
    select 1
      from public.shift_availability av, jsonb_array_elements(av.entries) e(v)
     where av.branch_id = v_shift.branch_id
       and av.staff_id = p_actor
       and av.week_start = v_week.week_start
       and av.status = 'submitted'
       and e.v ->> 'date' = v_date::text
       and e.v ->> 'kind' = 'unavailable'
  ) then
    return public.sched_fail('unavailable_day', jsonb_build_object('date', v_date));
  end if;

  v_label := public.sched_fmt(v_date, v_start, v_end);
  insert into public.shift_requests (branch_id, shift_id, staff_id, staff_name, note, terms)
  values (
    v_shift.branch_id,
    p_shift,
    p_actor,
    public.sched_name(p_actor),
    nullif(btrim(coalesce(p_note, '')), ''),
    jsonb_build_object(
      'shiftId', p_shift,
      'weekId', v_shift.week_id,
      'date', v_date,
      'start', v_start,
      'end', v_end,
      'label', v_label
    )
  ) returning id into v_id;

  perform public.sched_notify(
    v_shift.branch_id,
    array_remove(public.sched_manager_ids(v_shift.branch_id), p_actor),
    'request.new',
    public.sched_name(p_actor) || ' מבקש/ת להצטרף למשמרת',
    v_label,
    jsonb_build_object('tab', 'requests', 'shiftId', p_shift, 'weekStart', v_week.week_start)
  );
  perform public.sched_log(
    v_shift.branch_id,
    p_actor,
    'request.create',
    'ביקש/ה להצטרף למשמרת: ' || v_label,
    jsonb_build_object('requestId', v_id, 'shiftId', p_shift)
  );
  return jsonb_build_object('ok', true, 'requestId', v_id);
exception when unique_violation then
  return public.sched_fail('duplicate_request');
end;
$$;

create or replace function public.sched_request_shift(p_actor uuid, p_shift uuid, p_note text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.internal_sched_request_shift_unchecked(p_actor, p_shift, p_note);
$$;

revoke all on function public.sched_can_browse_published(uuid, uuid) from public, anon, authenticated;
revoke all on function public.internal_sched_request_shift_unchecked(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.sched_request_shift(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.sched_can_browse_published(uuid, uuid) to service_role;
grant execute on function public.sched_request_shift(uuid, uuid, text) to service_role;

do $$
begin
  if has_function_privilege('public', 'public.sched_can_browse_published(uuid,uuid)', 'execute')
     or has_function_privilege('anon', 'public.sched_can_browse_published(uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.sched_can_browse_published(uuid,uuid)', 'execute') then
    raise exception 'verify: published schedule helper is browser-executable';
  end if;
end;
$$;
