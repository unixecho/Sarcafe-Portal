-- The minimum-rest rule is gone: it does not fit this business (a morning at Givat Haviva and an evening at Maor is a
-- normal day for one person). The automatic fill no longer refuses a person for too little rest between shifts.
-- This is sched_fill_eligible exactly as in 20261015091000_staff_time_off.sql minus the rest check. Overlap, weekly and
-- daily caps, days off, availability and consecutive days still apply. The stored `minRestHours` setting is ignored.
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

revoke all on function public.sched_fill_eligible(uuid, uuid, date, jsonb, integer) from public, anon, authenticated;
grant execute on function public.sched_fill_eligible(uuid, uuid, date, jsonb, integer) to service_role;
