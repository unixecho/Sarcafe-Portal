-- 20261105090000_staff_tools_messages_qa_runs
--
-- Three small stores for the glass dashboards (docs/SARCAFE_GLASS_UI.md, docs/SARCAFE_TEAM_MESSAGE.md, docs/QA_BLUEPRINT.md):
--
--   1. staff_tool_usage + staff_tool_searches: which tools a person opens in the tool finder and what they searched for, so the
--      suggestions follow the PERSON across devices (owner, 2026-11-05). Bounded: at most 60 tools and 5 searches per person.
--   2. staff_messages: the audit trail of the team message (who sent what to which branch / shift, how many received it, how many
--      were skipped because they never turned notifications on). Its primary key is the sender's request id, so the same send
--      can never go out twice. The message itself reaches people as ordinary schedule_notifications rows (kind 'staff.message').
--   3. qa_runs: the reports of the automatic QA suite (GitHub Actions, every morning and on every push to main), read by the
--      developer's morning review page /staff/dev/qa. Two suites, two reports per run: 'dashboard' (the portal) and 'kiosk' (the
--      tablet, its page, its APIs and its app). qa_digests: the 07:00 notification to the developer, at most one per day.
--
-- Additive and idempotent. Nothing here is reachable from a browser role: RLS on, every grant revoked, service role only.
-- The app works before this is applied: the finder keeps its history on the device, the team message sends without the audit
-- row, and the QA page shows the report shipped with the code.

-- ── 1. tool usage ──────────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.staff_tool_usage (
  staff_id      uuid not null references public.staff(id) on delete cascade,
  tool_id       text not null check (tool_id ~ '^[a-z0-9-]{1,40}$'),
  uses          integer not null default 0 check (uses >= 0 and uses <= 100000),
  last_used_at  timestamptz not null default now(),
  primary key (staff_id, tool_id)
);
create index if not exists staff_tool_usage_recent_idx on public.staff_tool_usage (staff_id, last_used_at desc);

create table if not exists public.staff_tool_searches (
  id           bigint generated always as identity primary key,
  staff_id     uuid not null references public.staff(id) on delete cascade,
  query        text not null check (char_length(query) between 2 and 60),
  searched_at  timestamptz not null default now()
);
create index if not exists staff_tool_searches_staff_idx on public.staff_tool_searches (staff_id, searched_at desc);

alter table public.staff_tool_usage enable row level security;
alter table public.staff_tool_searches enable row level security;
revoke all on public.staff_tool_usage, public.staff_tool_searches from public, anon, authenticated;
grant all on public.staff_tool_usage, public.staff_tool_searches to service_role;

