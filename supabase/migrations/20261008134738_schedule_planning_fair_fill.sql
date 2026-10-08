-- Weekly planning: requests close after Tuesday in Jerusalem; manual choices
-- remain authoritative. Only the server service role may invoke these RPCs.

create or replace function public.sched_request_deadline(p_week date)
returns date language sql immutable set search_path = public as $$
  select p_week - extract(dow from p_week)::integer - 5;
$$;

create or replace function public.sched_requests_open(p_week date, p_at timestamptz default now())
returns boolean language sql stable set search_path = public as $$
  select (p_at at time zone 'Asia/Jerusalem')::date <= public.sched_request_deadline(p_week);
$$;

create or replace function public.sched_submit_availability(
  p_actor uuid, p_branch uuid, p_week_start date, p_entries jsonb, p_note text, p_status text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_entry jsonb; v_old public.shift_availability%rowtype;
begin
  if not public.sched_can_view(p_actor, p_branch) then return public.sched_fail('forbidden'); end if;
  if extract(dow from p_week_start) <> 0 then return public.sched_fail('bad_date'); end if;
  if not public.sched_requests_open(p_week_start) then return public.sched_fail('requests_closed'); end if;
  if p_status not in ('draft', 'submitted') or jsonb_typeof(p_entries) <> 'array'
    or jsonb_array_length(p_entries) > 7 or char_length(coalesce(p_note, '')) > 300 then
    return public.sched_fail('bad_request');
  end if;
  if exists (select 1 from public.shift_settings where branch_id = p_branch and not coalesce((features->>'availability')::boolean, true)) then
    return public.sched_fail('bad_request');
  end if;
  if (select count(distinct e->>'date') from jsonb_array_elements(p_entries) e) <> jsonb_array_length(p_entries) then
    return public.sched_fail('bad_request');
  end if;
  for v_entry in select * from jsonb_array_elements(p_entries) loop
    if not coalesce(v_entry->>'date' ~ '^\d{4}-\d{2}-\d{2}$', false)
      or (v_entry->>'date')::date not between p_week_start and p_week_start + 6 then
      return public.sched_fail('bad_date');
    end if;
    if not coalesce(v_entry->>'kind' in ('unavailable', 'prefer', 'partial'), false) then
      return public.sched_fail('bad_request');
    end if;
    if v_entry->>'kind' = 'partial' and (
      not coalesce(v_entry->>'from' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$', false)
      or not coalesce(v_entry->>'to' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$', false)
      or v_entry->>'from' = v_entry->>'to'
    ) then return public.sched_fail('bad_time'); end if;
  end loop;
  -- The same week lock as request decisions and automatic filling. Submission
  -- and manager notification commit together, never as separate network writes.
  insert into public.schedule_weeks (branch_id, week_start) values (p_branch, p_week_start)
    on conflict (branch_id, week_start) do nothing;
  perform 1 from public.schedule_weeks where branch_id = p_branch and week_start = p_week_start for update;
  select * into v_old from public.shift_availability where branch_id = p_branch and staff_id = p_actor and week_start = p_week_start;
  insert into public.shift_availability (branch_id, staff_id, week_start, entries, note, status, updated_at)
    values (p_branch, p_actor, p_week_start, p_entries, nullif(btrim(coalesce(p_note, '')), ''), p_status, now())
    on conflict (branch_id, staff_id, week_start) do update
      set entries = excluded.entries, note = excluded.note, status = excluded.status, updated_at = now();
  if p_status = 'submitted' and (v_old.id is null or v_old.entries is distinct from p_entries
    or v_old.note is distinct from nullif(btrim(coalesce(p_note, '')), '') or v_old.status <> 'submitted') then
    perform public.sched_notify(p_branch, array_remove(public.sched_manager_ids(p_branch), p_actor),
      'availability.submitted', public.sched_name(p_actor) || ' הגיש/ה בקשות וזמינות',
      'לשבוע שמתחיל ב-' || to_char(p_week_start, 'FMDD/FMMM'), jsonb_build_object('tab', 'requests', 'weekStart', p_week_start));
  end if;
  return jsonb_build_object('ok', true);
exception when invalid_datetime_format or datetime_field_overflow then return public.sched_fail('bad_date');
end;
$$;

-- Automatic fill is conservative; a manager can deliberately override all soft
-- constraints in the existing shift editor. No availability submission means
-- available. Draft availability is never treated as submitted preference.
create or replace function public.sched_fill_eligible(
  p_staff uuid, p_shift uuid, p_week_start date, p_safety jsonb, p_cap integer
)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare s public.shifts%rowtype; v_range tsrange; v_hours numeric; v_daily numeric; v_entry jsonb; v_streak integer;
begin
  select * into s from public.shifts where id = p_shift;
  v_range := public.sched_range(s.shift_date, s.start_time, s.end_time);
  v_hours := extract(epoch from upper(v_range) - lower(v_range)) / 3600;
  if exists (select 1 from public.shift_assignments where shift_id = p_shift and staff_id = p_staff) then return false; end if;
  if jsonb_array_length(public.sched_conflicts(p_staff, v_range)) > 0 then return false; end if;
  select e into v_entry from public.shift_availability av, jsonb_array_elements(av.entries) e
    where av.branch_id = s.branch_id and av.staff_id = p_staff and av.week_start = p_week_start
      and av.status = 'submitted' and e->>'date' = s.shift_date::text limit 1;
  if v_entry->>'kind' = 'unavailable' then return false; end if;
  if v_entry->>'kind' = 'partial' and not (
    v_range <@ public.sched_range(s.shift_date, v_entry->>'from', v_entry->>'to')
  ) then return false; end if;
  if v_hours + coalesce((select sum(extract(epoch from upper(public.sched_range(x.shift_date, x.start_time, x.end_time))
      - lower(public.sched_range(x.shift_date, x.start_time, x.end_time))) / 3600)
    from public.shift_assignments a join public.shifts x on x.id = a.shift_id
    where a.staff_id = p_staff and x.shift_date between p_week_start and p_week_start + 6), 0)
    > coalesce(p_cap::numeric, (p_safety->>'maxWeeklyHours')::numeric, 42) then return false; end if;
  select coalesce(sum(extract(epoch from upper(public.sched_range(x.shift_date, x.start_time, x.end_time))
    - lower(public.sched_range(x.shift_date, x.start_time, x.end_time))) / 3600), 0) into v_daily
    from public.shift_assignments a join public.shifts x on x.id = a.shift_id where a.staff_id = p_staff and x.shift_date = s.shift_date;
  if v_daily + v_hours > coalesce((p_safety->>'maxDailyHours')::numeric, 10) then return false; end if;
  if exists (
    select 1 from public.shift_assignments a join public.shifts x on x.id = a.shift_id
    cross join lateral (select public.sched_range(x.shift_date, x.start_time, x.end_time) r) t
    where a.staff_id = p_staff and x.shift_date between s.shift_date - 2 and s.shift_date + 2 and (
      (upper(t.r) <= lower(v_range) and lower(v_range) - upper(t.r) < make_interval(mins => round(coalesce((p_safety->>'minRestHours')::numeric, 10) * 60)::integer))
      or (lower(t.r) >= upper(v_range) and lower(t.r) - upper(v_range) < make_interval(mins => round(coalesce((p_safety->>'minRestHours')::numeric, 10) * 60)::integer))
    )
  ) then return false; end if;
  select coalesce(max(n), 0) into v_streak from (
    select count(*) n from (
      select d, d - row_number() over (order by d)::integer island from (
        select s.shift_date d union select x.shift_date from public.shift_assignments a join public.shifts x on x.id = a.shift_id
          where a.staff_id = p_staff and x.shift_date between s.shift_date - 14 and s.shift_date + 14
      ) dates
    ) islands group by island
  ) streaks;
  return v_streak <= coalesce((p_safety->>'maxConsecutiveDays')::integer, 6);
end;
$$;

create or replace function public.sched_fill_week(p_actor uuid, p_week uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w public.schedule_weeks%rowtype; cfg public.shift_settings%rowtype; s record; slot record;
  v_staff uuid; v_added integer := 0; v_missing jsonb := '[]'::jsonb; v_range tsrange;
begin
  select * into w from public.schedule_weeks where id = p_week for update;
  if not found then return public.sched_fail('not_found'); end if;
  if not public.sched_can_manage(p_actor, w.branch_id) then return public.sched_fail('forbidden'); end if;
  if public.sched_requests_open(w.week_start) then return public.sched_fail('planning_open'); end if;
  if exists (select 1 from public.shift_requests r join public.shifts x on x.id = r.shift_id where x.week_id = p_week and r.status = 'pending') then
    return public.sched_fail('requests_pending');
  end if;
  select * into cfg from public.shift_settings where branch_id = w.branch_id;
  -- Fixed lock order protects against overlapping allocations in another branch.
  perform public.sched_lock_staff_many(array(select st.id from public.staff st
    where st.active and public.sched_can_view(st.id, w.branch_id)));
  -- Allocate Saturday first so ordinary shifts cannot exhaust somebody's hour cap
  -- before their turn for a premium opportunity. Explicit assignments never move.
  for s in select * from public.shifts where week_id = p_week
    order by (extract(dow from shift_date) = 6) desc, shift_date, start_time, id for update loop
    if public.sched_is_past(s.branch_id, s.shift_date, s.start_time) then continue; end if;
    v_range := public.sched_range(s.shift_date, s.start_time, s.end_time);
    for slot in
      select r->>'roleId' role_id, (r->>'min')::integer needed
        from jsonb_array_elements(s.requirements) r where coalesce((r->>'min')::integer, 0) > 0
      union all select null::text, 1 where jsonb_array_length(s.requirements) = 0
    loop
      while (select count(*) from public.shift_assignments a where a.shift_id = s.id
        and (slot.role_id is null or a.role_id = slot.role_id)) < slot.needed loop
        select st.id into v_staff from public.staff st
          left join public.schedule_members m on m.branch_id = w.branch_id and m.staff_id = st.id
          where st.active and public.sched_can_view(st.id, w.branch_id) and coalesce(m.schedulable, true)
            and (slot.role_id is null or m.default_role_id is null or m.default_role_id = slot.role_id)
            and public.sched_fill_eligible(st.id, s.id, w.week_start, cfg.safety, m.max_weekly_hours)
          order by
            -- Saturday wage label is a product rule (150%), never payroll math.
            case when extract(dow from s.shift_date) = 6 then coalesce((
              select sum(extract(epoch from upper(public.sched_range(x.shift_date, x.start_time, x.end_time))
                - lower(public.sched_range(x.shift_date, x.start_time, x.end_time))))
              from public.shift_assignments a join public.shifts x on x.id = a.shift_id join public.schedule_weeks h on h.id = x.week_id
              where a.staff_id = st.id and x.branch_id = w.branch_id and extract(dow from x.shift_date) = 6
                and x.shift_date between w.week_start - 84 and w.week_start + 6
                and (h.status = 'published' or h.id = p_week)
            ), 0) else 0 end,
            coalesce((select sum(extract(epoch from upper(public.sched_range(x.shift_date, x.start_time, x.end_time))
              - lower(public.sched_range(x.shift_date, x.start_time, x.end_time)))) from public.shift_assignments a join public.shifts x on x.id = a.shift_id
              where a.staff_id = st.id and x.shift_date between w.week_start and w.week_start + 6), 0),
            case when exists (select 1 from public.shift_availability av, jsonb_array_elements(av.entries) e
              where av.staff_id = st.id and av.branch_id = w.branch_id and av.week_start = w.week_start and av.status = 'submitted'
                and e->>'date' = s.shift_date::text and e->>'kind' = 'prefer') then 0 else 1 end,
            md5(st.id::text || w.week_start::text), st.id
          limit 1;
        if v_staff is null then
          v_missing := v_missing || jsonb_build_array(jsonb_build_object('shiftId', s.id, 'roleId', slot.role_id,
            'label', public.sched_fmt(s.shift_date, s.start_time, s.end_time), 'reason', 'no_eligible_staff'));
          exit;
        end if;
        insert into public.shift_assignments (branch_id, shift_id, staff_id, staff_name, role_id)
          values (w.branch_id, s.id, v_staff, public.sched_name(v_staff), slot.role_id);
        update public.shifts set updated_at = now() where id = s.id;
        v_added := v_added + 1;
      end loop;
    end loop;
  end loop;
  set constraints all immediate;
  set constraints all deferred;
  perform public.sched_log(w.branch_id, p_actor, 'schedule.fill', 'השלים/ה אוטומטית ' || v_added || ' שיבוצים',
    jsonb_build_object('weekId', p_week, 'added', v_added, 'remaining', v_missing, 'saturdayHistoryWeeks', 12));
  return jsonb_build_object('ok', true, 'added', v_added, 'remaining', v_missing);
end;
$$;

revoke all on function public.sched_request_deadline(date) from public, anon, authenticated;
revoke all on function public.sched_requests_open(date, timestamptz) from public, anon, authenticated;
revoke all on function public.sched_submit_availability(uuid, uuid, date, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.sched_fill_eligible(uuid, uuid, date, jsonb, integer) from public, anon, authenticated;
revoke all on function public.sched_fill_week(uuid, uuid) from public, anon, authenticated;
grant execute on function public.sched_request_deadline(date), public.sched_requests_open(date, timestamptz),
  public.sched_submit_availability(uuid, uuid, date, jsonb, text, text), public.sched_fill_eligible(uuid, uuid, date, jsonb, integer),
  public.sched_fill_week(uuid, uuid) to service_role;

-- The owner can offer an empty week before collecting employee preferences.
-- Existing manually created shifts and every assignment stay intact.
create or replace function public.sched_prepare_week(p_actor uuid, p_week uuid, p_presets jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w public.schedule_weeks%rowtype; cfg public.shift_settings%rowtype; v_day integer; v_date date;
  v_preset jsonb; v_added integer := 0; v_role text;
begin
  select * into w from public.schedule_weeks where id = p_week for update;
  if not found then return public.sched_fail('not_found'); end if;
  if not public.sched_can_manage(p_actor, w.branch_id) then return public.sched_fail('forbidden'); end if;
  if jsonb_typeof(p_presets) <> 'array' or jsonb_array_length(p_presets) > 20 then return public.sched_fail('bad_request'); end if;
  for v_preset in select * from jsonb_array_elements(p_presets) loop
    if not coalesce(v_preset->>'startTime' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$', false)
      or not coalesce(v_preset->>'endTime' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$', false)
      or v_preset->>'startTime' = v_preset->>'endTime' then return public.sched_fail('bad_time'); end if;
  end loop;
  select * into cfg from public.shift_settings where branch_id = w.branch_id;
  for v_day in 0..6 loop
    if not (v_day = any(coalesce(cfg.working_days, '{0,1,2,3,4,5,6}'::smallint[]))) then continue; end if;
    v_date := w.week_start + v_day;
    for v_preset in select * from jsonb_array_elements(p_presets) loop
      if public.sched_is_past(w.branch_id, v_date, v_preset->>'startTime') then continue; end if;
      if exists (select 1 from public.shifts x where x.week_id = p_week and x.shift_date = v_date and (
        (x.start_time = v_preset->>'startTime' and x.end_time = v_preset->>'endTime')
        or (v_preset->>'id' is not null and x.preset_id = v_preset->>'id')
      )) then continue; end if;
      v_role := nullif(v_preset->>'roleId', '');
      insert into public.shifts (branch_id, week_id, shift_date, start_time, end_time, preset_id, station_id, requirements)
        values (w.branch_id, p_week, v_date, v_preset->>'startTime', v_preset->>'endTime',
          nullif(v_preset->>'id', ''), nullif(v_preset->>'stationId', ''),
          case when v_role is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('roleId', v_role, 'min', 1)) end);
      v_added := v_added + 1;
    end loop;
  end loop;
  perform public.sched_log(w.branch_id, p_actor, 'schedule.prepare', 'הכין/ה ' || v_added || ' משמרות לבקשות העובדים',
    jsonb_build_object('weekId', p_week, 'added', v_added));
  return jsonb_build_object('ok', true, 'added', v_added);
end;
$$;
revoke all on function public.sched_prepare_week(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sched_prepare_week(uuid, uuid, jsonb) to service_role;

-- Preserve all existing request integrity checks while opening draft-week preferences.
create or replace function public.sched_request_shift(p_actor uuid, p_shift uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift public.shifts%rowtype;
  v_week public.schedule_weeks%rowtype;
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

  if not public.sched_can_view(p_actor, v_shift.branch_id) then
    return public.sched_fail('forbidden');
  end if;
  if p_note is not null and char_length(p_note) > 300 then
    return public.sched_fail('bad_request');
  end if;
  -- Draft shift choices are intentionally offered without any assignments or notes.
  if v_week.status = 'draft' then
    if not public.sched_requests_open(v_week.week_start) then
      return public.sched_fail('requests_closed');
    end if;
  elsif not public.sched_in_snapshot(v_shift.week_id, 'shifts', v_shift.id) then
    return public.sched_fail('not_published');
  end if;
  if public.sched_is_past(v_shift.branch_id, v_shift.shift_date, v_shift.start_time) then
    return public.sched_fail('past');
  end if;
  if exists (select 1 from public.schedule_members m where m.branch_id = v_shift.branch_id and m.staff_id = p_actor and not m.schedulable) then
    return public.sched_fail('not_schedulable');
  end if;
  if exists (select 1 from public.shift_assignments a where a.shift_id = v_shift.id and a.staff_id = p_actor) then
    return public.sched_fail('already_assigned');
  end if;
  if exists (select 1 from public.shift_requests r where r.shift_id = v_shift.id and r.staff_id = p_actor and r.status = 'pending') then
    return public.sched_fail('duplicate_request');
  end if;

  v_needed := public.sched_needed(v_shift.requirements);
  select count(*) into v_assigned from public.shift_assignments where shift_id = v_shift.id;
  if v_week.status = 'published' and v_needed > 0 and v_assigned >= v_needed then
    return public.sched_fail('shift_full', jsonb_build_object('needed', v_needed, 'assigned', v_assigned));
  end if;

  perform public.sched_lock_staff(p_actor);
  v_conf := public.sched_conflicts(p_actor, public.sched_range(v_shift.shift_date, v_shift.start_time, v_shift.end_time), '{}', v_shift.id);
  if jsonb_array_length(v_conf) > 0 then
    return public.sched_fail('busy', jsonb_build_object('with', v_conf -> 0));
  end if;
  -- contradictory: another PENDING request of theirs at the same time
  if exists (
    select 1 from public.shift_requests r join public.shifts s on s.id = r.shift_id
     where r.staff_id = p_actor and r.status = 'pending' and s.id <> v_shift.id
       and public.sched_range(s.shift_date, s.start_time, s.end_time) && public.sched_range(v_shift.shift_date, v_shift.start_time, v_shift.end_time)
  ) then
    return public.sched_fail('overlapping_request');
  end if;
  -- they said they cannot work that day
  if exists (
    select 1 from public.shift_availability av, jsonb_array_elements(av.entries) e(v)
     where av.branch_id = v_shift.branch_id and av.staff_id = p_actor and av.week_start = v_week.week_start and av.status = 'submitted'
       and e.v ->> 'date' = v_shift.shift_date::text and e.v ->> 'kind' = 'unavailable'
  ) then
    return public.sched_fail('unavailable_day', jsonb_build_object('date', v_shift.shift_date));
  end if;

  v_label := public.sched_fmt(v_shift.shift_date, v_shift.start_time, v_shift.end_time);
  insert into public.shift_requests (branch_id, shift_id, staff_id, staff_name, note, terms)
  values (v_shift.branch_id, v_shift.id, p_actor, public.sched_name(p_actor), nullif(btrim(coalesce(p_note, '')), ''),
          jsonb_build_object('shiftId', v_shift.id, 'weekId', v_shift.week_id, 'date', v_shift.shift_date,
                             'start', v_shift.start_time, 'end', v_shift.end_time, 'label', v_label))
  returning id into v_id;

  perform public.sched_notify(v_shift.branch_id, array_remove(public.sched_manager_ids(v_shift.branch_id), p_actor),
    'request.new', public.sched_name(p_actor) || ' מבקש/ת להצטרף למשמרת', v_label,
    jsonb_build_object('tab', 'requests', 'shiftId', v_shift.id, 'weekStart', v_week.week_start));
  perform public.sched_log(v_shift.branch_id, p_actor, 'request.create',
    'ביקש/ה להצטרף למשמרת: ' || v_label, jsonb_build_object('requestId', v_id, 'shiftId', v_shift.id));
  return jsonb_build_object('ok', true, 'requestId', v_id);
exception when unique_violation then
  return public.sched_fail('duplicate_request');
end;
$$;
