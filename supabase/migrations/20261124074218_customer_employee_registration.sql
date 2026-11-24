-- 20261124074218_customer_employee_registration
--
-- FABLE-003 (docs/identity-system/fable-tasks/FABLE-003.md, docs/SARCAFE_IDENTITY.md): an organization's employees register through
-- a link their department head (or the organization's administrator) gives them, with first and last name, a nickname and a private
-- photograph; the application waits for an authorized reviewer, who approves, rejects, deactivates or reactivates it.
-- Nothing from the two earlier identity migrations is changed (their functions, tables, triggers and rules stay as verified; this
-- file only ADDS one unique index on customer_org_memberships, which the new scoped foreign keys need). No staff, owner, scheduler,
-- checklist, POS, kiosk or waitlist object is touched, and nothing here creates a staff row, an auth account or a POS / scheduler
-- right: an approved employee is a member of ONE organization, never Sarcafe staff.
--
-- THE FLOW
--   1. A reviewer of a department (customer_dept_review_check: its department head, or an administrator of its organization) makes
--      a single-use registration link (customer_registration_invite_create). Only the token's digest is stored.
--   2. The employee opens the link, signs in with Google and trades the link for a REGISTRATION SESSION
--      (customer_registration_open): short (at most two hours), bound to that one link AND that one signed-in user, able to do
--      exactly one thing (submit one application). It is not a staff session and opens nothing else.
--   3. The photo is checked and re-encoded by the server (src/lib/identity/server/photo.ts) BEFORE anything is stored here; the row
--      is written first in state 'uploading' (customer_photo_intent), then the object is uploaded, then the application is
--      submitted (customer_registration_submit), which links the photo, writes the member, the pending membership, the profile and
--      the consent evidence, and consumes the link, in ONE transaction. An upload that never becomes part of an application stays
--      'uploading' and is discarded by the cleanup job (customer_photo_cleanup_due / _done): nothing is left behind silently.
--   4. A reviewer approves or rejects (customer_membership_review). NOBODY reviews their own application. A pending application
--      gives nothing; only an approved membership will be eligible for anything (later slices read state AND version).
--   5. A change to the name, the nickname or the photo by the employee (customer_membership_resubmit) sends the membership back to
--      'pending': it is reviewed again before it counts again.
--   6. Deactivation takes effect at once (state + version), so later credentials and verifications, which bind to the version,
--      stop working immediately.
--
-- COLLECTION IS CLOSED UNTIL A NOTICE IS PUBLISHED. A registration needs the currently published, versioned notice for its purpose
-- (customer_notices). No notice is seeded: real collection of employee names and photos starts only after the business writes,
-- reviews and publishes one (the retention it decides is stored with it). Until then every registration answers 'closed'.
--
-- PHOTOS are private: bucket customer-identity-photos (public = false, browser roles denied by a restrictive policy), opaque object
-- names (org/<organization id>/<photo id>.jpg, never a name or a phone number), read only through the server proxy after
-- customer_photo_open rechecks the viewer and writes an audit row. No signed URL, no public URL, no listing.
--
-- Refusals say nothing: 'bad_request' for a malformed call, 'denied' for everything about authority or existence. After authority
-- has passed: 'conflict' (already registered, already decided), 'limit', 'stale' (the version or notice the screen showed is no
-- longer current), 'closed' (no published notice).
--
-- Additive and idempotent (applies twice). RLS on every new table, no policy; browser roles get nothing; service_role gets select /
-- insert / update (consent: select / insert) and execute on the fourteen functions below. No row is seeded.

-- ---------------------------------------------------------------- notices (the text a person agrees to, versioned)

create table if not exists public.customer_notices (
  id            uuid primary key default gen_random_uuid(),
  purpose       text not null check (purpose in ('employee_registration')),
  language      text not null check (language in ('he', 'en', 'ar')),
  version       text not null check (version ~ '^[a-z0-9][a-z0-9._-]{0,39}$'),
  body          text not null check (char_length(btrim(body)) between 20 and 8000),
  state         text not null default 'draft' check (state in ('draft', 'published', 'retired')),
  -- what the business decided WITH this text, in days ({ "rejected_days": n, "replaced_photo_days": n }); a missing key means "not
  -- decided", and then nothing of that kind is deleted by age (no duration is guessed here)
  retention     jsonb not null default '{}'::jsonb check (jsonb_typeof(retention) = 'object' and octet_length(retention::text) <= 500),
  created_at    timestamptz not null default now(),
  published_at  timestamptz,
  unique (purpose, language, version),
  constraint customer_notices_published_check check ((state = 'draft') = (published_at is null))
);
-- one published text per purpose and language
create unique index if not exists customer_notices_published_idx on public.customer_notices (purpose, language) where state = 'published';

-- ---------------------------------------------------------------- the registration link and session

create table if not exists public.customer_registration_invites (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.customer_organizations(id) on delete restrict,
  department_id           uuid not null,
  -- sha-256 (hex) of the purpose-prefixed token in the link. The token itself is never stored.
  token_digest            text not null unique check (token_digest ~ '^[0-9a-f]{64}$'),
  -- a plain value (no foreign key), like the audit's actor: the record outlives the issuer
  issued_by_auth_user_id  uuid not null,
  created_at              timestamptz not null default now(),
  expires_at              timestamptz not null,
  revoked_at              timestamptz,
  revoked_reason          text check (revoked_reason is null or char_length(revoked_reason) between 1 and 300),
  consumed_at             timestamptz,
  membership_id           uuid,
  constraint customer_registration_invites_department_fk foreign key (organization_id, department_id)
    references public.customer_departments (organization_id, id) on delete restrict,
  constraint customer_registration_invites_expiry_check check (expires_at > created_at),
  constraint customer_registration_invites_consumed_check check ((consumed_at is null) = (membership_id is null)),
  constraint customer_registration_invites_one_end_check check (consumed_at is null or revoked_at is null)
);
create index if not exists customer_registration_invites_department_idx on public.customer_registration_invites (organization_id, department_id);

create table if not exists public.customer_registration_sessions (
  id             uuid primary key default gen_random_uuid(),
  invite_id      uuid not null references public.customer_registration_invites(id) on delete restrict,
  -- the signed-in user the session belongs to (a plain value: a session must not stop an auth account from being removed)
  auth_user_id   uuid not null,
  token_digest   text not null unique check (token_digest ~ '^[0-9a-f]{64}$'),
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  revoked_at     timestamptz,
  used_at        timestamptz,
  constraint customer_registration_sessions_expiry_check check (expires_at > created_at and expires_at <= created_at + interval '2 hours'),
  constraint customer_registration_sessions_one_end_check check (used_at is null or revoked_at is null)
);
create index if not exists customer_registration_sessions_invite_idx on public.customer_registration_sessions (invite_id);
create index if not exists customer_registration_sessions_user_idx on public.customer_registration_sessions (auth_user_id);

-- ---------------------------------------------------------------- what the organization knows about its employee

-- the target of the scoped references below: (organization_id, membership_id) must name a real pair
create unique index if not exists customer_org_memberships_scope_idx on public.customer_org_memberships (organization_id, id);

alter table public.customer_registration_invites drop constraint if exists customer_registration_invites_membership_fk;
alter table public.customer_registration_invites add constraint customer_registration_invites_membership_fk foreign key (organization_id, membership_id)
  references public.customer_org_memberships (organization_id, id) on delete restrict;
create index if not exists customer_registration_invites_membership_idx on public.customer_registration_invites (organization_id, membership_id) where membership_id is not null;

-- The names THIS organization holds for the person, and who applied. Never matched against anything: two employees with the same
-- names are two people. erased_at: the names were removed under the published retention (the membership row stays, ids only).
create table if not exists public.customer_member_profiles (
  membership_id           uuid primary key,
  organization_id         uuid not null,
  applicant_principal_id  uuid not null references public.customer_principals(id) on delete restrict,
  first_name              text check (first_name is null or char_length(first_name) between 1 and 60),
  last_name               text check (last_name is null or char_length(last_name) between 1 and 60),
  nickname                text check (nickname is null or char_length(nickname) between 1 and 40),
  version                 integer not null default 1 check (version >= 1),
  submitted_at            timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  erase_after             timestamptz,
  erased_at               timestamptz,
  constraint customer_member_profiles_membership_fk foreign key (organization_id, membership_id)
    references public.customer_org_memberships (organization_id, id) on delete restrict,
  constraint customer_member_profiles_names_check check ((erased_at is null) = (first_name is not null and last_name is not null)),
  constraint customer_member_profiles_erased_check check (erased_at is null or nickname is null)
);
-- one application per person and organization
create unique index if not exists customer_member_profiles_applicant_idx on public.customer_member_profiles (organization_id, applicant_principal_id);
create index if not exists customer_member_profiles_principal_idx on public.customer_member_profiles (applicant_principal_id);

-- ---------------------------------------------------------------- photographs (the image is in private storage, never here)

create table if not exists public.customer_member_photos (
  id                        uuid primary key,
  organization_id           uuid not null references public.customer_organizations(id) on delete restrict,
  session_id                uuid references public.customer_registration_sessions(id) on delete restrict,
  membership_id             uuid,
  uploaded_by_auth_user_id  uuid not null,
  object_path               text not null unique check (object_path ~ '^org/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'),
  state                     text not null default 'uploading' check (state in ('uploading', 'pending', 'approved', 'replaced', 'rejected', 'discarded', 'erased')),
  content_type              text not null default 'image/jpeg' check (content_type = 'image/jpeg'),
  width                     integer not null check (width between 64 and 2048),
  height                    integer not null check (height between 64 and 2048),
  byte_size                 integer not null check (byte_size between 1 and 2097152),
  sha256                    text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at                timestamptz not null default now(),
  decided_at                timestamptz,
  erase_after               timestamptz,
  erased_at                 timestamptz,
  constraint customer_member_photos_membership_fk foreign key (organization_id, membership_id)
    references public.customer_org_memberships (organization_id, id) on delete restrict,
  -- an object path names its own organization and photo id (so a row can never point at another tenant's object)
  constraint customer_member_photos_path_check check (object_path = 'org/' || organization_id::text || '/' || id::text || '.jpg'),
  -- every photo that is part of an application belongs to it
  constraint customer_member_photos_owner_check check (membership_id is not null or state in ('uploading', 'discarded', 'erased')),
  constraint customer_member_photos_origin_check check (session_id is not null or membership_id is not null),
  constraint customer_member_photos_erased_check check ((state = 'erased') = (erased_at is not null))
);
create unique index if not exists customer_member_photos_pending_idx on public.customer_member_photos (membership_id) where state = 'pending';
create unique index if not exists customer_member_photos_approved_idx on public.customer_member_photos (membership_id) where state = 'approved';
create index if not exists customer_member_photos_membership_idx on public.customer_member_photos (organization_id, membership_id) where membership_id is not null;
create index if not exists customer_member_photos_session_idx on public.customer_member_photos (session_id) where session_id is not null;
create index if not exists customer_member_photos_due_idx on public.customer_member_photos (state, created_at) where state in ('uploading', 'rejected', 'replaced');

-- ---------------------------------------------------------------- consent evidence (append-only)

create table if not exists public.customer_consent_events (
  id                  uuid primary key default gen_random_uuid(),
  at                  timestamptz not null default now(),
  organization_id     uuid not null,
  membership_id       uuid not null,
  notice_id           uuid not null references public.customer_notices(id) on delete restrict,
  purpose             text not null check (purpose in ('employee_registration')),
  action              text not null check (action in ('accept', 'withdraw')),
  actor_auth_user_id  uuid not null,
  constraint customer_consent_events_membership_fk foreign key (organization_id, membership_id)
    references public.customer_org_memberships (organization_id, id) on delete restrict
);
create index if not exists customer_consent_events_membership_idx on public.customer_consent_events (organization_id, membership_id, at desc);
create index if not exists customer_consent_events_notice_idx on public.customer_consent_events (notice_id);

-- ---------------------------------------------------------------- access: RLS on, browser roles nothing, service role the minimum

alter table public.customer_notices enable row level security;
alter table public.customer_registration_invites enable row level security;
alter table public.customer_registration_sessions enable row level security;
alter table public.customer_member_profiles enable row level security;
alter table public.customer_member_photos enable row level security;
alter table public.customer_consent_events enable row level security;

revoke all on public.customer_notices, public.customer_registration_invites, public.customer_registration_sessions,
  public.customer_member_profiles, public.customer_member_photos, public.customer_consent_events
  from public, anon, authenticated, service_role;
grant select, insert, update on public.customer_notices, public.customer_registration_invites, public.customer_registration_sessions,
  public.customer_member_profiles, public.customer_member_photos to service_role;
grant select, insert on public.customer_consent_events to service_role;

-- ---------------------------------------------------------------- triggers

-- Append-only (consent evidence): no update, no delete, also for the service role and the table owner.
create or replace function public.customer_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'customer identity: % is append-only', tg_table_name using errcode = '23514';
end;
$$;
revoke all on function public.customer_append_only() from public, anon, authenticated, service_role;

-- A photo row's facts never change; its membership is set once (null -> the membership); a discarded or erased photo is final.
create or replace function public.customer_member_photos_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.membership_id is not null and new.membership_id is distinct from old.membership_id then
    raise exception 'customer identity: a photo cannot move to another membership' using errcode = '23514';
  end if;
  if old.state in ('discarded', 'erased') and new.state is distinct from old.state then
    raise exception 'customer identity: a discarded or erased photo is final' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.customer_member_photos_guard() from public, anon, authenticated, service_role;

drop trigger if exists customer_notices_keep on public.customer_notices;
create trigger customer_notices_keep before update on public.customer_notices
  for each row execute function public.customer_keep_columns('id', 'purpose', 'language', 'version', 'body', 'retention', 'created_at');
drop trigger if exists customer_registration_invites_keep on public.customer_registration_invites;
create trigger customer_registration_invites_keep before update on public.customer_registration_invites
  for each row execute function public.customer_keep_columns('id', 'organization_id', 'department_id', 'token_digest', 'issued_by_auth_user_id', 'created_at', 'expires_at');
-- a used or revoked link is final (the FABLE-002 trigger function: it reads only consumed_at and revoked_at)
drop trigger if exists customer_registration_invites_final on public.customer_registration_invites;
create trigger customer_registration_invites_final before update on public.customer_registration_invites
  for each row execute function public.customer_invitations_final();
drop trigger if exists customer_registration_sessions_keep on public.customer_registration_sessions;
create trigger customer_registration_sessions_keep before update on public.customer_registration_sessions
  for each row execute function public.customer_keep_columns('id', 'invite_id', 'auth_user_id', 'token_digest', 'created_at', 'expires_at');
drop trigger if exists customer_member_profiles_keep on public.customer_member_profiles;
create trigger customer_member_profiles_keep before update on public.customer_member_profiles
  for each row execute function public.customer_keep_columns('membership_id', 'organization_id', 'applicant_principal_id', 'submitted_at');
drop trigger if exists customer_member_photos_keep on public.customer_member_photos;
create trigger customer_member_photos_keep before update on public.customer_member_photos
  for each row execute function public.customer_keep_columns('id', 'organization_id', 'session_id', 'uploaded_by_auth_user_id', 'object_path', 'content_type', 'width', 'height', 'byte_size', 'sha256', 'created_at');
drop trigger if exists customer_member_photos_guard on public.customer_member_photos;
create trigger customer_member_photos_guard before update on public.customer_member_photos
  for each row execute function public.customer_member_photos_guard();
drop trigger if exists customer_consent_events_keep on public.customer_consent_events;
create trigger customer_consent_events_keep before update or delete on public.customer_consent_events
  for each row execute function public.customer_append_only();

-- ---------------------------------------------------------------- the private photo bucket

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('customer-identity-photos', 'customer-identity-photos', false, 2097152, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Restrictive: no browser role reads, lists or writes this bucket, even if a permissive storage policy is added later. Only the
-- server (service role) reaches it, and only after customer_photo_open.
drop policy if exists customer_identity_photos_browser_deny on storage.objects;
create policy customer_identity_photos_browser_deny on storage.objects as restrictive
  for all to anon, authenticated
  using (bucket_id <> 'customer-identity-photos') with check (bucket_id <> 'customer-identity-photos');

-- ---------------------------------------------------------------- who may review a department

-- { ok: true, via: 'department_head' | 'organization_admin', grant_id, principal_id } or { ok: false, error }
-- The department's own head (a live department_head grant on exactly this pair), or an administrator of its organization. The
-- organization and the department must both be active. A business owner (also in setup), a general manager, a schedule delegate
-- and anyone else never pass: an organization's employees are reviewed by the organization's own people. Reads only.
create or replace function public.customer_dept_review_check(p_auth_user_id uuid, p_organization_id uuid, p_department_id uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_check jsonb;
begin
  if p_auth_user_id is null or p_organization_id is null or p_department_id is null then return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;
  if not exists (
    select 1 from public.customer_departments d
      join public.customer_organizations o on o.id = d.organization_id and o.state = 'active'
     where d.id = p_department_id and d.organization_id = p_organization_id and d.state = 'active') then
    return jsonb_build_object('ok', false, 'error', 'denied');
  end if;
  v_check := public.customer_access_check(p_auth_user_id, 'department_head', null, p_organization_id, p_department_id);
  if coalesce((v_check ->> 'ok')::boolean, false) and v_check ->> 'via' = 'grant' then
    return jsonb_build_object('ok', true, 'via', 'department_head', 'grant_id', v_check -> 'grant_id', 'principal_id', v_check -> 'principal_id');
  end if;
  v_check := public.customer_access_check(p_auth_user_id, 'organization_admin', null, p_organization_id, null);
  if coalesce((v_check ->> 'ok')::boolean, false) and v_check ->> 'via' = 'grant' then
    return jsonb_build_object('ok', true, 'via', 'organization_admin', 'grant_id', v_check -> 'grant_id', 'principal_id', v_check -> 'principal_id');
  end if;
  return jsonb_build_object('ok', false, 'error', 'denied');
end;
$$;
revoke all on function public.customer_dept_review_check(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.customer_dept_review_check(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------- registration links

-- A single-use link for ONE employee of ONE department, for at most 14 days. The server made the token and passes only its digest.
create or replace function public.customer_registration_invite_create(p_actor_auth_user_id uuid, p_organization_id uuid, p_department_id uuid, p_token_digest text, p_expires_at timestamptz)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_actor jsonb;
  v_invite uuid;
begin
  if p_actor_auth_user_id is null or p_organization_id is null or p_department_id is null
     or p_token_digest is null or p_token_digest !~ '^[0-9a-f]{64}$'
     or p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '14 days' then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  perform 1 from public.customer_organizations o where o.id = p_organization_id for update;
  v_actor := public.customer_dept_review_check(p_actor_auth_user_id, p_organization_id, p_department_id);
  if not coalesce((v_actor ->> 'ok')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'denied'); end if;
  if exists (select 1 from public.customer_registration_invites i where i.token_digest = p_token_digest) then return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;
  if (select count(*) from public.customer_registration_invites i
       where i.organization_id = p_organization_id and i.department_id = p_department_id and i.consumed_at is null and i.revoked_at is null and i.expires_at > now()) >= 100 then
    return jsonb_build_object('ok', false, 'error', 'limit');
  end if;
  insert into public.customer_registration_invites (organization_id, department_id, token_digest, issued_by_auth_user_id, expires_at)
  values (p_organization_id, p_department_id, p_token_digest, p_actor_auth_user_id, p_expires_at)
  returning id into v_invite;
  insert into public.customer_identity_audit (organization_id, actor_auth_user_id, actor_principal_id, operation, target_table, target_id, detail)
  values (p_organization_id, p_actor_auth_user_id, (v_actor ->> 'principal_id')::uuid, 'registration_invite.create', 'customer_registration_invites', v_invite,
          jsonb_build_object('department_id', p_department_id, 'expires_at', p_expires_at, 'actor_via', v_actor ->> 'via'));
  return jsonb_build_object('ok', true, 'status', 'created', 'invite_id', v_invite, 'expires_at', p_expires_at);
end;
$$;
revoke all on function public.customer_registration_invite_create(uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.customer_registration_invite_create(uuid, uuid, uuid, text, timestamptz) to service_role;

-- Ends an open link now (its open sessions with it). Unknown and out-of-scope answer the same; a used link is 'conflict'.
create or replace function public.customer_registration_invite_revoke(p_actor_auth_user_id uuid, p_invite_id uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_invite public.customer_registration_invites%rowtype;
  v_actor jsonb;
begin
  if p_actor_auth_user_id is null or p_invite_id is null then return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;
  select * into v_invite from public.customer_registration_invites i where i.id = p_invite_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'denied'); end if;
  perform 1 from public.customer_organizations o where o.id = v_invite.organization_id for update;
  select * into v_invite from public.customer_registration_invites i where i.id = p_invite_id for update;
  v_actor := public.customer_dept_review_check(p_actor_auth_user_id, v_invite.organization_id, v_invite.department_id);
  if not coalesce((v_actor ->> 'ok')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'denied'); end if;
  if v_invite.consumed_at is not null then return jsonb_build_object('ok', false, 'error', 'conflict'); end if;
  if v_invite.revoked_at is not null then return jsonb_build_object('ok', true, 'status', 'unchanged', 'invite_id', v_invite.id); end if;
  update public.customer_registration_invites set revoked_at = now(), revoked_reason = 'revoked' where id = v_invite.id;
  update public.customer_registration_sessions set revoked_at = now() where invite_id = v_invite.id and revoked_at is null and used_at is null;
  insert into public.customer_identity_audit (organization_id, actor_auth_user_id, actor_principal_id, operation, target_table, target_id, detail)
  values (v_invite.organization_id, p_actor_auth_user_id, (v_actor ->> 'principal_id')::uuid, 'registration_invite.revoke', 'customer_registration_invites', v_invite.id,
          jsonb_build_object('department_id', v_invite.department_id, 'actor_via', v_actor ->> 'via'));
  return jsonb_build_object('ok', true, 'status', 'revoked', 'invite_id', v_invite.id);
end;
$$;
revoke all on function public.customer_registration_invite_revoke(uuid, uuid) from public, anon, authenticated;
grant execute on function public.customer_registration_invite_revoke(uuid, uuid) to service_role;

-- ---------------------------------------------------------------- the registration session

-- Trades an open link for a registration session of the signed-in user (a proven Google sign-in, checked by the server). Refused
-- ('denied'): unknown, used, revoked or expired link; switched-off department or organization; an issuer who may no longer review
-- that department; the issuer themselves; a switched-off principal. 'closed': no published notice. 'conflict': this person already
-- has an application in this organization. 'limit': the link was opened too many times. The person's earlier open session on the
-- same link is ended (one at a time). Returns the names and the notice to show. Writes one audit row.
create or replace function public.customer_registration_open(p_token_digest text, p_auth_user_id uuid, p_session_digest text, p_expires_at timestamptz)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_denied constant jsonb := jsonb_build_object('ok', false, 'error', 'denied');
  v_organization uuid;
  v_invite public.customer_registration_invites%rowtype;
  v_notice public.customer_notices%rowtype;
  v_names record;
  v_session uuid;
begin
  if p_auth_user_id is null or p_token_digest is null or p_token_digest !~ '^[0-9a-f]{64}$'
     or p_session_digest is null or p_session_digest !~ '^[0-9a-f]{64}$'
     or p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '2 hours' then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  select i.organization_id into v_organization from public.customer_registration_invites i where i.token_digest = p_token_digest;
  if not found then return v_denied; end if;
  perform 1 from public.customer_organizations o where o.id = v_organization for update;
  select * into v_invite from public.customer_registration_invites i where i.token_digest = p_token_digest for update;
  if not found or v_invite.consumed_at is not null or v_invite.revoked_at is not null or v_invite.expires_at <= now()
     or v_invite.issued_by_auth_user_id = p_auth_user_id then
    return v_denied;
  end if;
  select o.name as organization_name, d.name as department_name into v_names
    from public.customer_departments d
    join public.customer_organizations o on o.id = d.organization_id and o.state = 'active'
   where d.id = v_invite.department_id and d.organization_id = v_invite.organization_id and d.state = 'active';
  if not found then return v_denied; end if;
  if not coalesce((public.customer_dept_review_check(v_invite.issued_by_auth_user_id, v_invite.organization_id, v_invite.department_id) ->> 'ok')::boolean, false) then return v_denied; end if;
  if exists (select 1 from public.customer_principals p where p.auth_user_id = p_auth_user_id and p.state <> 'active') then return v_denied; end if;

  select * into v_notice from public.customer_notices n where n.purpose = 'employee_registration' and n.language = 'he' and n.state = 'published';
  if not found then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  if exists (
    select 1 from public.customer_member_profiles f
      join public.customer_principals p on p.id = f.applicant_principal_id and p.auth_user_id = p_auth_user_id
     where f.organization_id = v_invite.organization_id) then
    return jsonb_build_object('ok', false, 'error', 'conflict');
  end if;
  if (select count(*) from public.customer_registration_sessions s where s.invite_id = v_invite.id) >= 10 then
    return jsonb_build_object('ok', false, 'error', 'limit');
  end if;

  update public.customer_registration_sessions set revoked_at = now()
   where invite_id = v_invite.id and auth_user_id = p_auth_user_id and revoked_at is null and used_at is null;
  insert into public.customer_registration_sessions (invite_id, auth_user_id, token_digest, expires_at)
  values (v_invite.id, p_auth_user_id, p_session_digest, p_expires_at)
  returning id into v_session;
  insert into public.customer_identity_audit (organization_id, actor_auth_user_id, operation, target_table, target_id, detail)
  values (v_invite.organization_id, p_auth_user_id, 'registration.open', 'customer_registration_sessions', v_session,
          jsonb_build_object('invite_id', v_invite.id, 'department_id', v_invite.department_id));
  return jsonb_build_object('ok', true, 'session_id', v_session, 'expires_at', p_expires_at,
    'organization_name', v_names.organization_name, 'department_name', v_names.department_name,
    'notice', jsonb_build_object('id', v_notice.id, 'version', v_notice.version, 'language', v_notice.language, 'body', v_notice.body));
end;
$$;
revoke all on function public.customer_registration_open(text, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.customer_registration_open(text, uuid, text, timestamptz) to service_role;

-- What the registration page shows while its session is live: the same payload as customer_registration_open. Reads only.
create or replace function public.customer_registration_read(p_session_digest text, p_auth_user_id uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_denied constant jsonb := jsonb_build_object('ok', false, 'error', 'denied');
  v_session public.customer_registration_sessions%rowtype;
  v_invite public.customer_registration_invites%rowtype;
  v_notice public.customer_notices%rowtype;
  v_names record;
begin
  if p_auth_user_id is null or p_session_digest is null or p_session_digest !~ '^[0-9a-f]{64}$' then return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;
  select * into v_session from public.customer_registration_sessions s where s.token_digest = p_session_digest;
  if not found or v_session.auth_user_id <> p_auth_user_id or v_session.revoked_at is not null or v_session.used_at is not null or v_session.expires_at <= now() then return v_denied; end if;
  select * into v_invite from public.customer_registration_invites i where i.id = v_session.invite_id;
  if v_invite.consumed_at is not null or v_invite.revoked_at is not null or v_invite.expires_at <= now() then return v_denied; end if;
  select o.name as organization_name, d.name as department_name into v_names
    from public.customer_departments d
    join public.customer_organizations o on o.id = d.organization_id and o.state = 'active'
   where d.id = v_invite.department_id and d.organization_id = v_invite.organization_id and d.state = 'active';
  if not found then return v_denied; end if;
  if not coalesce((public.customer_dept_review_check(v_invite.issued_by_auth_user_id, v_invite.organization_id, v_invite.department_id) ->> 'ok')::boolean, false) then return v_denied; end if;
  select * into v_notice from public.customer_notices n where n.purpose = 'employee_registration' and n.language = 'he' and n.state = 'published';
  if not found then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  return jsonb_build_object('ok', true, 'session_id', v_session.id, 'expires_at', v_session.expires_at,
    'organization_name', v_names.organization_name, 'department_name', v_names.department_name,
    'notice', jsonb_build_object('id', v_notice.id, 'version', v_notice.version, 'language', v_notice.language, 'body', v_notice.body));
end;
$$;
revoke all on function public.customer_registration_read(text, uuid) from public, anon, authenticated;
grant execute on function public.customer_registration_read(text, uuid) to service_role;

-- ---------------------------------------------------------------- photographs

-- Writes the row of a photo the SERVER has already checked and re-encoded, before the object is uploaded (state 'uploading').
-- Exactly one origin: a live registration session of this user (p_session_digest), or this user's own membership
-- (p_membership_id, for a change after applying). The object path is made HERE from the organization and the photo id and
-- returned (the server uploads to exactly that path); a caller never chooses it. At most five unfinished uploads per session or
-- membership.
create or replace function public.customer_photo_intent(
  p_auth_user_id uuid, p_session_digest text, p_membership_id uuid, p_photo_id uuid,
  p_width integer, p_height integer, p_byte_size integer, p_sha256 text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_denied constant jsonb := jsonb_build_object('ok', false, 'error', 'denied');
  v_session public.customer_registration_sessions%rowtype;
  v_organization uuid;
  v_membership public.customer_org_memberships%rowtype;
  v_open integer;
  v_path text;
begin
  if p_auth_user_id is null or p_photo_id is null or ((p_session_digest is null) = (p_membership_id is null))
     or (p_session_digest is not null and p_session_digest !~ '^[0-9a-f]{64}$')
     or p_width is null or p_width not between 64 and 2048 or p_height is null or p_height not between 64 and 2048
     or p_byte_size is null or p_byte_size not between 1 and 2097152 or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;

  if p_session_digest is not null then
    select * into v_session from public.customer_registration_sessions s where s.token_digest = p_session_digest;
    if not found or v_session.auth_user_id <> p_auth_user_id or v_session.revoked_at is not null or v_session.used_at is not null or v_session.expires_at <= now() then return v_denied; end if;
    select i.organization_id into v_organization from public.customer_registration_invites i
     where i.id = v_session.invite_id and i.consumed_at is null and i.revoked_at is null and i.expires_at > now();
    if not found then return v_denied; end if;
    perform 1 from public.customer_organizations o where o.id = v_organization for update;
    select count(*) into v_open from public.customer_member_photos f where f.session_id = v_session.id and f.state = 'uploading';
  else
    select m.* into v_membership from public.customer_org_memberships m
      join public.customer_member_profiles f on f.membership_id = m.id and f.erased_at is null
      join public.customer_principals p on p.id = f.applicant_principal_id and p.auth_user_id = p_auth_user_id and p.state = 'active'
     where m.id = p_membership_id and m.state in ('pending', 'approved', 'rejected');
    if not found then return v_denied; end if;
    v_organization := v_membership.organization_id;
    perform 1 from public.customer_organizations o where o.id = v_organization and o.state = 'active' for update;
    if not found then return v_denied; end if;
    select count(*) into v_open from public.customer_member_photos f where f.membership_id = v_membership.id and f.state = 'uploading';
  end if;
  if v_open >= 5 then return jsonb_build_object('ok', false, 'error', 'limit'); end if;
  v_path := 'org/' || v_organization::text || '/' || p_photo_id::text || '.jpg';
  if exists (select 1 from public.customer_member_photos f where f.id = p_photo_id) then return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;

  -- a photo for an existing membership names it from the start (it is still 'uploading' until the change is submitted)
  insert into public.customer_member_photos (id, organization_id, session_id, membership_id, uploaded_by_auth_user_id, object_path, width, height, byte_size, sha256)
  values (p_photo_id, v_organization, case when p_session_digest is not null then v_session.id end, p_membership_id, p_auth_user_id, v_path, p_width, p_height, p_byte_size, p_sha256);
  return jsonb_build_object('ok', true, 'status', 'created', 'photo_id', p_photo_id, 'object_path', v_path);
end;
$$;
revoke all on function public.customer_photo_intent(uuid, text, uuid, uuid, integer, integer, integer, text) from public, anon, authenticated;
grant execute on function public.customer_photo_intent(uuid, text, uuid, uuid, integer, integer, integer, text) to service_role;

-- ---------------------------------------------------------------- the application

-- Everything or nothing, once. The session must be live and this user's; its link open; the department and organization active;
-- the link's issuer still a reviewer of that department; the notice the person accepted (p_notice_id) the one published NOW
-- ('stale' otherwise, 'closed' when none is); the photo this session's own checked upload. Then: the user's principal (created when
-- they have none), a member (their principal's member, or a new one: never matched by name), a PENDING membership of that
-- department, the names, the photo linked and 'pending', the consent evidence, the link consumed, the session used, the audit.
-- The organization row is locked first, then the link, then the session: two submits of one session or one link cannot both win.
create or replace function public.customer_registration_submit(
  p_session_digest text, p_auth_user_id uuid, p_first_name text, p_last_name text, p_nickname text, p_photo_id uuid, p_notice_id uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_denied constant jsonb := jsonb_build_object('ok', false, 'error', 'denied');
  v_first text := btrim(coalesce(p_first_name, ''));
  v_last text := btrim(coalesce(p_last_name, ''));
  v_nick text := nullif(btrim(coalesce(p_nickname, '')), '');
  v_session public.customer_registration_sessions%rowtype;
  v_invite public.customer_registration_invites%rowtype;
  v_notice uuid;
  v_principal public.customer_principals%rowtype;
  v_principal_id uuid;
  v_member uuid;
  v_membership uuid;
begin
  if p_session_digest is null or p_session_digest !~ '^[0-9a-f]{64}$' or p_auth_user_id is null or p_photo_id is null or p_notice_id is null
     or char_length(v_first) not between 1 and 60 or char_length(v_last) not between 1 and 60 or (v_nick is not null and char_length(v_nick) > 40)
     or v_first ~ '[[:cntrl:]]' or v_last ~ '[[:cntrl:]]' or coalesce(v_nick, '') ~ '[[:cntrl:]]' then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  select * into v_session from public.customer_registration_sessions s where s.token_digest = p_session_digest;
  if not found then return v_denied; end if;
  select * into v_invite from public.customer_registration_invites i where i.id = v_session.invite_id;
  perform 1 from public.customer_organizations o where o.id = v_invite.organization_id for update;
  select * into v_invite from public.customer_registration_invites i where i.id = v_session.invite_id for update;
  select * into v_session from public.customer_registration_sessions s where s.id = v_session.id for update;
  if v_session.auth_user_id <> p_auth_user_id or v_session.revoked_at is not null or v_session.used_at is not null or v_session.expires_at <= now()
     or v_invite.consumed_at is not null or v_invite.revoked_at is not null or v_invite.expires_at <= now() then
    return v_denied;
  end if;
  if not exists (
    select 1 from public.customer_departments d
      join public.customer_organizations o on o.id = d.organization_id and o.state = 'active'
     where d.id = v_invite.department_id and d.organization_id = v_invite.organization_id and d.state = 'active') then
    return v_denied;
  end if;
  if not coalesce((public.customer_dept_review_check(v_invite.issued_by_auth_user_id, v_invite.organization_id, v_invite.department_id) ->> 'ok')::boolean, false) then return v_denied; end if;
  select n.id into v_notice from public.customer_notices n where n.purpose = 'employee_registration' and n.language = 'he' and n.state = 'published';
  if not found then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  if v_notice <> p_notice_id then return jsonb_build_object('ok', false, 'error', 'stale'); end if;
  perform 1 from public.customer_member_photos f
   where f.id = p_photo_id and f.session_id = v_session.id and f.uploaded_by_auth_user_id = p_auth_user_id and f.state = 'uploading' and f.organization_id = v_invite.organization_id
   for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;

  select * into v_principal from public.customer_principals p where p.auth_user_id = p_auth_user_id for update;
  if found then
    if v_principal.state <> 'active' then return v_denied; end if;
    v_principal_id := v_principal.id;
    v_member := v_principal.member_id;
  else
    insert into public.customer_members default values returning id into v_member;
    insert into public.customer_principals (auth_user_id, member_id) values (p_auth_user_id, v_member)
    on conflict (auth_user_id) do nothing
    returning id into v_principal_id;
    if v_principal_id is null then
      -- the same user was signing up somewhere else at this very moment: that transaction made the principal (its member is used;
      -- the member made above stays unused, ids only)
      select * into v_principal from public.customer_principals p where p.auth_user_id = p_auth_user_id for update;
      if not found or v_principal.state <> 'active' then return v_denied; end if;
      v_principal_id := v_principal.id;
      v_member := v_principal.member_id;
    else
      insert into public.customer_identity_audit (organization_id, actor_auth_user_id, actor_principal_id, operation, target_table, target_id, detail)
      values (v_invite.organization_id, p_auth_user_id, v_principal_id, 'principal.create', 'customer_principals', v_principal_id, jsonb_build_object('via', 'registration'));
    end if;
  end if;
  if exists (select 1 from public.customer_member_profiles f where f.organization_id = v_invite.organization_id and f.applicant_principal_id = v_principal_id) then
    return jsonb_build_object('ok', false, 'error', 'conflict');
  end if;
  -- an operator principal (a department head, an administrator) has no member of its own and keeps none: its application gets a
  -- member of its own, linked only through this profile
  if v_member is null then insert into public.customer_members default values returning id into v_member; end if;
  if exists (select 1 from public.customer_org_memberships m where m.organization_id = v_invite.organization_id and m.member_id = v_member) then
    return jsonb_build_object('ok', false, 'error', 'conflict');
  end if;

  insert into public.customer_org_memberships (member_id, organization_id, department_id, state)
  values (v_member, v_invite.organization_id, v_invite.department_id, 'pending')
  returning id into v_membership;
  insert into public.customer_member_profiles (membership_id, organization_id, applicant_principal_id, first_name, last_name, nickname)
  values (v_membership, v_invite.organization_id, v_principal_id, v_first, v_last, v_nick);
  update public.customer_member_photos set membership_id = v_membership, state = 'pending' where id = p_photo_id;
  insert into public.customer_consent_events (organization_id, membership_id, notice_id, purpose, action, actor_auth_user_id)
  values (v_invite.organization_id, v_membership, v_notice, 'employee_registration', 'accept', p_auth_user_id);
  update public.customer_registration_invites set consumed_at = now(), membership_id = v_membership where id = v_invite.id;
  update public.customer_registration_sessions set used_at = now() where id = v_session.id;
  -- the person's other open sessions of this link end with it
  update public.customer_registration_sessions set revoked_at = now() where invite_id = v_invite.id and id <> v_session.id and revoked_at is null and used_at is null;
  insert into public.customer_identity_audit (organization_id, actor_auth_user_id, actor_principal_id, operation, target_table, target_id, detail)
  values (v_invite.organization_id, p_auth_user_id, v_principal_id, 'membership.apply', 'customer_org_memberships', v_membership,
          jsonb_build_object('department_id', v_invite.department_id, 'invite_id', v_invite.id, 'photo_id', p_photo_id, 'notice_id', v_notice));
  return jsonb_build_object('ok', true, 'status', 'pending', 'membership_id', v_membership);
end;
$$;
revoke all on function public.customer_registration_submit(text, uuid, text, text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.customer_registration_submit(text, uuid, text, text, text, uuid, uuid) to service_role;

-- The employee changes their own details after applying (pending, approved or rejected; an inactive membership is reactivated
-- only by a reviewer). A change of a name, the nickname or the photo is identity-critical: the membership goes back to 'pending'
-- (version + 1), and is reviewed again before it counts. An approved photo is KEPT until a reviewer approves its replacement (the
-- membership is pending meanwhile, so it gives nothing). p_photo_id null = keep the photo; otherwise an own 'uploading' photo of this
-- membership (customer_photo_intent with p_membership_id). The accepted notice must be the one published now. Nothing changed:
-- 'unchanged', nothing written.
create or replace function public.customer_membership_resubmit(
  p_auth_user_id uuid, p_membership_id uuid, p_first_name text, p_last_name text, p_nickname text, p_photo_id uuid, p_notice_id uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_denied constant jsonb := jsonb_build_object('ok', false, 'error', 'denied');
  v_first text := btrim(coalesce(p_first_name, ''));
  v_last text := btrim(coalesce(p_last_name, ''));
  v_nick text := nullif(btrim(coalesce(p_nickname, '')), '');
  v_membership public.customer_org_memberships%rowtype;
  v_profile public.customer_member_profiles%rowtype;
  v_notice public.customer_notices%rowtype;
  v_names_changed boolean;
  v_replaced integer := 0;
begin
  if p_auth_user_id is null or p_membership_id is null or p_notice_id is null
     or char_length(v_first) not between 1 and 60 or char_length(v_last) not between 1 and 60 or (v_nick is not null and char_length(v_nick) > 40)
     or v_first ~ '[[:cntrl:]]' or v_last ~ '[[:cntrl:]]' or coalesce(v_nick, '') ~ '[[:cntrl:]]' then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  select * into v_membership from public.customer_org_memberships m where m.id = p_membership_id;
  if not found then return v_denied; end if;
  perform 1 from public.customer_organizations o where o.id = v_membership.organization_id for update;
  select * into v_membership from public.customer_org_memberships m where m.id = p_membership_id for update;
  select f.* into v_profile from public.customer_member_profiles f
    join public.customer_principals p on p.id = f.applicant_principal_id and p.auth_user_id = p_auth_user_id and p.state = 'active'
   where f.membership_id = v_membership.id and f.erased_at is null
   for update of f;
  if not found or v_membership.state not in ('pending', 'approved', 'rejected') then return v_denied; end if;
  if not exists (
    select 1 from public.customer_departments d
      join public.customer_organizations o on o.id = d.organization_id and o.state = 'active'
     where d.id = v_membership.department_id and d.organization_id = v_membership.organization_id and d.state = 'active') then
    return v_denied;
  end if;
  select * into v_notice from public.customer_notices n where n.purpose = 'employee_registration' and n.language = 'he' and n.state = 'published';
  if not found then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  if v_notice.id <> p_notice_id then return jsonb_build_object('ok', false, 'error', 'stale'); end if;
  if p_photo_id is not null then
    perform 1 from public.customer_member_photos f
     where f.id = p_photo_id and f.membership_id = v_membership.id and f.uploaded_by_auth_user_id = p_auth_user_id and f.state = 'uploading'
     for update;
    if not found then return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;
  end if;

  v_names_changed := v_first is distinct from v_profile.first_name or v_last is distinct from v_profile.last_name or v_nick is distinct from v_profile.nickname;
  if not v_names_changed and p_photo_id is null then
    return jsonb_build_object('ok', true, 'status', 'unchanged', 'membership_id', v_membership.id, 'version', v_membership.version);
  end if;

  if p_photo_id is not null then
    -- a waiting photo is replaced by the newer one; an approved photo stays until its replacement is approved
    update public.customer_member_photos set state = 'replaced', decided_at = now(),
           erase_after = case when (v_notice.retention ->> 'replaced_photo_days') ~ '^[0-9]{1,4}$' then now() + make_interval(days => (v_notice.retention ->> 'replaced_photo_days')::integer) end
     where membership_id = v_membership.id and state = 'pending';
    get diagnostics v_replaced = row_count;
    update public.customer_member_photos set state = 'pending' where id = p_photo_id;
  end if;
  update public.customer_member_profiles set first_name = v_first, last_name = v_last, nickname = v_nick, version = version + 1, updated_at = now(), erase_after = null
   where membership_id = v_membership.id;
  update public.customer_org_memberships set state = 'pending', reviewed_at = null, reviewed_by_principal_id = null, review_reason = null,
         version = version + 1, updated_at = now()
   where id = v_membership.id;
  insert into public.customer_consent_events (organization_id, membership_id, notice_id, purpose, action, actor_auth_user_id)
  values (v_membership.organization_id, v_membership.id, v_notice.id, 'employee_registration', 'accept', p_auth_user_id);
  insert into public.customer_identity_audit (organization_id, actor_auth_user_id, actor_principal_id, operation, target_table, target_id, detail)
  values (v_membership.organization_id, p_auth_user_id, v_profile.applicant_principal_id, 'membership.resubmit', 'customer_org_memberships', v_membership.id,
          jsonb_build_object('state_from', v_membership.state, 'names_changed', v_names_changed, 'photo_id', p_photo_id, 'photos_replaced', v_replaced, 'version', v_membership.version + 1));
  return jsonb_build_object('ok', true, 'status', 'pending', 'membership_id', v_membership.id, 'version', v_membership.version + 1);
end;
$$;
revoke all on function public.customer_membership_resubmit(uuid, uuid, text, text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.customer_membership_resubmit(uuid, uuid, text, text, text, uuid, uuid) to service_role;

-- ---------------------------------------------------------------- review

-- One department's applications and members, for its reviewer: names, state, version and whether a photo waits or is approved
-- (never the photo itself, never anything of another department), newest first, at most 100 per page; and the department's open
-- links (ids and times only). p_state null = every state.
create or replace function public.customer_membership_list(p_actor_auth_user_id uuid, p_organization_id uuid, p_department_id uuid, p_state text, p_limit integer, p_offset integer)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_actor jsonb;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 100000);
begin
  if p_state is not null and p_state not in ('pending', 'approved', 'rejected', 'inactive') then return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;
  v_actor := public.customer_dept_review_check(p_actor_auth_user_id, p_organization_id, p_department_id);
  if not coalesce((v_actor ->> 'ok')::boolean, false) then return jsonb_build_object('ok', false, 'error', coalesce(v_actor ->> 'error', 'denied')); end if;
  return jsonb_build_object(
    'ok', true, 'via', v_actor ->> 'via',
    'counts', (select jsonb_build_object(
        'pending', count(*) filter (where m.state = 'pending'), 'approved', count(*) filter (where m.state = 'approved'),
        'rejected', count(*) filter (where m.state = 'rejected'), 'inactive', count(*) filter (where m.state = 'inactive'))
      from public.customer_org_memberships m
      join public.customer_member_profiles f on f.membership_id = m.id
     where m.organization_id = p_organization_id and m.department_id = p_department_id),
    'members', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.submitted_at desc, x.membership_id) from (
        select m.id as membership_id, m.state, m.version, f.first_name, f.last_name, f.nickname, f.submitted_at, f.updated_at, m.reviewed_at, m.review_reason,
               (f.erased_at is not null) as erased,
               exists (select 1 from public.customer_member_photos p where p.membership_id = m.id and p.state = 'pending') as has_pending_photo,
               exists (select 1 from public.customer_member_photos p where p.membership_id = m.id and p.state = 'approved') as has_approved_photo
          from public.customer_org_memberships m
          join public.customer_member_profiles f on f.membership_id = m.id
         where m.organization_id = p_organization_id and m.department_id = p_department_id and (p_state is null or m.state = p_state)
         order by f.updated_at desc, m.id
         limit v_limit offset v_offset) x), '[]'::jsonb),
    'invites', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'created_at', i.created_at, 'expires_at', i.expires_at,
               'opened', exists (select 1 from public.customer_registration_sessions s where s.invite_id = i.id)) order by i.created_at desc, i.id)
        from public.customer_registration_invites i
       where i.organization_id = p_organization_id and i.department_id = p_department_id and i.consumed_at is null and i.revoked_at is null and i.expires_at > now()), '[]'::jsonb));
end;
$$;
revoke all on function public.customer_membership_list(uuid, uuid, uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.customer_membership_list(uuid, uuid, uuid, text, integer, integer) to service_role;

-- A reviewer's decision, with the version the screen showed (p_expected_version; another decision or a resubmission since then is
-- 'stale', nothing written):
--   approve     pending  -> approved   (its waiting photo becomes THE photo; a previously approved one is 'replaced')
--   reject      pending  -> rejected   (reason required; its waiting photo is 'rejected'; names and photo are erased under the
--                                       published retention, if the business decided one)
--   deactivate  approved -> inactive   (reason required; takes effect at once: state and version)
--   reactivate  inactive -> approved
-- Nobody decides about their own application. The membership is named WITH its organization and department (the route's own path):
-- a membership of another department or tenant is 'denied' even for someone who reviews both; and the actor must review that
-- department. Approve and reactivate need an approvable photo. Every decision bumps the version and writes an audit row; the extension point for later credential / Wallet
-- revocation is that version (they bind to it, so they stop working at once).
create or replace function public.customer_membership_review(
  p_actor_auth_user_id uuid, p_organization_id uuid, p_department_id uuid, p_membership_id uuid, p_decision text, p_reason text, p_expected_version integer)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_denied constant jsonb := jsonb_build_object('ok', false, 'error', 'denied');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_membership public.customer_org_memberships%rowtype;
  v_profile public.customer_member_profiles%rowtype;
  v_actor jsonb;
  v_to text;
  v_retention jsonb;
  v_days integer;
begin
  if p_actor_auth_user_id is null or p_organization_id is null or p_department_id is null or p_membership_id is null or p_expected_version is null
     or p_decision is null or p_decision not in ('approve', 'reject', 'deactivate', 'reactivate')
     or (v_reason is not null and (char_length(v_reason) > 300 or v_reason ~ '[[:cntrl:]]'))
     or (p_decision in ('reject', 'deactivate') and v_reason is null) then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  perform 1 from public.customer_organizations o where o.id = p_organization_id for update;
  select * into v_membership from public.customer_org_memberships m where m.id = p_membership_id and m.organization_id = p_organization_id for update;
  if not found or v_membership.department_id <> p_department_id then return v_denied; end if;
  v_actor := public.customer_dept_review_check(p_actor_auth_user_id, v_membership.organization_id, v_membership.department_id);
  if not coalesce((v_actor ->> 'ok')::boolean, false) then return v_denied; end if;
  select * into v_profile from public.customer_member_profiles f where f.membership_id = v_membership.id for update;
  if not found then return v_denied; end if;
  -- no self-review: not by the applying principal, nor by anyone signed in as the applying user
  if v_profile.applicant_principal_id = (v_actor ->> 'principal_id')::uuid
     or exists (select 1 from public.customer_principals p where p.id = v_profile.applicant_principal_id and p.auth_user_id = p_actor_auth_user_id) then
    return v_denied;
  end if;
  if v_membership.version <> p_expected_version then return jsonb_build_object('ok', false, 'error', 'stale'); end if;

  v_to := case p_decision when 'approve' then 'approved' when 'reject' then 'rejected' when 'deactivate' then 'inactive' else 'approved' end;
  if (p_decision in ('approve', 'reject') and v_membership.state <> 'pending')
     or (p_decision = 'deactivate' and v_membership.state <> 'approved')
     or (p_decision = 'reactivate' and v_membership.state <> 'inactive') then
    return jsonb_build_object('ok', false, 'error', 'conflict');
  end if;
  if p_decision in ('approve', 'reactivate') and (v_profile.erased_at is not null or not exists (
      select 1 from public.customer_member_photos f where f.membership_id = v_membership.id and f.state in ('pending', 'approved'))) then
    return jsonb_build_object('ok', false, 'error', 'conflict');
  end if;

  -- the retention published with the notice this person last accepted (nothing is deleted by age when none was decided)
  select n.retention into v_retention from public.customer_consent_events c join public.customer_notices n on n.id = c.notice_id
   where c.membership_id = v_membership.id and c.action = 'accept' order by c.at desc, c.id desc limit 1;

  if p_decision = 'approve' then
    if exists (select 1 from public.customer_member_photos f where f.membership_id = v_membership.id and f.state = 'pending') then
      v_days := case when (v_retention ->> 'replaced_photo_days') ~ '^[0-9]{1,4}$' then (v_retention ->> 'replaced_photo_days')::integer end;
      update public.customer_member_photos set state = 'replaced', decided_at = now(), erase_after = case when v_days is not null then now() + make_interval(days => v_days) end
       where membership_id = v_membership.id and state = 'approved';
      update public.customer_member_photos set state = 'approved', decided_at = now() where membership_id = v_membership.id and state = 'pending';
    end if;
  elsif p_decision = 'reject' then
    v_days := case when (v_retention ->> 'rejected_days') ~ '^[0-9]{1,4}$' then (v_retention ->> 'rejected_days')::integer end;
    update public.customer_member_photos set state = 'rejected', decided_at = now(), erase_after = case when v_days is not null then now() + make_interval(days => v_days) end
     where membership_id = v_membership.id and state in ('pending', 'approved');
    update public.customer_member_profiles set erase_after = case when v_days is not null then now() + make_interval(days => v_days) end where membership_id = v_membership.id;
  end if;

  update public.customer_org_memberships set state = v_to, reviewed_at = now(), reviewed_by_principal_id = (v_actor ->> 'principal_id')::uuid,
         review_reason = v_reason, version = version + 1, updated_at = now()
   where id = v_membership.id;
  insert into public.customer_identity_audit (organization_id, actor_auth_user_id, actor_principal_id, operation, target_table, target_id, reason, detail)
  values (v_membership.organization_id, p_actor_auth_user_id, (v_actor ->> 'principal_id')::uuid, 'membership.' || p_decision, 'customer_org_memberships', v_membership.id, v_reason,
          jsonb_build_object('state_from', v_membership.state, 'state_to', v_to, 'version', v_membership.version + 1, 'department_id', v_membership.department_id, 'actor_via', v_actor ->> 'via'));
  return jsonb_build_object('ok', true, 'status', v_to, 'membership_id', v_membership.id, 'version', v_membership.version + 1);
end;
$$;
revoke all on function public.customer_membership_review(uuid, uuid, uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.customer_membership_review(uuid, uuid, uuid, uuid, text, text, integer) to service_role;

-- ---------------------------------------------------------------- reading a photo (the server proxy asks this every time)

-- May this user see this membership's photo ('pending' or 'approved') now? A reviewer of the membership's department (named with
-- it: p_organization_id / p_department_id must be the membership's own, so an id from another tenant is 'denied'), or the applying
-- person themselves (p_organization_id and p_department_id null). Returns the object path and writes an audit row 'photo.read';
-- 'denied' for everything else, also for a photo that does not exist.
create or replace function public.customer_photo_open(p_auth_user_id uuid, p_organization_id uuid, p_department_id uuid, p_membership_id uuid, p_which text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_denied constant jsonb := jsonb_build_object('ok', false, 'error', 'denied');
  v_membership public.customer_org_memberships%rowtype;
  v_photo public.customer_member_photos%rowtype;
  v_actor jsonb;
  v_principal uuid;
  v_via text;
begin
  if p_auth_user_id is null or p_membership_id is null or p_which is null or p_which not in ('pending', 'approved')
     or ((p_organization_id is null) <> (p_department_id is null)) then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  select * into v_membership from public.customer_org_memberships m where m.id = p_membership_id;
  if not found then return v_denied; end if;
  if p_organization_id is not null then
    if v_membership.organization_id <> p_organization_id or v_membership.department_id <> p_department_id then return v_denied; end if;
    v_actor := public.customer_dept_review_check(p_auth_user_id, p_organization_id, p_department_id);
    if not coalesce((v_actor ->> 'ok')::boolean, false) then return v_denied; end if;
    v_principal := (v_actor ->> 'principal_id')::uuid;
    v_via := v_actor ->> 'via';
  else
    select p.id into v_principal from public.customer_member_profiles f
      join public.customer_principals p on p.id = f.applicant_principal_id and p.auth_user_id = p_auth_user_id and p.state = 'active'
     where f.membership_id = v_membership.id and f.erased_at is null;
    if not found then return v_denied; end if;
    v_via := 'self';
  end if;
  select * into v_photo from public.customer_member_photos f where f.membership_id = v_membership.id and f.state = p_which;
  if not found then return v_denied; end if;
  insert into public.customer_identity_audit (organization_id, actor_auth_user_id, actor_principal_id, operation, target_table, target_id, detail)
  values (v_membership.organization_id, p_auth_user_id, v_principal, 'photo.read', 'customer_member_photos', v_photo.id,
          jsonb_build_object('membership_id', v_membership.id, 'which', p_which, 'actor_via', v_via));
  return jsonb_build_object('ok', true, 'photo_id', v_photo.id, 'object_path', v_photo.object_path, 'sha256', v_photo.sha256);
end;
$$;
revoke all on function public.customer_photo_open(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.customer_photo_open(uuid, uuid, uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------- the person's own applications

-- What the signed-in user applied for, in every organization (their own data only): state, version, names, whether a photo waits or
-- is approved, the notice in force (to accept again when changing details). Someone who applied nowhere gets an empty list.
create or replace function public.customer_my_memberships(p_auth_user_id uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
begin
  if p_auth_user_id is null then return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;
  return jsonb_build_object(
    'ok', true,
    'memberships', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.submitted_at desc, x.membership_id) from (
        select m.id as membership_id, m.state, m.version, o.name as organization_name, d.name as department_name,
               (o.state = 'active' and d.state = 'active') as open, f.first_name, f.last_name, f.nickname, f.submitted_at, f.updated_at,
               exists (select 1 from public.customer_member_photos p where p.membership_id = m.id and p.state = 'pending') as has_pending_photo,
               exists (select 1 from public.customer_member_photos p where p.membership_id = m.id and p.state = 'approved') as has_approved_photo
          from public.customer_member_profiles f
          join public.customer_principals pr on pr.id = f.applicant_principal_id and pr.auth_user_id = p_auth_user_id and pr.state = 'active'
          join public.customer_org_memberships m on m.id = f.membership_id
          join public.customer_organizations o on o.id = m.organization_id
          join public.customer_departments d on d.id = m.department_id and d.organization_id = m.organization_id
         where f.erased_at is null) x), '[]'::jsonb),
    'notice', (select jsonb_build_object('id', n.id, 'version', n.version, 'language', n.language, 'body', n.body)
                 from public.customer_notices n where n.purpose = 'employee_registration' and n.language = 'he' and n.state = 'published'));
end;
$$;
revoke all on function public.customer_my_memberships(uuid) from public, anon, authenticated;
grant execute on function public.customer_my_memberships(uuid) to service_role;

-- ---------------------------------------------------------------- cleanup (a scheduled server job; nothing is guessed)

-- Which stored objects should go now: uploads that never became part of an application (still 'uploading' an hour after they were
-- written), and rejected or replaced photos whose erase_after (from the published retention) has passed. Reads only; the job
-- deletes the objects and then reports them done (customer_photo_cleanup_done), so a failed deletion is simply listed again.
create or replace function public.customer_photo_cleanup_due(p_limit integer)
returns jsonb language plpgsql stable set search_path = '' as $$
begin
  return jsonb_build_object('ok', true, 'photos', coalesce((
    select jsonb_agg(jsonb_build_object('photo_id', x.id, 'object_path', x.object_path) order by x.created_at, x.id) from (
      select f.id, f.object_path, f.created_at from public.customer_member_photos f
       where (f.state = 'uploading' and f.created_at <= now() - interval '1 hour')
          or (f.state in ('rejected', 'replaced') and f.erase_after is not null and f.erase_after <= now())
       order by f.created_at, f.id
       limit least(greatest(coalesce(p_limit, 100), 1), 500)) x), '[]'::jsonb));
end;
$$;
revoke all on function public.customer_photo_cleanup_due(integer) from public, anon, authenticated;
grant execute on function public.customer_photo_cleanup_due(integer) to service_role;

-- The job deleted these objects: an unfinished upload becomes 'discarded', a rejected or replaced photo 'erased' (only when it is
-- still due: a photo that changed meanwhile is left alone). Then the names of rejected applications whose erase_after has passed are
-- removed (the membership row stays, ids only). Returns the counts; writes one audit row per organization touched, ids only.
create or replace function public.customer_photo_cleanup_done(p_photo_ids uuid[])
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_discarded uuid[];
  v_erased uuid[];
  v_profiles uuid[];
  v_org uuid;
begin
  if p_photo_ids is null or cardinality(p_photo_ids) > 500 then return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;
  with d as (
    update public.customer_member_photos f set state = 'discarded'
     where f.id = any(p_photo_ids) and f.state = 'uploading' and f.created_at <= now() - interval '1 hour'
    returning f.organization_id)
  select coalesce(array_agg(d.organization_id), '{}') into v_discarded from d;
  with e as (
    update public.customer_member_photos f set state = 'erased', erased_at = now()
     where f.id = any(p_photo_ids) and f.state in ('rejected', 'replaced') and f.erase_after is not null and f.erase_after <= now()
    returning f.organization_id)
  select coalesce(array_agg(e.organization_id), '{}') into v_erased from e;
  with p as (
    update public.customer_member_profiles f set first_name = null, last_name = null, nickname = null, erased_at = now()
     where f.erased_at is null and f.erase_after is not null and f.erase_after <= now()
       and exists (select 1 from public.customer_org_memberships m where m.id = f.membership_id and m.state = 'rejected')
    returning f.organization_id)
  select coalesce(array_agg(p.organization_id), '{}') into v_profiles from p;
  for v_org in select distinct x from unnest(v_discarded || v_erased || v_profiles) as x loop
    insert into public.customer_identity_audit (organization_id, operation, target_table, target_id, detail)
    values (v_org, 'photo.cleanup', 'customer_organizations', v_org, jsonb_build_object(
      'discarded', (select count(*) from unnest(v_discarded) x where x = v_org),
      'erased', (select count(*) from unnest(v_erased) x where x = v_org),
      'profiles_erased', (select count(*) from unnest(v_profiles) x where x = v_org)));
  end loop;
  return jsonb_build_object('ok', true, 'discarded', cardinality(v_discarded), 'erased', cardinality(v_erased), 'profiles_erased', cardinality(v_profiles));
end;
$$;
revoke all on function public.customer_photo_cleanup_done(uuid[]) from public, anon, authenticated;
grant execute on function public.customer_photo_cleanup_done(uuid[]) to service_role;

-- Check after applying (all true):
--   select (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relrowsecurity
--            and c.relname in ('customer_notices', 'customer_registration_invites', 'customer_registration_sessions', 'customer_member_profiles',
--              'customer_member_photos', 'customer_consent_events')) = 6 as six_tables_with_rls,
--          (select not public from storage.buckets where id = 'customer-identity-photos') as photo_bucket_private,
--          not has_function_privilege('authenticated', 'public.customer_registration_submit(text, uuid, text, text, text, uuid, uuid)', 'execute') as browser_locked,
--          (select count(*) from public.customer_notices where state = 'published') = 0 as collection_closed_until_a_notice_is_published,
--          (select count(*) from (select proname from pg_proc p where p.pronamespace = 'public'::regnamespace
--            and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') group by proname having count(*) > 1) t) = 0 as no_overloads;
-- Ledger row (only when the owner applies it; NOT applied by this change; the two earlier identity migrations must be applied first):
--   insert into supabase_migrations.schema_migrations (version, name) values ('20261124074218', 'customer_employee_registration') on conflict do nothing;
