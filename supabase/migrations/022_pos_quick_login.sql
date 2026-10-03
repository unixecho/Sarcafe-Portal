-- =====================================================================
-- 022_pos_quick_login.sql — employee number + 6-digit passcode "quick login"
--
-- The default way in is still the person's own Google account on their own phone
-- (owner decision, 2026-10-02). Quick login is the OPTION for a shared station
-- tablet: the employee types their employee number and a 6-digit passcode instead
-- of going through Google, and gets a REAL session as themselves — so every action
-- on that tablet is attributed to the person actually standing at it, and the
-- existing guards / RLS / realtime keep working unchanged (identity is still the
-- session; the browser still never chooses it).
--
-- Because six digits are a much weaker secret than a Google account, a quick-login
-- session is deliberately SECOND-CLASS: it may do floor work (register, station,
-- orders) and nothing else — never the owner pages, never a manager-only action.
-- The sessions minted this way are recorded in pos_quick_sessions so the guards can
-- tell them apart (by the JWT's own session_id — not by anything the client holds).
--
-- What this adds
--   staff.employee_no  a short number to type (auto-assigned, owner-editable, unique)
--   staff.pin_hash     bcrypt of the passcode (never the passcode itself)
--   staff.pin_set_at
--   pos_quick_sessions the ids of sessions that were minted by a passcode
--   pos_set_pin / pos_clear_pin / pos_verify_pin / pos_set_employee_no
--   pos_clear_old_quick_sessions
--   two audit event types: 'pin_changed', 'quick_login'
--
-- The passcode itself is NEVER written anywhere but as a bcrypt hash: not in the
-- audit log, not in a payload, not in a log line. Brute force is bounded by the
-- route (check_rate_limit per employee number AND per IP) on top of bcrypt's cost.
-- Re-runnable.
-- =====================================================================

alter table public.staff add column if not exists employee_no integer;
alter table public.staff add column if not exists pin_hash    text;
alter table public.staff add column if not exists pin_set_at  timestamptz;

-- Short, typeable, never reused (max + 1). Serialised so two simultaneous inserts
-- cannot draw the same number.
create or replace function public.pos_next_employee_no()
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  n integer;
begin
  perform pg_advisory_xact_lock(hashtext('sarcafe.staff.employee_no'));
  select coalesce(max(employee_no), 100) + 1 into n from public.staff;
  return n;
end;
$$;

do $$
declare
  r record;
begin
  for r in select id from public.staff where employee_no is null order by created_at, id loop
    update public.staff set employee_no = public.pos_next_employee_no() where id = r.id;
  end loop;
end;
$$;

create or replace function public.pos_staff_default_employee_no()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.employee_no is null then
    new.employee_no := public.pos_next_employee_no();
  end if;
  return new;
end;
$$;

drop trigger if exists staff_default_employee_no on public.staff;
create trigger staff_default_employee_no
  before insert on public.staff
  for each row execute function public.pos_staff_default_employee_no();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'staff_employee_no_range') then
    alter table public.staff add constraint staff_employee_no_range check (employee_no between 1 and 99999);
  end if;
end;
$$;
create unique index if not exists staff_employee_no_key on public.staff (employee_no) where employee_no is not null;

