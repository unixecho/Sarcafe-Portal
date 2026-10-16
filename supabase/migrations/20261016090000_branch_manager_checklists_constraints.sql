-- The branch manager and the constraints (אילוצים) alerts.
--
--  1. checklist_branch_settings: the owner can switch a checklist kind (opening / handover / closing) off for ONE
--     branch and on again. A switched-off kind is no longer called for by the schedule from the day it was switched
--     off: unstarted copies from that day on are removed, started ones are closed (dismissed), nothing already sent is
--     touched. Switching it on again brings the forms back for the days that have not started; days that already passed
--     are not asked for retroactively.
--  2. sched_submit_time_off / sched_submit_availability: the owner hears about EVERY constraint an employee sends
--     (a day off, "not the morning", "not the evening") in one alert, and about a note added to the week.
--
-- Additive and idempotent. Service role only, like every checklist table.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Per-branch checklist switches
-- ---------------------------------------------------------------------------------------------------------------

create table if not exists public.checklist_branch_settings (
  branch_id uuid not null references public.branches(id) on delete cascade,
  kind text not null check (kind in ('opening', 'handover', 'closing')),
  enabled boolean not null default true,
  -- the first day the kind is no longer asked for (only meaningful while enabled = false)
  disabled_from date not null default ((now() at time zone 'Asia/Jerusalem')::date),
  updated_by uuid references public.staff(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (branch_id, kind)
);

alter table public.checklist_branch_settings enable row level security;
revoke all on public.checklist_branch_settings from public, anon, authenticated;
grant all on public.checklist_branch_settings to service_role;

-- Which (assignment, checklist kind) pairs a week should have: 20261015090000's rule, minus the kinds the branch has
-- switched off for the shift's date.
create or replace function public.checklist_expected(p_week_id uuid)
returns table (shift_assignment_id uuid, staff_id uuid, shift_id uuid, branch_id uuid, kind text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.staff_id, s.id, s.branch_id, k.kind
    from public.shift_assignments a
    join public.shifts s on s.id = a.shift_id
    cross join lateral (
      select 'opening'::text as kind
       where not exists (
         select 1 from public.shifts x
          where x.branch_id = s.branch_id and x.shift_date = s.shift_date
            and (x.start_time, x.id) < (s.start_time, s.id)
       )
      union all
      select 'handover'::text
       where exists (
         select 1 from public.shifts x
          where x.branch_id = s.branch_id and x.shift_date = s.shift_date
            and x.id <> s.id
       )
      union all
      select 'closing'::text
       where not exists (
         select 1 from public.shifts x
          where x.branch_id = s.branch_id and x.shift_date = s.shift_date
            and (x.start_time, x.id) > (s.start_time, s.id)
       )
    ) k
   where s.week_id = p_week_id and a.staff_id is not null
     and (
       a.checklist_lead
       or not exists (
         select 1 from public.shift_assignments l
          where l.shift_id = s.id and l.checklist_lead and l.staff_id is not null
       )
     )
     and not exists (
       select 1 from public.checklist_branch_settings cs
        where cs.branch_id = s.branch_id and cs.kind = k.kind and not cs.enabled and s.shift_date >= cs.disabled_from
     );
$$;

-- The owner's switch. Returns { ok, enabled, removed, closed } or { ok:false, reason }.
create or replace function public.checklist_set_branch_kind(p_actor uuid, p_branch uuid, p_kind text, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Jerusalem')::date;
  v_week_from date;
  v_week uuid;
  v_removed integer := 0;
  v_closed integer := 0;
  v_late integer := 0;
  v_kind_label text;
begin
  if p_kind not in ('opening', 'handover', 'closing') or p_enabled is null then return public.sched_fail('bad_request'); end if;
  if not public.sched_is_op(p_actor) then return public.sched_fail('forbidden'); end if;
  if not exists (select 1 from public.branches where id = p_branch and active) then return public.sched_fail('not_found'); end if;
  v_week_from := v_today - extract(dow from v_today)::int;
  v_kind_label := case p_kind when 'opening' then 'פתיחת משמרת' when 'handover' then 'החלפת משמרת' else 'סגירת משמרת' end;

  insert into public.checklist_branch_settings (branch_id, kind, enabled, disabled_from, updated_by, updated_at)
  values (p_branch, p_kind, p_enabled, v_today, p_actor, now())
  on conflict (branch_id, kind) do update
    set enabled = excluded.enabled, disabled_from = excluded.disabled_from, updated_by = excluded.updated_by, updated_at = now();

  if not p_enabled then
    -- Unstarted copies of the days that have not passed are removed; started ones are closed with a reason, so no
    -- alert chases a form nobody has to fill. Sent ones are evidence and stay.
    delete from public.checklist_assignments ca
     using public.shifts s
     where ca.shift_id = s.id and ca.branch_id = p_branch and ca.checklist_kind = p_kind
       and ca.status = 'pending' and s.shift_date >= v_today;
    get diagnostics v_removed = row_count;
    update public.checklist_assignments ca
       set manager_resolved_at = now(), manager_resolved_by = p_actor, manager_note = 'הצ׳קליסט הושבת בסניף', updated_at = now()
      from public.shifts s
     where ca.shift_id = s.id and ca.branch_id = p_branch and ca.checklist_kind = p_kind
       and ca.status in ('in_progress', 'covered') and ca.manager_resolved_at is null and s.shift_date >= v_today;
    get diagnostics v_closed = row_count;
  else
    for v_week in select id from public.schedule_weeks where branch_id = p_branch and week_start >= v_week_from loop
      perform public.sync_checklist_assignments(v_week);
    end loop;
    -- Days that already passed are not asked for after the fact: close what the sync just created for them.
    update public.checklist_assignments ca
       set manager_resolved_at = now(), manager_resolved_by = p_actor, manager_note = 'הופעל מחדש — לא נדרש רטרואקטיבית', updated_at = now()
      from public.shifts s
     where ca.shift_id = s.id and ca.branch_id = p_branch and ca.checklist_kind = p_kind
       and ca.status = 'pending' and ca.manager_resolved_at is null and s.shift_date < v_today
       and ca.created_at >= now() - interval '1 minute';
    get diagnostics v_late = row_count;
  end if;

  perform public.sched_log(p_branch, p_actor, case when p_enabled then 'checklist.enable' else 'checklist.disable' end,
    (case when p_enabled then 'הפעיל/ה' else 'השבית/ה' end) || ' את הצ׳קליסט "' || v_kind_label || '" בסניף',
    jsonb_build_object('kind', p_kind, 'enabled', p_enabled, 'removed', v_removed, 'closed', v_closed + v_late));
  return jsonb_build_object('ok', true, 'enabled', p_enabled, 'removed', v_removed, 'closed', v_closed + v_late);
end;
$$;

revoke all on function public.checklist_expected(uuid) from public, anon, authenticated;
revoke all on function public.checklist_set_branch_kind(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.checklist_expected(uuid), public.checklist_set_branch_kind(uuid, uuid, text, boolean) to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. The owner hears about every constraint
-- ---------------------------------------------------------------------------------------------------------------

-- 20261015091000's body, with ONE change at the end: a single alert per branch lists everything that was added (a day
-- off, "not the morning", "not the evening"), where it used to speak only of days off. kind stays 'timeoff.new'
-- when a day off needs an answer and becomes 'timeoff.wish' when it is only wishes.
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
  v_added_morning date[] := '{}';
  v_added_evening date[] := '{}';
  v_withdrawn_days date[] := '{}';
  v_branches uuid[];
  v_branch uuid;
  v_name text;
  v_added integer := 0;
  v_removed integer := 0;
  v_labels text;
  v_lines text[] := '{}';
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
        if v_kind = 'day_off' then v_added_days := v_added_days || v_day;
        elsif v_kind = 'no_morning' then v_added_morning := v_added_morning || v_day;
        else v_added_evening := v_added_evening || v_day;
        end if;
      end if;
    end loop;
  end loop;

  v_branches := public.sched_staff_branches(p_actor);
  if coalesce(array_length(v_added_days, 1), 0) > 0 then
    select string_agg(to_char(d, 'FMDD/FMMM'), ', ' order by d) into v_labels from unnest(v_added_days) d;
    v_lines := v_lines || ('יום חופש: ' || v_labels);
  end if;
  if coalesce(array_length(v_added_morning, 1), 0) > 0 then
    select string_agg(to_char(d, 'FMDD/FMMM'), ', ' order by d) into v_labels from unnest(v_added_morning) d;
    v_lines := v_lines || ('לא יכול/ה בבוקר: ' || v_labels);
  end if;
  if coalesce(array_length(v_added_evening, 1), 0) > 0 then
    select string_agg(to_char(d, 'FMDD/FMMM'), ', ' order by d) into v_labels from unnest(v_added_evening) d;
    v_lines := v_lines || ('לא יכול/ה בערב: ' || v_labels);
  end if;
  if coalesce(array_length(v_lines, 1), 0) > 0 then
    foreach v_branch in array v_branches loop
      perform public.sched_notify(v_branch, array_remove(public.sched_manager_ids(v_branch), p_actor),
        case when coalesce(array_length(v_added_days, 1), 0) > 0 then 'timeoff.new' else 'timeoff.wish' end,
        v_name || ' שלח/ה אילוצים',
        array_to_string(v_lines, E'\n'), jsonb_build_object('tab', 'requests', 'weekStart', p_week_start));
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
    perform public.sched_log(v_branches[1], p_actor, 'timeoff.submit', v_name || ' עדכן/ה אילוצים לשבוע ' || to_char(p_week_start, 'FMDD/FMMM'),
      jsonb_build_object('weekStart', p_week_start, 'added', v_added, 'removed', v_removed));
  end if;
  return jsonb_build_object('ok', true, 'added', v_added, 'removed', v_removed);
end;
$$;

-- 20261008134738's body, with ONE change: a note that was added or changed gets its own alert that carries the note,
-- so the owner reads it without opening the app. Everything else about it is unchanged.
create or replace function public.sched_submit_availability(
  p_actor uuid, p_branch uuid, p_week_start date, p_entries jsonb, p_note text, p_status text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_entry jsonb; v_old public.shift_availability%rowtype; v_new_note text := nullif(btrim(coalesce(p_note, '')), '');
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
    values (p_branch, p_actor, p_week_start, p_entries, v_new_note, p_status, now())
    on conflict (branch_id, staff_id, week_start) do update
      set entries = excluded.entries, note = excluded.note, status = excluded.status, updated_at = now();
  if p_status = 'submitted' and (v_old.id is null or v_old.entries is distinct from p_entries
    or v_old.note is distinct from v_new_note or v_old.status <> 'submitted') then
    if v_new_note is not null and v_old.note is distinct from v_new_note then
      perform public.sched_notify(p_branch, array_remove(public.sched_manager_ids(p_branch), p_actor),
        'availability.note', public.sched_name(p_actor) || ' הוסיף/ה הערה לאילוצים',
        left(v_new_note, 160), jsonb_build_object('tab', 'requests', 'weekStart', p_week_start));
    end if;
    if v_old.id is null or v_old.entries is distinct from p_entries or v_old.status <> 'submitted'
       or (v_new_note is null and v_old.note is distinct from v_new_note) then
      perform public.sched_notify(p_branch, array_remove(public.sched_manager_ids(p_branch), p_actor),
        'availability.submitted', public.sched_name(p_actor) || ' הגיש/ה בקשות וזמינות',
        'לשבוע שמתחיל ב-' || to_char(p_week_start, 'FMDD/FMMM'), jsonb_build_object('tab', 'requests', 'weekStart', p_week_start));
    end if;
  end if;
  return jsonb_build_object('ok', true);
exception when invalid_datetime_format or datetime_field_overflow then return public.sched_fail('bad_date');
end;
$$;

revoke all on function public.sched_submit_time_off(uuid, date, jsonb) from public, anon, authenticated;
revoke all on function public.sched_submit_availability(uuid, uuid, date, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.sched_submit_time_off(uuid, date, jsonb), public.sched_submit_availability(uuid, uuid, date, jsonb, text, text) to service_role;
