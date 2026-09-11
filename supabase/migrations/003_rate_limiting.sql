-- Table-backed rate limiting. Mirrors AyekaBar's migration 045 exactly.
-- Deliberately table-backed rather than an in-process counter: the app
-- runs on Vercel serverless/Fluid Compute, where separate concurrent
-- invocations don't share memory — Postgres is the one thing every request
-- already talks to.
--
-- Needed now for login/menu-editor API routes, and again in Phase 2+3 for
-- the six-digit recovery-code and QR-token endpoints, which are exactly
-- the kind of brute-force target this exists for.

create table public.rate_limits (
  key         text primary key,
  window_start timestamptz not null,
  count       integer not null default 0
);

alter table public.rate_limits enable row level security;
-- No policies at all — service-role only, same posture as menu_audit.

-- Fixed-window (not sliding) limiter. One atomic INSERT ... ON CONFLICT so
-- two concurrent requests can't both read-then-write past the limit.
-- Callers must encode both WHO and WHAT into p_key (e.g.
-- 'login:ip:1.2.3.4') so one endpoint's abuse can't burn another's budget.
create or replace function public.check_rate_limit(p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.rate_limits (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
    set count = case
          when public.rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
            then 1
          else public.rate_limits.count + 1
        end,
        window_start = case
          when public.rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
            then now()
          else public.rate_limits.window_start
        end
  returning count into v_count;

  return v_count <= p_max;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC by default; revoking anon/authenticated
-- alone would be cosmetic (both inherit PUBLIC) — revoke PUBLIC explicitly,
-- then grant only to service_role, which is the only caller (see
-- lib/rate-limit.ts — always invoked via the service-role client, never
-- directly from the browser).
revoke execute on function public.check_rate_limit(text, integer, integer) from public;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;

create or replace function public.cleanup_rate_limits()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.rate_limits where window_start < now() - interval '1 day';
$$;

revoke execute on function public.cleanup_rate_limits() from public;
grant execute on function public.cleanup_rate_limits() to service_role;
