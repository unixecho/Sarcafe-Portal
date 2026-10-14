-- Days off and shift preferences, one rule across every branch.
--
--   day_off     "I do not want to work this day." Needs the owner's yes. Once approved the person cannot be put on
--               ANY shift of ANY branch that day: a deferred constraint trigger on shift_assignments refuses it
--               even if a function forgets to check. A pending day off is only a request: nothing is blocked yet,
--               but automatic filling already leaves the person alone.
--   no_morning  "I would rather not work the morning shift that day."
--   no_evening  Soft wishes. No decision needed (status 'noted'): the owner sees them while building the schedule
--               and may still schedule the person, so they only colour and warn, they never block.
--
-- A person's wishes belong to the person, not to a branch, so this is its own table rather than another entry kind
-- in shift_availability (which is per branch and per week). Employees can ask for any day that has not started;
-- there is deliberately no weekly cap yet (the owner said "for now, every day"): the one place to add one is
-- sched_submit_time_off. Browser roles get no access to the table or the functions.

create table if not exists public.staff_time_off (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('day_off', 'no_morning', 'no_evening')),
  status text not null check (status in ('pending', 'approved', 'declined', 'cancelled', 'noted')),
  note text,
  decision_note text,
  decided_by uuid references public.staff(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (kind = 'day_off' and status in ('pending', 'approved', 'declined', 'cancelled'))
    or (kind <> 'day_off' and status in ('noted', 'cancelled'))
  )
);
create unique index if not exists staff_time_off_one_live
  on public.staff_time_off (staff_id, day, kind) where status in ('pending', 'approved', 'noted');
create index if not exists staff_time_off_day_idx on public.staff_time_off (day, status);
create index if not exists staff_time_off_staff_idx on public.staff_time_off (staff_id, day);

alter table public.staff_time_off enable row level security;
revoke all on public.staff_time_off from public, anon, authenticated;
grant all on public.staff_time_off to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Small helpers
-- ---------------------------------------------------------------------------------------------------------------

-- Which half of the day a shift touches: 'morning' (it starts before 13:00) and/or 'evening' (it ends after
-- 13:00 or runs past midnight). 07:00-13:00 is morning, 13:00-19:00 evening, a 07:00-19:00 shift is both.
-- KEEP IN SYNC with shiftPeriods() in src/lib/shifts/time-off.ts (scripts/check-schedule.mjs compares them).
create or replace function public.sched_shift_periods(p_start text, p_end text)
returns text[]
language sql
immutable
set search_path = public
as $$
  with m as (
    select (split_part(p_start, ':', 1)::int * 60 + split_part(p_start, ':', 2)::int) as s,
           (split_part(p_end, ':', 1)::int * 60 + split_part(p_end, ':', 2)::int) as e
  )
  select array_remove(array[
    case when s < 780 then 'morning' end,
    case when e > 780 or e <= s then 'evening' end
  ], null) from m;
$$;

-- The active permanent branches a person can be scheduled in (their own branch, or all when they have none),
-- minus the ones an owner switched them off in. Those are the branches whose managers hear about their requests.
create or replace function public.sched_staff_branches(p_staff uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(b.id order by b.created_at), '{}'::uuid[])
    from public.branches b
    join public.staff s on s.id = p_staff
   where b.active and coalesce(b.kind, 'permanent') = 'permanent'
     and (s.branch_id is null or s.branch_id = b.id)
     and not exists (select 1 from public.schedule_members m where m.branch_id = b.id and m.staff_id = p_staff and not m.schedulable);
$$;

-- True when the person has an APPROVED day off on that date: the one fact that blocks scheduling.
create or replace function public.sched_time_off_blocked(p_staff uuid, p_day date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff_time_off t
     where t.staff_id = p_staff and t.day = p_day and t.kind = 'day_off' and t.status = 'approved'
  );
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- The backstop: nobody is put on a shift on an approved day off. Deferred, like the double-booking guard, so a
-- multi-row change is judged on its final state. A row that did not actually change person/shift passes (an
-- owner may knowingly keep someone who was already scheduled when their day off was approved).
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.sched_time_off_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_day date;
begin
  if new.staff_id is null then return null; end if;
  if tg_op = 'UPDATE' and old.staff_id is not distinct from new.staff_id and old.shift_id is not distinct from new.shift_id then
    return null;
  end if;
  if not exists (select 1 from public.shift_assignments a where a.id = new.id) then
    return null; -- inserted and removed again within the same transaction
  end if;
  select s.shift_date into v_day from public.shifts s where s.id = new.shift_id;
  if v_day is not null and public.sched_time_off_blocked(new.staff_id, v_day) then
    raise exception 'sched_time_off';
  end if;
  return null;
