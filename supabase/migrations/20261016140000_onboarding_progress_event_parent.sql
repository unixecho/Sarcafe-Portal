-- Three small additions, all additive.
--
--  1. staff.onboarding_done_at: when a person finished the onboarding walk (code, Google, details, tour). Someone who set
--     their code but did not finish is sent back to the walk on their next visit (that is the "recovery": an app that was
--     closed, a phone that was changed, a tour never seen). EVERY person who exists today is marked done once, when the
--     column is created: nobody already working is sent through a wizard they have long passed. People created later start
--     with null; the owner regenerating someone's link resets it (a new phone starts again).
--  2. staff.push_gate_exempt: the owner can let one employee in without notifications (a phone that cannot do push at all).
--     Everyone else on the staff pages must have notifications on (the gate); this is the recovery for the exception.
--  3. branches.parent_branch_id: an EVENT (a stall the POS trades at) belongs to a coffee truck, so the POS is a subsystem of
--     a branch instead of a sibling of the trucks. Only an event may have a parent, and the parent must be a permanent
--     branch. branch_set_parent() is the owner's way to (re)assign it. Existing events keep no parent until assigned.
--
-- Service role only for the new function, like every owner function.

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'staff' and column_name = 'onboarding_done_at') then
    alter table public.staff add column onboarding_done_at timestamptz;
    update public.staff set onboarding_done_at = now();
  end if;
end;
$$;
comment on column public.staff.onboarding_done_at is 'When the person finished the onboarding walk. null = not yet (resume it). Everyone existing on 2026-10-16 was marked done.';

alter table public.staff add column if not exists push_gate_exempt boolean not null default false;
comment on column public.staff.push_gate_exempt is 'The owner lets this employee use the staff pages without notifications on (a device that cannot do push).';

alter table public.branches add column if not exists parent_branch_id uuid references public.branches(id) on delete set null;
comment on column public.branches.parent_branch_id is 'For an event: the coffee truck (permanent branch) whose POS subsystem it belongs to.';
create index if not exists branches_parent_idx on public.branches (parent_branch_id) where parent_branch_id is not null;

create or replace function public.branches_parent_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.parent_branch_id is null then return new; end if;
  if new.kind <> 'event' then raise exception 'branch_parent_only_events'; end if;
  if new.parent_branch_id = new.id then raise exception 'branch_parent_self'; end if;
  if not exists (select 1 from public.branches p where p.id = new.parent_branch_id and p.kind = 'permanent') then
    raise exception 'branch_parent_not_a_truck';
  end if;
  return new;
end;
$$;

drop trigger if exists branches_parent_guard on public.branches;
create trigger branches_parent_guard
  before insert or update of parent_branch_id, kind on public.branches
  for each row execute function public.branches_parent_guard();

-- The owner (re)assigns an event to a truck, or detaches it (p_parent null). Returns { ok } or { ok:false, reason }.
create or replace function public.branch_set_parent(p_actor uuid, p_event uuid, p_parent uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.sched_is_op(p_actor) then return public.sched_fail('forbidden'); end if;
  if not exists (select 1 from public.branches where id = p_event and kind = 'event' and active) then return public.sched_fail('not_found'); end if;
  if p_parent is not null and not exists (select 1 from public.branches where id = p_parent and kind = 'permanent' and active) then
    return public.sched_fail('bad_target');
  end if;
  update public.branches set parent_branch_id = p_parent where id = p_event;
  perform public.sched_log(coalesce(p_parent, p_event), p_actor, 'branch.parent',
    case when p_parent is null then 'ניתק/ה אירוע מהסניף שלו' else 'שייך/ה אירוע לסניף' end,
    jsonb_build_object('event', p_event, 'parent', p_parent));
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.branch_set_parent(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.branch_set_parent(uuid, uuid, uuid) to service_role;
