-- Customer waitlist: sign-ups to the (future) loyalty club, collected on the kiosk tablet (owner, 2026-10-27).
--
-- Design: docs/SARCAFE_KIOSK_GATE3_ARCHITECTURE.md sections 4, 5, 6 and 7.
--   * customer_waitlist_contacts        one row per person per branch (name, normalized phone, optional e-mail).
--   * customer_waitlist_consent_events  append-only evidence: which notice/terms/consent version, when, marketing yes/no.
--                                       No IP, user agent, device id or free text.
--   * customer_waitlist_attempts        short-lived rate-limit hits keyed by an HMAC of the caller (raw IPs never stored).
--   * customer_waitlist_register()      the ONE entry point for the kiosk's anonymous POST (called by the server with the
--                                       service role): validates, rate-limits, upserts, appends the event, and tells every
--                                       active owner and developer, all in one transaction. A repeat request id is a
--                                       replay: same answer, no second event, no second notification.
--   * customer_waitlist_set_marketing() / customer_waitlist_erase()   owner actions (withdraw / grant marketing, delete).
-- Nothing here is reachable from a browser role: RLS on, every grant revoked, functions service-role only.
-- Notifications carry NO customer data (no name, phone or e-mail): the owner opens /owner/waitlist to see who.

-- ---------------------------------------------------------------------
-- A. Tables
-- ---------------------------------------------------------------------
create table if not exists public.customer_waitlist_contacts (
  id                         uuid primary key default gen_random_uuid(),
  branch_id                  uuid not null references public.branches(id) on delete restrict,
  first_name                 text not null check (char_length(first_name) between 1 and 60),
  normalized_phone           text not null check (normalized_phone ~ '^05[0-9]{8}$'),
  email                      text check (email is null or (char_length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')),
  source                     text not null default 'kiosk',
  current_marketing_consent  boolean not null default false,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  last_interest_at           timestamptz not null default now(),
  unique (branch_id, normalized_phone)
);
create index if not exists customer_waitlist_contacts_recent_idx on public.customer_waitlist_contacts (branch_id, last_interest_at desc);

create table if not exists public.customer_waitlist_consent_events (
  id                      uuid primary key default gen_random_uuid(),
  -- set null (not cascade) on erase: the minimal evidence survives without the person
  contact_id              uuid references public.customer_waitlist_contacts(id) on delete set null,
  event_type              text not null check (event_type in ('interest_registered', 'marketing_granted', 'marketing_withdrawn', 'details_corrected', 'contact_deleted')),
  privacy_notice_version  text not null check (char_length(privacy_notice_version) between 1 and 80),
  consent_text_version    text not null check (char_length(consent_text_version) between 1 and 80),
  terms_version           text not null check (char_length(terms_version) between 1 and 80),
  marketing_consent       boolean not null,
  source                  text not null,
  request_id              uuid not null unique default gen_random_uuid(),
  created_at              timestamptz not null default now()
);
create index if not exists customer_waitlist_consent_events_contact_idx on public.customer_waitlist_consent_events (contact_id, created_at desc);

create table if not exists public.customer_waitlist_attempts (
  id        bigint generated always as identity primary key,
  key_hash  text not null,
  at        timestamptz not null default now()
);
create index if not exists customer_waitlist_attempts_key_idx on public.customer_waitlist_attempts (key_hash, at);

alter table public.customer_waitlist_contacts enable row level security;
alter table public.customer_waitlist_consent_events enable row level security;
alter table public.customer_waitlist_attempts enable row level security;
revoke all on public.customer_waitlist_contacts, public.customer_waitlist_consent_events, public.customer_waitlist_attempts
  from public, anon, authenticated;
grant all on public.customer_waitlist_contacts, public.customer_waitlist_consent_events, public.customer_waitlist_attempts to service_role;

-- ---------------------------------------------------------------------
-- B. customer_waitlist_register: the kiosk's sign-up
-- ---------------------------------------------------------------------
create or replace function public.customer_waitlist_register(
  p_first_name       text,
  p_phone            text,
  p_email            text,
  p_marketing        boolean,
  p_privacy_version  text,
  p_consent_version  text,
  p_terms_version    text,
  p_request_id       uuid,
  p_key_hash         text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch    uuid;
  v_phone     text;
  v_name      text;
  v_email     text;
  v_marketing boolean := coalesce(p_marketing, false);
  v_contact   public.customer_waitlist_contacts%rowtype;
  v_is_new    boolean := false;
  v_recipient record;
  v_title     text := '☕ התעניינות חדשה במועדון סרקפה';
  v_body      text;
begin
  if p_key_hash is null or char_length(p_key_hash) not between 16 and 128 then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;

  -- Rate limit: per caller and for the whole kiosk, over the last hour. Old hits are swept here, so the table stays tiny.
  delete from public.customer_waitlist_attempts where at < now() - interval '2 hours';
  if (select count(*) from public.customer_waitlist_attempts where key_hash = p_key_hash and at > now() - interval '1 hour') >= 12
     or (select count(*) from public.customer_waitlist_attempts where at > now() - interval '1 hour') >= 300 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  insert into public.customer_waitlist_attempts (key_hash) values (p_key_hash);

  -- Validate and normalize. +972 5X... and 05X... both become 05XXXXXXXX.
  v_phone := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if v_phone ~ '^9725[0-9]{8}$' then v_phone := '0' || substr(v_phone, 4); end if;
  if v_phone !~ '^05[0-9]{8}$' then return jsonb_build_object('ok', false, 'error', 'bad_phone'); end if;

  v_name := btrim(regexp_replace(coalesce(p_first_name, ''), '[[:cntrl:]]', '', 'g'));
  if char_length(v_name) not between 1 and 60 then return jsonb_build_object('ok', false, 'error', 'bad_name'); end if;

  v_email := nullif(lower(btrim(coalesce(p_email, ''))), '');
  if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') then
    return jsonb_build_object('ok', false, 'error', 'bad_email');
  end if;

  if p_request_id is null
     or coalesce(char_length(p_privacy_version), 0) not between 1 and 80
     or coalesce(char_length(p_consent_version), 0) not between 1 and 80
     or coalesce(char_length(p_terms_version), 0) not between 1 and 80 then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;

  -- Same request id again (a retry after a dropped answer): the same success, nothing new.
  if exists (select 1 from public.customer_waitlist_consent_events where request_id = p_request_id) then
    return jsonb_build_object('ok', true, 'status', 'replayed');
  end if;

  select id into v_branch from public.branches where slug = 'givat-haviva';
  if v_branch is null then return jsonb_build_object('ok', false, 'error', 'unavailable'); end if;

  select * into v_contact from public.customer_waitlist_contacts
   where branch_id = v_branch and normalized_phone = v_phone for update;
  if not found then
    v_is_new := true;
    insert into public.customer_waitlist_contacts (branch_id, first_name, normalized_phone, email, current_marketing_consent)
    values (v_branch, v_name, v_phone, v_email, v_marketing)
    returning * into v_contact;
  else
    -- A repeat sign-up refreshes the details that were given, and never takes back an earlier marketing yes.
    update public.customer_waitlist_contacts
       set first_name = v_name,
           email = coalesce(v_email, email),
           current_marketing_consent = current_marketing_consent or v_marketing,
           last_interest_at = now(),
           updated_at = now()
     where id = v_contact.id
    returning * into v_contact;
  end if;

  insert into public.customer_waitlist_consent_events
    (contact_id, event_type, privacy_notice_version, consent_text_version, terms_version, marketing_consent, source, request_id)
  values (v_contact.id, 'interest_registered', p_privacy_version, p_consent_version, p_terms_version, v_marketing, 'kiosk', p_request_id);

  -- A marketing yes that is new for this person is its own, separate, dated event.
  if v_marketing and (v_is_new or not exists (
       select 1 from public.customer_waitlist_consent_events
        where contact_id = v_contact.id and event_type = 'marketing_granted')) then
    insert into public.customer_waitlist_consent_events
      (contact_id, event_type, privacy_notice_version, consent_text_version, terms_version, marketing_consent, source)
    values (v_contact.id, 'marketing_granted', p_privacy_version, p_consent_version, p_terms_version, true, 'kiosk');
  end if;

  -- Tell every active owner and developer, once each. No customer data in the text.
  v_body := case when v_is_new
                 then 'לקוח חדש הצטרף לרשימת המתעניינים במועדון הלקוחות הדיגיטלי.'
                 else 'לקוח שכבר ברשימה חידש את ההתעניינות במועדון הלקוחות הדיגיטלי.' end;
  for v_recipient in
    select s.id, (s.role = 'owner' or s.badge = 'owner') as is_owner
      from public.staff s
     where s.active and (s.role = 'owner' or s.badge in ('owner', 'developer'))
  loop
    insert into public.schedule_notifications (branch_id, staff_id, kind, title, body, link)
    values (v_branch, v_recipient.id,
            case when v_recipient.is_owner then 'club.signup' else 'dev.club_signup' end,
            v_title, v_body, jsonb_build_object('url', '/owner/waitlist'));
  end loop;

  return jsonb_build_object('ok', true, 'status', case when v_is_new then 'created' else 'updated' end);
exception
  when unique_violation then
    -- two taps of the same request at the same moment: the first one won
    return jsonb_build_object('ok', true, 'status', 'replayed');
end;
$$;

-- ---------------------------------------------------------------------
-- C. Owner actions
-- ---------------------------------------------------------------------
create or replace function public.customer_waitlist_set_marketing(p_contact_id uuid, p_grant boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact public.customer_waitlist_contacts%rowtype;
begin
  select * into v_contact from public.customer_waitlist_contacts where id = p_contact_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if v_contact.current_marketing_consent = coalesce(p_grant, false) then
    return jsonb_build_object('ok', true, 'status', 'unchanged');
  end if;
  update public.customer_waitlist_contacts
     set current_marketing_consent = coalesce(p_grant, false), updated_at = now()
   where id = v_contact.id;
  insert into public.customer_waitlist_consent_events
    (contact_id, event_type, privacy_notice_version, consent_text_version, terms_version, marketing_consent, source)
  values (v_contact.id,
          case when coalesce(p_grant, false) then 'marketing_granted' else 'marketing_withdrawn' end,
          'owner-action', 'owner-action', 'owner-action', coalesce(p_grant, false), 'owner');
  return jsonb_build_object('ok', true, 'status', 'changed');
end;
$$;

create or replace function public.customer_waitlist_erase(p_contact_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact public.customer_waitlist_contacts%rowtype;
begin
  select * into v_contact from public.customer_waitlist_contacts where id = p_contact_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  -- the deletion itself is recorded without the person (contact_id is already null on this row)
  insert into public.customer_waitlist_consent_events
    (contact_id, event_type, privacy_notice_version, consent_text_version, terms_version, marketing_consent, source)
  values (null, 'contact_deleted', 'owner-action', 'owner-action', 'owner-action', false, 'owner');
  delete from public.customer_waitlist_contacts where id = v_contact.id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------
-- C2. Retention: the privacy notice promises that details are not kept past 12 months from the last interest
-- ---------------------------------------------------------------------
-- Run daily by /api/cron/cleanup-feedback (the same Vercel Cron route that already carries the other retention jobs).
-- A person who signed up again (last_interest_at refreshed) is kept; everyone else is erased, each with a minimal
-- 'contact_deleted' event that has no link to the person.
create or replace function public.customer_waitlist_purge_expired(p_months integer default 12)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  if p_months is null or p_months < 1 then return 0; end if;
  select coalesce(array_agg(id), '{}') into v_ids
    from public.customer_waitlist_contacts
   where last_interest_at < now() - make_interval(months => p_months);
  if coalesce(array_length(v_ids, 1), 0) = 0 then return 0; end if;
  insert into public.customer_waitlist_consent_events
    (contact_id, event_type, privacy_notice_version, consent_text_version, terms_version, marketing_consent, source)
  select null, 'contact_deleted', 'retention', 'retention', 'retention', false, 'retention'
    from unnest(v_ids);
  delete from public.customer_waitlist_contacts where id = any (v_ids);
  return array_length(v_ids, 1);
end;
$$;

-- ---------------------------------------------------------------------
-- D. Access: service role only, exact signatures
-- ---------------------------------------------------------------------
revoke all on function public.customer_waitlist_purge_expired(integer) from public, anon, authenticated;
grant execute on function public.customer_waitlist_purge_expired(integer) to service_role;
revoke all on function public.customer_waitlist_register(text, text, text, boolean, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.customer_waitlist_register(text, text, text, boolean, text, text, text, uuid, text) to service_role;
revoke all on function public.customer_waitlist_set_marketing(uuid, boolean) from public, anon, authenticated;
grant execute on function public.customer_waitlist_set_marketing(uuid, boolean) to service_role;
revoke all on function public.customer_waitlist_erase(uuid) from public, anon, authenticated;
grant execute on function public.customer_waitlist_erase(uuid) to service_role;
