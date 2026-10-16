-- A person who works in more than one branch (the owner's own "Sini", the developer who runs both) got every
-- אילוצים alert TWICE: sched_submit_time_off looped over the person's branches and told each branch's managers, and the
-- owner manages both. Read from production 2026-10-16: one submission wrote six rows, two per manager, all at the same
-- millisecond. Now the managers of every branch are collected first and told once. Nothing else changes: the body is
-- 20261016090000's, the signature is the same (no overload), grants are as before.

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
  v_managers uuid[] := '{}';
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
  -- Everyone who runs one of the person's branches, ONCE. A person who works in two branches is managed by the same
  -- owner in both, and a loop per branch told that owner twice (the same alert twice on the phone, 2026-10-16).
  -- A person with no branch gets no alert, as before.
  if coalesce(array_length(v_branches, 1), 0) > 0 then
    select coalesce(array_agg(distinct m), '{}'::uuid[]) into v_managers
      from unnest(v_branches) b, unnest(public.sched_manager_ids(b)) m
     where m <> p_actor;
  end if;
  if coalesce(array_length(v_lines, 1), 0) > 0 and coalesce(array_length(v_managers, 1), 0) > 0 then
    perform public.sched_notify(v_branches[1], v_managers,
      case when coalesce(array_length(v_added_days, 1), 0) > 0 then 'timeoff.new' else 'timeoff.wish' end,
      v_name || ' שלח/ה אילוצים',
      array_to_string(v_lines, E'\n'), jsonb_build_object('tab', 'requests', 'weekStart', p_week_start));
  end if;
  if coalesce(array_length(v_withdrawn_days, 1), 0) > 0 and coalesce(array_length(v_managers, 1), 0) > 0 then
    select string_agg(to_char(d, 'FMDD/FMMM'), ', ' order by d) into v_labels from unnest(v_withdrawn_days) d;
    perform public.sched_notify(v_branches[1], v_managers, 'timeoff.cancelled',
      v_name || ' ביטל/ה יום חופש שאושר', v_labels, jsonb_build_object('tab', 'requests', 'weekStart', p_week_start));
  end if;
  if (v_added + v_removed) > 0 and coalesce(array_length(v_branches, 1), 0) > 0 then
    perform public.sched_log(v_branches[1], p_actor, 'timeoff.submit', v_name || ' עדכן/ה אילוצים לשבוע ' || to_char(p_week_start, 'FMDD/FMMM'),
      jsonb_build_object('weekStart', p_week_start, 'added', v_added, 'removed', v_removed));
  end if;
  return jsonb_build_object('ok', true, 'added', v_added, 'removed', v_removed);
end;
$$;

revoke all on function public.sched_submit_time_off(uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.sched_submit_time_off(uuid, date, jsonb) to service_role;
