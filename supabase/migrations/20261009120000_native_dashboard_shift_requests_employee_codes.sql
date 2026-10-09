-- Native dashboard follow-up: explicit per-shift request opt-in and HYP employee
-- codes that preserve leading zeroes. Service-only functions keep both rules at
-- the database boundary; the browser cannot bypass either one.

-- ---------------------------------------------------------------------------
-- Employee codes: keep the historical integer for compatibility, but make the
-- text code canonical for login and display so 0849 survives end to end.
-- ---------------------------------------------------------------------------
alter table public.staff add column if not exists employee_code text;
update public.staff set employee_code = employee_no::text where employee_code is null and employee_no is not null;
alter table public.staff drop constraint if exists staff_employee_code_format;
alter table public.staff add constraint staff_employee_code_format check (
  employee_code is null or (employee_code ~ '^[0-9]{1,5}$' and employee_code ~ '[1-9]')
);
create unique index if not exists staff_employee_code_key on public.staff(employee_code) where employee_code is not null;

create or replace function public.pos_sync_employee_code()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if new.employee_code is not null then
      new.employee_no := new.employee_code::integer;
    elsif new.employee_no is not null then
      new.employee_code := new.employee_no::text;
    end if;
  elsif new.employee_code is distinct from old.employee_code then
    new.employee_no := new.employee_code::integer;
  elsif new.employee_no is distinct from old.employee_no then
    new.employee_code := new.employee_no::text;
  end if;
  return new;
end $$;

drop trigger if exists staff_sync_employee_code on public.staff;
create trigger staff_sync_employee_code
  before insert or update of employee_no, employee_code on public.staff
  for each row execute function public.pos_sync_employee_code();

create or replace function public.pos_verify_pin(p_employee_no text, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare s public.staff%rowtype;
begin
  select * into s from public.staff
   where employee_code = p_employee_no and active and pin_hash is not null;
  if not found then
    perform crypt(coalesce(p_pin, ''), gen_salt('bf', 8));
    return jsonb_build_object('ok', false);
  end if;
  if coalesce(p_pin, '') !~ '^[0-9]{6}$' or s.pin_hash <> crypt(p_pin, s.pin_hash) then
    return jsonb_build_object('ok', false);
  end if;
  perform public.pos_log_event(b.branch_id, s.id, 'quick_login', jsonb_build_object('employee_no', p_employee_no))
    from public.pos_branch_settings b where b.enabled;
  return jsonb_build_object('ok', true, 'staff_id', s.id, 'email', s.email,
    'auth_user_id', s.auth_user_id, 'branch_id', s.branch_id, 'handle', s.handle);
end $$;

create or replace function public.pos_set_employee_code(p_actor uuid, p_target uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.staff where id = p_actor and active) then
    return jsonb_build_object('ok', false, 'reason', 'no_actor');
  end if;
  if p_code is null or p_code !~ '^[0-9]{1,5}$' or p_code !~ '[1-9]' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if exists (select 1 from public.staff where (employee_code = p_code or employee_no = p_code::integer) and id <> p_target) then
    return jsonb_build_object('ok', false, 'reason', 'taken');
  end if;
  begin
    update public.staff set employee_code = p_code where id = p_target;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'taken');
  end;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  perform public.pos_log_event(b.branch_id, p_actor, 'settings_changed',
    jsonb_build_object('employee_no', p_code, 'target_staff', p_target))
    from public.pos_branch_settings b where b.enabled;
  return jsonb_build_object('ok', true, 'employee_no', p_code);
end $$;

revoke all on function public.pos_verify_pin(text,text) from public, anon, authenticated;
revoke all on function public.pos_set_employee_code(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.pos_verify_pin(text,text) to service_role;
grant execute on function public.pos_set_employee_code(uuid,uuid,text) to service_role;

-- ---------------------------------------------------------------------------
-- Shift requests are closed unless the owner deliberately opens that shift.
-- ---------------------------------------------------------------------------
alter table public.shifts add column if not exists requests_open boolean not null default false;

-- Overload the existing atomic save with the new flag. The original function
-- performs all validation and assignment writes in this same transaction.
create or replace function public.sched_save_shift(
  p_actor uuid, p_week_id uuid, p_shift_id uuid,
  p_date date, p_start text, p_end text,
  p_preset_id text, p_station_id text, p_requirements jsonb, p_requests_open boolean,
  p_note text, p_assignees jsonb, p_expected_updated text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_result jsonb; v_shift uuid;
begin
  v_result := public.sched_save_shift(p_actor, p_week_id, p_shift_id, p_date, p_start, p_end,
    p_preset_id, p_station_id, p_requirements, p_note, p_assignees, p_expected_updated);
  if coalesce((v_result ->> 'ok')::boolean, false) then
    v_shift := (v_result ->> 'shiftId')::uuid;
    update public.shifts set requests_open = coalesce(p_requests_open, false), updated_at = now() where id = v_shift;
  end if;
  return v_result;
end $$;

-- Preserve the already verified request implementation behind a guarded entry.
alter function public.sched_request_shift(uuid,uuid,text) rename to internal_sched_request_shift_unchecked;
create function public.sched_request_shift(p_actor uuid, p_shift uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_week uuid; v_open boolean;
begin
  select week_id into v_week from public.shifts where id = p_shift;
  if v_week is null then return public.sched_fail('not_found'); end if;
  perform 1 from public.schedule_weeks where id = v_week for update;
  select requests_open into v_open from public.shifts where id = p_shift for update;
  if not coalesce(v_open, false) then return public.sched_fail('requests_not_open'); end if;
  return public.internal_sched_request_shift_unchecked(p_actor, p_shift, p_note);
end $$;

revoke all on function public.sched_save_shift(uuid,uuid,uuid,date,text,text,text,text,jsonb,boolean,text,jsonb,text) from public, anon, authenticated;
revoke all on function public.sched_request_shift(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.internal_sched_request_shift_unchecked(uuid,uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.sched_save_shift(uuid,uuid,uuid,date,text,text,text,text,jsonb,boolean,text,jsonb,text) to service_role;
grant execute on function public.sched_request_shift(uuid,uuid,text) to service_role;

do $$ begin
  if exists(select 1 from public.staff where employee_code is null) then
    raise exception 'verify: employee_code missing';
  end if;
  if exists(select 1 from public.shifts where requests_open is null) then
    raise exception 'verify: requests_open missing';
  end if;
end $$;
