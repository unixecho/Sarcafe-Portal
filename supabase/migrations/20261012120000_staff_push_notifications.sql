-- Staff push notifications (Web Push to the installed home-screen app).
--
-- The customer order page already pushes through VAPID keys, but a customer's subscription
-- belongs to an ORDER (order_push_subscriptions). A staff member's belongs to a PERSON, so
-- the same phone keeps receiving their shift and checklist alerts across shifts.
--
-- How a notification becomes a push, without touching the 20+ places that already write to
-- the in-app inbox: every inbox row (schedule_notifications) is also an outbox row. The app
-- claims rows whose push_sent_at is null, sends them, and stamps them. Rows made by
-- sched_notify() (swaps, requests, publishing, hours sync) and rows the app writes itself
-- (shift reminders, checklist alerts) therefore travel the same road.
--
-- Everything here is service-role only, like the rest of the scheduling tables.

-- ---------------------------------------------------------------------
-- A. One row per browser/phone, owned by one person
-- ---------------------------------------------------------------------
-- endpoint is unique on its own: a push endpoint identifies one browser profile, so when
-- another employee signs in on the same phone the row moves to them (the app upserts).
create table if not exists public.staff_push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  staff_id      uuid not null references public.staff(id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
create index if not exists staff_push_subscriptions_staff_idx on public.staff_push_subscriptions (staff_id);

alter table public.staff_push_subscriptions enable row level security;
revoke all on public.staff_push_subscriptions from public, anon, authenticated;
grant all on public.staff_push_subscriptions to service_role;

-- ---------------------------------------------------------------------
-- B. The inbox doubles as the outbox
-- ---------------------------------------------------------------------
-- push_sent_at: null = not yet pushed. Rows that exist when this runs were already seen in
-- the app, so they are stamped once and never pushed (otherwise the first run would buzz
-- every phone with weeks of old news). The guard keeps a re-run from re-stamping new rows.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'schedule_notifications' and column_name = 'push_sent_at') then
    alter table public.schedule_notifications add column push_sent_at timestamptz;
    update public.schedule_notifications set push_sent_at = now();
  end if;
end
$$;

-- dedupe_key: lets a timed reminder be written at most once per person ("shift-soon:<assignment>").
-- Null for ordinary notifications (nulls never collide in a unique index).
alter table public.schedule_notifications add column if not exists dedupe_key text;
create unique index if not exists schedule_notifications_dedupe_idx on public.schedule_notifications (staff_id, dedupe_key);
create index if not exists schedule_notifications_push_pending_idx on public.schedule_notifications (created_at) where push_sent_at is null;

-- ---------------------------------------------------------------------
-- C. "I am giving up this shift — anyone who is free can have it"
-- ---------------------------------------------------------------------
-- An offer to a NAMED colleague already notifies them (sched_request_swap). An offer open to
-- everyone notified nobody, so it sat unseen until someone happened to open the requests tab.
-- A trigger tells every colleague who could actually take it, whichever function created the
-- swap. A failure here must never block the swap itself.
create or replace function public.sched_notify_open_swap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift uuid;
  v_week date;
  v_who uuid[];
begin
  if new.direction is distinct from 'give' or new.to_staff_id is not null or new.status is distinct from 'open' then
    return new;
  end if;
  select s.id, w.week_start into v_shift, v_week
    from public.shift_assignments a
    join public.shifts s on s.id = a.shift_id
    join public.schedule_weeks w on w.id = s.week_id
   where a.id = new.assignment_id;
  if v_shift is null then
    return new;
  end if;
  select coalesce(array_agg(st.id), '{}'::uuid[]) into v_who
    from public.staff st
   where st.active
     and st.id <> new.from_staff_id
     and public.sched_can_view(st.id, new.branch_id)
     and not exists (select 1 from public.schedule_members m where m.branch_id = new.branch_id and m.staff_id = st.id and not m.schedulable)
     and not exists (select 1 from public.shift_assignments x where x.shift_id = v_shift and x.staff_id = st.id);
  perform public.sched_notify(new.branch_id, v_who, 'swap.open',
    coalesce(new.from_staff_name, 'עובד/ת') || ' מוסר/ת משמרת',
    coalesce(new.terms -> 'from' ->> 'label', '') || E'\n' || 'מי שפנוי/ה יכול/ה לקחת אותה בלשונית הבקשות.',
    jsonb_build_object('tab', 'requests', 'weekStart', v_week));
  return new;
exception when others then
  return new;
end;
$$;

revoke all on function public.sched_notify_open_swap() from public, anon, authenticated;
grant execute on function public.sched_notify_open_swap() to service_role;

drop trigger if exists shift_swaps_notify_open on public.shift_swaps;
create trigger shift_swaps_notify_open
  after insert on public.shift_swaps
  for each row execute function public.sched_notify_open_swap();
