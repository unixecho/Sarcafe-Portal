-- Schedule-linked staff checklists.
-- All access is through guarded server routes. Browser roles receive no table access.

create table if not exists public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  kind text not null check (kind in ('opening', 'handover', 'closing')),
  name text not null,
  version integer not null default 1 check (version > 0),
  definition jsonb not null default '{"categories":[]}'::jsonb,
  active boolean not null default true,
  published_at timestamptz not null default now(),
  created_by uuid references public.staff(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, kind, version)
);
create unique index if not exists checklist_templates_one_active_kind
  on public.checklist_templates (branch_id, kind) where active;
create index if not exists checklist_templates_branch_idx
  on public.checklist_templates (branch_id, active, kind);

create table if not exists public.checklist_assignments (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  shift_id uuid not null references public.shifts(id) on delete cascade,
  shift_assignment_id uuid not null references public.shift_assignments(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete set null,
  checklist_kind text not null check (checklist_kind in ('opening', 'handover', 'closing')),
  template_id uuid references public.checklist_templates(id) on delete set null,
  template_version integer not null,
  template_snapshot jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'submitted')),
  answers jsonb not null default '{}'::jsonb,
  issues jsonb not null default '[]'::jsonb,
  issue_count integer not null default 0 check (issue_count >= 0),
  has_inventory_issue boolean not null default false,
  has_cleanliness_issue boolean not null default false,
  attested boolean not null default false,
  started_at timestamptz,
  submitted_at timestamptz,
  manager_seen_at timestamptz,
  manager_seen_by uuid references public.staff(id) on delete set null,
  manager_resolved_at timestamptz,
  manager_resolved_by uuid references public.staff(id) on delete set null,
  manager_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shift_assignment_id, checklist_kind)
);
create index if not exists checklist_assignments_staff_status_idx
  on public.checklist_assignments (staff_id, status, created_at desc);
create index if not exists checklist_assignments_branch_inbox_idx
  on public.checklist_assignments (branch_id, submitted_at desc)
  where status = 'submitted' and issue_count > 0;
create index if not exists checklist_assignments_shift_idx
  on public.checklist_assignments (shift_id, checklist_kind);

