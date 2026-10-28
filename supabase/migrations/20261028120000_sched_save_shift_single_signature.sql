-- sched_save_shift had TWO public signatures: the original (12 arguments) and a wrapper (13 arguments, adds p_requests_open) that
-- called the original. The repo's own rule is "never overload a function": a second signature makes the REST layer reject JSON calls
-- that could match both (PGRST203), which is what locked every employee out of PIN login on 2026-10-09. This pair was safe only
-- because the argument NAMES differ, which is fragile. Now there is one public signature.
--
--   * the original becomes internal_sched_save_shift_core (internal_* functions are never callable by service_role or any browser role)
--   * sched_save_shift keeps its 13-argument signature and grants, and calls the core
--
-- Behaviour is unchanged for the app, which always sends p_requests_open. A caller that omitted it used to fall through to the old
-- 12-argument function; that no longer exists, so such a call now fails loudly instead of silently ignoring the flag.
-- Idempotent: the rename only happens while the old signature still carries the public name.

do $$
begin
  if to_regprocedure('public.sched_save_shift(uuid,uuid,uuid,date,text,text,text,text,jsonb,text,jsonb,text)') is not null then
    alter function public.sched_save_shift(uuid,uuid,uuid,date,text,text,text,text,jsonb,text,jsonb,text)
      rename to internal_sched_save_shift_core;
  end if;
end
$$;

revoke all on function public.internal_sched_save_shift_core(uuid,uuid,uuid,date,text,text,text,text,jsonb,text,jsonb,text)
  from public, anon, authenticated, service_role;

create or replace function public.sched_save_shift(
  p_actor uuid, p_week_id uuid, p_shift_id uuid,
  p_date date, p_start text, p_end text,
  p_preset_id text, p_station_id text, p_requirements jsonb, p_requests_open boolean,
  p_note text, p_assignees jsonb, p_expected_updated text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_result jsonb; v_shift uuid;
begin
  v_result := public.internal_sched_save_shift_core(p_actor, p_week_id, p_shift_id, p_date, p_start, p_end,
    p_preset_id, p_station_id, p_requirements, p_note, p_assignees, p_expected_updated);
  if coalesce((v_result ->> 'ok')::boolean, false) then
    v_shift := (v_result ->> 'shiftId')::uuid;
    update public.shifts set requests_open = coalesce(p_requests_open, false), updated_at = now() where id = v_shift;
  end if;
  return v_result;
end $$;

revoke all on function public.sched_save_shift(uuid,uuid,uuid,date,text,text,text,text,jsonb,boolean,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.sched_save_shift(uuid,uuid,uuid,date,text,text,text,text,jsonb,boolean,text,jsonb,text) to service_role;