-- Sessions minted by a passcode. RLS on, NO policy, NO client grant: service role only.
create table if not exists public.pos_quick_sessions (
  session_id  uuid primary key,
  staff_id    uuid not null references public.staff(id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index if not exists pos_quick_sessions_created_idx on public.pos_quick_sessions (created_at);
alter table public.pos_quick_sessions enable row level security;
revoke all on public.pos_quick_sessions from public, anon, authenticated;
grant all on public.pos_quick_sessions to service_role;

-- Two more audit event types (the CHECK vocabulary was deliberately complete in 020;
-- quick login is the one addition since). Re-created, not appended, so it stays one list.
alter table public.pos_events drop constraint if exists pos_events_event_check;
alter table public.pos_events add constraint pos_events_event_check check (event in (
  'order_created', 'items_added', 'order_edited',
  'item_claimed', 'item_ready', 'item_picked_up', 'item_delivered', 'item_reverted',
  'item_voided', 'order_voided', 'order_completed',
  'session_opened', 'session_closed', 'training_wiped',
  'point_created', 'point_updated', 'point_deactivated', 'routes_changed',
  'checkin', 'checkout',
  'handle_changed', 'board_token_rotated', 'settings_changed', 'pii_cleared',
  'pin_changed', 'quick_login'
));

-- Obvious passcodes are refused: one repeated digit (000000), runs up or down
-- (123456, 654321, 456789), a repeated pair (121212) or triple (123123).
create or replace function public.pos_pin_is_weak(p_pin text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_pin ~ '^(\d)\1{5}$'
      or position(p_pin in '01234567890123456789') > 0
      or position(p_pin in '98765432109876543210') > 0
      or p_pin ~ '^(\d\d)\1\1$'
      or p_pin ~ '^(\d\d\d)\1$';
$$;

-- Set (or change) a passcode. Who may set whose is the ROUTE's decision (self, or the
-- owner); the function only validates, hashes and audits. pgcrypto lives in `public`
-- or `extensions` depending on how it was created, hence both on the search_path
-- ("extensions" is not a schema an attacker can write to).
create or replace function public.pos_set_pin(p_actor uuid, p_target uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if not exists (select 1 from public.staff where id = p_actor and active) then
    return jsonb_build_object('ok', false, 'reason', 'no_actor');
  end if;
  if not exists (select 1 from public.staff where id = p_target and active) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if coalesce(p_pin, '') !~ '^[0-9]{6}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if public.pos_pin_is_weak(p_pin) then
    return jsonb_build_object('ok', false, 'reason', 'weak');
  end if;

  update public.staff
     set pin_hash = crypt(p_pin, gen_salt('bf', 8)), pin_set_at = now()
   where id = p_target;

  -- A changed passcode ends every quick session of that person (a lost tablet, a
  -- shared code that leaked). Google sessions are untouched.
  delete from public.pos_quick_sessions where staff_id = p_target;

  perform public.pos_log_event(b.branch_id, p_actor, 'pin_changed',
    jsonb_build_object('target_staff', p_target, 'by_self', p_actor = p_target, 'cleared', false))
  from public.pos_branch_settings b where b.enabled;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.pos_clear_pin(p_actor uuid, p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if not exists (select 1 from public.staff where id = p_actor and active) then
    return jsonb_build_object('ok', false, 'reason', 'no_actor');
  end if;
  update public.staff set pin_hash = null, pin_set_at = null where id = p_target;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  delete from public.pos_quick_sessions where staff_id = p_target;

  perform public.pos_log_event(b.branch_id, p_actor, 'pin_changed',
    jsonb_build_object('target_staff', p_target, 'by_self', p_actor = p_target, 'cleared', true))
  from public.pos_branch_settings b where b.enabled;
  return jsonb_build_object('ok', true);
end;
$$;

-- Verify a passcode. ONE generic failure for every reason (no such number, wrong
-- code, inactive, never signed in with Google, no passcode set) so it cannot be used
-- to discover who works here; a comparable amount of bcrypt work is burnt on the
-- "no such employee" path so the timing does not give it away either. A person who
-- has never signed in with Google has no auth user to open a session for, so quick
-- login only works after the first Google sign-in.
create or replace function public.pos_verify_pin(p_employee_no integer, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  s public.staff%rowtype;
begin
  select * into s from public.staff
   where employee_no = p_employee_no and active
     and auth_user_id is not null and email is not null and pin_hash is not null;

  if not found then
    perform crypt(coalesce(p_pin, ''), gen_salt('bf', 8));
    return jsonb_build_object('ok', false);
  end if;
  if coalesce(p_pin, '') !~ '^[0-9]{6}$' or s.pin_hash <> crypt(p_pin, s.pin_hash) then
    return jsonb_build_object('ok', false);
  end if;

  perform public.pos_log_event(b.branch_id, s.id, 'quick_login', jsonb_build_object('employee_no', p_employee_no))
  from public.pos_branch_settings b where b.enabled;
  return jsonb_build_object('ok', true, 'staff_id', s.id, 'email', s.email, 'handle', s.handle);
end;
$$;

create or replace function public.pos_set_employee_no(p_actor uuid, p_target uuid, p_no integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.staff where id = p_actor and active) then
    return jsonb_build_object('ok', false, 'reason', 'no_actor');
  end if;
  if p_no is null or p_no < 1 or p_no > 99999 then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if exists (select 1 from public.staff where employee_no = p_no and id <> p_target) then
    return jsonb_build_object('ok', false, 'reason', 'taken');
  end if;
  begin
    update public.staff set employee_no = p_no where id = p_target;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'taken');
  end;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  perform public.pos_log_event(b.branch_id, p_actor, 'settings_changed',
    jsonb_build_object('employee_no', p_no, 'target_staff', p_target))
  from public.pos_branch_settings b where b.enabled;
  return jsonb_build_object('ok', true, 'employee_no', p_no);
end;
$$;

create or replace function public.pos_clear_old_quick_sessions(p_days int default 3)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n integer;
begin
  delete from public.pos_quick_sessions where created_at < now() - make_interval(days => p_days);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Same grant discipline as 020/021: nothing here is callable by a browser role.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'pos\_%'
  loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('revoke all on function %s from anon', f.sig);
    execute format('revoke all on function %s from authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end;
$$;

-- Verify
do $$
declare
  n int;
begin
  if exists (select 1 from public.staff where employee_no is null) then
    raise exception 'verify: a staff row has no employee_no';
  end if;
  if (select count(*) from public.staff) <> (select count(distinct employee_no) from public.staff) then
    raise exception 'verify: employee numbers are not unique';
  end if;
  if has_table_privilege('authenticated', 'public.pos_quick_sessions', 'select, insert, update, delete')
     or has_table_privilege('anon', 'public.pos_quick_sessions', 'select, insert, update, delete') then
    raise exception 'verify: a browser role can touch pos_quick_sessions';
  end if;
  select count(*) into n
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname like 'pos\_%'
     and (has_function_privilege('public', p.oid, 'execute')
          or has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute'));
  if n > 0 then
    raise exception 'verify: % pos_* function(s) are executable by public/anon/authenticated', n;
  end if;
end;
$$;