-- Opaque sessions let an owner-created employee use employee number + PIN before
-- they have an email/Auth account. Only the SHA-256 hash is stored.
create table if not exists public.staff_employee_sessions (
  token_hash text primary key,
  staff_id uuid not null references public.staff(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists staff_employee_sessions_staff_idx
  on public.staff_employee_sessions (staff_id, expires_at desc);

alter table public.checklist_templates enable row level security;
alter table public.checklist_assignments enable row level security;
alter table public.staff_employee_sessions enable row level security;
revoke all on public.checklist_templates from public, anon, authenticated;
revoke all on public.checklist_assignments from public, anon, authenticated;
revoke all on public.staff_employee_sessions from public, anon, authenticated;
grant all on public.checklist_templates to service_role;
grant all on public.checklist_assignments to service_role;
grant all on public.staff_employee_sessions to service_role;

-- Number/PIN verification no longer requires a previous Google sign-in. It returns
-- only server-needed identity facts and still burns bcrypt work for unknown numbers.
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
   where employee_no = p_employee_no and active and pin_hash is not null;

  if not found then
    perform crypt(coalesce(p_pin, ''), gen_salt('bf', 8));
    return jsonb_build_object('ok', false);
  end if;
  if coalesce(p_pin, '') !~ '^[0-9]{6}$' or s.pin_hash <> crypt(p_pin, s.pin_hash) then
    return jsonb_build_object('ok', false);
  end if;

  perform public.pos_log_event(b.branch_id, s.id, 'quick_login', jsonb_build_object('employee_no', p_employee_no))
  from public.pos_branch_settings b where b.enabled;
  return jsonb_build_object(
    'ok', true,
    'staff_id', s.id,
    'email', s.email,
    'auth_user_id', s.auth_user_id,
    'branch_id', s.branch_id,
    'handle', s.handle
  );
end;
$$;

-- A PIN change revokes opaque employee sessions as well as Supabase quick sessions.
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

  update public.staff set pin_hash = crypt(p_pin, gen_salt('bf', 8)), pin_set_at = now() where id = p_target;
  -- Keep the marker: an already-issued JWT must never turn into a privileged
  -- full session merely because the passcode changed.
  update public.staff_employee_sessions set revoked_at = now() where staff_id = p_target and revoked_at is null;

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
  -- Keep the marker until conservative cleanup; the token may still exist.
  update public.staff_employee_sessions set revoked_at = now() where staff_id = p_target and revoked_at is null;

  perform public.pos_log_event(b.branch_id, p_actor, 'pin_changed',
    jsonb_build_object('target_staff', p_target, 'by_self', p_actor = p_target, 'cleared', true))
  from public.pos_branch_settings b where b.enabled;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.pos_clear_old_quick_sessions(p_days int default 90)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n integer;
begin
  delete from public.pos_quick_sessions
   where created_at < now() - make_interval(days => greatest(coalesce(p_days, 90), 90));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Create the expected forms from a published schedule. The first shift of a day
-- gets opening, every shift with a later shift gets handover, and the final shift
-- gets closing. A single shift therefore gets opening + closing.
create or replace function public.sync_checklist_assignments(p_week_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer := 0;
  changed integer := 0;
begin
  with expected as (
    select a.id as shift_assignment_id, a.staff_id, s.id as shift_id, s.branch_id,
           k.kind
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
              and (x.start_time, x.id) > (s.start_time, s.id)
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
  ), ready as (
    select e.*, t.id as template_id, t.version, t.definition
      from expected e
      join public.checklist_templates t
        on t.branch_id = e.branch_id and t.kind = e.kind and t.active
  )
  insert into public.checklist_assignments (
    branch_id, shift_id, shift_assignment_id, staff_id, checklist_kind,
    template_id, template_version, template_snapshot
  )
  select branch_id, shift_id, shift_assignment_id, staff_id, kind,
         template_id, version, definition
    from ready
  on conflict (shift_assignment_id, checklist_kind) do update
    set staff_id = excluded.staff_id,
        template_id = case when public.checklist_assignments.status = 'pending' then excluded.template_id else public.checklist_assignments.template_id end,
        template_version = case when public.checklist_assignments.status = 'pending' then excluded.template_version else public.checklist_assignments.template_version end,
        template_snapshot = case when public.checklist_assignments.status = 'pending' then excluded.template_snapshot else public.checklist_assignments.template_snapshot end,
        updated_at = now();
  get diagnostics inserted_count = row_count;

  delete from public.checklist_assignments ca
   using public.shifts s
   where ca.status = 'pending'
     and ca.shift_id = s.id
     and s.week_id = p_week_id
     and (
       not exists (
         select 1 from public.shift_assignments sa
          where sa.id = ca.shift_assignment_id and sa.staff_id = ca.staff_id
       )
       or not (
         (ca.checklist_kind = 'opening' and not exists (
           select 1 from public.shifts x where x.branch_id = s.branch_id and x.shift_date = s.shift_date
             and (x.start_time, x.id) < (s.start_time, s.id)
         ))
         or (ca.checklist_kind = 'handover' and exists (
           select 1 from public.shifts x where x.branch_id = s.branch_id and x.shift_date = s.shift_date
             and (x.start_time, x.id) > (s.start_time, s.id)
         ))
         or (ca.checklist_kind = 'closing' and not exists (
           select 1 from public.shifts x where x.branch_id = s.branch_id and x.shift_date = s.shift_date
             and (x.start_time, x.id) > (s.start_time, s.id)
         ))
       )
     );
  get diagnostics changed = row_count;
  return inserted_count + changed;
end;
$$;

create or replace function public.checklist_sync_after_publish()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'published' and (old.status is distinct from new.status or old.version is distinct from new.version) then
    perform public.sync_checklist_assignments(new.id);
  end if;
  return new;
end;
$$;

create or replace function public.publish_checklist_template(
  p_actor uuid,
  p_branch_id uuid,
  p_kind text,
  p_name text,
  p_definition jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
  next_version integer;
  w record;
begin
  if p_kind not in ('opening', 'handover', 'closing') then raise exception 'invalid kind'; end if;
  if jsonb_typeof(p_definition->'categories') <> 'array' then raise exception 'invalid definition'; end if;
  if not exists (
    select 1 from public.staff s
     where s.id = p_actor and s.active
       and (s.role = 'owner' or s.badge in ('owner', 'general_manager'))
       and (s.branch_id is null or s.branch_id = p_branch_id)
  ) then raise exception 'not authorized'; end if;

  perform pg_advisory_xact_lock(hashtext('checklist:' || p_branch_id::text || ':' || p_kind));
  select coalesce(max(version), 0) + 1 into next_version
    from public.checklist_templates where branch_id = p_branch_id and kind = p_kind;
  update public.checklist_templates set active = false, updated_at = now()
   where branch_id = p_branch_id and kind = p_kind and active;
  insert into public.checklist_templates (branch_id, kind, name, version, definition, active, created_by)
  values (p_branch_id, p_kind, coalesce(nullif(trim(p_name), ''), p_kind), next_version, p_definition, true, p_actor)
  returning id into new_id;

  update public.checklist_assignments
     set template_id = new_id, template_version = next_version,
         template_snapshot = p_definition, updated_at = now()
   where branch_id = p_branch_id and checklist_kind = p_kind and status = 'pending';

  for w in select id from public.schedule_weeks where branch_id = p_branch_id and status = 'published' loop
    perform public.sync_checklist_assignments(w.id);
  end loop;
  return new_id;
end;
$$;

drop trigger if exists schedule_week_sync_checklists on public.schedule_weeks;
create trigger schedule_week_sync_checklists
  after update of status, version on public.schedule_weeks
  for each row execute function public.checklist_sync_after_publish();

revoke all on function public.pos_verify_pin(integer, text) from public, anon, authenticated;
revoke all on function public.pos_set_pin(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.pos_clear_pin(uuid, uuid) from public, anon, authenticated;
revoke all on function public.sync_checklist_assignments(uuid) from public, anon, authenticated;
revoke all on function public.checklist_sync_after_publish() from public, anon, authenticated;
revoke all on function public.publish_checklist_template(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.pos_verify_pin(integer, text) to service_role;
grant execute on function public.pos_set_pin(uuid, uuid, text) to service_role;
grant execute on function public.pos_clear_pin(uuid, uuid) to service_role;
grant execute on function public.sync_checklist_assignments(uuid) to service_role;
grant execute on function public.publish_checklist_template(uuid, uuid, text, text, jsonb) to service_role;

do $$
begin
  if has_table_privilege('anon', 'public.checklist_assignments', 'select, insert, update, delete')
     or has_table_privilege('authenticated', 'public.checklist_assignments', 'select, insert, update, delete')
     or has_table_privilege('anon', 'public.staff_employee_sessions', 'select, insert, update, delete')
     or has_table_privilege('authenticated', 'public.staff_employee_sessions', 'select, insert, update, delete') then
    raise exception 'verify: checklist/session tables exposed to browser roles';
  end if;
end;
$$;
