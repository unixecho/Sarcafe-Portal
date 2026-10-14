-- One person does a shift's checklists.
--
-- Before this, every employee on a shift got their own copy of every checklist of that shift, so two people
-- on the same shift filled in (and were chased for) the same forms twice. Now:
--   * the owner may pick ONE of the people on the shift (`shift_assignments.checklist_lead`); only that person
--     gets the shift's checklists (opening + handover, handover + closing, ...);
--   * when nobody is picked everyone on the shift keeps a form, and the FIRST one submitted wins: the same
--     checklist, on the same shift, can be submitted once. The others' unsent copies become 'covered' (closed,
--     never chased) but each person can still do the shift's OTHER checklist.
-- A submitted checklist is evidence and never changes; only unsent copies are covered.
-- Browser roles get nothing new: the table and every function stay service-role only.

alter table public.shift_assignments add column if not exists checklist_lead boolean not null default false;
create unique index if not exists shift_assignments_one_checklist_lead
  on public.shift_assignments (shift_id) where checklist_lead;

-- 'covered': an unsent copy that someone else is responsible for or has already sent.
alter table public.checklist_assignments drop constraint if exists checklist_assignments_status_check;
alter table public.checklist_assignments
  add constraint checklist_assignments_status_check check (status in ('pending', 'in_progress', 'submitted', 'covered'));

-- Moving an assignment to another shift never carries the "does the checklists" mark with it.
create or replace function public.checklist_lead_follow_shift()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.shift_id is distinct from old.shift_id then
    new.checklist_lead := false;
  end if;
  return new;
end;
$$;

drop trigger if exists shift_assignments_checklist_lead_reset on public.shift_assignments;
create trigger shift_assignments_checklist_lead_reset
  before update of shift_id on public.shift_assignments
  for each row execute function public.checklist_lead_follow_shift();

-- Which (assignment, checklist kind) pairs a week should have. The kinds are decided exactly as in
-- 20261009134321 (first shift of the day opens, every shift of a multi-shift day hands over, the last shift
-- closes); the new rule is the lead: with a lead on a shift only the lead is expected to do its checklists.
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
     );
$$;

