-- =====================================================================
-- 018_scheduling_overhaul.sql — Staff & Scheduling: one reliable backbone.
--
-- Re-runnable (idempotent): every statement is IF NOT EXISTS / OR REPLACE /
-- DROP ... IF EXISTS first, so a retry after a partial failure converges.
--
-- WHY THIS EXISTS (root causes, confirmed against the live database):
--
--  1. Every state-changing scheduling function in 010 (publish, accept /
--     decide swap, set member, copy / clear week ...) authorised through
--     auth.uid(). The app calls them with the SERVICE-ROLE client, where
--     auth.uid() is NULL, so is_schedule_manager() / current_staff_id() are
--     false/null and each one raised "not authorized" — always. (Live: 0 audit
--     rows, 0 assignments, 0 swaps.) The new sched_* functions take the actor
--     EXPLICITLY (p_actor = staff.id, resolved by the server guard from the
--     session, never from a request body), exactly the pos_* pattern in 014.
--     They are executable by service_role only.
--
--  2. Names. The invite flow stored first_name but never display_name and the
--     scheduler read display_name || email, so everyone invited without an
--     email was "ללא שם", and the assignment snapshot stored staff_name = NULL.
--     sched_name() resolves display_name -> first+last -> POS handle -> email,
--     and display_name is backfilled once from first/last name.
--
--  3. Integrity the old schema only hoped for:
--       * one person once per shift (the old unique(shift_id, staff_id,
--         role_id) never fired when role_id is NULL);
--       * a person can never hold two overlapping shifts, in ANY branch —
--         enforced by a deferred constraint trigger so it holds even against a
--         bug in a function, with an advisory lock per person so two managers
--         racing cannot both win;
--       * deleting an assignment / clearing a week no longer cascade-deletes
--         swap history (shift_swaps keeps its own snapshot of what was agreed);
--       * a PENDING swap or request never touches shift_assignments — only an
--         approval does, and an approval also patches the published snapshot so
--         employees see the change immediately.
--
--  4. New: shift_requests (employee asks to work a shift), schedule_notifications
--     (in-app inbox; nothing depends on email), staff.phone, staff_audit.
--
-- Result convention (like pos_*): functions return jsonb
--   { ok: true, ... }  or  { ok: false, reason: '<code>', details: {...} }
-- Expected business refusals are NOT exceptions; the app maps `reason` to
-- plain Hebrew (lib/shifts/messages.ts).
-- =====================================================================

-- ---------------------------------------------------------------------
-- A. Staff: contact + a stable, readable name
-- ---------------------------------------------------------------------
alter table public.staff add column if not exists phone text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'staff_phone_len') then
    alter table public.staff add constraint staff_phone_len check (phone is null or char_length(phone) <= 32);
  end if;
end;
$$;

-- One-time, additive: give everyone invited by first name a display_name too, so
-- every reader of display_name (audit, POS, anything future) sees a real name.
update public.staff
   set display_name = nullif(btrim(concat_ws(' ', nullif(btrim(first_name), ''), nullif(btrim(last_name), ''))), '')
 where (display_name is null or btrim(display_name) = '')
   and nullif(btrim(concat_ws(' ', nullif(btrim(first_name), ''), nullif(btrim(last_name), ''))), '') is not null;

-- No two staff rows with the same email (the invite route checked this by hand;
-- the database now backs it up). Skipped, loudly, if an old duplicate exists.
do $$
begin
  if exists (select 1 from public.staff where email is not null group by lower(email) having count(*) > 1) then
    raise notice 'staff_email_lower_key skipped: duplicate emails already exist';
  else
    create unique index if not exists staff_email_lower_key on public.staff (lower(email)) where email is not null;
  end if;
end;
$$;

