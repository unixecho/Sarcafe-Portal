-- ============================================================
-- Safe to re-run, same discipline as 010/017.
--
-- Customer-facing order access — NOT self-ordering (that still needs the
-- owner's sign-off per SarCafe-ARCHITECTURE-AUDIT.md §9's Phase 2+3 scope
-- and hasn't been given). Staff take the order via the POS (017); this
-- migration only adds what a customer needs to TRACK an order staff
-- already created: a QR code + a written-on-the-receipt 6-digit recovery
-- code, both opaque, both hashed, both with a real expiry — exactly the
-- shape the audit's §7 table specifies.
--
-- SECRET-HANDLING POSTURE, stated once: the plaintext token and recovery
-- code exist ONLY in issue_order_access()'s RETURN value, at the instant
-- they're (re)issued — never persisted anywhere, never retrievable again
-- after that. This is deliberately the same "shown once" contract a
-- password-reset link gets. A failed print or a lost phone is solved by
-- calling issue_order_access() again (a rotation — the old pair stops
-- working the moment a new one is issued), never by reading the old
-- secret back out of the database, because that's not possible by
-- construction.
--
-- The 6-digit recovery code's actual defense against brute force is
-- rate-limiting the calling IP (lib/rate-limit.ts's existing
-- check_rate_limit(), applied in the Route Handler — see
-- /api/order/recover), NOT the hash: a 6-digit space is brute-forceable
-- against any hash algorithm given enough unthrottled guesses. Hashing
-- here is defense-in-depth against a raw database dump, matching the
-- audit's own phrasing ("hashed, rate-limited").
-- ============================================================

create table if not exists public.order_access (
  order_id            uuid primary key references public.orders(id) on delete cascade,
  token_hash          text not null unique,
  recovery_code_hash  text not null,
  expires_at          timestamptz not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- One row per (order, browser push subscription). `page_url` is stored
-- here (not derived server-side later) because the plaintext token is
-- gone by the time a push actually fires — the subscribing browser is
-- the only party that still has it, at subscribe time, so it hands back
-- the deep link to store alongside its own subscription.
create table if not exists public.order_push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  page_url    text not null,
  created_at  timestamptz not null default now(),
  unique (order_id, endpoint)
);

create index if not exists order_push_subscriptions_order_idx on public.order_push_subscriptions (order_id);

-- ---------------------------------------------------------------------
-- hash_order_secret() — sha256 hex, via pgcrypto (already enabled in
-- migration 000). `extensions` added to search_path because Supabase
-- installs pgcrypto into that schema, not `public`, on managed projects.
-- ---------------------------------------------------------------------
create or replace function public.hash_order_secret(p_value text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(digest(p_value, 'sha256'), 'hex')
$$;

revoke execute on function public.hash_order_secret(text) from public;
grant execute on function public.hash_order_secret(text) to service_role;

-- ---------------------------------------------------------------------
-- issue_order_access() — mint (or rotate) an order's access pair. Called
-- by create_order() below at insert time, and directly from
-- lib/orders/dispatch-write.ts for a staff-requested reprint
-- ('regenerateAccess' action) — same function either way, since a
-- reprint IS a rotation, not a distinct operation.
-- ---------------------------------------------------------------------
create or replace function public.issue_order_access(p_order_id uuid, p_ttl_hours integer default 12)
returns table(token text, recovery_code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token   text := encode(gen_random_bytes(20), 'hex');
  v_code    text := lpad(floor(random() * 1000000)::text, 6, '0');
  v_expires timestamptz := now() + make_interval(hours => p_ttl_hours);
begin
  insert into public.order_access (order_id, token_hash, recovery_code_hash, expires_at, updated_at)
  values (p_order_id, public.hash_order_secret(v_token), public.hash_order_secret(v_code), v_expires, now())
  on conflict (order_id) do update
    set token_hash = excluded.token_hash,
        recovery_code_hash = excluded.recovery_code_hash,
        expires_at = excluded.expires_at,
        updated_at = now();

  -- A rotated token invalidates every push subscription that pointed at
  -- the old QR link — they'd otherwise keep firing pushes whose deep link
  -- 404s. The customer's own page re-subscribes silently on next load if
  -- push was already granted (see NotificationPrimer.tsx).
  delete from public.order_push_subscriptions where order_id = p_order_id;

  return query select v_token, v_code, v_expires;
end;
$$;

revoke execute on function public.issue_order_access(uuid, integer) from public;
grant execute on function public.issue_order_access(uuid, integer) to service_role;

-- ---------------------------------------------------------------------
-- verify_order_recovery_code() — plain lookup, no attempt counter here
-- (see header: a bare 6-digit code carries no order identifier to
-- attach a per-order lockout to before it's already matched, so the real
-- throttle is the caller's IP-keyed check_rate_limit(), not this
-- function). Returns null on no-match/expired — the Route Handler must
-- give the same generic error either way, never distinguishing them.
-- ---------------------------------------------------------------------
create or replace function public.verify_order_recovery_code(p_recovery_code text)
returns uuid
language sql
security definer
set search_path = public, extensions
as $$
  select order_id from public.order_access
  where recovery_code_hash = public.hash_order_secret(p_recovery_code)
    and expires_at > now()
  limit 1
$$;

revoke execute on function public.verify_order_recovery_code(text) from public;
grant execute on function public.verify_order_recovery_code(text) to service_role;

-- ---------------------------------------------------------------------
-- cleanup_order_access() — retention job, same shape as
-- cleanup_customer_feedback()/cleanup_rate_limits(). Wired into the
-- existing /api/cron/cleanup-feedback route (see that file) rather than
-- a new Vercel Cron entry — Hobby-tier projects have a low per-project
-- cron count, already spent on keep-alive + cleanup-feedback.
-- ---------------------------------------------------------------------
create or replace function public.cleanup_order_access()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.order_access where expires_at < now() - interval '7 days';
  delete from public.order_push_subscriptions op
    where not exists (select 1 from public.order_access oa where oa.order_id = op.order_id);
$$;

revoke execute on function public.cleanup_order_access() from public;
grant execute on function public.cleanup_order_access() to service_role;

-- ---------------------------------------------------------------------
-- create_order() — extended from migration 017 to also mint the order's
-- first access pair in the same transaction, so the POS receipt (QR +
-- printed code) is ready the instant the order exists. DROP first: the
-- OUT columns changed (three new trailing columns), which CREATE OR
-- REPLACE cannot do for a RETURNS TABLE function — same rule 015's
-- header documents for the availability functions it re-signatured.
-- ---------------------------------------------------------------------
drop function if exists public.create_order(uuid, uuid, text, text, text, text, jsonb);

create or replace function public.create_order(
  p_branch_id uuid,
  p_created_by uuid,
  p_created_by_name text,
  p_customer_name text,
  p_notes text,
  p_payment_method text,
  p_items jsonb
) returns table(id uuid, order_number integer, token text, recovery_code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tz         text;
  v_local_date date;
  v_counter    integer;
  v_order_id   uuid := gen_random_uuid();
  v_subtotal   numeric(10, 2) := 0;
  v_item       jsonb;
  v_menu_id    uuid;
  v_draft      jsonb;
  v_published  jsonb;
  v_sort       integer := 0;
  v_access     record;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'An order needs at least one item.';
  end if;

  select timezone into v_tz from public.branches where id = p_branch_id;
  if v_tz is null then
    raise exception 'Branch not found.';
  end if;
  v_local_date := (now() at time zone v_tz)::date;

  update public.order_counters
  set counter = case when order_date = v_local_date then counter + 1 else 1 end,
      order_date = v_local_date
  where branch_id = p_branch_id
  returning counter into v_counter;

  if not found then
    insert into public.order_counters (branch_id, order_date, counter)
    values (p_branch_id, v_local_date, 1)
    returning counter into v_counter;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if coalesce((v_item->>'unitPrice')::numeric, -1) < 0 or coalesce((v_item->>'quantity')::integer, 0) < 1 then
      raise exception 'Invalid order line.';
    end if;
    v_subtotal := v_subtotal + (v_item->>'unitPrice')::numeric * (v_item->>'quantity')::integer;
  end loop;

  insert into public.orders (
    id, branch_id, order_number, status, customer_name, notes, subtotal, total,
    payment_status, payment_method, created_by, created_by_name
  ) values (
    v_order_id, p_branch_id, v_counter, 'new',
    nullif(trim(coalesce(p_customer_name, '')), ''), nullif(trim(coalesce(p_notes, '')), ''),
    v_subtotal, v_subtotal, 'unpaid', p_payment_method, p_created_by, p_created_by_name
  );

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.order_items (
      order_id, item_uid, item_name, type_uid, type_name, unit_price, quantity, line_total, notes, sort_order
    ) values (
      v_order_id,
      v_item->>'itemUid',
      coalesce(v_item->'itemName', '{}'::jsonb),
      v_item->>'typeUid',
      v_item->'typeName',
      (v_item->>'unitPrice')::numeric,
      (v_item->>'quantity')::integer,
      (v_item->>'unitPrice')::numeric * (v_item->>'quantity')::integer,
      nullif(trim(coalesce(v_item->>'notes', '')), ''),
      v_sort
    );
    v_sort := v_sort + 1;
  end loop;

  select id into v_menu_id from public.menus where branch_id = p_branch_id;
  if v_menu_id is not null then
    select draft, published into v_draft, v_published from public.menus where id = v_menu_id for update;

    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_draft := public.decrement_item_quantity_in_doc(
        v_draft, v_item->>'itemUid', v_item->>'typeUid', (v_item->>'quantity')::integer
      );
      v_published := public.decrement_item_quantity_in_doc(
        v_published, v_item->>'itemUid', v_item->>'typeUid', (v_item->>'quantity')::integer
      );
    end loop;

    update public.menus
    set draft = v_draft, published = v_published, updated_at = now()
    where id = v_menu_id;
  end if;

  select * into v_access from public.issue_order_access(v_order_id);

  return query select v_order_id, v_counter, v_access.token, v_access.recovery_code, v_access.expires_at;
end;
$$;

revoke execute on function public.create_order(uuid, uuid, text, text, text, text, jsonb) from public;
grant execute on function public.create_order(uuid, uuid, text, text, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------
-- RLS — no policies on either table for anon/authenticated at all
-- (service-role only), same posture order_counters already established:
-- these are implementation details of the RPCs above, never read or
-- written directly by app code.
-- ---------------------------------------------------------------------
alter table public.order_access enable row level security;
alter table public.order_push_subscriptions enable row level security;

grant all on public.order_access, public.order_push_subscriptions to service_role;