-- One tool opened (and, when it came from a search, what was typed). Keeps the newest 60 tools and 5 searches per person.
create or replace function public.staff_tool_usage_record(p_staff_id uuid, p_tool_id text, p_query text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if p_staff_id is null or p_tool_id is null or p_tool_id !~ '^[a-z0-9-]{1,40}$' then
    raise exception 'invalid tool usage' using errcode = '22023';
  end if;
  if not exists (select 1 from public.staff where id = p_staff_id and active) then
    raise exception 'unknown staff' using errcode = '22023';
  end if;

  insert into public.staff_tool_usage (staff_id, tool_id, uses, last_used_at)
  values (p_staff_id, p_tool_id, 1, now())
  on conflict (staff_id, tool_id) do update
    set uses = least(public.staff_tool_usage.uses + 1, 100000), last_used_at = now();

  delete from public.staff_tool_usage u
   where u.staff_id = p_staff_id
     and u.tool_id not in (select k.tool_id from public.staff_tool_usage k where k.staff_id = p_staff_id order by k.last_used_at desc limit 60);

  if v_query is not null and char_length(v_query) between 2 and 60 then
    delete from public.staff_tool_searches s where s.staff_id = p_staff_id and lower(s.query) = lower(v_query);
    insert into public.staff_tool_searches (staff_id, query) values (p_staff_id, v_query);
    delete from public.staff_tool_searches s
     where s.staff_id = p_staff_id
       and s.id not in (select k.id from public.staff_tool_searches k where k.staff_id = p_staff_id order by k.searched_at desc, k.id desc limit 5);
  end if;
end;
$$;
revoke all on function public.staff_tool_usage_record(uuid, text, text) from public, anon, authenticated;
grant execute on function public.staff_tool_usage_record(uuid, text, text) to service_role;

-- A device's history joining the person's (the first time a phone that used the finder before this migration signs in).
-- Takes the larger count for each tool, so merging the same device twice never double counts. At most 60 entries are read.
create or replace function public.staff_tool_usage_merge(p_staff_id uuid, p_usage jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_value jsonb;
  v_uses integer;
  v_at timestamptz;
  v_seen integer := 0;
begin
  if p_staff_id is null or p_usage is null or jsonb_typeof(p_usage) <> 'object' then
    raise exception 'invalid tool usage' using errcode = '22023';
  end if;
  if not exists (select 1 from public.staff where id = p_staff_id and active) then
    raise exception 'unknown staff' using errcode = '22023';
  end if;
  for v_key, v_value in select key, value from jsonb_each(p_usage) loop
    v_seen := v_seen + 1;
    exit when v_seen > 60;
    continue when v_key !~ '^[a-z0-9-]{1,40}$' or jsonb_typeof(v_value) <> 'object';
    v_uses := least(greatest(coalesce((v_value ->> 'n')::numeric, 0), 0), 100000)::integer;
    continue when v_uses < 1;
    v_at := least(coalesce(to_timestamp(((v_value ->> 't')::numeric) / 1000), now()), now());
    insert into public.staff_tool_usage (staff_id, tool_id, uses, last_used_at)
    values (p_staff_id, v_key, v_uses, v_at)
    on conflict (staff_id, tool_id) do update
      set uses = greatest(public.staff_tool_usage.uses, excluded.uses),
          last_used_at = greatest(public.staff_tool_usage.last_used_at, excluded.last_used_at);
  end loop;
  delete from public.staff_tool_usage u
   where u.staff_id = p_staff_id
     and u.tool_id not in (select k.tool_id from public.staff_tool_usage k where k.staff_id = p_staff_id order by k.last_used_at desc limit 60);
end;
$$;
revoke all on function public.staff_tool_usage_merge(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.staff_tool_usage_merge(uuid, jsonb) to service_role;

-- "איפוס" in the finder: forget this person's history on every device.
create or replace function public.staff_tool_usage_reset(p_staff_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.staff_tool_usage where staff_id = p_staff_id;
  delete from public.staff_tool_searches where staff_id = p_staff_id;
$$;
revoke all on function public.staff_tool_usage_reset(uuid) from public, anon, authenticated;
grant execute on function public.staff_tool_usage_reset(uuid) to service_role;

-- ── 2. team message audit ──────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.staff_messages (
  id           uuid primary key,
  branch_id    uuid not null references public.branches(id) on delete cascade,
  sender_id    uuid references public.staff(id) on delete set null,
  audience     text not null check (audience in ('all', 'shift', 'one')),
  shift_id     uuid references public.shifts(id) on delete set null,
  body         text not null check (char_length(body) between 1 and 280),
  recipients   integer not null default 0 check (recipients >= 0),
  skipped      integer not null default 0 check (skipped >= 0),
  status       text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  created_at   timestamptz not null default now()
);
create index if not exists staff_messages_sender_idx on public.staff_messages (sender_id, created_at desc);
create index if not exists staff_messages_branch_idx on public.staff_messages (branch_id, created_at desc);
alter table public.staff_messages enable row level security;
revoke all on public.staff_messages from public, anon, authenticated;
grant all on public.staff_messages to service_role;

-- ── 3. QA runs ─────────────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.qa_runs (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  suite       text not null default 'dashboard' check (suite in ('dashboard', 'kiosk')),
  source      text not null check (source in ('schedule', 'push', 'manual', 'local')),
  commit_sha  text check (commit_sha is null or commit_sha ~ '^[0-9a-f]{7,40}$'),
  ref         text check (ref is null or char_length(ref) <= 120),
  status      text not null check (status in ('pass', 'warn', 'fail')),
  totals      jsonb not null,
  review      jsonb not null,
  report      jsonb not null,
  check (octet_length(report::text) < 600000)
);
-- in case an earlier draft of this table exists without the suite column
alter table public.qa_runs add column if not exists suite text not null default 'dashboard' check (suite in ('dashboard', 'kiosk'));
create index if not exists qa_runs_recent_idx on public.qa_runs (created_at desc);
create index if not exists qa_runs_suite_recent_idx on public.qa_runs (suite, created_at desc);
alter table public.qa_runs enable row level security;
revoke all on public.qa_runs from public, anon, authenticated;
grant all on public.qa_runs to service_role;

-- The 07:00 digest (POST /api/qa/digest): one row per Israel day, so the developer gets ONE notification however often it is asked.
create table if not exists public.qa_digests (
  day         date primary key,
  sent_at     timestamptz not null default now(),
  status      text not null check (status in ('pass', 'fail')),
  runs        jsonb not null default '{}'::jsonb check (jsonb_typeof(runs) = 'object' and pg_column_size(runs) <= 4096)
);
alter table public.qa_digests enable row level security;
revoke all on public.qa_digests from public, anon, authenticated;
grant all on public.qa_digests to service_role;

-- Check after applying (all must be true / 0):
--   select to_regclass('public.staff_tool_usage') is not null as usage_table,
--          to_regclass('public.staff_messages') is not null as messages_table,
--          to_regclass('public.qa_runs') is not null as qa_table,
--          to_regclass('public.qa_digests') is not null as digest_table,
--          (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--            where n.nspname = 'public' and p.proname in ('staff_tool_usage_record','staff_tool_usage_merge','staff_tool_usage_reset')) as functions_3,
--          (select count(*) from (select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
--            group by proname having count(*) > 1) d) as overloaded_names_0;
-- Ledger row:
--   insert into supabase_migrations.schema_migrations (version, name) values ('20261105090000', 'staff_tools_messages_qa_runs') on conflict do nothing;
