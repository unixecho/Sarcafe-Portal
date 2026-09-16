-- ============================================================
-- Safe to re-run: every CREATE TABLE/INDEX/VIEW/POLICY below is
-- idempotent (IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS first),
-- so a retry after a partial failure converges to the same end state
-- instead of erroring on "already exists" or leaving stale objects.
--
-- Shift scheduling — adapted from AyekaBar's migration 027
-- (src/lib/shifts/*, src/components/shifts/*), branch-scoped instead of
-- AyekaBar's single implicit venue. Every `venue_id` there becomes
-- `branch_id references public.branches(id)` here, following the exact
-- idiom `is_menu_editor(p_branch_id)` already established: a schedule
-- week/shift belongs to exactly one branch (mirrors `menus` being
-- `branch_id not null unique`), and `is_schedule_manager(p_branch_id)`
-- below has the same three-tier shape `is_menu_editor` does, plus a
-- per-branch delegated-manager list AyekaBar keeps in
-- `shift_settings.schedule_managers` rather than on `staff` itself (the
-- same "don't widen the shared staff table" reasoning `staff.branch_id`
-- already sets as house style).
--
-- AUTHORIZATION POSTURE, STATED ONCE: unlike AyekaBar (where RLS is the
-- actual gate and the app layer never re-checks), every write here also
-- goes through an explicit requireScheduleManager()/requireScheduleViewer()
-- guard in the API layer (lib/shifts/guard.ts) using the service-role
-- client — matching how every other route in THIS app is built
-- (requireMenuEditor/requireOwner + service role, not the caller's own
-- RLS-gated session). RLS policies below are still real and still matter
-- (defense in depth, and the one true backstop against a bug in the app
-- layer) but they are not the only thing standing between a request and a
-- write, consistent with this codebase's own established posture.
--
-- NOTE ON start_time/end_time: kept as plain `text` ("HH:MM"), not cast to
-- `time` in a generated column — verified against a local Postgres
-- instance that `text::time` is STABLE, not IMMUTABLE (its input function
-- can depend on DateStyle), so a generated column using that cast is
-- rejected outright ("generation expression is not immutable"). Duration/
-- midnight-crossing arithmetic lives in lib/shifts/time.ts instead, which
-- the app needs anyway for the rules engine.
-- ============================================================

-- ---------------------------------------------------------------------
-- Tables first — the access functions below query shift_settings, so
-- they must exist before those functions are defined.
-- ---------------------------------------------------------------------

-- shift_settings — one row per branch: working days/hours (+ per-weekday
-- override), the roles/stations/presets catalogs, safety rules, per-code
-- rule-severity overrides, feature flags, and the delegated-manager list.
-- Catalogs are jsonb, not normalized tables, on purpose — short, ordered
-- lists always read/written whole, same call AyekaBar's own settings make.
-- Vocabulary (role/station/preset names) is plain Hebrew text, not
-- trilingual: unlike menu content, nothing here is ever customer-facing —
-- matches every other staff/owner-only screen in this app.
create table if not exists public.shift_settings (
  branch_id          uuid primary key references public.branches(id) on delete cascade,
  working_days       smallint[] not null default '{0,1,2,3,4,5,6}',
  open_time          text not null default '07:00',
  close_time         text not null default '19:00',
  day_hours          jsonb not null default '{}'::jsonb,
  roles              jsonb not null default '[]'::jsonb,
  stations           jsonb not null default '[]'::jsonb,
  presets            jsonb not null default '[]'::jsonb,
  safety             jsonb not null default '{"maxWeeklyHours":42,"minRestHours":10,"maxDailyHours":10,"maxConsecutiveDays":6}'::jsonb,
  rule_severity      jsonb not null default '{}'::jsonb,
  features           jsonb not null default '{"availability":true,"swaps":true}'::jsonb,
  schedule_managers  uuid[] not null default '{}',
  onboarded_at       timestamptz,
  updated_at         timestamptz not null default now()
);

-- schedule_members — branch-scoped staff scheduling flags. THE direct
-- answer to "staff window needs staff flags for scheduling": no row =
-- not schedulable. Keyed (branch_id, staff_id) rather than just staff_id,
-- so an all-branch floater (staff.branch_id is null) can carry separate
-- flags per branch they actually work at.
create table if not exists public.schedule_members (
  branch_id         uuid not null references public.branches(id) on delete cascade,
  staff_id          uuid not null references public.staff(id) on delete cascade,
  schedulable       boolean not null default true,
  default_role_id   text,
  max_weekly_hours  integer,
  employment_type   text,
  sort_order        integer,
  note              text,
  updated_at        timestamptz not null default now(),
  primary key (branch_id, staff_id)
);

-- schedule_weeks — draft/published per branch+week. `published_snapshot`
-- is a FROZEN jsonb copy staff read from; staff never see live rows.
create table if not exists public.schedule_weeks (
  id                   uuid primary key default gen_random_uuid(),
  branch_id            uuid not null references public.branches(id) on delete cascade,
  week_start           date not null,
  status               text not null default 'draft' check (status in ('draft', 'published')),
  version              integer not null default 0,
  published_at         timestamptz,
  published_by         uuid references auth.users(id) on delete set null,
  day_notes            jsonb not null default '{}'::jsonb,
  dismissed_warnings   jsonb not null default '[]'::jsonb,
  published_snapshot   jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (branch_id, week_start)
);

-- shifts — wall-clock date + "HH:MM" text (never timestamptz), so a
-- shift's printed hours survive a DST transition unchanged.
create table if not exists public.shifts (
  id                 uuid primary key default gen_random_uuid(),
  branch_id          uuid not null references public.branches(id) on delete cascade,
  week_id            uuid not null references public.schedule_weeks(id) on delete cascade,
  shift_date         date not null,
  start_time         text not null,
  end_time           text not null,
  preset_id          text,
  station_id         text,
  requirements       jsonb not null default '[]'::jsonb,
  note               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists shifts_week_id_idx on public.shifts (week_id);
create index if not exists shifts_branch_date_idx on public.shifts (branch_id, shift_date);

-- shift_assignments — staff snapshotted by name so removing a staff
-- member later doesn't erase who actually worked a shift.
create table if not exists public.shift_assignments (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references public.branches(id) on delete cascade,
  shift_id    uuid not null references public.shifts(id) on delete cascade,
  staff_id    uuid references public.staff(id) on delete set null,
  staff_name  text,
  role_id     text,
  status      text not null default 'assigned' check (status in ('assigned', 'swap_pending')),
  created_at  timestamptz not null default now(),
  unique (shift_id, staff_id, role_id)
);
create index if not exists shift_assignments_shift_id_idx on public.shift_assignments (shift_id);
create index if not exists shift_assignments_staff_id_idx on public.shift_assignments (staff_id) where staff_id is not null;

-- shift_availability — "available" is absence of a row; only exceptions
-- are stored. Feature-flagged (shift_settings.features.availability).
create table if not exists public.shift_availability (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references public.branches(id) on delete cascade,
  staff_id    uuid not null references public.staff(id) on delete cascade,
  week_start  date not null,
  entries     jsonb not null default '[]'::jsonb,
  note        text,
  status      text not null default 'draft' check (status in ('draft', 'submitted')),
  updated_at  timestamptz not null default now(),
  unique (branch_id, staff_id, week_start)
);

-- shift_swaps — feature-flagged (shift_settings.features.swaps). All
-- state transitions (request/accept/decide/cancel) go through the RPCs
-- below, never a raw UPDATE — see the RLS section for why.
create table if not exists public.shift_swaps (
  id              uuid primary key default gen_random_uuid(),
  branch_id       uuid not null references public.branches(id) on delete cascade,
  assignment_id   uuid not null references public.shift_assignments(id) on delete cascade,
  from_staff_id   uuid not null references public.staff(id) on delete cascade,
  to_staff_id     uuid references public.staff(id) on delete cascade,
  status          text not null default 'open' check (status in ('open', 'peer_accepted', 'approved', 'rejected', 'cancelled')),
  reason          text,
  decided_at      timestamptz,
  decided_by      uuid references auth.users(id) on delete set null,
  decision_note   text,
  created_at      timestamptz not null default now()
);
create index if not exists shift_swaps_branch_status_idx on public.shift_swaps (branch_id, status);

-- shift_audit — append-only, same shape/posture as menu_audit.
create table if not exists public.shift_audit (
  id           bigint generated always as identity primary key,
  branch_id    uuid not null references public.branches(id) on delete cascade,
  actor_id     uuid references auth.users(id) on delete set null,
  actor_name   text,
  actor_email  text,
  action       text not null,
  summary      text,
  detail       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists shift_audit_branch_created_idx on public.shift_audit (branch_id, created_at desc);

-- ---------------------------------------------------------------------
-- Access functions — SQL twins of lib/shifts/access.ts. `current_staff_id`
-- and the three predicates below all need security definer because
-- `staff` itself carries no select policy for `authenticated` (an
-- intentional gap since day one — see 000_core_schema.sql).
-- ---------------------------------------------------------------------

create or replace function public.current_staff_id()
returns uuid
language sql
security definer
set search_path = public
as $$
  select id from public.staff where auth_user_id = auth.uid() and active limit 1;
$$;

create or replace function public.can_view_schedule(p_branch_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff s
    where s.auth_user_id = auth.uid()
      and s.active
      and (s.branch_id is null or s.branch_id = p_branch_id)
  );
$$;

-- Manage: owner, or badge='general_manager', or delegated via this
-- branch's shift_settings.schedule_managers[].
create or replace function public.is_schedule_manager(p_branch_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff s
    where s.auth_user_id = auth.uid()
      and s.active
      and (s.branch_id is null or s.branch_id = p_branch_id)
      and (
        s.role = 'owner'
        or s.badge = 'owner'
        or s.badge = 'general_manager'
        or s.id = any(
          coalesce((select schedule_managers from public.shift_settings where branch_id = p_branch_id), '{}')
        )
      )
  );
$$;

-- Delegate: deliberately narrower than manage — a delegate can hand out
-- schedule work but not the delegation itself. Owner/general_manager only.
create or replace function public.can_delegate_schedule(p_branch_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff s
    where s.auth_user_id = auth.uid()
      and s.active
      and (s.branch_id is null or s.branch_id = p_branch_id)
      and (s.role = 'owner' or s.badge = 'owner' or s.badge = 'general_manager')
  );
$$;

revoke execute on function public.current_staff_id() from public;
revoke execute on function public.can_view_schedule(uuid) from public;
revoke execute on function public.is_schedule_manager(uuid) from public;
revoke execute on function public.can_delegate_schedule(uuid) from public;
grant execute on function public.current_staff_id() to authenticated, service_role;
grant execute on function public.can_view_schedule(uuid) to authenticated, service_role;
grant execute on function public.is_schedule_manager(uuid) to authenticated, service_role;
grant execute on function public.can_delegate_schedule(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- log_shift_audit() — insert helper. Exceptions swallowed: a failed audit
-- write must never roll back the real change it was describing (same
-- posture as lib/menu/audit.ts's logMenuAudit on the app-layer side, here
-- also enforced at the SQL layer for the RPCs below that write audit rows
-- inline with their own transaction).
-- ---------------------------------------------------------------------
create or replace function public.log_shift_audit(
  p_branch_id uuid, p_action text, p_summary text, p_detail jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_email text;
begin
  select coalesce(display_name, nullif(trim(concat(first_name, ' ', last_name)), ''), email), email
    into v_name, v_email
    from public.staff where auth_user_id = auth.uid() and active limit 1;

  insert into public.shift_audit (branch_id, actor_id, actor_name, actor_email, action, summary, detail)
  values (p_branch_id, auth.uid(), v_name, v_email, p_action, p_summary, p_detail);
exception when others then
  null;
end;
$$;

-- ---------------------------------------------------------------------
-- publish_schedule_week() — the atomic core. FOR UPDATE locks the week
-- row so two managers publishing at once can't interleave; the snapshot
-- is built from the CURRENT shifts/assignments, so it's always a faithful
-- freeze of what's live at the moment of publish.
-- ---------------------------------------------------------------------
create or replace function public.publish_schedule_week(p_week_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_id uuid;
  v_snapshot jsonb;
begin
  select branch_id into v_branch_id from public.schedule_weeks where id = p_week_id for update;
  if not found then
    raise exception 'week % not found', p_week_id;
  end if;
  if not public.is_schedule_manager(v_branch_id) then
    raise exception 'not authorized';
  end if;

  select jsonb_build_object(
    'shifts', coalesce((select jsonb_agg(to_jsonb(s)) from public.shifts s where s.week_id = p_week_id), '[]'::jsonb),
    'assignments', coalesce(
      (select jsonb_agg(to_jsonb(a)) from public.shift_assignments a
        where a.shift_id in (select id from public.shifts where week_id = p_week_id)),
      '[]'::jsonb
    )
  ) into v_snapshot;

  update public.schedule_weeks
  set status = 'published', version = version + 1, published_at = now(), published_by = auth.uid(),
      published_snapshot = v_snapshot, updated_at = now()
  where id = p_week_id;

  perform public.log_shift_audit(v_branch_id, 'schedule.publish', 'פרסם את לוח המשמרות', jsonb_build_object('weekId', p_week_id));
end;
$$;

create or replace function public.unpublish_schedule_week(p_week_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_id uuid;
begin
  select branch_id into v_branch_id from public.schedule_weeks where id = p_week_id for update;
  if not found then
    raise exception 'week % not found', p_week_id;
  end if;
  if not public.is_schedule_manager(v_branch_id) then
    raise exception 'not authorized';
  end if;

  update public.schedule_weeks set status = 'draft', updated_at = now() where id = p_week_id;
  perform public.log_shift_audit(v_branch_id, 'schedule.unpublish', 'ביטל את פרסום לוח המשמרות', jsonb_build_object('weekId', p_week_id));
end;
$$;

create or replace function public.clear_schedule_week(p_week_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_id uuid;
begin
  select branch_id into v_branch_id from public.schedule_weeks where id = p_week_id for update;
  if not found then
    raise exception 'week % not found', p_week_id;
  end if;
  if not public.is_schedule_manager(v_branch_id) then
    raise exception 'not authorized';
  end if;

  delete from public.shifts where week_id = p_week_id;
  perform public.log_shift_audit(v_branch_id, 'schedule.clear', 'ניקה את לוח המשמרות', jsonb_build_object('weekId', p_week_id));
end;
$$;

-- copy_schedule_week() — REPLACES the target week's shifts (not a merge),
-- matched back to the source by (offset date, start_time), so copying
-- twice is idempotent rather than duplicating.
create or replace function public.copy_schedule_week(p_branch_id uuid, p_from_week_start date, p_to_week_start date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from_week_id uuid;
  v_to_week_id uuid;
  v_offset_days int;
begin
  if not public.is_schedule_manager(p_branch_id) then
    raise exception 'not authorized';
  end if;

  select id into v_from_week_id from public.schedule_weeks where branch_id = p_branch_id and week_start = p_from_week_start;
  if v_from_week_id is null then
    raise exception 'source week not found';
  end if;

  insert into public.schedule_weeks (branch_id, week_start)
  values (p_branch_id, p_to_week_start)
  on conflict (branch_id, week_start) do update set updated_at = now()
  returning id into v_to_week_id;

  perform pg_advisory_xact_lock(hashtext(v_to_week_id::text));
  delete from public.shifts where week_id = v_to_week_id;

  v_offset_days := p_to_week_start - p_from_week_start;

  with inserted as (
    insert into public.shifts (branch_id, week_id, shift_date, start_time, end_time, preset_id, station_id, requirements, note)
    select p_branch_id, v_to_week_id, shift_date + v_offset_days, start_time, end_time, preset_id, station_id, requirements, note
    from public.shifts
    where week_id = v_from_week_id
    returning id, shift_date, start_time
  )
  insert into public.shift_assignments (branch_id, shift_id, staff_id, staff_name, role_id)
  select p_branch_id, ins.id, a.staff_id, a.staff_name, a.role_id
  from public.shift_assignments a
  join public.shifts src on src.id = a.shift_id and src.week_id = v_from_week_id
  join inserted ins on ins.shift_date = src.shift_date + v_offset_days and ins.start_time = src.start_time;

  perform public.log_shift_audit(p_branch_id, 'schedule.copy', 'העתיק לוח משמרות משבוע קודם',
    jsonb_build_object('fromWeekStart', p_from_week_start, 'toWeekStart', p_to_week_start));

  return v_to_week_id;
end;
$$;

-- set_schedule_member() — upsert with "absent key = unchanged" semantics.
-- An RPC (not a plain RLS-gated upsert) purely so it can log the
-- before/after diff in one transaction.
create or replace function public.set_schedule_member(p_branch_id uuid, p_staff_id uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_staff_name text;
begin
  if not public.is_schedule_manager(p_branch_id) then
    raise exception 'not authorized';
  end if;

  select to_jsonb(m) into v_before from public.schedule_members m
    where branch_id = p_branch_id and staff_id = p_staff_id;

  insert into public.schedule_members (branch_id, staff_id, schedulable, default_role_id, max_weekly_hours, employment_type, sort_order, note, updated_at)
  values (
    p_branch_id, p_staff_id,
    coalesce((p_patch->>'schedulable')::boolean, true),
    p_patch->>'defaultRoleId',
    (p_patch->>'maxWeeklyHours')::integer,
    p_patch->>'employmentType',
    (p_patch->>'sortOrder')::integer,
    p_patch->>'note',
    now()
  )
  on conflict (branch_id, staff_id) do update set
    schedulable = coalesce((p_patch->>'schedulable')::boolean, schedule_members.schedulable),
    default_role_id = coalesce(p_patch->>'defaultRoleId', schedule_members.default_role_id),
    max_weekly_hours = case when p_patch ? 'maxWeeklyHours' then (p_patch->>'maxWeeklyHours')::integer else schedule_members.max_weekly_hours end,
    employment_type = coalesce(p_patch->>'employmentType', schedule_members.employment_type),
    sort_order = case when p_patch ? 'sortOrder' then (p_patch->>'sortOrder')::integer else schedule_members.sort_order end,
    note = coalesce(p_patch->>'note', schedule_members.note),
    updated_at = now();

  select coalesce(display_name, email) into v_staff_name from public.staff where id = p_staff_id;
  perform public.log_shift_audit(p_branch_id, 'member.update', concat('עדכן הגדרות שיבוץ: ', coalesce(v_staff_name, 'איש/אשת צוות')),
    jsonb_build_object('staffId', p_staff_id, 'before', v_before, 'patch', p_patch));
end;
$$;

-- ---------------------------------------------------------------------
-- Swap state machine — request/accept/decide/cancel, each row-locked.
-- Kept as RPCs rather than raw UPDATE policies specifically because
-- approving a swap must ALSO move shift_assignments.staff_id in the same
-- transaction — a plain RLS-gated UPDATE on shift_swaps could never do
-- that side effect atomically.
-- ---------------------------------------------------------------------
create or replace function public.request_shift_swap(p_assignment_id uuid, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_id uuid;
  v_staff_id uuid;
  v_swap_id uuid;
begin
  select a.branch_id, a.staff_id into v_branch_id, v_staff_id
    from public.shift_assignments a where a.id = p_assignment_id for update;
  if not found then
    raise exception 'assignment % not found', p_assignment_id;
  end if;
  if v_staff_id is null or v_staff_id <> public.current_staff_id() then
    raise exception 'not authorized';
  end if;

  update public.shift_assignments set status = 'swap_pending' where id = p_assignment_id;

  insert into public.shift_swaps (branch_id, assignment_id, from_staff_id, status, reason)
  values (v_branch_id, p_assignment_id, v_staff_id, 'open', p_reason)
  returning id into v_swap_id;

  perform public.log_shift_audit(v_branch_id, 'swap.request', 'ביקש/ה החלפת משמרת', jsonb_build_object('swapId', v_swap_id));
  return v_swap_id;
end;
$$;

create or replace function public.accept_shift_swap(p_swap_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_id uuid;
  v_status text;
  v_to_staff_id uuid;
  v_self uuid;
begin
  select branch_id, status, to_staff_id into v_branch_id, v_status, v_to_staff_id
    from public.shift_swaps where id = p_swap_id for update;
  if not found then
    raise exception 'swap % not found', p_swap_id;
  end if;
  if v_status <> 'open' then
    raise exception 'swap is not open';
  end if;

  v_self := public.current_staff_id();
  if v_self is null or (v_to_staff_id is not null and v_to_staff_id <> v_self) then
    raise exception 'not authorized';
  end if;

  update public.shift_swaps set status = 'peer_accepted', to_staff_id = v_self where id = p_swap_id;
  perform public.log_shift_audit(v_branch_id, 'swap.accept', 'הציע/ה לקחת משמרת מוחלפת', jsonb_build_object('swapId', p_swap_id));
end;
$$;

create or replace function public.decide_shift_swap(p_swap_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_id uuid;
  v_assignment_id uuid;
  v_status text;
  v_to_staff_id uuid;
  v_to_staff_name text;
begin
  select branch_id, assignment_id, status, to_staff_id into v_branch_id, v_assignment_id, v_status, v_to_staff_id
    from public.shift_swaps where id = p_swap_id for update;
  if not found then
    raise exception 'swap % not found', p_swap_id;
  end if;
  if not public.is_schedule_manager(v_branch_id) then
    raise exception 'not authorized';
  end if;
  if v_status <> 'peer_accepted' then
    raise exception 'swap is not awaiting a decision';
  end if;

  perform 1 from public.shift_assignments where id = v_assignment_id for update;

  if p_approve then
    select coalesce(display_name, email) into v_to_staff_name from public.staff where id = v_to_staff_id;
    update public.shift_assignments
      set staff_id = v_to_staff_id, staff_name = v_to_staff_name, status = 'assigned'
      where id = v_assignment_id;
    update public.shift_swaps
      set status = 'approved', decided_at = now(), decided_by = auth.uid(), decision_note = p_note
      where id = p_swap_id;
    perform public.log_shift_audit(v_branch_id, 'swap.approve', 'אישר/ה החלפת משמרת', jsonb_build_object('swapId', p_swap_id));
  else
    update public.shift_assignments set status = 'assigned' where id = v_assignment_id;
    update public.shift_swaps
      set status = 'rejected', decided_at = now(), decided_by = auth.uid(), decision_note = p_note
      where id = p_swap_id;
    perform public.log_shift_audit(v_branch_id, 'swap.reject', 'דחה/תה בקשת החלפת משמרת', jsonb_build_object('swapId', p_swap_id));
  end if;
end;
$$;

create or replace function public.cancel_shift_swap(p_swap_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_id uuid;
  v_assignment_id uuid;
  v_from_staff_id uuid;
  v_status text;
begin
  select branch_id, assignment_id, from_staff_id, status into v_branch_id, v_assignment_id, v_from_staff_id, v_status
    from public.shift_swaps where id = p_swap_id for update;
  if not found then
    raise exception 'swap % not found', p_swap_id;
  end if;
  if v_status not in ('open', 'peer_accepted') then
    raise exception 'swap is no longer active';
  end if;
  if v_from_staff_id <> public.current_staff_id() and not public.is_schedule_manager(v_branch_id) then
    raise exception 'not authorized';
  end if;

  update public.shift_assignments set status = 'assigned' where id = v_assignment_id;
  update public.shift_swaps set status = 'cancelled', decided_at = now(), decided_by = auth.uid() where id = p_swap_id;

  perform public.log_shift_audit(v_branch_id, 'swap.cancel', 'ביטל/ה בקשת החלפת משמרת', jsonb_build_object('swapId', p_swap_id));
end;
$$;

revoke execute on function public.log_shift_audit(uuid, text, text, jsonb) from public;
revoke execute on function public.publish_schedule_week(uuid) from public;
revoke execute on function public.unpublish_schedule_week(uuid) from public;
revoke execute on function public.clear_schedule_week(uuid) from public;
revoke execute on function public.copy_schedule_week(uuid, date, date) from public;
revoke execute on function public.set_schedule_member(uuid, uuid, jsonb) from public;
revoke execute on function public.request_shift_swap(uuid, text) from public;
revoke execute on function public.accept_shift_swap(uuid) from public;
revoke execute on function public.decide_shift_swap(uuid, boolean, text) from public;
revoke execute on function public.cancel_shift_swap(uuid) from public;

grant execute on function public.log_shift_audit(uuid, text, text, jsonb) to authenticated, service_role;
grant execute on function public.publish_schedule_week(uuid) to authenticated, service_role;
grant execute on function public.unpublish_schedule_week(uuid) to authenticated, service_role;
grant execute on function public.clear_schedule_week(uuid) to authenticated, service_role;
grant execute on function public.copy_schedule_week(uuid, date, date) to authenticated, service_role;
grant execute on function public.set_schedule_member(uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.request_shift_swap(uuid, text) to authenticated, service_role;
grant execute on function public.accept_shift_swap(uuid) to authenticated, service_role;
grant execute on function public.decide_shift_swap(uuid, boolean, text) to authenticated, service_role;
grant execute on function public.cancel_shift_swap(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- published_schedule — the only surface a non-manager reads. Definer view
-- (bypasses RLS on schedule_weeks) with its OWN authorization check in
-- the WHERE clause, since a definer view carries none automatically.
-- ---------------------------------------------------------------------
create or replace view public.published_schedule
with (security_invoker = false) as
select id, branch_id, week_start, status, version, published_at, day_notes, published_snapshot
from public.schedule_weeks
where status = 'published' and public.can_view_schedule(branch_id);

grant select on public.published_schedule to authenticated;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.shift_settings enable row level security;
alter table public.schedule_members enable row level security;
alter table public.schedule_weeks enable row level security;
alter table public.shifts enable row level security;
alter table public.shift_assignments enable row level security;
alter table public.shift_availability enable row level security;
alter table public.shift_swaps enable row level security;
alter table public.shift_audit enable row level security;

drop policy if exists "schedule settings readable by branch staff" on public.shift_settings;
create policy "schedule settings readable by branch staff" on public.shift_settings
  for select using (public.can_view_schedule(branch_id));
drop policy if exists "schedule settings writable by managers" on public.shift_settings;
create policy "schedule settings writable by managers" on public.shift_settings
  for all using (public.is_schedule_manager(branch_id)) with check (public.is_schedule_manager(branch_id));

drop policy if exists "roster readable by branch staff" on public.schedule_members;
create policy "roster readable by branch staff" on public.schedule_members
  for select using (public.can_view_schedule(branch_id));
drop policy if exists "roster writable by managers" on public.schedule_members;
create policy "roster writable by managers" on public.schedule_members
  for all using (public.is_schedule_manager(branch_id)) with check (public.is_schedule_manager(branch_id));

-- Draft/live tables: manager-only, full stop. Staff read ONLY through
-- published_schedule above — this is the "staff never read live rows"
-- guarantee, enforced at the RLS layer independent of the app layer.
drop policy if exists "schedule weeks manager only" on public.schedule_weeks;
create policy "schedule weeks manager only" on public.schedule_weeks
  for all using (public.is_schedule_manager(branch_id)) with check (public.is_schedule_manager(branch_id));
drop policy if exists "shifts manager only" on public.shifts;
create policy "shifts manager only" on public.shifts
  for all using (public.is_schedule_manager(branch_id)) with check (public.is_schedule_manager(branch_id));
drop policy if exists "shift assignments manager only" on public.shift_assignments;
create policy "shift assignments manager only" on public.shift_assignments
  for all using (public.is_schedule_manager(branch_id)) with check (public.is_schedule_manager(branch_id));

drop policy if exists "own availability, manager reads all" on public.shift_availability;
create policy "own availability, manager reads all" on public.shift_availability
  for all
  using (staff_id = public.current_staff_id() or public.is_schedule_manager(branch_id))
  with check (staff_id = public.current_staff_id() or public.is_schedule_manager(branch_id));

-- Swaps: select is broad (see below); every WRITE goes through the RPCs
-- above, so there is no insert/update/delete policy here at all — RLS
-- enabled with a select-only policy denies every other operation by
-- construction, which is exactly the point.
drop policy if exists "swap visibility" on public.shift_swaps;
create policy "swap visibility" on public.shift_swaps
  for select using (
    public.is_schedule_manager(branch_id)
    or from_staff_id = public.current_staff_id()
    or to_staff_id = public.current_staff_id()
    or (status = 'open' and public.can_view_schedule(branch_id))
  );

-- shift_audit: append-only from the app's perspective, service-role/RPC
-- only — no policies at all (same posture as menu_audit).

-- ---------------------------------------------------------------------
-- Grants — service_role needs full table access (every route resolves
-- access via requireScheduleManager()/requireScheduleViewer() first, same
-- as every other owner-gated route in this app); authenticated needs
-- table-level reach for the RLS policies above to ever be evaluated.
-- ---------------------------------------------------------------------
grant all on public.shift_settings, public.schedule_members, public.schedule_weeks,
  public.shifts, public.shift_assignments, public.shift_availability, public.shift_swaps, public.shift_audit
  to service_role;
grant select, insert, update, delete on public.shift_settings, public.schedule_members, public.schedule_weeks,
  public.shifts, public.shift_assignments, public.shift_availability to authenticated;
grant select on public.shift_swaps to authenticated;

-- Seed shift_settings for every existing branch, same "insert missing
-- rows for current branches" shape the menus table seed uses.
insert into public.shift_settings (branch_id)
select id from public.branches
on conflict (branch_id) do nothing;
