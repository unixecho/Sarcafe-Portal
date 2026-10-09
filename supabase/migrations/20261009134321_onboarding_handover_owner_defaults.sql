-- Operational onboarding/scheduling corrections.
-- Browser roles receive no new table or function privileges in this migration.

-- Every staffed shift on a day with more than one shift participates in the
-- handover. This gives the earlier employee an end-of-shift handover and the
-- later employee a start-of-shift handover. Pending rows are remapped; started
-- and submitted forms keep their immutable assignment/snapshot.
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
             and x.id <> s.id
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

revoke all on function public.sync_checklist_assignments(uuid) from public, anon, authenticated;
grant execute on function public.sync_checklist_assignments(uuid) to service_role;

-- Existing and future operators are deliberately absent from normal scheduling
-- until an owner explicitly enables them for a branch. ON CONFLICT DO NOTHING
-- preserves every previously explicit scheduling choice.
insert into public.schedule_members (branch_id, staff_id, schedulable, updated_at)
select b.id, s.id, false, now()
  from public.branches b
  cross join public.staff s
 where b.active
   and s.active
   and (s.role = 'owner' or s.badge in ('owner', 'developer'))
on conflict (branch_id, staff_id) do nothing;

create or replace function public.schedule_operator_defaults_after_staff_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.active and (new.role = 'owner' or new.badge in ('owner', 'developer')) then
    if tg_op = 'INSERT' or not (old.active and (old.role = 'owner' or old.badge in ('owner', 'developer'))) then
      insert into public.schedule_members (branch_id, staff_id, schedulable, updated_at)
      select b.id, new.id, false, now()
        from public.branches b
       where b.active
      on conflict (branch_id, staff_id) do update
        set schedulable = false, updated_at = now();
    else
      insert into public.schedule_members (branch_id, staff_id, schedulable, updated_at)
      select b.id, new.id, false, now()
        from public.branches b
       where b.active
      on conflict (branch_id, staff_id) do nothing;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists schedule_operator_defaults_staff on public.staff;
create trigger schedule_operator_defaults_staff
  after insert or update of role, badge, active on public.staff
  for each row execute function public.schedule_operator_defaults_after_staff_write();

create or replace function public.schedule_operator_defaults_after_branch_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.active then
    insert into public.schedule_members (branch_id, staff_id, schedulable, updated_at)
    select new.id, s.id, false, now()
      from public.staff s
     where s.active and (s.role = 'owner' or s.badge in ('owner', 'developer'))
    on conflict (branch_id, staff_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists schedule_operator_defaults_branch on public.branches;
create trigger schedule_operator_defaults_branch
  after insert or update of active on public.branches
  for each row execute function public.schedule_operator_defaults_after_branch_write();

revoke all on function public.schedule_operator_defaults_after_staff_write() from public, anon, authenticated;
revoke all on function public.schedule_operator_defaults_after_branch_write() from public, anon, authenticated;

do $$
declare
  published_week record;
begin
  for published_week in select id from public.schedule_weeks where status = 'published' loop
    perform public.sync_checklist_assignments(published_week.id);
  end loop;
end;
$$;