end;
$$;

create or replace function public.sched_time_off_shift_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  r record;
begin
  if new.shift_date is not distinct from old.shift_date then return null; end if;
  if not exists (select 1 from public.shifts x where x.id = new.id) then return null; end if;
  for r in select a.staff_id from public.shift_assignments a where a.shift_id = new.id and a.staff_id is not null loop
    if public.sched_time_off_blocked(r.staff_id, new.shift_date) then
      raise exception 'sched_time_off';
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists shift_assignments_no_time_off on public.shift_assignments;
create constraint trigger shift_assignments_no_time_off
  after insert or update of staff_id, shift_id on public.shift_assignments
  deferrable initially deferred
  for each row execute function public.sched_time_off_guard();

drop trigger if exists shifts_no_time_off on public.shifts;
create constraint trigger shifts_no_time_off
  after update of shift_date on public.shifts
  deferrable initially deferred
  for each row execute function public.sched_time_off_shift_guard();

-- ---------------------------------------------------------------------------------------------------------------
-- An employee sends the wishes for one week. p_entries is the WANTED state of that week:
-- [{ "date": "2030-01-08", "kinds": ["day_off"] }, { "date": "2030-01-09", "kinds": ["no_evening"] }];
-- a date that is not listed means "nothing". The function adds what is new, cancels what was removed and leaves
-- the rest (including decisions already made) alone. Days that have already started cannot be changed.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.sched_submit_time_off(p_actor uuid, p_week_start date, p_entries jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Jerusalem')::date;
  v_day date;
  v_entry jsonb;
  v_kind text;
  v_wanted text[];
  v_row public.staff_time_off%rowtype;
  v_added_days date[] := '{}';
  v_withdrawn_days date[] := '{}';
  v_branches uuid[];
  v_branch uuid;
  v_name text;
  v_added integer := 0;
  v_removed integer := 0;
  v_labels text;
begin
  if not exists (select 1 from public.staff where id = p_actor and active) then return public.sched_fail('forbidden'); end if;
  if p_week_start is null or extract(dow from p_week_start) <> 0 then return public.sched_fail('bad_date'); end if;
  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) > 7 then return public.sched_fail('bad_request'); end if;
  if (select count(distinct e->>'date') from jsonb_array_elements(p_entries) e) <> jsonb_array_length(p_entries) then
    return public.sched_fail('bad_request');
  end if;
  for v_entry in select * from jsonb_array_elements(p_entries) loop
    if not coalesce(v_entry->>'date' ~ '^\d{4}-\d{2}-\d{2}$', false)
       or (v_entry->>'date')::date not between p_week_start and p_week_start + 6 then
      return public.sched_fail('bad_date');
    end if;
    if jsonb_typeof(v_entry->'kinds') <> 'array' or jsonb_array_length(v_entry->'kinds') > 3 then return public.sched_fail('bad_request'); end if;
    for v_kind in select jsonb_array_elements_text(v_entry->'kinds') loop
      if v_kind not in ('day_off', 'no_morning', 'no_evening') then return public.sched_fail('bad_request'); end if;
    end loop;
  end loop;

  perform public.sched_lock_staff(p_actor);
  v_name := public.sched_name(p_actor);

  for v_day in select generate_series(p_week_start, p_week_start + 6, interval '1 day')::date loop
    if v_day < v_today then continue; end if;
    select coalesce(array_agg(distinct k), '{}') into v_wanted
      from jsonb_array_elements(p_entries) e, jsonb_array_elements_text(e->'kinds') k
     where e->>'date' = v_day::text;
    -- A whole day off already covers both halves: the softer wishes of the same day add nothing.
    if 'day_off' = any (v_wanted) then v_wanted := array['day_off']; end if;

    for v_row in select * from public.staff_time_off
                  where staff_id = p_actor and day = v_day and status in ('pending', 'approved', 'noted') for update loop
      if not (v_row.kind = any (v_wanted)) then
        update public.staff_time_off set status = 'cancelled', updated_at = now() where id = v_row.id;
        v_removed := v_removed + 1;
        if v_row.kind = 'day_off' and v_row.status = 'approved' then v_withdrawn_days := v_withdrawn_days || v_day; end if;
      end if;
    end loop;
    foreach v_kind in array v_wanted loop
      if not exists (select 1 from public.staff_time_off where staff_id = p_actor and day = v_day and kind = v_kind and status in ('pending', 'approved', 'noted')) then
        insert into public.staff_time_off (staff_id, day, kind, status)
        values (p_actor, v_day, v_kind, case when v_kind = 'day_off' then 'pending' else 'noted' end);
        v_added := v_added + 1;
        if v_kind = 'day_off' then v_added_days := v_added_days || v_day; end if;
      end if;
    end loop;
  end loop;

  v_branches := public.sched_staff_branches(p_actor);
  if coalesce(array_length(v_added_days, 1), 0) > 0 then
    select string_agg(to_char(d, 'FMDD/FMMM'), ', ' order by d) into v_labels from unnest(v_added_days) d;
    foreach v_branch in array v_branches loop
      perform public.sched_notify(v_branch, array_remove(public.sched_manager_ids(v_branch), p_actor), 'timeoff.new',
        v_name || ' ביקש/ה ' || case when array_length(v_added_days, 1) = 1 then 'יום חופש' else 'ימי חופש' end,
        v_labels, jsonb_build_object('tab', 'requests', 'weekStart', p_week_start));
    end loop;
  end if;
  if coalesce(array_length(v_withdrawn_days, 1), 0) > 0 then
    select string_agg(to_char(d, 'FMDD/FMMM'), ', ' order by d) into v_labels from unnest(v_withdrawn_days) d;
    foreach v_branch in array v_branches loop
      perform public.sched_notify(v_branch, array_remove(public.sched_manager_ids(v_branch), p_actor), 'timeoff.cancelled',
        v_name || ' ביטל/ה יום חופש שאושר', v_labels, jsonb_build_object('tab', 'requests', 'weekStart', p_week_start));
    end loop;
  end if;
  if (v_added + v_removed) > 0 and coalesce(array_length(v_branches, 1), 0) > 0 then
    perform public.sched_log(v_branches[1], p_actor, 'timeoff.submit', v_name || ' עדכן/ה בקשות חופש והעדפות לשבוע ' || to_char(p_week_start, 'FMDD/FMMM'),
      jsonb_build_object('weekStart', p_week_start, 'added', v_added, 'removed', v_removed));
  end if;
  return jsonb_build_object('ok', true, 'added', v_added, 'removed', v_removed);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- A manager decides day-off requests (several at once, normally one person's days of one week).
-- p_branch is the board the manager is on: they must manage it and the person must belong to it.
-- An approval does not remove the person from shifts they already hold that day: it asks first (needs_confirmation),
-- and the shifts stay on the board flagged until the owner changes them.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.sched_decide_time_off(
  p_actor uuid, p_branch uuid, p_ids uuid[], p_approve boolean, p_note text, p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.staff_time_off%rowtype;
  v_rows public.staff_time_off[] := '{}';
  v_staff uuid;
  v_issues jsonb := '[]'::jsonb;
  v_shifts text;
  v_labels text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 or array_length(p_ids, 1) > 31 then return public.sched_fail('bad_request'); end if;
  if char_length(coalesce(v_note, '')) > 300 then return public.sched_fail('bad_request'); end if;
  if not public.sched_can_manage(p_actor, p_branch) then return public.sched_fail('forbidden'); end if;

  for v_row in select * from public.staff_time_off where id = any (p_ids) order by day for update loop
    v_rows := v_rows || v_row;
  end loop;
  if coalesce(array_length(v_rows, 1), 0) <> (select count(distinct x) from unnest(p_ids) x) then return public.sched_fail('not_found'); end if;
  select r.staff_id into v_staff from unnest(v_rows) r limit 1;
  if exists (select 1 from unnest(v_rows) r where r.staff_id <> v_staff) then return public.sched_fail('bad_request'); end if;
  if exists (select 1 from unnest(v_rows) r where r.kind <> 'day_off' or r.status <> 'pending') then return public.sched_fail('not_pending'); end if;
  if not (p_branch = any (public.sched_staff_branches(v_staff))) then return public.sched_fail('wrong_branch'); end if;

  if p_approve and not coalesce(p_force, false) then
    for v_row in select r.* from unnest(v_rows) r order by r.day loop
      select string_agg(public.sched_fmt(s.shift_date, s.start_time, s.end_time), ', ' order by s.start_time) into v_shifts
        from public.shift_assignments a join public.shifts s on s.id = a.shift_id
       where a.staff_id = v_staff and s.shift_date = v_row.day;
      if v_shifts is not null then
        v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'already_scheduled',
          'message', public.sched_name(v_staff) || ' כבר משובץ/ת ב' || v_shifts || '. האישור לא מסיר אותם מהמשמרת — צריך להחליף אותם בלוח ידנית.'));
      end if;
    end loop;
    if jsonb_array_length(v_issues) > 0 then
      return public.sched_fail('needs_confirmation', jsonb_build_object('issues', v_issues));
    end if;
  end if;

  update public.staff_time_off
     set status = case when p_approve then 'approved' else 'declined' end,
         decided_by = p_actor, decided_at = now(), decision_note = v_note, updated_at = now()
   where id = any (p_ids);

  select string_agg(to_char(r.day, 'FMDD/FMMM'), ', ' order by r.day) into v_labels from unnest(v_rows) r;
  perform public.sched_notify(p_branch, array[v_staff], 'timeoff.decided',
    case when p_approve then 'יום החופש אושר' else 'בקשת יום החופש נדחתה' end,
    v_labels || coalesce(' · ' || v_note, ''), jsonb_build_object('url', '/staff/schedule?tab=availability'));
  perform public.sched_log(p_branch, p_actor,
    case when p_approve then 'timeoff.approve' else 'timeoff.decline' end,
    (case when p_approve then 'אישר/ה' else 'דחה/תה' end) || ' יום חופש ל' || public.sched_name(v_staff) || ': ' || v_labels,
    jsonb_build_object('staffId', v_staff, 'days', p_ids));
  return jsonb_build_object('ok', true, 'staffId', v_staff, 'days', array_length(v_rows, 1));
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Automatic filling honours the wishes: a pending or approved day off, and the half of the day someone asked to
-- avoid, leave them out (the place stays open and is reported, the owner decides). Unchanged otherwise: this is the
-- 20261008134738 body with one added check.
-- ---------------------------------------------------------------------------------------------------------------
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
  if exists (
    select 1 from public.staff_time_off t
     where t.staff_id = p_staff and t.day = s.shift_date and (
       (t.kind = 'day_off' and t.status in ('pending', 'approved'))
       or (t.status = 'noted' and (
         (t.kind = 'no_morning' and 'morning' = any (public.sched_shift_periods(s.start_time, s.end_time)))
         or (t.kind = 'no_evening' and 'evening' = any (public.sched_shift_periods(s.start_time, s.end_time)))
       ))
     )
  ) then return false; end if;
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