-- Staff changes (rename, role, branch, deactivate ...). No FK on purpose: the
-- trail must outlive the row it describes. Append-only for the app (select +
-- insert grants only).
create table if not exists public.staff_audit (
  id              bigint generated always as identity primary key,
  staff_id        uuid,
  staff_name      text,
  actor_staff_id  uuid,
  actor_name      text,
  action          text not null,
  summary         text,
  detail          jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists staff_audit_staff_idx on public.staff_audit (staff_id, created_at desc);
alter table public.staff_audit enable row level security;
revoke all on public.staff_audit from public, anon, authenticated;
grant select, insert on public.staff_audit to service_role;

-- ---------------------------------------------------------------------
-- B. Shifts / assignments: stricter shape
-- ---------------------------------------------------------------------
-- Wall-clock HH:MM only. NOT VALID = enforced for every new/updated row without
-- re-scanning (and failing on) anything written before this migration.
alter table public.shifts drop constraint if exists shifts_time_format;
alter table public.shifts add constraint shifts_time_format
  check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') not valid;

-- A pending swap used to flip the live assignment to 'swap_pending'. Pending is
-- now derived from shift_swaps; the schedule itself is left alone until approval.
update public.shift_assignments set status = 'assigned' where status = 'swap_pending';

-- One person once per shift (any role). Older duplicates (same person, same
-- shift) carry no extra information: keep the oldest.
delete from public.shift_assignments a
 using public.shift_assignments b
 where a.shift_id = b.shift_id and a.staff_id = b.staff_id and a.staff_id is not null
   and (a.created_at, a.id) > (b.created_at, b.id);
create unique index if not exists shift_assignments_one_per_shift
  on public.shift_assignments (shift_id, staff_id) where staff_id is not null;

alter table public.shift_audit add column if not exists actor_staff_id uuid;

-- ---------------------------------------------------------------------
-- C. shift_swaps: keep history, add the exchange + the peer-decline state
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
     where conrelid = 'public.shift_swaps'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.shift_swaps drop constraint %I', r.conname);
  end loop;
  for r in
    select c.conname from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.conrelid = 'public.shift_swaps'::regclass and c.contype = 'f' and a.attname = 'assignment_id'
  loop
    execute format('alter table public.shift_swaps drop constraint %I', r.conname);
  end loop;
end;
$$;

alter table public.shift_swaps alter column assignment_id drop not null;
alter table public.shift_swaps
  add constraint shift_swaps_assignment_id_fkey
  foreign key (assignment_id) references public.shift_assignments(id) on delete set null;
alter table public.shift_swaps
  add constraint shift_swaps_status_check
  check (status in ('open', 'peer_accepted', 'approved', 'rejected', 'declined', 'cancelled'));

alter table public.shift_swaps
  add column if not exists return_assignment_id uuid references public.shift_assignments(id) on delete set null,
  add column if not exists from_staff_name      text,
  add column if not exists to_staff_name        text,
  add column if not exists terms                jsonb not null default '{}'::jsonb,
  add column if not exists cancel_reason        text,
  add column if not exists peer_responded_at    timestamptz,
  add column if not exists decided_by_staff     uuid references public.staff(id) on delete set null,
  add column if not exists updated_at           timestamptz not null default now();

-- One live swap per assignment, whichever side of the exchange it is on.
create unique index if not exists shift_swaps_one_active_per_assignment
  on public.shift_swaps (assignment_id) where status in ('open', 'peer_accepted') and assignment_id is not null;
create unique index if not exists shift_swaps_one_active_per_return
  on public.shift_swaps (return_assignment_id) where status in ('open', 'peer_accepted') and return_assignment_id is not null;

-- ---------------------------------------------------------------------
-- D. New tables
-- ---------------------------------------------------------------------
-- "I would like to work this shift." Never touches shift_assignments until a
-- manager approves it. The shift's date/time are snapshotted in `terms` so the
-- request stays readable after the shift is edited or removed.
create table if not exists public.shift_requests (
  id               uuid primary key default gen_random_uuid(),
  branch_id        uuid not null references public.branches(id) on delete cascade,
  shift_id         uuid references public.shifts(id) on delete set null,
  staff_id         uuid not null references public.staff(id) on delete cascade,
  staff_name       text,
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  note             text check (note is null or char_length(note) <= 300),
  terms            jsonb not null default '{}'::jsonb,
  decision_note    text,
  decided_at       timestamptz,
  decided_by_staff uuid references public.staff(id) on delete set null,
  cancel_reason    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists shift_requests_one_pending
  on public.shift_requests (shift_id, staff_id) where status = 'pending' and shift_id is not null;
create index if not exists shift_requests_branch_status_idx on public.shift_requests (branch_id, status, created_at desc);
create index if not exists shift_requests_staff_idx on public.shift_requests (staff_id, created_at desc);

-- The in-app inbox. Text is composed (in Hebrew) at write time so a notification
-- still reads correctly after the shift or the person has changed.
create table if not exists public.schedule_notifications (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references public.branches(id) on delete cascade,
  staff_id    uuid not null references public.staff(id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text,
  link        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index if not exists schedule_notifications_staff_idx on public.schedule_notifications (staff_id, created_at desc);
create index if not exists schedule_notifications_unread_idx on public.schedule_notifications (staff_id) where read_at is null;

alter table public.shift_requests enable row level security;
alter table public.schedule_notifications enable row level security;
-- Service role only (like menu_audit / customer_feedback): the app reads and
-- writes through requireSchedule*() guards, never from a browser session.
revoke all on public.shift_requests, public.schedule_notifications from public, anon, authenticated;
grant all on public.shift_requests, public.schedule_notifications to service_role;

-- Every write to the schedule goes through the app's server (service role),
-- which authorises first. A browser session holding the anon key must not be
-- able to write around the new rules, whatever the RLS policies say.
revoke insert, update, delete on public.shift_settings, public.schedule_members, public.schedule_weeks,
  public.shifts, public.shift_assignments, public.shift_availability from authenticated;

-- A swap one colleague aimed at another is nobody else's business: a browser may
-- read its own swaps, swaps addressed to it, and swaps open to ANYONE.
drop policy if exists "swap visibility" on public.shift_swaps;
create policy "swap visibility" on public.shift_swaps
  for select using (
    public.is_schedule_manager(branch_id)
    or from_staff_id = public.current_staff_id()
    or to_staff_id = public.current_staff_id()
    or (status = 'open' and to_staff_id is null and public.can_view_schedule(branch_id))
  );

-- ---------------------------------------------------------------------
-- E. Small pure helpers
-- ---------------------------------------------------------------------
-- The one name every screen, audit row and notification uses.
create or replace function public.sched_name(p_staff uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(btrim(s.display_name), ''),
    nullif(btrim(concat_ws(' ', nullif(btrim(s.first_name), ''), nullif(btrim(s.last_name), ''))), ''),
    nullif(btrim(s.handle), ''),
    nullif(btrim(s.email), ''),
    'ללא שם')
  from public.staff s where s.id = p_staff;
$$;

-- "07:00–13:00", isolated (U+2066 … U+2069) so a time range keeps its clock order inside a
-- right-to-left sentence instead of reading "13:00–07:00". The TS twin is isolatedRange().
create or replace function public.sched_range_text(p_start text, p_end text)
returns text
language sql
immutable
as $$
  select chr(8294) || p_start || '–' || p_end || chr(8297);
$$;

-- "יום שלישי 29/9 · 07:00–13:00"   (TS twin: formatShiftLabel — keep in sync, scripts/check-schedule.mjs asserts it)
create or replace function public.sched_fmt(p_date date, p_start text, p_end text)
returns text
language sql
immutable
as $$
  select 'יום ' || (array['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'])[extract(dow from p_date)::int + 1]
         || ' ' || to_char(p_date, 'FMDD/FMMM') || ' · ' || public.sched_range_text(p_start, p_end);
$$;

-- The wall-clock interval a shift occupies. end <= start means "past midnight".
-- Half-open, so a 13:00 end and a 13:00 start do NOT overlap.
create or replace function public.sched_range(p_date date, p_start text, p_end text)
returns tsrange
language sql
stable
as $$
  select tsrange(
    p_date::timestamp + p_start::time,
    p_date::timestamp + p_start::time
      + case when p_end::time <= p_start::time then (p_end::time - p_start::time) + interval '24 hours'
             else (p_end::time - p_start::time) end,
    '[)');
$$;

create or replace function public.sched_tz(p_branch uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select timezone from public.branches where id = p_branch), 'Asia/Jerusalem');
$$;

-- Has this shift already started (in the branch's own clock)?
create or replace function public.sched_is_past(p_branch uuid, p_date date, p_start text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select ((p_date::timestamp + p_start::time) at time zone public.sched_tz(p_branch)) <= now();
$$;

-- Total headcount a shift declares it needs (sum of the per-role minimums).
create or replace function public.sched_needed(p_requirements jsonb)
returns integer
language sql
immutable
as $$
  select coalesce(sum(case when (r.v ->> 'min') ~ '^[0-9]+$' then (r.v ->> 'min')::int else 0 end), 0)::int
    from jsonb_array_elements(case when jsonb_typeof(p_requirements) = 'array' then p_requirements else '[]'::jsonb end) as r(v);
$$;

create or replace function public.sched_fail(p_reason text, p_details jsonb default '{}'::jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('ok', false, 'reason', p_reason, 'details', coalesce(p_details, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------
-- F. Authorisation twins of lib/shifts/access.ts, by explicit staff id.
--    KEEP IN SYNC with that file (the bug class 000_core_schema warns about).
-- ---------------------------------------------------------------------
create or replace function public.sched_can_view(p_staff uuid, p_branch uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff s
     where s.id = p_staff and s.active
       and (s.role = 'owner' or s.badge = 'owner' or s.branch_id is null or s.branch_id = p_branch));
$$;

create or replace function public.sched_can_manage(p_staff uuid, p_branch uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff s
     where s.id = p_staff and s.active
       and (
         s.role = 'owner' or s.badge = 'owner'
         or ((s.branch_id is null or s.branch_id = p_branch)
             and (s.badge = 'general_manager'
                  or s.id = any (coalesce((select ss.schedule_managers from public.shift_settings ss where ss.branch_id = p_branch), '{}'::uuid[]))))
       ));
$$;

create or replace function public.sched_manager_ids(p_branch uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(s.id), '{}'::uuid[])
    from public.staff s where s.active and public.sched_can_manage(s.id, p_branch);
$$;

-- Owners only (staff management is owner-only in this app).
create or replace function public.sched_is_op(p_staff uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.staff s where s.id = p_staff and s.active and (s.role = 'owner' or s.badge = 'owner'));
$$;

-- The RLS-side predicates (010) now mirror the TS rules exactly: an owner is
-- never branch-scoped, and a delegate must be scoped to the branch.
create or replace function public.can_view_schedule(p_branch_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff s
     where s.auth_user_id = auth.uid() and s.active
       and (s.role = 'owner' or s.badge = 'owner' or s.branch_id is null or s.branch_id = p_branch_id));
$$;

-- ---------------------------------------------------------------------
-- G. Logging + notifying
-- ---------------------------------------------------------------------
create or replace function public.sched_log(p_branch uuid, p_actor uuid, p_action text, p_summary text, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth uuid;
  v_email text;
begin
  select s.auth_user_id, s.email into v_auth, v_email from public.staff s where s.id = p_actor;
  insert into public.shift_audit (branch_id, actor_id, actor_staff_id, actor_name, actor_email, action, summary, detail)
  values (p_branch, v_auth, p_actor, public.sched_name(p_actor), v_email, p_action, p_summary, coalesce(p_detail, '{}'::jsonb));
exception when others then
  -- A failed audit write must never undo the real change it describes.
  null;
end;
$$;

create or replace function public.staff_log(p_actor uuid, p_target uuid, p_action text, p_summary text, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.staff_audit (staff_id, staff_name, actor_staff_id, actor_name, action, summary, detail)
  values (p_target, public.sched_name(p_target), p_actor, public.sched_name(p_actor), p_action, p_summary, coalesce(p_detail, '{}'::jsonb));
exception when others then
  null;
end;
$$;

-- In-app notification. Only people who can actually open the app (active, with a
-- linked sign-in) get a row: an unclaimed name-only employee has nowhere to read
-- it. Rows older than 90 days are swept for the people being notified.
create or replace function public.sched_notify(p_branch uuid, p_staff uuid[], p_kind text, p_title text, p_body text, p_link jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_staff is null or array_length(p_staff, 1) is null then
    return;
  end if;
  insert into public.schedule_notifications (branch_id, staff_id, kind, title, body, link)
  select p_branch, s.id, p_kind, p_title, p_body, coalesce(p_link, '{}'::jsonb)
    from public.staff s
   where s.id = any (p_staff) and s.active and s.auth_user_id is not null;
  delete from public.schedule_notifications where staff_id = any (p_staff) and created_at < now() - interval '90 days';
end;
$$;

-- ---------------------------------------------------------------------
-- H. Conflicts: the overlap rule, in one place
-- ---------------------------------------------------------------------
-- Every shift (any branch) this person already holds that overlaps p_range.
create or replace function public.sched_conflicts(
  p_staff uuid, p_range tsrange, p_ignore_assignments uuid[] default '{}', p_ignore_shift uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'assignmentId', a.id, 'shiftId', s.id, 'branchId', s.branch_id,
           'date', s.shift_date, 'start', s.start_time, 'end', s.end_time,
           'label', public.sched_fmt(s.shift_date, s.start_time, s.end_time)
         ) order by s.shift_date, s.start_time), '[]'::jsonb)
    from public.shift_assignments a
    join public.shifts s on s.id = a.shift_id
   where a.staff_id = p_staff
     and not (a.id = any (coalesce(p_ignore_assignments, '{}'::uuid[])))
     and (p_ignore_shift is null or s.id <> p_ignore_shift)
     and s.shift_date between (lower(p_range)::date - 1) and (upper(p_range)::date + 1)
     and public.sched_range(s.shift_date, s.start_time, s.end_time) && p_range;
$$;

-- Serialises everything that decides "is this person free?" for one person.
create or replace function public.sched_lock_staff(p_staff uuid)
returns void
language sql
as $$
  select pg_advisory_xact_lock(hashtext('sched:staff:' || p_staff::text));
$$;

-- Several people at once, ALWAYS in the same (sorted) order — two decisions that each need the same
-- two people can then never wait on each other in opposite order (a deadlock).
create or replace function public.sched_lock_staff_many(p_staff uuid[])
returns void
language plpgsql
as $$
declare
  v uuid;
begin
  for v in select distinct x from unnest(coalesce(p_staff, '{}'::uuid[])) as x where x is not null order by x loop
    perform public.sched_lock_staff(v);
  end loop;
end;
$$;

-- The backstop. Deferred, so a multi-row change (an exchange swaps two people
-- between two shifts) is judged on the FINAL state, not row by row.
create or replace function public.sched_assignment_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_range tsrange;
begin
  if new.staff_id is null then
    return null;
  end if;
  if not exists (select 1 from public.shift_assignments a where a.id = new.id) then
    return null; -- inserted and removed again within the same transaction
  end if;
  perform public.sched_lock_staff(new.staff_id);
  select public.sched_range(s.shift_date, s.start_time, s.end_time) into v_range from public.shifts s where s.id = new.shift_id;
  if v_range is null then
    return null;
  end if;
  if jsonb_array_length(public.sched_conflicts(new.staff_id, v_range, array[new.id], null)) > 0 then
    raise exception 'sched_overlap';
  end if;
  return null;
end;
$$;

create or replace function public.sched_shift_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  r record;
  v_range tsrange;
begin
  if not exists (select 1 from public.shifts x where x.id = new.id) then
    return null;
  end if;
  v_range := public.sched_range(new.shift_date, new.start_time, new.end_time);
  for r in select a.id, a.staff_id from public.shift_assignments a where a.shift_id = new.id and a.staff_id is not null loop
    perform public.sched_lock_staff(r.staff_id);
    if jsonb_array_length(public.sched_conflicts(r.staff_id, v_range, array[r.id], null)) > 0 then
      raise exception 'sched_overlap';
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists shift_assignments_no_overlap on public.shift_assignments;
create constraint trigger shift_assignments_no_overlap
  after insert or update of staff_id, shift_id on public.shift_assignments
  deferrable initially deferred
  for each row execute function public.sched_assignment_guard();

drop trigger if exists shifts_no_overlap on public.shifts;
create constraint trigger shifts_no_overlap
  after update of shift_date, start_time, end_time on public.shifts
  deferrable initially deferred
  for each row execute function public.sched_shift_guard();

-- ---------------------------------------------------------------------
-- I. Published-snapshot patching. Staff read ONLY the frozen snapshot, so an
--    approved swap / request must be written there too, but nothing else the
--    manager has drafted since may leak out with it.
-- ---------------------------------------------------------------------
create or replace function public.sched_in_snapshot(p_week uuid, p_kind text, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.schedule_weeks w, jsonb_array_elements(w.published_snapshot -> p_kind) e(v)
     where w.id = p_week and w.status = 'published' and e.v ->> 'id' = p_id::text);
$$;

create or replace function public.sched_snapshot_set_assignee(p_week uuid, p_assignment uuid, p_staff uuid, p_name text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.schedule_weeks w
     set published_snapshot = jsonb_set(
           w.published_snapshot, '{assignments}',
           coalesce((select jsonb_agg(case when e.v ->> 'id' = p_assignment::text
                                           then e.v || jsonb_build_object('staff_id', p_staff, 'staff_name', p_name)
                                           else e.v end)
                       from jsonb_array_elements(w.published_snapshot -> 'assignments') e(v)), '[]'::jsonb))
   where w.id = p_week and w.status = 'published' and w.published_snapshot is not null;
$$;

create or replace function public.sched_snapshot_add_assignment(p_week uuid, p_assignment uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.schedule_weeks w
     set published_snapshot = jsonb_set(
           w.published_snapshot, '{assignments}',
           coalesce(w.published_snapshot -> 'assignments', '[]'::jsonb) || (select to_jsonb(a) from public.shift_assignments a where a.id = p_assignment))
   where w.id = p_week and w.status = 'published' and w.published_snapshot is not null
     and exists (select 1 from jsonb_array_elements(w.published_snapshot -> 'shifts') s(v)
                  where s.v ->> 'id' = (select a.shift_id::text from public.shift_assignments a where a.id = p_assignment))
     and not exists (select 1 from jsonb_array_elements(w.published_snapshot -> 'assignments') x(v) where x.v ->> 'id' = p_assignment::text);
$$;

-- ---------------------------------------------------------------------
-- J. Invalidation: what a schedule change does to open requests / swaps
-- ---------------------------------------------------------------------
create or replace function public.sched_assignment_terms(p_assignment uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'assignmentId', a.id, 'shiftId', s.id, 'weekId', s.week_id, 'branchId', s.branch_id,
           'date', s.shift_date, 'start', s.start_time, 'end', s.end_time, 'presetId', s.preset_id,
           'roleId', a.role_id, 'staffId', a.staff_id,
           'staffName', coalesce(public.sched_name(a.staff_id), a.staff_name),
           'label', public.sched_fmt(s.shift_date, s.start_time, s.end_time))
    from public.shift_assignments a join public.shifts s on s.id = a.shift_id
   where a.id = p_assignment;
$$;

-- Cancel every live swap that involves this assignment (either side) and tell
-- the people it affected. The swap row survives as history.
create or replace function public.sched_cancel_swaps_for_assignment(p_assignment uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select * from public.shift_swaps
     where (assignment_id = p_assignment or return_assignment_id = p_assignment) and status in ('open', 'peer_accepted')
     for update
  loop
    update public.shift_swaps
       set status = 'cancelled', cancel_reason = p_reason, decided_at = now(), updated_at = now()
     where id = r.id;
    n := n + 1;
    perform public.sched_notify(r.branch_id, array_remove(array[r.from_staff_id, r.to_staff_id], null),
      'swap.cancelled', 'בקשת ההחלפה בוטלה',
      p_reason || coalesce(' · ' || (r.terms -> 'from' ->> 'label'), ''), jsonb_build_object('tab', 'requests'));
    if r.status = 'peer_accepted' then
      perform public.sched_notify(r.branch_id, public.sched_manager_ids(r.branch_id),
        'swap.cancelled', 'בקשת החלפה שהמתינה לאישור בוטלה', p_reason, jsonb_build_object('tab', 'requests'));
    end if;
  end loop;
  return n;
end;
$$;

create or replace function public.sched_cancel_requests_for_shifts(p_shifts uuid[], p_reason text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select * from public.shift_requests where shift_id = any (p_shifts) and status = 'pending' for update
  loop
    update public.shift_requests
       set status = 'cancelled', cancel_reason = p_reason, decided_at = now(), updated_at = now()
     where id = r.id;
    n := n + 1;
    perform public.sched_notify(r.branch_id, array[r.staff_id], 'request.cancelled', 'הבקשה שלך בוטלה',
      p_reason || coalesce(' · ' || (r.terms ->> 'label'), ''), jsonb_build_object('tab', 'requests'));
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------
-- K. Saving a shift: ONE atomic action for "the sheet's Save button".
--    Times + station + needs + note + exactly who is on it. Either all of it
--    is applied or none of it is.
--    p_assignees: [{ assignmentId?: uuid, staffId: uuid, roleId?: text }]
--      with assignmentId  -> keep that person (role may change)
--      without            -> add that person
--      an existing assignment not listed -> removed
-- ---------------------------------------------------------------------
create or replace function public.sched_save_shift(
  p_actor uuid, p_week_id uuid, p_shift_id uuid,
  p_date date, p_start text, p_end text,
  p_preset_id text, p_station_id text, p_requirements jsonb, p_note text,
  p_assignees jsonb, p_expected_updated text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week public.schedule_weeks%rowtype;
  v_shift public.shifts%rowtype;
  v_branch uuid;
  v_range tsrange;
  v_time_changed boolean := false;
  v_item jsonb;
  v_staff uuid;
  v_aid uuid;
  v_role text;
  v_keep uuid[] := '{}';
  v_seen uuid[] := '{}';
  v_conflicts jsonb := '[]'::jsonb;
  v_conf jsonb;
  v_new_id uuid;
  v_added text[] := '{}';
  v_removed text[] := '{}';
  v_old_label text;
  v_ex record;
  v_assignment_id uuid;
  v_reqs jsonb := coalesce(p_requirements, '[]'::jsonb);
  v_list jsonb := coalesce(p_assignees, '[]'::jsonb);
begin
  select * into v_week from public.schedule_weeks where id = p_week_id for update;
  if not found then
    return public.sched_fail('not_found');
  end if;
  v_branch := v_week.branch_id;
  if not public.sched_can_manage(p_actor, v_branch) then
    return public.sched_fail('forbidden');
  end if;
  if p_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or p_end !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or p_start = p_end then
    return public.sched_fail('bad_time');
  end if;
  if p_date is null or p_date < v_week.week_start or p_date > v_week.week_start + 6 then
    return public.sched_fail('bad_date');
  end if;
  if jsonb_typeof(v_reqs) <> 'array' or jsonb_typeof(v_list) <> 'array' or jsonb_array_length(v_list) > 60 then
    return public.sched_fail('bad_request');
  end if;
  if p_note is not null and char_length(p_note) > 300 then
    return public.sched_fail('bad_request');
  end if;

  if p_shift_id is not null then
    select * into v_shift from public.shifts where id = p_shift_id for update;
    if not found or v_shift.week_id <> p_week_id then
      return public.sched_fail('not_found');
    end if;
    if p_expected_updated is not null and v_shift.updated_at <> p_expected_updated::timestamptz then
      return public.sched_fail('stale');
    end if;
    v_time_changed := (v_shift.shift_date <> p_date or v_shift.start_time <> p_start or v_shift.end_time <> p_end);
    v_old_label := public.sched_fmt(v_shift.shift_date, v_shift.start_time, v_shift.end_time);
  end if;

  v_range := public.sched_range(p_date, p_start, p_end);

  -- Everyone this save touches is locked first, in a fixed order, so two managers editing different
  -- weeks that share a person cannot deadlock — and so each "is this person free?" answer below is final.
  perform public.sched_lock_staff_many(array(select (e.v ->> 'staffId')::uuid from jsonb_array_elements(v_list) e(v)));

  -- ---- validate the people (no writes yet) ----
  for v_item in select * from jsonb_array_elements(v_list) loop
    v_staff := (v_item ->> 'staffId')::uuid;
    v_aid := nullif(v_item ->> 'assignmentId', '')::uuid;
    if v_staff = any (v_seen) then
      return public.sched_fail('duplicate_person', jsonb_build_object('staffId', v_staff, 'name', public.sched_name(v_staff)));
    end if;
    v_seen := v_seen || v_staff;

    if v_aid is not null then
      -- an existing assignment being kept: must really be on this shift
      if not exists (select 1 from public.shift_assignments a where a.id = v_aid and a.shift_id = p_shift_id) then
        return public.sched_fail('stale');
      end if;
      v_keep := v_keep || v_aid;
    else
      if not exists (select 1 from public.staff s where s.id = v_staff and s.active) then
        return public.sched_fail('inactive_staff', jsonb_build_object('staffId', v_staff, 'name', public.sched_name(v_staff)));
      end if;
      if not public.sched_can_view(v_staff, v_branch) then
        return public.sched_fail('wrong_branch', jsonb_build_object('staffId', v_staff, 'name', public.sched_name(v_staff)));
      end if;
      if exists (select 1 from public.schedule_members m where m.branch_id = v_branch and m.staff_id = v_staff and not m.schedulable) then
        return public.sched_fail('not_schedulable', jsonb_build_object('staffId', v_staff, 'name', public.sched_name(v_staff)));
      end if;
    end if;

    if v_aid is null or v_time_changed then
      perform public.sched_lock_staff(v_staff);
      v_conf := public.sched_conflicts(v_staff, v_range, '{}', p_shift_id);
      if jsonb_array_length(v_conf) > 0 then
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
          'staffId', v_staff, 'name', public.sched_name(v_staff), 'with', v_conf -> 0));
      end if;
    end if;
  end loop;
  if jsonb_array_length(v_conflicts) > 0 then
    return public.sched_fail('conflict', jsonb_build_object('conflicts', v_conflicts));
  end if;

  -- ---- write ----
  if p_shift_id is null then
    insert into public.shifts (branch_id, week_id, shift_date, start_time, end_time, preset_id, station_id, requirements, note)
    values (v_branch, p_week_id, p_date, p_start, p_end, nullif(p_preset_id, ''), nullif(p_station_id, ''), v_reqs, nullif(btrim(coalesce(p_note, '')), ''))
    returning id into v_new_id;
  else
    v_new_id := p_shift_id;
    update public.shifts
       set shift_date = p_date, start_time = p_start, end_time = p_end,
           preset_id = nullif(p_preset_id, ''), station_id = nullif(p_station_id, ''),
           requirements = v_reqs, note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now()
     where id = p_shift_id;

    -- people no longer listed are removed (their open swaps are cancelled first)
    for v_ex in
      select a.id, a.staff_id, a.staff_name from public.shift_assignments a
       where a.shift_id = p_shift_id and not (a.id = any (v_keep))
    loop
      perform public.sched_cancel_swaps_for_assignment(v_ex.id, 'השיבוץ במשמרת הוסר');
      delete from public.shift_assignments where id = v_ex.id;
      v_removed := v_removed || coalesce(public.sched_name(v_ex.staff_id), v_ex.staff_name, 'עובד/ת שהוסר/ה');
    end loop;

    if v_time_changed then
      for v_ex in select a.id from public.shift_assignments a where a.shift_id = p_shift_id loop
        perform public.sched_cancel_swaps_for_assignment(v_ex.id, 'יום או שעות המשמרת השתנו');
      end loop;
    end if;
  end if;

  for v_item in select * from jsonb_array_elements(v_list) loop
    v_staff := (v_item ->> 'staffId')::uuid;
    v_aid := nullif(v_item ->> 'assignmentId', '')::uuid;
    v_role := nullif(btrim(coalesce(v_item ->> 'roleId', '')), '');
    if v_aid is not null then
      update public.shift_assignments set role_id = v_role where id = v_aid and role_id is distinct from v_role;
    else
      insert into public.shift_assignments (branch_id, shift_id, staff_id, staff_name, role_id)
      values (v_branch, v_new_id, v_staff, public.sched_name(v_staff), v_role)
      returning id into v_assignment_id;
      v_added := v_added || public.sched_name(v_staff);
      -- A pending request for exactly this shift is answered by the manager
      -- simply putting the person on it.
      for v_ex in select r.id, r.staff_id from public.shift_requests r
                   where r.shift_id = v_new_id and r.staff_id = v_staff and r.status = 'pending' for update loop
        update public.shift_requests
           set status = 'approved', decided_at = now(), decided_by_staff = p_actor, decision_note = 'שובצ/ה ישירות על ידי המנהל/ת', updated_at = now()
         where id = v_ex.id;
        perform public.sched_notify(v_branch, array[v_staff], 'request.approved', 'הבקשה שלך אושרה',
          public.sched_fmt(p_date, p_start, p_end), jsonb_build_object('tab', 'schedule', 'weekStart', v_week.week_start));
      end loop;
    end if;
  end loop;

  set constraints all immediate;
  set constraints all deferred;

  perform public.sched_log(v_branch, p_actor,
    case when p_shift_id is null then 'shift.create' else 'shift.update' end,
    case when p_shift_id is null
         then 'יצר/ה משמרת: ' || public.sched_fmt(p_date, p_start, p_end)
         else 'עדכן/ה משמרת: ' || coalesce(v_old_label, '') ||
              case when v_time_changed then ' → ' || public.sched_fmt(p_date, p_start, p_end) else '' end end ||
         case when coalesce(array_length(v_added, 1), 0) > 0 then ' · שובצו: ' || array_to_string(v_added, ', ') else '' end ||
         case when coalesce(array_length(v_removed, 1), 0) > 0 then ' · הוסרו: ' || array_to_string(v_removed, ', ') else '' end,
    jsonb_build_object('shiftId', v_new_id, 'weekId', p_week_id, 'added', v_added, 'removed', v_removed));

  return jsonb_build_object('ok', true, 'shiftId', v_new_id, 'created', p_shift_id is null, 'added', v_added, 'removed', v_removed);
exception when others then
  if sqlerrm = 'sched_overlap' then
    return public.sched_fail('conflict');
  end if;
  if sqlstate in ('22P02', '22007', '22008', '22023') then
    return public.sched_fail('bad_request');
  end if;
  raise;
end;
$$;

create or replace function public.sched_delete_shift(p_actor uuid, p_shift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift public.shifts%rowtype;
  v_week public.schedule_weeks%rowtype;
  v_ex record;
  v_people integer;
  v_requests integer;
begin
  select * into v_shift from public.shifts where id = p_shift_id;
  if not found then
    return public.sched_fail('not_found');
  end if;
  select * into v_week from public.schedule_weeks where id = v_shift.week_id for update;
  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found then
    return public.sched_fail('not_found');
  end if;
  if not public.sched_can_manage(p_actor, v_shift.branch_id) then
    return public.sched_fail('forbidden');
  end if;

  select count(*) into v_people from public.shift_assignments where shift_id = p_shift_id;
  for v_ex in select a.id from public.shift_assignments a where a.shift_id = p_shift_id loop
    perform public.sched_cancel_swaps_for_assignment(v_ex.id, 'המשמרת בוטלה');
  end loop;
  v_requests := public.sched_cancel_requests_for_shifts(array[p_shift_id], 'המשמרת בוטלה');
  delete from public.shifts where id = p_shift_id;

  perform public.sched_log(v_shift.branch_id, p_actor, 'shift.delete',
    'מחק/ה משמרת: ' || public.sched_fmt(v_shift.shift_date, v_shift.start_time, v_shift.end_time)
      || case when v_people > 0 then ' (היו משובצים ' || v_people || ')' else '' end,
    jsonb_build_object('shiftId', p_shift_id, 'people', v_people));
  return jsonb_build_object('ok', true, 'people', v_people, 'requestsCancelled', v_requests);
end;
$$;

-- Move one person from their shift to another shift of the same branch.
create or replace function public.sched_move_assignment(p_actor uuid, p_assignment uuid, p_to_shift uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a public.shift_assignments%rowtype;
  v_from public.shifts%rowtype;
  v_to public.shifts%rowtype;
  v_w1 uuid;
  v_w2 uuid;
  v_conf jsonb;
begin
  select * into v_a from public.shift_assignments where id = p_assignment;
  if not found then
    return public.sched_fail('not_found');
  end if;
  select * into v_from from public.shifts where id = v_a.shift_id;
  select * into v_to from public.shifts where id = p_to_shift;
  if v_to.id is null or v_to.branch_id <> v_from.branch_id then
    return public.sched_fail('not_found');
  end if;
  if not public.sched_can_manage(p_actor, v_from.branch_id) then
    return public.sched_fail('forbidden');
  end if;

  -- lock both weeks in a fixed order (no deadlock between two managers)
  v_w1 := least(v_from.week_id, v_to.week_id);
  v_w2 := greatest(v_from.week_id, v_to.week_id);
  perform 1 from public.schedule_weeks where id in (v_w1, v_w2) order by id for update;
  select * into v_a from public.shift_assignments where id = p_assignment for update;
  if not found or v_a.shift_id <> v_from.id then
    return public.sched_fail('stale');
  end if;
  if v_a.staff_id is null then
    return public.sched_fail('bad_request');
  end if;
  if v_to.id = v_from.id then
    return public.sched_fail('bad_request');
  end if;
  if exists (select 1 from public.shift_assignments x where x.shift_id = v_to.id and x.staff_id = v_a.staff_id) then
    return public.sched_fail('already_assigned', jsonb_build_object('name', public.sched_name(v_a.staff_id)));
  end if;
  perform public.sched_lock_staff(v_a.staff_id);
  v_conf := public.sched_conflicts(v_a.staff_id, public.sched_range(v_to.shift_date, v_to.start_time, v_to.end_time), array[v_a.id], null);
  if jsonb_array_length(v_conf) > 0 then
    return public.sched_fail('conflict', jsonb_build_object('conflicts', jsonb_build_array(jsonb_build_object(
      'staffId', v_a.staff_id, 'name', public.sched_name(v_a.staff_id), 'with', v_conf -> 0))));
  end if;

  perform public.sched_cancel_swaps_for_assignment(v_a.id, 'השיבוץ הועבר למשמרת אחרת');
  update public.shift_assignments set shift_id = v_to.id where id = v_a.id;
  update public.shifts set updated_at = now() where id in (v_from.id, v_to.id);

  set constraints all immediate;
  set constraints all deferred;

  perform public.sched_log(v_from.branch_id, p_actor, 'shift.move',
    'העביר/ה את ' || coalesce(public.sched_name(v_a.staff_id), 'עובד/ת') || ' מ' ||
      public.sched_fmt(v_from.shift_date, v_from.start_time, v_from.end_time) || ' אל ' ||
      public.sched_fmt(v_to.shift_date, v_to.start_time, v_to.end_time),
    jsonb_build_object('assignmentId', v_a.id, 'from', v_from.id, 'to', v_to.id));
  return jsonb_build_object('ok', true);
exception when others then
  if sqlerrm = 'sched_overlap' then
    return public.sched_fail('conflict');
  end if;
  raise;
end;
$$;

-- ---------------------------------------------------------------------
-- L. Weeks: publish / unpublish / clear / copy
-- ---------------------------------------------------------------------
create or replace function public.sched_publish_week(p_actor uuid, p_week_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week public.schedule_weeks%rowtype;
  v_snap jsonb;
  v_old jsonb;
  v_update boolean;
  v_notified integer := 0;
  r record;
begin
  select * into v_week from public.schedule_weeks where id = p_week_id for update;
  if not found then
    return public.sched_fail('not_found');
  end if;
  if not public.sched_can_manage(p_actor, v_week.branch_id) then
    return public.sched_fail('forbidden');
  end if;

  v_old := v_week.published_snapshot;
  v_update := (v_week.status = 'published' and v_old is not null);

  select jsonb_build_object(
    'shifts', coalesce((select jsonb_agg(to_jsonb(s)) from public.shifts s where s.week_id = p_week_id), '[]'::jsonb),
    'assignments', coalesce((select jsonb_agg(to_jsonb(a)) from public.shift_assignments a
                              where a.shift_id in (select id from public.shifts where week_id = p_week_id)), '[]'::jsonb))
    into v_snap;

  -- Who is affected, and how — told to them in plain words.
  for r in
    with newr as (
      select (a.v ->> 'staff_id')::uuid as staff_id, (s.v ->> 'id')::uuid as shift_id,
             (s.v ->> 'shift_date')::date as d, s.v ->> 'start_time' as st, s.v ->> 'end_time' as en
        from jsonb_array_elements(v_snap -> 'assignments') a(v)
        join jsonb_array_elements(v_snap -> 'shifts') s(v) on s.v ->> 'id' = a.v ->> 'shift_id'
       where a.v ->> 'staff_id' is not null),
    oldr as (
      select (a.v ->> 'staff_id')::uuid as staff_id, (s.v ->> 'id')::uuid as shift_id,
             (s.v ->> 'shift_date')::date as d, s.v ->> 'start_time' as st, s.v ->> 'end_time' as en
        from jsonb_array_elements(case when v_update then v_old -> 'assignments' else '[]'::jsonb end) a(v)
        join jsonb_array_elements(case when v_update then v_old -> 'shifts' else '[]'::jsonb end) s(v) on s.v ->> 'id' = a.v ->> 'shift_id'
       where a.v ->> 'staff_id' is not null),
    diff as (
      select coalesce(n.staff_id, o.staff_id) as staff_id,
             coalesce(n.d, o.d) as d, coalesce(n.st, o.st) as st,
             case when not v_update then 'משמרת: ' || public.sched_fmt(n.d, n.st, n.en)
                  when o.shift_id is null then 'נוספה: ' || public.sched_fmt(n.d, n.st, n.en)
                  when n.shift_id is null then 'הוסרה: ' || public.sched_fmt(o.d, o.st, o.en)
                  else 'השתנתה: ' || public.sched_fmt(n.d, n.st, n.en) || ' (היה ' || public.sched_range_text(o.st, o.en) || ')' end as line
        from newr n full join oldr o on o.staff_id = n.staff_id and o.shift_id = n.shift_id
       where not v_update or o.shift_id is null or n.shift_id is null
          or (o.d, o.st, o.en) is distinct from (n.d, n.st, n.en))
    select staff_id, string_agg(line, E'\n' order by d, st) as lines from diff group by staff_id
  loop
    perform public.sched_notify(v_week.branch_id, array[r.staff_id], 'schedule.published',
      case when v_update then 'הלוח שלך עודכן' else 'פורסם לוח משמרות' end,
      'שבוע ' || to_char(v_week.week_start, 'FMDD/FMMM') || E'\n' || r.lines,
      jsonb_build_object('tab', 'schedule', 'weekStart', v_week.week_start));
    v_notified := v_notified + 1;
  end loop;

  update public.schedule_weeks
     set status = 'published', version = version + 1, published_at = now(),
         published_by = (select auth_user_id from public.staff where id = p_actor),
         published_snapshot = v_snap, updated_at = now()
   where id = p_week_id;

  perform public.sched_log(v_week.branch_id, p_actor, 'schedule.publish',
    case when v_update then 'פרסם/ה עדכון ללוח שבוע ' else 'פרסם/ה את לוח שבוע ' end || to_char(v_week.week_start, 'FMDD/FMMM'),
    jsonb_build_object('weekId', p_week_id, 'notified', v_notified));
  return jsonb_build_object('ok', true, 'version', v_week.version + 1, 'notified', v_notified, 'update', v_update);
end;
$$;

create or replace function public.sched_unpublish_week(p_actor uuid, p_week_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week public.schedule_weeks%rowtype;
  v_ex record;
  v_swaps integer := 0;
  v_reqs integer;
begin
  select * into v_week from public.schedule_weeks where id = p_week_id for update;
  if not found then
    return public.sched_fail('not_found');
  end if;
  if not public.sched_can_manage(p_actor, v_week.branch_id) then
    return public.sched_fail('forbidden');
  end if;
  for v_ex in select a.id from public.shift_assignments a join public.shifts s on s.id = a.shift_id where s.week_id = p_week_id loop
    v_swaps := v_swaps + public.sched_cancel_swaps_for_assignment(v_ex.id, 'הלוח הוחזר לטיוטה');
  end loop;
  v_reqs := public.sched_cancel_requests_for_shifts(array(select id from public.shifts where week_id = p_week_id), 'הלוח הוחזר לטיוטה');
  update public.schedule_weeks set status = 'draft', updated_at = now() where id = p_week_id;
  perform public.sched_log(v_week.branch_id, p_actor, 'schedule.unpublish',
    'ביטל/ה את פרסום לוח שבוע ' || to_char(v_week.week_start, 'FMDD/FMMM'), jsonb_build_object('weekId', p_week_id));
  return jsonb_build_object('ok', true, 'swapsCancelled', v_swaps, 'requestsCancelled', v_reqs);
end;
$$;

create or replace function public.sched_clear_week(p_actor uuid, p_week_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week public.schedule_weeks%rowtype;
  v_ex record;
  v_count integer;
begin
  select * into v_week from public.schedule_weeks where id = p_week_id for update;
  if not found then
    return public.sched_fail('not_found');
  end if;
  if not public.sched_can_manage(p_actor, v_week.branch_id) then
    return public.sched_fail('forbidden');
  end if;
  for v_ex in select a.id from public.shift_assignments a join public.shifts s on s.id = a.shift_id where s.week_id = p_week_id loop
    perform public.sched_cancel_swaps_for_assignment(v_ex.id, 'השבוע נוקה');
  end loop;
  perform public.sched_cancel_requests_for_shifts(array(select id from public.shifts where week_id = p_week_id), 'השבוע נוקה');
  select count(*) into v_count from public.shifts where week_id = p_week_id;
  delete from public.shifts where week_id = p_week_id;
  perform public.sched_log(v_week.branch_id, p_actor, 'schedule.clear',
    'ניקה/תה את לוח שבוע ' || to_char(v_week.week_start, 'FMDD/FMMM') || ' (' || v_count || ' משמרות)',
    jsonb_build_object('weekId', p_week_id, 'shifts', v_count));
  return jsonb_build_object('ok', true, 'shifts', v_count);
end;
$$;

-- Copy a week onto another, REPLACING the target's shifts. People who cannot be
-- copied (inactive, not schedulable, or already busy at that time elsewhere) are
-- skipped and reported — never silently double-booked.
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

-- ---------------------------------------------------------------------
-- M. Per-person scheduling flags (explicit actor, audited, and "absent key =
--    unchanged / null = clear" for every field — the old coalesce() could never
--    clear a default role).
-- ---------------------------------------------------------------------
create or replace function public.sched_set_member(p_actor uuid, p_branch uuid, p_staff uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
begin
  if not public.sched_can_manage(p_actor, p_branch) then
    return public.sched_fail('forbidden');
  end if;
  if not exists (select 1 from public.staff s where s.id = p_staff) or not public.sched_can_view(p_staff, p_branch) then
    return public.sched_fail('not_found');
  end if;
  if jsonb_typeof(p_patch) <> 'object' then
    return public.sched_fail('bad_request');
  end if;
  if (p_patch ? 'maxWeeklyHours') and (p_patch ->> 'maxWeeklyHours') is not null
     and ((p_patch ->> 'maxWeeklyHours') !~ '^[0-9]{1,3}$' or (p_patch ->> 'maxWeeklyHours')::int > 168) then
    return public.sched_fail('bad_request');
  end if;

  select to_jsonb(m) into v_before from public.schedule_members m where m.branch_id = p_branch and m.staff_id = p_staff;

  insert into public.schedule_members (branch_id, staff_id, schedulable, default_role_id, max_weekly_hours, employment_type, sort_order, note, updated_at)
  values (
    p_branch, p_staff,
    coalesce((p_patch ->> 'schedulable')::boolean, true),
    p_patch ->> 'defaultRoleId',
    (p_patch ->> 'maxWeeklyHours')::integer,
    p_patch ->> 'employmentType',
    (p_patch ->> 'sortOrder')::integer,
    p_patch ->> 'note',
    now())
  on conflict (branch_id, staff_id) do update set
    schedulable      = case when p_patch ? 'schedulable'     then coalesce((p_patch ->> 'schedulable')::boolean, true) else schedule_members.schedulable end,
    default_role_id  = case when p_patch ? 'defaultRoleId'   then p_patch ->> 'defaultRoleId'            else schedule_members.default_role_id end,
    max_weekly_hours = case when p_patch ? 'maxWeeklyHours'  then (p_patch ->> 'maxWeeklyHours')::integer else schedule_members.max_weekly_hours end,
    employment_type  = case when p_patch ? 'employmentType'  then p_patch ->> 'employmentType'           else schedule_members.employment_type end,
    sort_order       = case when p_patch ? 'sortOrder'       then (p_patch ->> 'sortOrder')::integer      else schedule_members.sort_order end,
    note             = case when p_patch ? 'note'            then p_patch ->> 'note'                      else schedule_members.note end,
    updated_at       = now();

  perform public.sched_log(p_branch, p_actor, 'member.update',
    'עדכן/ה הגדרות שיבוץ: ' || coalesce(public.sched_name(p_staff), 'איש/אשת צוות'),
    jsonb_build_object('staffId', p_staff, 'before', v_before, 'patch', p_patch));
  return jsonb_build_object('ok', true);
exception when others then
  if sqlstate in ('22P02', '22023') then
    return public.sched_fail('bad_request');
  end if;
  raise;
end;
$$;

-- ---------------------------------------------------------------------
-- N. Shift requests: "I would like to work this shift"
-- ---------------------------------------------------------------------
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
  -- employees only know the published schedule
  if not public.sched_in_snapshot(v_shift.week_id, 'shifts', v_shift.id) then
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
  if v_needed > 0 and v_assigned >= v_needed then
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
     where av.branch_id = v_shift.branch_id and av.staff_id = p_actor and av.week_start = v_week.week_start
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
    jsonb_build_object('tab', 'requests', 'shiftId', v_shift.id));
  perform public.sched_log(v_shift.branch_id, p_actor, 'request.create',
    'ביקש/ה להצטרף למשמרת: ' || v_label, jsonb_build_object('requestId', v_id, 'shiftId', v_shift.id));
  return jsonb_build_object('ok', true, 'requestId', v_id);
exception when unique_violation then
  return public.sched_fail('duplicate_request');
end;
$$;

create or replace function public.sched_cancel_request(p_actor uuid, p_request uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.shift_requests%rowtype;
begin
  select * into v_req from public.shift_requests where id = p_request for update;
  if not found then
    return public.sched_fail('not_found');
  end if;
  if v_req.staff_id <> p_actor then
    return public.sched_fail('forbidden');
  end if;
  if v_req.status <> 'pending' then
    return public.sched_fail('not_pending');
  end if;
  update public.shift_requests
     set status = 'cancelled', cancel_reason = 'בוטלה על ידי העובד/ת', decided_at = now(), updated_at = now()
   where id = p_request;
  perform public.sched_notify(v_req.branch_id, array_remove(public.sched_manager_ids(v_req.branch_id), p_actor),
    'request.cancelled', public.sched_name(p_actor) || ' ביטל/ה בקשה להצטרף למשמרת', v_req.terms ->> 'label',
    jsonb_build_object('tab', 'requests'));
  perform public.sched_log(v_req.branch_id, p_actor, 'request.cancel',
    'ביטל/ה בקשה להצטרף למשמרת: ' || coalesce(v_req.terms ->> 'label', ''), jsonb_build_object('requestId', p_request));
  return jsonb_build_object('ok', true);
end;
$$;

-- Manager decision. Reject needs nothing. Approve re-checks EVERYTHING against
-- the schedule as it is now:
--   hard stops  (can never be forced): the shift is gone / already started, the
--               person is inactive or already on it, or already busy then;
--   soft issues (need an explicit p_force = true, i.e. the manager saw them):
--               shift already full / already has people, the person marked that
--               day unavailable, the shift's time changed since the request.
create or replace function public.sched_decide_request(p_actor uuid, p_request uuid, p_approve boolean, p_note text, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.shift_requests%rowtype;
  v_shift public.shifts%rowtype;
  v_week public.schedule_weeks%rowtype;
  v_issues jsonb := '[]'::jsonb;
  v_conf jsonb;
  v_needed integer;
  v_assigned integer;
  v_names text;
  v_role text;
  v_new uuid;
  v_label text;
begin
  select * into v_req from public.shift_requests where id = p_request;
  if not found then
    return public.sched_fail('not_found');
  end if;
  if not public.sched_can_manage(p_actor, v_req.branch_id) then
    return public.sched_fail('forbidden');
  end if;
  if v_req.shift_id is not null then
    select * into v_shift from public.shifts where id = v_req.shift_id;
    if found then
      select * into v_week from public.schedule_weeks where id = v_shift.week_id for update;
    end if;
  end if;
  select * into v_req from public.shift_requests where id = p_request for update;
  if v_req.status <> 'pending' then
    return public.sched_fail('not_pending');
  end if;
  if p_note is not null and char_length(p_note) > 300 then
    return public.sched_fail('bad_request');
  end if;

  if not p_approve then
    update public.shift_requests
       set status = 'rejected', decision_note = nullif(btrim(coalesce(p_note, '')), ''), decided_at = now(), decided_by_staff = p_actor, updated_at = now()
     where id = p_request;
    perform public.sched_notify(v_req.branch_id, array[v_req.staff_id], 'request.rejected', 'הבקשה שלך לא אושרה',
      coalesce(v_req.terms ->> 'label', '') || coalesce(E'\n' || nullif(btrim(coalesce(p_note, '')), ''), ''),
      jsonb_build_object('tab', 'requests'));
    perform public.sched_log(v_req.branch_id, p_actor, 'request.reject',
      'דחה/תה בקשה של ' || coalesce(public.sched_name(v_req.staff_id), v_req.staff_name) || ' למשמרת ' || coalesce(v_req.terms ->> 'label', ''),
      jsonb_build_object('requestId', p_request));
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;

  -- ---- approve ----
  if v_shift.id is null then
    update public.shift_requests set status = 'cancelled', cancel_reason = 'המשמרת בוטלה', decided_at = now(), updated_at = now() where id = p_request;
    return public.sched_fail('shift_gone');
  end if;
  v_label := public.sched_fmt(v_shift.shift_date, v_shift.start_time, v_shift.end_time);
  if public.sched_is_past(v_shift.branch_id, v_shift.shift_date, v_shift.start_time) then
    return public.sched_fail('past');
  end if;
  if not exists (select 1 from public.staff s where s.id = v_req.staff_id and s.active) then
    return public.sched_fail('inactive_staff', jsonb_build_object('name', public.sched_name(v_req.staff_id)));
  end if;
  if exists (select 1 from public.schedule_members m where m.branch_id = v_shift.branch_id and m.staff_id = v_req.staff_id and not m.schedulable) then
    return public.sched_fail('not_schedulable', jsonb_build_object('name', public.sched_name(v_req.staff_id)));
  end if;
  if exists (select 1 from public.shift_assignments a where a.shift_id = v_shift.id and a.staff_id = v_req.staff_id) then
    return public.sched_fail('already_assigned', jsonb_build_object('name', public.sched_name(v_req.staff_id)));
  end if;
  perform public.sched_lock_staff(v_req.staff_id);
  v_conf := public.sched_conflicts(v_req.staff_id, public.sched_range(v_shift.shift_date, v_shift.start_time, v_shift.end_time), '{}', v_shift.id);
  if jsonb_array_length(v_conf) > 0 then
    return public.sched_fail('busy', jsonb_build_object('name', public.sched_name(v_req.staff_id), 'with', v_conf -> 0));
  end if;

  v_needed := public.sched_needed(v_shift.requirements);
  select count(*), string_agg(coalesce(public.sched_name(a.staff_id), a.staff_name, '—'), ', ')
    into v_assigned, v_names from public.shift_assignments a where a.shift_id = v_shift.id;
  if v_needed > 0 and v_assigned >= v_needed then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'full',
      'message', 'המשמרת כבר מאוישת במלואה (' || v_assigned || ' מתוך ' || v_needed || ')'));
  elsif v_needed = 0 and v_assigned > 0 then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'occupied',
      'message', 'במשמרת כבר משובצים: ' || v_names));
  end if;
  if exists (
    select 1 from public.shift_availability av, jsonb_array_elements(av.entries) e(v)
     where av.branch_id = v_shift.branch_id and av.staff_id = v_req.staff_id and av.week_start = v_week.week_start
       and e.v ->> 'date' = v_shift.shift_date::text and e.v ->> 'kind' = 'unavailable'
  ) then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'unavailable',
      'message', coalesce(public.sched_name(v_req.staff_id), 'העובד/ת') || ' סימן/ה שאינו/ה זמין/ה ביום הזה'));
  end if;
  if (v_req.terms ->> 'start') is distinct from v_shift.start_time or (v_req.terms ->> 'end') is distinct from v_shift.end_time
     or (v_req.terms ->> 'date') is distinct from v_shift.shift_date::text then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'changed',
      'message', 'המשמרת השתנתה מאז הבקשה (היה ' || coalesce(v_req.terms ->> 'label', '') || ')'));
  end if;
  if jsonb_array_length(v_issues) > 0 and not coalesce(p_force, false) then
    return public.sched_fail('needs_confirmation', jsonb_build_object('issues', v_issues));
  end if;

  select m.default_role_id into v_role from public.schedule_members m where m.branch_id = v_shift.branch_id and m.staff_id = v_req.staff_id;
  if v_role is null then
    select q.v ->> 'roleId' into v_role
      from jsonb_array_elements(case when jsonb_typeof(v_shift.requirements) = 'array' then v_shift.requirements else '[]'::jsonb end) q(v)
     where coalesce(nullif(q.v ->> 'min', '')::int, 0) >
           (select count(*) from public.shift_assignments a where a.shift_id = v_shift.id and a.role_id = q.v ->> 'roleId')
     limit 1;
  end if;

  insert into public.shift_assignments (branch_id, shift_id, staff_id, staff_name, role_id)
  values (v_shift.branch_id, v_shift.id, v_req.staff_id, public.sched_name(v_req.staff_id), v_role)
  returning id into v_new;
  update public.shifts set updated_at = now() where id = v_shift.id;
  perform public.sched_snapshot_add_assignment(v_shift.week_id, v_new);

  update public.shift_requests
     set status = 'approved', decision_note = nullif(btrim(coalesce(p_note, '')), ''), decided_at = now(), decided_by_staff = p_actor, updated_at = now()
   where id = p_request;

  set constraints all immediate;
  set constraints all deferred;

  perform public.sched_notify(v_req.branch_id, array[v_req.staff_id], 'request.approved', 'הבקשה שלך אושרה',
    v_label || coalesce(E'\n' || nullif(btrim(coalesce(p_note, '')), ''), ''),
    jsonb_build_object('tab', 'schedule', 'weekStart', v_week.week_start));
  perform public.sched_log(v_req.branch_id, p_actor, 'request.approve',
    'אישר/ה בקשה של ' || coalesce(public.sched_name(v_req.staff_id), v_req.staff_name) || ' למשמרת ' || v_label,
    jsonb_build_object('requestId', p_request, 'assignmentId', v_new, 'forced', coalesce(p_force, false) and jsonb_array_length(v_issues) > 0));
  return jsonb_build_object('ok', true, 'status', 'approved', 'assignmentId', v_new);
exception when others then
  if sqlerrm = 'sched_overlap' then
    return public.sched_fail('busy', jsonb_build_object('name', public.sched_name(v_req.staff_id)));
  end if;
  raise;
end;
$$;

-- ---------------------------------------------------------------------
-- O. Shift swaps
--    open ──(peer accepts)──> peer_accepted ──(manager approves)──> approved
--      │  \──(peer declines)──> declined          └─(manager rejects)──> rejected
--      └──(requester / manager / schedule change)──> cancelled
--    A swap is either
--      * a hand-over    A gives a shift away, someone takes it     (no return shift)
--      * an exchange    A's shift for one of B's shifts            (return shift)
--    and either aimed at one named person (to_staff_id set) or open to anyone
--    (to_staff_id null until someone volunteers). Nothing in shift_assignments
--    changes until the manager approves.
-- ---------------------------------------------------------------------
create or replace function public.sched_request_swap(p_actor uuid, p_assignment uuid, p_target uuid, p_return uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a public.shift_assignments%rowtype;
  v_s public.shifts%rowtype;
  v_r public.shift_assignments%rowtype;
  v_rs public.shifts%rowtype;
  v_week public.schedule_weeks%rowtype;
  v_conf jsonb;
  v_id uuid;
  v_terms jsonb;
  v_w1 uuid;
  v_w2 uuid;
begin
  select * into v_a from public.shift_assignments where id = p_assignment;
  if not found then
    return public.sched_fail('not_found');
  end if;
  select * into v_s from public.shifts where id = v_a.shift_id;
  if p_return is not null then
    select * into v_r from public.shift_assignments where id = p_return;
    if not found then
      return public.sched_fail('not_found');
    end if;
    select * into v_rs from public.shifts where id = v_r.shift_id;
    v_w1 := least(v_s.week_id, v_rs.week_id);
    v_w2 := greatest(v_s.week_id, v_rs.week_id);
  else
    v_w1 := v_s.week_id;
    v_w2 := v_s.week_id;
  end if;
  perform 1 from public.schedule_weeks where id in (v_w1, v_w2) order by id for update;
  select * into v_week from public.schedule_weeks where id = v_s.week_id;
  select * into v_a from public.shift_assignments where id = p_assignment for update;
  if not found then
    return public.sched_fail('not_found');
  end if;

  if v_a.staff_id is distinct from p_actor then
    return public.sched_fail('forbidden');
  end if;
  if not public.sched_can_view(p_actor, v_s.branch_id) then
    return public.sched_fail('forbidden');
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

  if p_target is not null then
    if p_target = p_actor then
      return public.sched_fail('bad_target');
    end if;
    if not exists (select 1 from public.staff s where s.id = p_target and s.active) or not public.sched_can_view(p_target, v_s.branch_id) then
      return public.sched_fail('bad_target');
    end if;
    if exists (select 1 from public.schedule_members m where m.branch_id = v_s.branch_id and m.staff_id = p_target and not m.schedulable) then
      return public.sched_fail('target_not_schedulable', jsonb_build_object('name', public.sched_name(p_target)));
    end if;
    if exists (select 1 from public.shift_assignments x where x.shift_id = v_s.id and x.staff_id = p_target) then
      return public.sched_fail('target_already_on_shift', jsonb_build_object('name', public.sched_name(p_target)));
    end if;
    perform public.sched_lock_staff(p_target);
    v_conf := public.sched_conflicts(p_target, public.sched_range(v_s.shift_date, v_s.start_time, v_s.end_time),
                                     case when p_return is null then '{}'::uuid[] else array[p_return] end, null);
    if jsonb_array_length(v_conf) > 0 then
      return public.sched_fail('target_busy', jsonb_build_object('name', public.sched_name(p_target), 'with', v_conf -> 0));
    end if;
  end if;

  if p_return is not null then
    if p_target is null or v_r.staff_id is distinct from p_target or v_r.id = v_a.id then
      return public.sched_fail('bad_request');
    end if;
    if v_rs.branch_id <> v_s.branch_id then
      return public.sched_fail('bad_request');
    end if;
    if not public.sched_in_snapshot(v_rs.week_id, 'assignments', v_r.id) then
      return public.sched_fail('not_published');
    end if;
    if public.sched_is_past(v_rs.branch_id, v_rs.shift_date, v_rs.start_time) then
      return public.sched_fail('past');
    end if;
    if exists (select 1 from public.shift_swaps w where w.status in ('open', 'peer_accepted') and (w.assignment_id = v_r.id or w.return_assignment_id = v_r.id)) then
      return public.sched_fail('duplicate_swap');
    end if;
    if exists (select 1 from public.shift_assignments x where x.shift_id = v_rs.id and x.staff_id = p_actor) then
      return public.sched_fail('already_assigned', jsonb_build_object('name', public.sched_name(p_actor)));
    end if;
    perform public.sched_lock_staff(p_actor);
    v_conf := public.sched_conflicts(p_actor, public.sched_range(v_rs.shift_date, v_rs.start_time, v_rs.end_time), array[v_a.id], null);
    if jsonb_array_length(v_conf) > 0 then
      return public.sched_fail('actor_busy', jsonb_build_object('with', v_conf -> 0));
    end if;
  end if;

  v_terms := jsonb_build_object('from', public.sched_assignment_terms(v_a.id),
                                'to', case when p_return is null then null else public.sched_assignment_terms(v_r.id) end);
  insert into public.shift_swaps (branch_id, assignment_id, return_assignment_id, from_staff_id, to_staff_id, from_staff_name, to_staff_name, status, reason, terms)
  values (v_s.branch_id, v_a.id, p_return, p_actor, p_target, public.sched_name(p_actor),
          case when p_target is null then null else public.sched_name(p_target) end, 'open',
          nullif(btrim(coalesce(p_reason, '')), ''), v_terms)
  returning id into v_id;

  if p_target is not null then
    perform public.sched_notify(v_s.branch_id, array[p_target], 'swap.request',
      public.sched_name(p_actor) || ' מבקש/ת להחליף איתך משמרת',
      case when p_return is null
           then public.sched_name(p_actor) || ' מבקש/ת שתיקח/י את ' || (v_terms -> 'from' ->> 'label')
           else public.sched_name(p_actor) || ' נותן/ת: ' || (v_terms -> 'from' ->> 'label') || E'\n' || 'ומקבל/ת ממך: ' || (v_terms -> 'to' ->> 'label') end,
      jsonb_build_object('tab', 'requests', 'weekStart', v_week.week_start));
  end if;
  perform public.sched_log(v_s.branch_id, p_actor, 'swap.request',
    'ביקש/ה החלפת משמרת: ' || (v_terms -> 'from' ->> 'label') ||
      case when p_target is not null then ' (עם ' || public.sched_name(p_target) || ')' else ' (פתוח לכולם)' end,
    jsonb_build_object('swapId', v_id));
  return jsonb_build_object('ok', true, 'swapId', v_id);
exception when unique_violation then
  return public.sched_fail('duplicate_swap');
end;
$$;

-- The other side answers. A named person accepts/declines; for an open swap any
-- colleague may volunteer (and nobody "declines" an open offer — they just don't).
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
  if p_actor = v_sw.from_staff_id then
    return public.sched_fail('forbidden');
  end if;
  if v_sw.to_staff_id is not null and v_sw.to_staff_id <> p_actor then
    return public.sched_fail('forbidden');
  end if;

  if not p_accept then
    if v_sw.to_staff_id is null then
      return public.sched_fail('forbidden');
    end if;
    update public.shift_swaps set status = 'declined', peer_responded_at = now(), updated_at = now() where id = p_swap;
    perform public.sched_notify(v_sw.branch_id, array[v_sw.from_staff_id], 'swap.declined',
      public.sched_name(p_actor) || ' לא יכול/ה להחליף', v_sw.terms -> 'from' ->> 'label', jsonb_build_object('tab', 'requests'));
    perform public.sched_log(v_sw.branch_id, p_actor, 'swap.decline', 'סירב/ה להחלפת משמרת עם ' || coalesce(v_sw.from_staff_name, ''), jsonb_build_object('swapId', p_swap));
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
  if exists (select 1 from public.shift_assignments x where x.shift_id = v_s.id and x.staff_id = p_actor) then
    return public.sched_fail('already_assigned');
  end if;
  if exists (select 1 from public.schedule_members m where m.branch_id = v_s.branch_id and m.staff_id = p_actor and not m.schedulable) then
    return public.sched_fail('not_schedulable');
  end if;
  perform public.sched_lock_staff(p_actor);
  v_conf := public.sched_conflicts(p_actor, public.sched_range(v_s.shift_date, v_s.start_time, v_s.end_time),
                                   case when v_sw.return_assignment_id is null then '{}'::uuid[] else array[v_sw.return_assignment_id] end, null);
  if jsonb_array_length(v_conf) > 0 then
    return public.sched_fail('busy', jsonb_build_object('with', v_conf -> 0));
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

create or replace function public.sched_decide_swap(p_actor uuid, p_swap uuid, p_approve boolean, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sw public.shift_swaps%rowtype;
  v_a public.shift_assignments%rowtype;
  v_r public.shift_assignments%rowtype;
  v_s public.shifts%rowtype;
  v_rs public.shifts%rowtype;
  v_conf jsonb;
  v_w1 uuid;
  v_w2 uuid;
  v_to_name text;
  v_from_name text;
begin
  select * into v_sw from public.shift_swaps where id = p_swap;
  if not found then
    return public.sched_fail('not_found');
  end if;
  if not public.sched_can_manage(p_actor, v_sw.branch_id) then
    return public.sched_fail('forbidden');
  end if;
  if p_note is not null and char_length(p_note) > 300 then
    return public.sched_fail('bad_request');
  end if;

  if v_sw.assignment_id is not null then
    select * into v_a from public.shift_assignments where id = v_sw.assignment_id;
    select * into v_s from public.shifts where id = v_a.shift_id;
  end if;
  if v_sw.return_assignment_id is not null then
    select * into v_r from public.shift_assignments where id = v_sw.return_assignment_id;
    select * into v_rs from public.shifts where id = v_r.shift_id;
  end if;
  v_w1 := least(v_s.week_id, coalesce(v_rs.week_id, v_s.week_id));
  v_w2 := greatest(v_s.week_id, coalesce(v_rs.week_id, v_s.week_id));
  if v_w1 is not null then
    perform 1 from public.schedule_weeks where id in (v_w1, v_w2) order by id for update;
  end if;
  select * into v_sw from public.shift_swaps where id = p_swap for update;
  if v_sw.status <> 'peer_accepted' then
    return public.sched_fail('not_pending');
  end if;

  if not p_approve then
    update public.shift_swaps
       set status = 'rejected', decision_note = nullif(btrim(coalesce(p_note, '')), ''), decided_at = now(), decided_by_staff = p_actor, updated_at = now()
     where id = p_swap;
    perform public.sched_notify(v_sw.branch_id, array_remove(array[v_sw.from_staff_id, v_sw.to_staff_id], null), 'swap.rejected',
      'ההחלפה לא אושרה', coalesce(v_sw.terms -> 'from' ->> 'label', '') || coalesce(E'\n' || nullif(btrim(coalesce(p_note, '')), ''), ''),
      jsonb_build_object('tab', 'requests'));
    perform public.sched_log(v_sw.branch_id, p_actor, 'swap.reject',
      'דחה/תה החלפה בין ' || coalesce(v_sw.from_staff_name, '') || ' ל' || coalesce(v_sw.to_staff_name, ''), jsonb_build_object('swapId', p_swap));
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;

  -- ---- approve: re-validate against the schedule as it is NOW ----
  if v_a.id is null or v_a.staff_id is distinct from v_sw.from_staff_id
     or (v_sw.return_assignment_id is not null and (v_r.id is null or v_r.staff_id is distinct from v_sw.to_staff_id)) then
    return public.sched_fail('assignment_changed');
  end if;
  if v_sw.to_staff_id is null then
    return public.sched_fail('bad_request');
  end if;
  if public.sched_is_past(v_s.branch_id, v_s.shift_date, v_s.start_time)
     or (v_rs.id is not null and public.sched_is_past(v_rs.branch_id, v_rs.shift_date, v_rs.start_time)) then
    return public.sched_fail('past');
  end if;
  if not exists (select 1 from public.staff x where x.id = v_sw.from_staff_id and x.active)
     or not exists (select 1 from public.staff x where x.id = v_sw.to_staff_id and x.active) then
    return public.sched_fail('inactive_staff');
  end if;
  if exists (select 1 from public.shift_assignments x where x.shift_id = v_s.id and x.staff_id = v_sw.to_staff_id and x.id is distinct from v_r.id) then
    return public.sched_fail('already_assigned', jsonb_build_object('name', public.sched_name(v_sw.to_staff_id)));
  end if;
  if v_rs.id is not null and exists (select 1 from public.shift_assignments x where x.shift_id = v_rs.id and x.staff_id = v_sw.from_staff_id and x.id <> v_a.id) then
    return public.sched_fail('already_assigned', jsonb_build_object('name', public.sched_name(v_sw.from_staff_id)));
  end if;

  perform public.sched_lock_staff_many(array[v_sw.to_staff_id, v_sw.from_staff_id]);
  v_conf := public.sched_conflicts(v_sw.to_staff_id, public.sched_range(v_s.shift_date, v_s.start_time, v_s.end_time),
                                   case when v_r.id is null then '{}'::uuid[] else array[v_r.id] end, null);
  if jsonb_array_length(v_conf) > 0 then
    return public.sched_fail('conflict', jsonb_build_object('conflicts', jsonb_build_array(jsonb_build_object(
      'staffId', v_sw.to_staff_id, 'name', public.sched_name(v_sw.to_staff_id), 'with', v_conf -> 0))));
  end if;
  if v_rs.id is not null then
    v_conf := public.sched_conflicts(v_sw.from_staff_id, public.sched_range(v_rs.shift_date, v_rs.start_time, v_rs.end_time), array[v_a.id], null);
    if jsonb_array_length(v_conf) > 0 then
      return public.sched_fail('conflict', jsonb_build_object('conflicts', jsonb_build_array(jsonb_build_object(
        'staffId', v_sw.from_staff_id, 'name', public.sched_name(v_sw.from_staff_id), 'with', v_conf -> 0))));
    end if;
  end if;

  v_to_name := public.sched_name(v_sw.to_staff_id);
  v_from_name := public.sched_name(v_sw.from_staff_id);
  update public.shift_assignments set staff_id = v_sw.to_staff_id, staff_name = v_to_name where id = v_a.id;
  perform public.sched_snapshot_set_assignee(v_s.week_id, v_a.id, v_sw.to_staff_id, v_to_name);
  update public.shifts set updated_at = now() where id = v_s.id;
  if v_r.id is not null then
    update public.shift_assignments set staff_id = v_sw.from_staff_id, staff_name = v_from_name where id = v_r.id;
    perform public.sched_snapshot_set_assignee(v_rs.week_id, v_r.id, v_sw.from_staff_id, v_from_name);
    update public.shifts set updated_at = now() where id = v_rs.id;
  end if;

  update public.shift_swaps
     set status = 'approved', decision_note = nullif(btrim(coalesce(p_note, '')), ''), decided_at = now(), decided_by_staff = p_actor,
         from_staff_name = v_from_name, to_staff_name = v_to_name, updated_at = now()
   where id = p_swap;

  set constraints all immediate;
  set constraints all deferred;

  perform public.sched_notify(v_sw.branch_id, array[v_sw.from_staff_id, v_sw.to_staff_id], 'swap.approved', 'ההחלפה אושרה',
    case when v_r.id is null
         then v_to_name || ' לוקח/ת את ' || (v_sw.terms -> 'from' ->> 'label')
         else v_from_name || ' עובד/ת ב' || (v_sw.terms -> 'to' ->> 'label') || E'\n' || v_to_name || ' עובד/ת ב' || (v_sw.terms -> 'from' ->> 'label') end ||
      coalesce(E'\n' || nullif(btrim(coalesce(p_note, '')), ''), ''),
    jsonb_build_object('tab', 'schedule', 'weekStart', (select week_start from public.schedule_weeks where id = v_s.week_id)));
  perform public.sched_log(v_sw.branch_id, p_actor, 'swap.approve',
    'אישר/ה החלפה בין ' || v_from_name || ' ל' || v_to_name || ': ' || (v_sw.terms -> 'from' ->> 'label'),
    jsonb_build_object('swapId', p_swap, 'assignmentId', v_a.id, 'returnAssignmentId', v_r.id));
  return jsonb_build_object('ok', true, 'status', 'approved');
exception when others then
  if sqlerrm = 'sched_overlap' then
    return public.sched_fail('conflict');
  end if;
  raise;
end;
$$;

create or replace function public.sched_cancel_swap(p_actor uuid, p_swap uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sw public.shift_swaps%rowtype;
begin
  select * into v_sw from public.shift_swaps where id = p_swap for update;
  if not found then
    return public.sched_fail('not_found');
  end if;
  if v_sw.from_staff_id <> p_actor and not public.sched_can_manage(p_actor, v_sw.branch_id) then
    return public.sched_fail('forbidden');
  end if;
  if v_sw.status not in ('open', 'peer_accepted') then
    return public.sched_fail('not_pending');
  end if;
  update public.shift_swaps
     set status = 'cancelled', cancel_reason = case when v_sw.from_staff_id = p_actor then 'בוטלה על ידי מי שביקש/ה' else 'בוטלה על ידי המנהל/ת' end,
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
-- P. Notifications read state
-- ---------------------------------------------------------------------
create or replace function public.sched_mark_read(p_actor uuid, p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.schedule_notifications
     set read_at = now()
   where staff_id = p_actor and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------
-- Q. Staff lifecycle: deactivate / reactivate / delete, with the schedule kept
--    consistent and the history preserved.
-- ---------------------------------------------------------------------
-- Future shifts this person is still on (assignments are never deleted just
-- because someone left — past ones are history).
create or replace function public.sched_staff_future_count(p_staff uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
    from public.shift_assignments a
    join public.shifts s on s.id = a.shift_id
    join public.branches b on b.id = s.branch_id
   where a.staff_id = p_staff
     and ((s.shift_date::timestamp + s.start_time::time) at time zone coalesce(b.timezone, 'Asia/Jerusalem')) > now();
$$;

create or replace function public.sched_set_staff_active(p_actor uuid, p_staff uuid, p_active boolean, p_remove_future boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.staff%rowtype;
  v_future integer;
  v_removed integer := 0;
  v_ex record;
  v_cancelled integer := 0;
begin
  if not public.sched_is_op(p_actor) then
    return public.sched_fail('forbidden');
  end if;
  select * into v_target from public.staff where id = p_staff for update;
  if not found then
    return public.sched_fail('not_found');
  end if;
  if v_target.active = p_active then
    return jsonb_build_object('ok', true, 'unchanged', true);
  end if;

  if not p_active then
    if p_staff = p_actor then
      return public.sched_fail('self');
    end if;
    if (v_target.role = 'owner' or v_target.badge = 'owner')
       and not exists (select 1 from public.staff o where o.id <> p_staff and o.active and (o.role = 'owner' or o.badge = 'owner')) then
      return public.sched_fail('last_owner');
    end if;
  end if;

  if not p_active then
    v_future := public.sched_staff_future_count(p_staff);
    -- open requests / swaps of someone who left cannot be answered any more
    for v_ex in select id from public.shift_swaps where status in ('open', 'peer_accepted') and (from_staff_id = p_staff or to_staff_id = p_staff) loop
      update public.shift_swaps set status = 'cancelled', cancel_reason = 'העובד/ת אינו/ה פעיל/ה', decided_at = now(), updated_at = now() where id = v_ex.id;
      v_cancelled := v_cancelled + 1;
    end loop;
    update public.shift_requests
       set status = 'cancelled', cancel_reason = 'העובד/ת אינו/ה פעיל/ה', decided_at = now(), updated_at = now()
     where staff_id = p_staff and status = 'pending';
    if p_remove_future then
      for v_ex in
        select a.id, s.id as shift_id from public.shift_assignments a
          join public.shifts s on s.id = a.shift_id
          join public.branches b on b.id = s.branch_id
         where a.staff_id = p_staff
           and ((s.shift_date::timestamp + s.start_time::time) at time zone coalesce(b.timezone, 'Asia/Jerusalem')) > now()
      loop
        perform public.sched_cancel_swaps_for_assignment(v_ex.id, 'העובד/ת הוסר/ה מהלוח');
        delete from public.shift_assignments where id = v_ex.id;
        update public.shifts set updated_at = now() where id = v_ex.shift_id;
        v_removed := v_removed + 1;
      end loop;
    end if;
    -- Deactivation also unlinks the sign-in (every access check keys on auth_user_id),
    -- so a removed person's own Google login cannot silently re-admit them.
    update public.staff set active = false, auth_user_id = null where id = p_staff;
  else
    update public.staff set active = true where id = p_staff;
  end if;

  perform public.staff_log(p_actor, p_staff, case when p_active then 'staff.reactivate' else 'staff.deactivate' end,
    case when p_active then 'הפעיל/ה מחדש את ' else 'השבית/ה את ' end || public.sched_name(p_staff)
      || case when not p_active and v_removed > 0 then ' והסיר/ה אותו/ה מ-' || v_removed || ' משמרות עתידיות' else '' end,
    jsonb_build_object('removedFutureShifts', v_removed, 'futureShifts', v_future));
  return jsonb_build_object('ok', true, 'removedFuture', v_removed, 'futureLeft', coalesce(v_future, 0) - v_removed, 'cancelled', v_cancelled);
end;
$$;

-- "Does this person have any history?" — any row anywhere that points at them
-- other than pure configuration. Derived from the foreign keys themselves, so a
-- table added later is covered automatically.
create or replace function public.staff_has_history(p_staff uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
  v_exists boolean;
begin
  if exists (select 1 from public.staff s where s.id = p_staff and (s.claimed_at is not null or s.auth_user_id is not null)) then
    return true; -- they have signed in: that is history in itself
  end if;
  for r in
    select c.conrelid::regclass::text as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.contype = 'f' and c.confrelid = 'public.staff'::regclass
       and c.conrelid <> 'public.staff'::regclass and array_length(c.conkey, 1) = 1
       and c.conrelid::regclass::text not in
           ('pos_point_staff', 'pos_quick_sessions', 'schedule_members', 'shift_availability', 'schedule_notifications',
            'public.pos_point_staff', 'public.pos_quick_sessions', 'public.schedule_members', 'public.shift_availability', 'public.schedule_notifications')
  loop
    execute format('select exists (select 1 from %s where %I = $1)', r.tbl, r.col) into v_exists using p_staff;
    if v_exists then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

create or replace function public.sched_delete_staff(p_actor uuid, p_staff uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.staff%rowtype;
  v_name text;
begin
  if not public.sched_is_op(p_actor) then
    return public.sched_fail('forbidden');
  end if;
  select * into v_target from public.staff where id = p_staff for update;
  if not found then
    return public.sched_fail('not_found');
  end if;
  if p_staff = p_actor then
    return public.sched_fail('self');
  end if;
  if (v_target.role = 'owner' or v_target.badge = 'owner') then
    return public.sched_fail('is_owner');
  end if;
  if public.staff_has_history(p_staff) then
    return public.sched_fail('has_history');
  end if;
  v_name := public.sched_name(p_staff);
  perform public.staff_log(p_actor, p_staff, 'staff.delete', 'מחק/ה את ' || v_name || ' (לא הייתה היסטוריה)', jsonb_build_object('email', v_target.email));
  delete from public.staff where id = p_staff;
  return jsonb_build_object('ok', true, 'name', v_name);
exception when foreign_key_violation then
  return public.sched_fail('has_history');
end;
$$;

-- ---------------------------------------------------------------------
-- R. Retire the old, never-working (auth.uid()-based) entry points. Leaving
--    them callable would let any scheduling manager's own browser session
--    approve a swap WITHOUT any of the checks above.
-- ---------------------------------------------------------------------
drop function if exists public.publish_schedule_week(uuid);
drop function if exists public.unpublish_schedule_week(uuid);
drop function if exists public.clear_schedule_week(uuid);
drop function if exists public.copy_schedule_week(uuid, date, date);
drop function if exists public.set_schedule_member(uuid, uuid, jsonb);
drop function if exists public.request_shift_swap(uuid, text);
drop function if exists public.accept_shift_swap(uuid);
drop function if exists public.decide_shift_swap(uuid, boolean, text);
drop function if exists public.cancel_shift_swap(uuid);

-- ---------------------------------------------------------------------
-- S. Grants: every new function is for the SERVER only (service_role).
-- ---------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'sched\_%' or p.proname in ('staff_log', 'staff_has_history'))
  loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('revoke all on function %s from anon', f.sig);
    execute format('revoke all on function %s from authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------
do $$
declare
  n int;
begin
  select count(*) into n
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and (p.proname like 'sched\_%' or p.proname in ('staff_log', 'staff_has_history'))
     and (has_function_privilege('public', p.oid, 'execute')
          or has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute'));
  if n > 0 then
    raise exception 'verify: % sched_* function(s) are executable by public/anon/authenticated', n;
  end if;
  if has_table_privilege('authenticated', 'public.shifts', 'insert')
     or has_table_privilege('authenticated', 'public.shift_assignments', 'insert') then
    raise exception 'verify: a browser role can still write the schedule directly';
  end if;
  if has_table_privilege('authenticated', 'public.shift_requests', 'select')
     or has_table_privilege('anon', 'public.schedule_notifications', 'select') then
    raise exception 'verify: a browser role can read requests / notifications directly';
  end if;
end;
$$;
