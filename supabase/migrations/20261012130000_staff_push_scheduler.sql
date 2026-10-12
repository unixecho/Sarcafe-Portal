-- Staff push: the scheduler, run by Supabase itself (pg_cron + pg_net), so the timed alerts
-- (shift starting, checklist not submitted) and any push the request path missed go out every
-- couple of minutes without Vercel cron (the Hobby plan only allows daily ones).
--
-- Every two minutes pg_cron calls staff_push_tick(), which asks the app's /api/cron/staff-push
-- to run. The call is authenticated with a random secret generated here and kept in Supabase
-- Vault; the app checks it with staff_push_verify_cron() (the secret never leaves the database,
-- is never in the repo, and needs no Vercel environment variable). CRON_SECRET still works too.
--
-- Everything that needs pg_cron / pg_net / Vault is guarded: where they do not exist (the local
-- PGlite test database) the functions are created but the schedule is skipped with a notice.
-- Functions are service_role only like the rest; pg_cron runs as the database owner.

-- ---------------------------------------------------------------------
-- A. Functions
-- ---------------------------------------------------------------------
create or replace function public.staff_push_verify_cron(p_secret text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_secret is null or char_length(p_secret) < 32 then
    return false;
  end if;
  return exists (select 1 from vault.decrypted_secrets where name = 'staff_push_cron' and decrypted_secret = p_secret);
exception when others then
  return false;
end;
$$;

-- What pg_cron runs. A missing secret or an unreachable app must never raise: the next tick tries again.
create or replace function public.staff_push_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'staff_push_cron';
  if v_secret is null then
    return;
  end if;
  perform net.http_get(
    url := 'https://sarcafe-portal.vercel.app/api/cron/staff-push',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 25000
  );
exception when others then
  null;
end;
$$;

-- For the developer panel: is the schedule there, and did the last run reach the app?
create or replace function public.staff_push_cron_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
  v_run record;
  v_http record;
begin
  begin
    select jobid, schedule, active into v_job from cron.job where jobname = 'staff-push';
    if v_job.jobid is not null then
      select status, start_time into v_run from cron.job_run_details where jobid = v_job.jobid order by start_time desc limit 1;
    end if;
    select status_code, error_msg, created into v_http from net._http_response order by created desc limit 1;
  exception when others then
    return jsonb_build_object('available', false);
  end;
  return jsonb_build_object(
    'available', true,
    'scheduled', v_job.jobid is not null,
    'schedule', v_job.schedule,
    'active', v_job.active,
    'lastRunAt', v_run.start_time,
    'lastRunStatus', v_run.status,
    'lastHttpStatus', v_http.status_code,
    'lastHttpAt', v_http.created,
    'lastHttpError', v_http.error_msg
  );
end;
$$;

revoke all on function public.staff_push_verify_cron(text) from public, anon, authenticated;
revoke all on function public.staff_push_tick() from public, anon, authenticated;
revoke all on function public.staff_push_cron_status() from public, anon, authenticated;
grant execute on function public.staff_push_verify_cron(text) to service_role;
grant execute on function public.staff_push_tick() to service_role;
grant execute on function public.staff_push_cron_status() to service_role;

-- ---------------------------------------------------------------------
-- B. The schedule (only where Supabase's scheduler, HTTP client and Vault exist)
-- ---------------------------------------------------------------------
do $schedule$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
     or not exists (select 1 from pg_available_extensions where name = 'supabase_vault') then
    raise notice 'staff push scheduler skipped: pg_cron, pg_net or Vault is not available in this database';
    return;
  end if;

  create extension if not exists pg_net with schema extensions;
  create extension if not exists pg_cron;

  if not exists (select 1 from vault.decrypted_secrets where name = 'staff_push_cron') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'staff_push_cron',
      'Bearer secret pg_cron sends to /api/cron/staff-push; verified by staff_push_verify_cron()'
    );
  end if;

  -- Same name = replace, so re-running this migration never creates a second job.
  perform cron.schedule('staff-push', '*/2 * * * *', 'select public.staff_push_tick()');
end
$schedule$;