create or replace function public.sync_checklist_assignments(p_week_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer := 0;
  changed integer := 0;
  covered integer := 0;
  reopened integer := 0;
begin
  -- 1. the forms the schedule calls for (a person whose shift's checklist was already sent starts covered)
  with ready as (
    select e.*, t.id as template_id, t.version, t.definition
      from public.checklist_expected(p_week_id) e
      join public.checklist_templates t
        on t.branch_id = e.branch_id and t.kind = e.kind and t.active
  )
  insert into public.checklist_assignments (
    branch_id, shift_id, shift_assignment_id, staff_id, checklist_kind,
    template_id, template_version, template_snapshot, status
  )
  select r.branch_id, r.shift_id, r.shift_assignment_id, r.staff_id, r.kind,
         r.template_id, r.version, r.definition,
         case when exists (
           select 1 from public.checklist_assignments o
            where o.shift_id = r.shift_id and o.checklist_kind = r.kind and o.status = 'submitted'
         ) then 'covered' else 'pending' end
    from ready r
  on conflict (shift_assignment_id, checklist_kind) do update
    set staff_id = excluded.staff_id,
        template_id = case when public.checklist_assignments.status = 'pending' then excluded.template_id else public.checklist_assignments.template_id end,
        template_version = case when public.checklist_assignments.status = 'pending' then excluded.template_version else public.checklist_assignments.template_version end,
        template_snapshot = case when public.checklist_assignments.status = 'pending' then excluded.template_snapshot else public.checklist_assignments.template_snapshot end,
        updated_at = now();
  get diagnostics inserted_count = row_count;

  -- 2. cover: an unsent copy whose checklist was sent by someone else, or whose shift has a different lead
  update public.checklist_assignments ca
     set status = 'covered', updated_at = now()
    from public.shifts s
   where ca.shift_id = s.id and s.week_id = p_week_id
     and ca.status in ('pending', 'in_progress')
     and (
       exists (
         select 1 from public.checklist_assignments o
          where o.shift_id = ca.shift_id and o.checklist_kind = ca.checklist_kind
            and o.status = 'submitted' and o.id <> ca.id
       )
       or (
         exists (select 1 from public.shift_assignments l where l.shift_id = ca.shift_id and l.checklist_lead and l.staff_id is not null)
         and not exists (select 1 from public.shift_assignments m where m.id = ca.shift_assignment_id and m.checklist_lead)
       )
     );
  get diagnostics covered = row_count;

  -- 3. reopen: a covered copy that has no reason to be covered any more (the lead was cleared or removed)
  update public.checklist_assignments ca
     set status = case when ca.answers = '{}'::jsonb then 'pending' else 'in_progress' end, updated_at = now()
    from public.shifts s
   where ca.shift_id = s.id and s.week_id = p_week_id
     and ca.status = 'covered'
     and not exists (
       select 1 from public.checklist_assignments o
        where o.shift_id = ca.shift_id and o.checklist_kind = ca.checklist_kind
          and o.status = 'submitted' and o.id <> ca.id
     )
     and not (
       exists (select 1 from public.shift_assignments l where l.shift_id = ca.shift_id and l.checklist_lead and l.staff_id is not null)
       and not exists (select 1 from public.shift_assignments m where m.id = ca.shift_assignment_id and m.checklist_lead)
     );
  get diagnostics reopened = row_count;

  -- 4. forget unstarted forms the schedule no longer calls for (started and sent ones are kept as evidence)
  delete from public.checklist_assignments ca
   using public.shifts s
   where ca.status = 'pending'
     and ca.shift_id = s.id
     and s.week_id = p_week_id
     and not exists (
       select 1 from public.checklist_expected(p_week_id) e
        where e.shift_assignment_id = ca.shift_assignment_id and e.kind = ca.checklist_kind and e.staff_id = ca.staff_id
     );
  get diagnostics changed = row_count;
  return inserted_count + changed + covered + reopened;
end;
$$;

-- The same checklist of the same shift is sent once. Serialised per (shift, kind) so two people pressing
-- send together get one winner and one clean refusal, never two submissions.
create or replace function public.checklist_submit_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('checklist-submit:' || new.shift_id::text || ':' || new.checklist_kind));
  if exists (
    select 1 from public.checklist_assignments o
     where o.shift_id = new.shift_id and o.checklist_kind = new.checklist_kind
       and o.status = 'submitted' and o.id <> new.id
  ) then
    raise exception 'checklist_covered';
  end if;
  if exists (select 1 from public.shift_assignments l where l.shift_id = new.shift_id and l.checklist_lead and l.staff_id is not null)
     and not exists (select 1 from public.shift_assignments m where m.id = new.shift_assignment_id and m.checklist_lead) then
    raise exception 'checklist_not_lead';
  end if;
  return new;
end;
$$;

create or replace function public.checklist_cover_siblings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.checklist_assignments
     set status = 'covered', updated_at = now()
   where shift_id = new.shift_id and checklist_kind = new.checklist_kind
     and id <> new.id and status in ('pending', 'in_progress');
  return null;
end;
$$;

drop trigger if exists checklist_assignments_submit_guard on public.checklist_assignments;
create trigger checklist_assignments_submit_guard
  before update of status on public.checklist_assignments
  for each row when (new.status = 'submitted' and old.status is distinct from 'submitted')
  execute function public.checklist_submit_guard();

drop trigger if exists checklist_assignments_cover_siblings on public.checklist_assignments;
create trigger checklist_assignments_cover_siblings
  after update of status on public.checklist_assignments
  for each row when (new.status = 'submitted' and old.status is distinct from 'submitted')
  execute function public.checklist_cover_siblings();

-- The owner picks who does a shift's checklists (p_staff null = nobody: the first to send wins).
create or replace function public.sched_set_checklist_lead(p_actor uuid, p_shift uuid, p_staff uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.shifts%rowtype;
  w public.schedule_weeks%rowtype;
  v_prev uuid;
  v_assignment uuid;
  v_others uuid[];
  v_name text;
begin
  select * into s from public.shifts where id = p_shift;
  if not found then return public.sched_fail('not_found'); end if;
  if not public.sched_can_manage(p_actor, s.branch_id) then return public.sched_fail('forbidden'); end if;
  select * into w from public.schedule_weeks where id = s.week_id for update;

  select a.staff_id into v_prev from public.shift_assignments a where a.shift_id = p_shift and a.checklist_lead limit 1;
  if p_staff is not null then
    select a.id into v_assignment from public.shift_assignments a where a.shift_id = p_shift and a.staff_id = p_staff limit 1;
    if v_assignment is null then return public.sched_fail('not_on_shift'); end if;
  end if;
  if v_prev is not distinct from p_staff then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;

  update public.shift_assignments set checklist_lead = false where shift_id = p_shift and checklist_lead;
  if p_staff is not null then
    update public.shift_assignments set checklist_lead = true where id = v_assignment;
  end if;

  if w.status = 'published' then
    perform public.sync_checklist_assignments(w.id);
    if p_staff is not null then
      v_name := public.sched_name(p_staff);
      select coalesce(array_agg(a.staff_id), '{}'::uuid[]) into v_others
        from public.shift_assignments a where a.shift_id = p_shift and a.staff_id is not null and a.staff_id <> p_staff;
      perform public.sched_notify(s.branch_id, array[p_staff], 'checklist.lead', 'נבחרת למלא את הצ׳קליסטים של המשמרת',
        public.sched_fmt(s.shift_date, s.start_time, s.end_time), jsonb_build_object('url', '/staff/checklists'));
      perform public.sched_notify(s.branch_id, v_others, 'checklist.lead_other', v_name || ' ימלא/תמלא את הצ׳קליסטים של המשמרת',
        public.sched_fmt(s.shift_date, s.start_time, s.end_time) || ' · אין צורך שתגישו', jsonb_build_object('url', '/staff/checklists'));
    end if;
  end if;

  perform public.sched_log(s.branch_id, p_actor, 'shift.checklist_lead',
    case when p_staff is null then 'ביטל/ה את הבחירה של מי ממלא/ת את הצ׳קליסטים: ' || public.sched_fmt(s.shift_date, s.start_time, s.end_time)
         else 'קבע/ה ש' || public.sched_name(p_staff) || ' ממלא/ת את הצ׳קליסטים: ' || public.sched_fmt(s.shift_date, s.start_time, s.end_time) end,
    jsonb_build_object('shiftId', p_shift, 'staffId', p_staff));
  return jsonb_build_object('ok', true, 'changed', true);
end;
$$;

revoke all on function public.checklist_lead_follow_shift() from public, anon, authenticated;
revoke all on function public.checklist_expected(uuid) from public, anon, authenticated;
revoke all on function public.sync_checklist_assignments(uuid) from public, anon, authenticated;
revoke all on function public.checklist_submit_guard() from public, anon, authenticated;
revoke all on function public.checklist_cover_siblings() from public, anon, authenticated;
revoke all on function public.sched_set_checklist_lead(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.checklist_expected(uuid) to service_role;
grant execute on function public.sync_checklist_assignments(uuid) to service_role;
grant execute on function public.sched_set_checklist_lead(uuid, uuid, uuid) to service_role;

-- Reconcile what already exists: a shift whose checklist was sent by one person stops asking the others for it.
do $$
declare
  published_week record;
begin
  for published_week in select id from public.schedule_weeks where status = 'published' loop
    perform public.sync_checklist_assignments(published_week.id);
  end loop;
end;
$$;