-- ---------------------------------------------------------------------------------------------------------------
-- Copying a week skips a person whose approved day off falls on the copied day (and says so), instead of failing
-- the whole copy at the backstop. The 024 body with one added skip.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.sched_copy_week(p_actor uuid, p_branch uuid, p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from public.schedule_weeks%rowtype;
  v_to public.schedule_weeks%rowtype;
  v_offset integer;
  s record;
  a record;
  v_new uuid;
  v_nd date;
  v_shifts integer := 0;
  v_people integer := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_ex record;
begin
  if not public.sched_can_manage(p_actor, p_branch) then
    return public.sched_fail('forbidden');
  end if;
  if p_from = p_to or extract(dow from p_from) <> 0 or extract(dow from p_to) <> 0 then
    return public.sched_fail('bad_date');
  end if;
  select * into v_from from public.schedule_weeks where branch_id = p_branch and week_start = p_from;
  if not found then
    return public.sched_fail('source_empty');
  end if;
  insert into public.schedule_weeks (branch_id, week_start) values (p_branch, p_to)
  on conflict (branch_id, week_start) do update set updated_at = now();
  select * into v_to from public.schedule_weeks where branch_id = p_branch and week_start = p_to;
  perform 1 from public.schedule_weeks where id in (v_from.id, v_to.id) order by id for update;

  if not exists (select 1 from public.shifts where week_id = v_from.id) then
    return public.sched_fail('source_empty');
  end if;

  perform public.sched_lock_staff_many(array(
    select a2.staff_id from public.shift_assignments a2 join public.shifts s2 on s2.id = a2.shift_id where s2.week_id = v_from.id and a2.staff_id is not null));

  for v_ex in select x.id from public.shift_assignments x join public.shifts sh on sh.id = x.shift_id where sh.week_id = v_to.id loop
    perform public.sched_cancel_swaps_for_assignment(v_ex.id, 'השבוע הוחלף בהעתקה משבוע אחר');
  end loop;
  perform public.sched_cancel_requests_for_shifts(array(select id from public.shifts where week_id = v_to.id), 'השבוע הוחלף בהעתקה משבוע אחר');
  delete from public.shifts where week_id = v_to.id;

  v_offset := p_to - p_from;
  for s in select * from public.shifts where week_id = v_from.id order by shift_date, start_time loop
    v_nd := s.shift_date + v_offset;
    insert into public.shifts (branch_id, week_id, shift_date, start_time, end_time, preset_id, station_id, requirements, note)
    values (p_branch, v_to.id, v_nd, s.start_time, s.end_time, s.preset_id, s.station_id, s.requirements, s.note)
    returning id into v_new;
    v_shifts := v_shifts + 1;
    for a in select * from public.shift_assignments where shift_id = s.id and staff_id is not null order by created_at loop
      if not exists (select 1 from public.staff st where st.id = a.staff_id and st.active)
         or exists (select 1 from public.schedule_members m where m.branch_id = p_branch and m.staff_id = a.staff_id and not m.schedulable) then
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('name', coalesce(public.sched_name(a.staff_id), a.staff_name), 'why', 'inactive', 'label', public.sched_fmt(v_nd, s.start_time, s.end_time)));
        continue;
      end if;
      if public.sched_time_off_blocked(a.staff_id, v_nd) then
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('name', public.sched_name(a.staff_id), 'why', 'day_off', 'label', public.sched_fmt(v_nd, s.start_time, s.end_time)));
        continue;
      end if;
      perform public.sched_lock_staff(a.staff_id);
      if jsonb_array_length(public.sched_conflicts(a.staff_id, public.sched_range(v_nd, s.start_time, s.end_time), '{}', v_new)) > 0 then
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('name', public.sched_name(a.staff_id), 'why', 'busy', 'label', public.sched_fmt(v_nd, s.start_time, s.end_time)));
        continue;
      end if;
      insert into public.shift_assignments (branch_id, shift_id, staff_id, staff_name, role_id)
      values (p_branch, v_new, a.staff_id, public.sched_name(a.staff_id), a.role_id);
      v_people := v_people + 1;
    end loop;
  end loop;

  set constraints all immediate;
  set constraints all deferred;

  perform public.sched_log(p_branch, p_actor, 'schedule.copy',
    'העתיק/ה לוח משבוע ' || to_char(p_from, 'FMDD/FMMM') || ' אל שבוע ' || to_char(p_to, 'FMDD/FMMM'),
    jsonb_build_object('from', p_from, 'to', p_to, 'shifts', v_shifts, 'people', v_people, 'skipped', v_skipped));
  return jsonb_build_object('ok', true, 'weekId', v_to.id, 'shifts', v_shifts, 'people', v_people, 'skipped', v_skipped);
