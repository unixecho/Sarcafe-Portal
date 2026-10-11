-- Taking a colleague's shift.
--
-- A swap could only be started by the person GIVING a shift away (hand-over or
-- exchange). An employee with no shift of their own, or one who simply wants an
-- extra shift, had no way to ask for a colleague's. A 'take' is started by the
-- person who WANTS the shift; the colleague who holds it answers (agree or
-- decline); the manager still decides. Nothing in shift_assignments changes
-- until the manager approves, exactly as for every other swap.
--
--   direction 'give'  initiated by from_staff (the giver)  -> answered by to_staff, or any
--                     colleague for an open offer. Unchanged.
--   direction 'take'  initiated by to_staff (the taker)    -> answered by from_staff (the
--                     holder). from_staff_id = whoever holds assignment_id; there is no
--                     return shift (asking for a shift AND offering one in return is an
--                     ordinary exchange started from the asker's own shift).
--
-- sched_decide_swap needs no change: it already moves assignment_id from from_staff
-- to to_staff and re-validates both people against the schedule as it is NOW.

alter table public.shift_swaps add column if not exists direction text not null default 'give';
alter table public.shift_swaps drop constraint if exists shift_swaps_direction_check;
alter table public.shift_swaps add constraint shift_swaps_direction_check check (direction in ('give', 'take'));

-- ---------------------------------------------------------------------
-- Ask a colleague for their shift (no shift offered in return)
-- ---------------------------------------------------------------------
create or replace function public.sched_request_take(p_actor uuid, p_assignment uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a public.shift_assignments%rowtype;
  v_s public.shifts%rowtype;
  v_week public.schedule_weeks%rowtype;
  v_conf jsonb;
  v_id uuid;
  v_terms jsonb;
begin
  select * into v_a from public.shift_assignments where id = p_assignment;
  if not found then
    return public.sched_fail('not_found');
  end if;
  select * into v_s from public.shifts where id = v_a.shift_id;
  perform 1 from public.schedule_weeks where id = v_s.week_id for update;
  select * into v_week from public.schedule_weeks where id = v_s.week_id;
  select * into v_a from public.shift_assignments where id = p_assignment for update;
  if not found then
    return public.sched_fail('not_found');
  end if;

  if v_a.staff_id is null or v_a.staff_id = p_actor then
    return public.sched_fail('bad_target');
  end if;
  if not public.sched_can_view(p_actor, v_s.branch_id) then
    return public.sched_fail('forbidden');
  end if;
  if not exists (select 1 from public.staff s where s.id = v_a.staff_id and s.active) then
    return public.sched_fail('bad_target');
  end if;
  if p_reason is not null and char_length(p_reason) > 300 then
    return public.sched_fail('bad_request');
  end if;
  if not public.sched_in_snapshot(v_s.week_id, 'assignments', v_a.id) then
    return public.sched_fail('not_published');
  end if;
  if public.sched_is_past(v_s.branch_id, v_s.shift_date, v_s.start_time) then
    return public.sched_fail('past');
  end if;
  if exists (select 1 from public.shift_swaps w where w.status in ('open', 'peer_accepted') and (w.assignment_id = v_a.id or w.return_assignment_id = v_a.id)) then
    return public.sched_fail('duplicate_swap');
  end if;
  if exists (select 1 from public.schedule_members m where m.branch_id = v_s.branch_id and m.staff_id = p_actor and not m.schedulable) then
    return public.sched_fail('not_schedulable');
  end if;
  if exists (select 1 from public.shift_assignments x where x.shift_id = v_s.id and x.staff_id = p_actor) then
    return public.sched_fail('already_assigned');
  end if;

  perform public.sched_lock_staff(p_actor);
  v_conf := public.sched_conflicts(p_actor, public.sched_range(v_s.shift_date, v_s.start_time, v_s.end_time), '{}'::uuid[], null);
  if jsonb_array_length(v_conf) > 0 then
    return public.sched_fail('busy', jsonb_build_object('with', v_conf -> 0));
  end if;

  v_terms := jsonb_build_object('from', public.sched_assignment_terms(v_a.id), 'to', null);
  insert into public.shift_swaps (branch_id, assignment_id, return_assignment_id, from_staff_id, to_staff_id, from_staff_name, to_staff_name, status, reason, terms, direction)
  values (v_s.branch_id, v_a.id, null, v_a.staff_id, p_actor, public.sched_name(v_a.staff_id), public.sched_name(p_actor), 'open',
          nullif(btrim(coalesce(p_reason, '')), ''), v_terms, 'take')
  returning id into v_id;

  perform public.sched_notify(v_s.branch_id, array[v_a.staff_id], 'swap.request',
    public.sched_name(p_actor) || ' מבקש/ת לקחת ממך משמרת',
    (v_terms -> 'from' ->> 'label') || E'\n' || 'בלי משמרת בתמורה. אפשר להסכים או לסרב בלשונית הבקשות.',
    jsonb_build_object('tab', 'requests', 'weekStart', v_week.week_start));
  perform public.sched_log(v_s.branch_id, p_actor, 'swap.request',
    'ביקש/ה לקחת את המשמרת של ' || public.sched_name(v_a.staff_id) || ': ' || (v_terms -> 'from' ->> 'label'),
    jsonb_build_object('swapId', v_id, 'direction', 'take'));
  return jsonb_build_object('ok', true, 'swapId', v_id);
exception when unique_violation then
  return public.sched_fail('duplicate_swap');
end;
$$;

-- ---------------------------------------------------------------------
-- The other side answers. For a 'give' this is the 024 behaviour, unchanged: a named
-- person accepts or declines, and for an open offer any colleague may volunteer. For a
-- 'take' only the person who holds the shift answers, and it is the TAKER (to_staff) who
-- must be free and available for it.
-- ---------------------------------------------------------------------
create or replace function public.sched_respond_swap(p_actor uuid, p_swap uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sw public.shift_swaps%rowtype;
  v_a public.shift_assignments%rowtype;
  v_s public.shifts%rowtype;
  v_conf jsonb;
  v_taker uuid;
begin
  select * into v_sw from public.shift_swaps where id = p_swap;
  if not found then
    return public.sched_fail('not_found');
  end if;
  if v_sw.assignment_id is not null then
    perform 1 from public.schedule_weeks w join public.shifts s on s.week_id = w.id
      join public.shift_assignments a on a.shift_id = s.id where a.id = v_sw.assignment_id for update of w;
  end if;
  select * into v_sw from public.shift_swaps where id = p_swap for update;
  if v_sw.status <> 'open' then
    return public.sched_fail('not_pending');
  end if;
  if not public.sched_can_view(p_actor, v_sw.branch_id) then
    return public.sched_fail('forbidden');
  end if;
  if v_sw.direction = 'take' then
    if p_actor is distinct from v_sw.from_staff_id then
      return public.sched_fail('forbidden');
    end if;
  else
    if p_actor = v_sw.from_staff_id then
      return public.sched_fail('forbidden');
    end if;
    if v_sw.to_staff_id is not null and v_sw.to_staff_id <> p_actor then
      return public.sched_fail('forbidden');
    end if;
  end if;

  if not p_accept then
    if v_sw.direction = 'give' and v_sw.to_staff_id is null then
      return public.sched_fail('forbidden');
    end if;
    update public.shift_swaps set status = 'declined', peer_responded_at = now(), updated_at = now() where id = p_swap;
    if v_sw.direction = 'take' then
      perform public.sched_notify(v_sw.branch_id, array[v_sw.to_staff_id], 'swap.declined',
        public.sched_name(p_actor) || ' לא יכול/ה למסור לך את המשמרת', v_sw.terms -> 'from' ->> 'label', jsonb_build_object('tab', 'requests'));
      perform public.sched_log(v_sw.branch_id, p_actor, 'swap.decline', 'סירב/ה למסור משמרת ל' || coalesce(v_sw.to_staff_name, ''), jsonb_build_object('swapId', p_swap));
    else
      perform public.sched_notify(v_sw.branch_id, array[v_sw.from_staff_id], 'swap.declined',
        public.sched_name(p_actor) || ' לא יכול/ה להחליף', v_sw.terms -> 'from' ->> 'label', jsonb_build_object('tab', 'requests'));
      perform public.sched_log(v_sw.branch_id, p_actor, 'swap.decline', 'סירב/ה להחלפת משמרת עם ' || coalesce(v_sw.from_staff_name, ''), jsonb_build_object('swapId', p_swap));
    end if;
    return jsonb_build_object('ok', true, 'status', 'declined');
  end if;

  -- accept: the schedule must still be what was offered
  select * into v_a from public.shift_assignments where id = v_sw.assignment_id;
  if not found or v_a.staff_id is distinct from v_sw.from_staff_id then
    update public.shift_swaps set status = 'cancelled', cancel_reason = 'השיבוץ השתנה', decided_at = now(), updated_at = now() where id = p_swap;
    return public.sched_fail('assignment_changed');
  end if;
  select * into v_s from public.shifts where id = v_a.shift_id;
  if public.sched_is_past(v_s.branch_id, v_s.shift_date, v_s.start_time) then
    return public.sched_fail('past');
  end if;

  -- whoever ends up with the shift has to be free for it
  v_taker := case when v_sw.direction = 'take' then v_sw.to_staff_id else p_actor end;
  if v_sw.direction = 'take' and not exists (select 1 from public.staff x where x.id = v_taker and x.active) then
    return public.sched_fail('inactive_staff', jsonb_build_object('name', public.sched_name(v_taker)));
  end if;
  if exists (select 1 from public.shift_assignments x where x.shift_id = v_s.id and x.staff_id = v_taker) then
    return public.sched_fail('already_assigned', case when v_sw.direction = 'take' then jsonb_build_object('name', public.sched_name(v_taker)) else '{}'::jsonb end);
  end if;
  if exists (select 1 from public.schedule_members m where m.branch_id = v_s.branch_id and m.staff_id = v_taker and not m.schedulable) then
    return public.sched_fail('not_schedulable', case when v_sw.direction = 'take' then jsonb_build_object('name', public.sched_name(v_taker)) else '{}'::jsonb end);
  end if;
  perform public.sched_lock_staff(v_taker);
  v_conf := public.sched_conflicts(v_taker, public.sched_range(v_s.shift_date, v_s.start_time, v_s.end_time),
                                   case when v_sw.return_assignment_id is null then '{}'::uuid[] else array[v_sw.return_assignment_id] end, null);
  if jsonb_array_length(v_conf) > 0 then
    return public.sched_fail('busy', case when v_sw.direction = 'take'
      then jsonb_build_object('name', public.sched_name(v_taker), 'with', v_conf -> 0)
      else jsonb_build_object('with', v_conf -> 0) end);
  end if;

  if v_sw.direction = 'take' then
    update public.shift_swaps set status = 'peer_accepted', peer_responded_at = now(), updated_at = now() where id = p_swap;
    perform public.sched_notify(v_sw.branch_id, array[v_sw.to_staff_id], 'swap.accepted',
      public.sched_name(p_actor) || ' מסכים/ה למסור לך את המשמרת', 'ממתין לאישור המנהל/ת · ' || (v_sw.terms -> 'from' ->> 'label'), jsonb_build_object('tab', 'requests'));
    perform public.sched_notify(v_sw.branch_id, public.sched_manager_ids(v_sw.branch_id),
      'swap.awaiting', 'בקשת החלפה ממתינה לאישורך',
      coalesce(v_sw.from_staff_name, '') || ' ↔ ' || coalesce(v_sw.to_staff_name, '') || E'\n' || (v_sw.terms -> 'from' ->> 'label'),
      jsonb_build_object('tab', 'requests'));
    perform public.sched_log(v_sw.branch_id, p_actor, 'swap.accept', 'הסכים/ה למסור משמרת ל' || coalesce(v_sw.to_staff_name, ''), jsonb_build_object('swapId', p_swap));
    return jsonb_build_object('ok', true, 'status', 'peer_accepted');
  end if;

  update public.shift_swaps
     set status = 'peer_accepted', to_staff_id = p_actor, to_staff_name = public.sched_name(p_actor), peer_responded_at = now(), updated_at = now()
   where id = p_swap;
  perform public.sched_notify(v_sw.branch_id, array[v_sw.from_staff_id], 'swap.accepted',
    public.sched_name(p_actor) || ' מסכים/ה להחלפה', 'ממתין לאישור המנהל/ת · ' || (v_sw.terms -> 'from' ->> 'label'), jsonb_build_object('tab', 'requests'));
  perform public.sched_notify(v_sw.branch_id, public.sched_manager_ids(v_sw.branch_id),
    'swap.awaiting', 'בקשת החלפה ממתינה לאישורך',
    coalesce(v_sw.from_staff_name, '') || ' ↔ ' || public.sched_name(p_actor) || E'\n' || (v_sw.terms -> 'from' ->> 'label'),
    jsonb_build_object('tab', 'requests'));
  perform public.sched_log(v_sw.branch_id, p_actor, 'swap.accept', 'הסכים/ה להחלפת משמרת עם ' || coalesce(v_sw.from_staff_name, ''), jsonb_build_object('swapId', p_swap));
  return jsonb_build_object('ok', true, 'status', 'peer_accepted');
end;
$$;

-- ---------------------------------------------------------------------
-- Withdraw: whoever STARTED the request (the giver of a 'give', the asker of a 'take'),
-- or a manager.
-- ---------------------------------------------------------------------
create or replace function public.sched_cancel_swap(p_actor uuid, p_swap uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sw public.shift_swaps%rowtype;
  v_initiator uuid;
begin
  select * into v_sw from public.shift_swaps where id = p_swap for update;
  if not found then
    return public.sched_fail('not_found');
  end if;
  v_initiator := case when v_sw.direction = 'take' then v_sw.to_staff_id else v_sw.from_staff_id end;
  if v_initiator is distinct from p_actor and not public.sched_can_manage(p_actor, v_sw.branch_id) then
    return public.sched_fail('forbidden');
  end if;
  if v_sw.status not in ('open', 'peer_accepted') then
    return public.sched_fail('not_pending');
  end if;
  update public.shift_swaps
     set status = 'cancelled', cancel_reason = case when v_initiator is not distinct from p_actor then 'בוטלה על ידי מי שביקש/ה' else 'בוטלה על ידי המנהל/ת' end,
         decided_at = now(), updated_at = now()
   where id = p_swap;
  perform public.sched_notify(v_sw.branch_id,
    array_remove(array[v_sw.from_staff_id, v_sw.to_staff_id], p_actor), 'swap.cancelled', 'בקשת ההחלפה בוטלה',
    v_sw.terms -> 'from' ->> 'label', jsonb_build_object('tab', 'requests'));
  if v_sw.status = 'peer_accepted' then
    perform public.sched_notify(v_sw.branch_id, array_remove(public.sched_manager_ids(v_sw.branch_id), p_actor),
      'swap.cancelled', 'בקשת החלפה שהמתינה לאישור בוטלה', v_sw.terms -> 'from' ->> 'label', jsonb_build_object('tab', 'requests'));
  end if;
  perform public.sched_log(v_sw.branch_id, p_actor, 'swap.cancel', 'ביטל/ה בקשת החלפה: ' || coalesce(v_sw.terms -> 'from' ->> 'label', ''), jsonb_build_object('swapId', p_swap));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------
-- Grants: server only (service_role), like every other sched_* function. The two
-- replaced functions keep their existing privileges; the new one needs its own.
-- ---------------------------------------------------------------------
revoke all on function public.sched_request_take(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.sched_request_take(uuid, uuid, text) to service_role;