exception when others then
  if sqlerrm = 'sched_overlap' then
    return public.sched_fail('conflict');
  end if;
  raise;
end;
$$;

revoke all on function public.sched_shift_periods(text, text) from public, anon, authenticated;
revoke all on function public.sched_staff_branches(uuid) from public, anon, authenticated;
revoke all on function public.sched_time_off_blocked(uuid, date) from public, anon, authenticated;
revoke all on function public.sched_time_off_guard() from public, anon, authenticated;
revoke all on function public.sched_time_off_shift_guard() from public, anon, authenticated;
revoke all on function public.sched_submit_time_off(uuid, date, jsonb) from public, anon, authenticated;
revoke all on function public.sched_decide_time_off(uuid, uuid, uuid[], boolean, text, boolean) from public, anon, authenticated;
revoke all on function public.sched_fill_eligible(uuid, uuid, date, jsonb, integer) from public, anon, authenticated;
revoke all on function public.sched_copy_week(uuid, uuid, date, date) from public, anon, authenticated;
grant execute on function public.sched_time_off_guard(), public.sched_time_off_shift_guard(), public.sched_shift_periods(text, text), public.sched_staff_branches(uuid), public.sched_time_off_blocked(uuid, date),
  public.sched_submit_time_off(uuid, date, jsonb), public.sched_decide_time_off(uuid, uuid, uuid[], boolean, text, boolean),
  public.sched_fill_eligible(uuid, uuid, date, jsonb, integer), public.sched_copy_week(uuid, uuid, date, date) to service_role;
