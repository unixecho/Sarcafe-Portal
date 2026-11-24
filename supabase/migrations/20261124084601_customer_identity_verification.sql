-- 20261124084601_customer_identity_verification
--
-- FABLE-004 (docs/identity-system/fable-tasks/FABLE-004.md, docs/SARCAFE_IDENTITY.md): revocable QR credentials for approved
-- employees, and authenticated staff verification with a human photo comparison. Nothing from the earlier identity migrations is
-- changed. No staff, owner, scheduler, checklist, POS, kiosk or waitlist object is touched (staff rows are READ, by the scanner
-- rules, never written).
--
-- THE CREDENTIAL. An approved employee's own card (/benefits/manage, "הכרטיס שלי") shows a QR that carries ONLY an opaque random
-- token (`sc1_` + 32 random bytes): no name, phone, organization, department, photo or URL. Only its digest is stored, bound to the
-- membership AND the membership's version at the moment it was made, with a short expiry (the web card renews itself). Making a
-- new one revokes the earlier ones (a screenshot of an older card is dead). A review decision or a change of details bumps the
-- version, so every credential made before it stops working at once, without touching it. A QR is possession, never identity: the
-- operator must compare the private photo.
--
-- THE SCANNER. A Sarcafe staff member with an explicit, revocable scanner grant for the business (and, optionally, one branch),
-- given by a business administrator (a full owner session). Being staff, a manager or signed in is NOT enough; the shared kiosk key
-- and an employee-code session never are (the routes need a proven Google session; the rules here need the grant and a live staff
-- row). A scan names the business and the branch; both must fit the grant and the branch must belong to the business.
--
-- THE VERIFICATION. A scan of a valid credential, by an authorized operator, of an APPROVED membership whose organization has an
-- ACTIVE agreement with the scanning business, opens a short verification (two minutes) bound to the operator, the business, the
-- branch, the credential and the membership version. It shows the minimum (first name, last name or nickname, organization and
-- department names) and lets the same operator read the photo, then decide: match (valid five more minutes, for the redemption of
-- FABLE-005, once), mismatch or cancel. Another operator cannot decide it or read its photo; a membership change in between makes it
-- 'stale'. Every refusal is one answer ('denied') that says nothing about the person.
--
-- Additive and idempotent. RLS on the new tables, no policy; browser roles nothing; service_role select / insert / update and execute
-- on the functions below. No row is seeded.

-- ---------------------------------------------------------------- scanner grants

create table if not exists public.customer_scanner_grants (
  id                       uuid primary key default gen_random_uuid(),
  business_id              uuid not null references public.customer_businesses(id) on delete restrict,
  -- null: every branch of the business
  branch_id                uuid,
  -- the staff member, by their auth user and staff row (plain values: this domain never writes staff)
  auth_user_id             uuid not null,
  staff_id                 uuid not null,
  granted_by_auth_user_id  uuid not null,
  granted_at               timestamptz not null default now(),
  revoked_at               timestamptz,
  revoked_reason           text check (revoked_reason is null or char_length(revoked_reason) between 1 and 300),
  constraint customer_scanner_grants_branch_fk foreign key (business_id, branch_id)
    references public.customer_business_branches (business_id, branch_id) on delete restrict
);
create unique index if not exists customer_scanner_grants_live_idx on public.customer_scanner_grants
  (business_id, auth_user_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)) where revoked_at is null;
create index if not exists customer_scanner_grants_user_idx on public.customer_scanner_grants (auth_user_id);
create index if not exists customer_scanner_grants_branch_idx on public.customer_scanner_grants (business_id, branch_id) where branch_id is not null;

-- ---------------------------------------------------------------- credentials

create table if not exists public.customer_credentials (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null,
  membership_id           uuid not null,
  audience                text not null default 'organization_member' check (audience in ('organization_member')),
  -- sha-256 (hex) of the purpose-prefixed token in the QR. The token itself is never stored.
  token_digest            text not null unique check (token_digest ~ '^[0-9a-f]{64}$'),
  -- the membership version the credential was made for: any later review decision or change of details makes it stale at once
  membership_version      integer not null check (membership_version >= 1),
  issued_by_auth_user_id  uuid not null,
  created_at              timestamptz not null default now(),
  expires_at              timestamptz not null,
  revoked_at              timestamptz,
  revoked_reason          text check (revoked_reason is null or char_length(revoked_reason) between 1 and 300),
  constraint customer_credentials_membership_fk foreign key (organization_id, membership_id)
    references public.customer_org_memberships (organization_id, id) on delete restrict,
  constraint customer_credentials_expiry_check check (expires_at > created_at and expires_at <= created_at + interval '1 day')
);
create index if not exists customer_credentials_membership_idx on public.customer_credentials (organization_id, membership_id);
create index if not exists customer_credentials_live_idx on public.customer_credentials (membership_id) where revoked_at is null;

-- ---------------------------------------------------------------- verifications

create table if not exists public.customer_verifications (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.customer_businesses(id) on delete restrict,
  branch_id           uuid not null,
  organization_id     uuid not null,
  membership_id       uuid not null,
  credential_id       uuid not null references public.customer_credentials(id) on delete restrict,
  membership_version  integer not null check (membership_version >= 1),
  actor_auth_user_id  uuid not null,
  actor_staff_id      uuid not null,
  state               text not null default 'pending' check (state in ('pending', 'matched', 'mismatched', 'cancelled', 'expired', 'stale', 'consumed')),
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  decided_at          timestamptz,
  consumed_at         timestamptz,
  constraint customer_verifications_membership_fk foreign key (organization_id, membership_id)
    references public.customer_org_memberships (organization_id, id) on delete restrict,
  constraint customer_verifications_branch_fk foreign key (business_id, branch_id)
    references public.customer_business_branches (business_id, branch_id) on delete restrict,
  constraint customer_verifications_decided_check check ((state = 'pending') = (decided_at is null)),
  constraint customer_verifications_consumed_check check ((state = 'consumed') = (consumed_at is not null)),
  constraint customer_verifications_expiry_check check (expires_at > created_at and expires_at <= created_at + interval '10 minutes')
);
create index if not exists customer_verifications_actor_idx on public.customer_verifications (actor_auth_user_id, created_at desc);
create index if not exists customer_verifications_membership_idx on public.customer_verifications (organization_id, membership_id);
create index if not exists customer_verifications_credential_idx on public.customer_verifications (credential_id);
create index if not exists customer_verifications_branch_idx on public.customer_verifications (business_id, branch_id);

-- ---------------------------------------------------------------- access

alter table public.customer_scanner_grants enable row level security;
alter table public.customer_credentials enable row level security;
alter table public.customer_verifications enable row level security;
revoke all on public.customer_scanner_grants, public.customer_credentials, public.customer_verifications from public, anon, authenticated, service_role;
grant select, insert, update on public.customer_scanner_grants, public.customer_credentials, public.customer_verifications to service_role;

-- a row's facts never change; a revoked grant or credential stays revoked; a decided verification only moves to 'consumed' (match)
create or replace function public.customer_verifications_final()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.state <> 'pending' and not (old.state = 'matched' and new.state in ('consumed', 'expired', 'stale')) and new.state is distinct from old.state then
    raise exception 'customer identity: a decided verification is final' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.customer_verifications_final() from public, anon, authenticated, service_role;

create or replace function public.customer_revoked_final()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'customer identity: % is revoked for good', tg_table_name using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.customer_revoked_final() from public, anon, authenticated, service_role;

drop trigger if exists customer_scanner_grants_keep on public.customer_scanner_grants;
create trigger customer_scanner_grants_keep before update on public.customer_scanner_grants
  for each row execute function public.customer_keep_columns('id', 'business_id', 'branch_id', 'auth_user_id', 'staff_id', 'granted_by_auth_user_id', 'granted_at');
drop trigger if exists customer_scanner_grants_final on public.customer_scanner_grants;
create trigger customer_scanner_grants_final before update on public.customer_scanner_grants
  for each row execute function public.customer_revoked_final();
drop trigger if exists customer_credentials_keep on public.customer_credentials;
create trigger customer_credentials_keep before update on public.customer_credentials
  for each row execute function public.customer_keep_columns('id', 'organization_id', 'membership_id', 'audience', 'token_digest', 'membership_version', 'issued_by_auth_user_id', 'created_at', 'expires_at');
drop trigger if exists customer_credentials_final on public.customer_credentials;
create trigger customer_credentials_final before update on public.customer_credentials
  for each row execute function public.customer_revoked_final();
drop trigger if exists customer_verifications_keep on public.customer_verifications;
create trigger customer_verifications_keep before update on public.customer_verifications
  for each row execute function public.customer_keep_columns('id', 'business_id', 'branch_id', 'organization_id', 'membership_id', 'credential_id', 'membership_version', 'actor_auth_user_id', 'actor_staff_id', 'created_at');
drop trigger if exists customer_verifications_final on public.customer_verifications;
create trigger customer_verifications_final before update on public.customer_verifications
  for each row execute function public.customer_verifications_final();

-- ---------------------------------------------------------------- the scanner rule

-- { ok: true, grant_id, staff_id } or { ok: false, error }. A live scanner grant of this auth user for this business, for this branch
-- or for every branch; the branch belongs to the business; the business is active; and the grant's staff row is still THIS auth
-- user's, active. Reads only.
create or replace function public.customer_scanner_check(p_auth_user_id uuid, p_business_id uuid, p_branch_id uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_grant uuid;
  v_staff uuid;
begin
  if p_auth_user_id is null or p_business_id is null or p_branch_id is null then return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;
  if not exists (select 1 from public.customer_businesses b where b.id = p_business_id and b.state = 'active')
     or not exists (select 1 from public.customer_business_branches m where m.business_id = p_business_id and m.branch_id = p_branch_id) then
    return jsonb_build_object('ok', false, 'error', 'denied');
  end if;
  select g.id, g.staff_id into v_grant, v_staff
    from public.customer_scanner_grants g
    join public.staff s on s.id = g.staff_id and s.auth_user_id = p_auth_user_id and s.active
   where g.business_id = p_business_id and g.auth_user_id = p_auth_user_id and g.revoked_at is null
     and (g.branch_id is null or g.branch_id = p_branch_id)
   order by g.branch_id nulls last
   limit 1;
  if v_grant is null then return jsonb_build_object('ok', false, 'error', 'denied'); end if;
  return jsonb_build_object('ok', true, 'grant_id', v_grant, 'staff_id', v_staff);
end;
$$;
revoke all on function public.customer_scanner_check(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.customer_scanner_check(uuid, uuid, uuid) to service_role;

-- The branches of the business this operator may scan at, with their names (a grant for every branch counts every branch the
-- business has). 'denied' when they hold no live grant (or their staff row is not active). Reads only.
create or replace function public.customer_scanner_scope(p_auth_user_id uuid, p_business_id uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_branches jsonb;
begin
  if p_auth_user_id is null or p_business_id is null then return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;
  select jsonb_agg(jsonb_build_object('branch_id', x.branch_id, 'name', x.name) order by x.name, x.branch_id) into v_branches from (
    select distinct m.branch_id, coalesce(nullif(br.name ->> 'he', ''), br.slug) as name
      from public.customer_scanner_grants g
      join public.staff s on s.id = g.staff_id and s.auth_user_id = p_auth_user_id and s.active
      join public.customer_businesses b on b.id = g.business_id and b.state = 'active'
      join public.customer_business_branches m on m.business_id = g.business_id and (g.branch_id is null or m.branch_id = g.branch_id)
      join public.branches br on br.id = m.branch_id
     where g.business_id = p_business_id and g.auth_user_id = p_auth_user_id and g.revoked_at is null) x;
  if v_branches is null then return jsonb_build_object('ok', false, 'error', 'denied'); end if;
  return jsonb_build_object('ok', true, 'branches', v_branches);
end;
$$;
revoke all on function public.customer_scanner_scope(uuid, uuid) from public, anon, authenticated;
grant execute on function public.customer_scanner_scope(uuid, uuid) to service_role;

-- ---------------------------------------------------------------- managing scanners (a business administrator)

-- The business's staff who could be given scanner access (active, signed in with an account), with their live grants. Only for
-- a business administrator of THE legacy business (Sarcafe's staff are its staff); any other business: 'denied'.
create or replace function public.customer_scanner_list(p_actor_auth_user_id uuid, p_business_id uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_actor jsonb;
begin
  if p_actor_auth_user_id is null or p_business_id is null then return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;
  v_actor := public.customer_access_check(p_actor_auth_user_id, 'business_admin', p_business_id, null, null);
  if not coalesce((v_actor ->> 'ok')::boolean, false)
     or not exists (select 1 from public.customer_businesses b where b.id = p_business_id and b.legacy_owner_access) then
    return jsonb_build_object('ok', false, 'error', 'denied');
  end if;
  return jsonb_build_object('ok', true,
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object('staff_id', s.id, 'name', coalesce(nullif(btrim(s.display_name), ''), nullif(btrim(concat_ws(' ', s.first_name, s.last_name)), ''), 'עובד'),
               'grants', coalesce((select jsonb_agg(jsonb_build_object('grant_id', g.id, 'branch_id', g.branch_id, 'granted_at', g.granted_at) order by g.granted_at)
                                     from public.customer_scanner_grants g where g.business_id = p_business_id and g.staff_id = s.id and g.revoked_at is null), '[]'::jsonb))
             order by lower(coalesce(s.display_name, s.first_name, '')), s.id)
        from public.staff s where s.active and s.auth_user_id is not null), '[]'::jsonb),
    'branches', coalesce((
      select jsonb_agg(jsonb_build_object('branch_id', m.branch_id, 'name', coalesce(nullif(br.name ->> 'he', ''), br.slug)) order by m.created_at, m.branch_id)
        from public.customer_business_branches m join public.branches br on br.id = m.branch_id where m.business_id = p_business_id), '[]'::jsonb));
end;
$$;
revoke all on function public.customer_scanner_list(uuid, uuid) from public, anon, authenticated;
grant execute on function public.customer_scanner_list(uuid, uuid) to service_role;

-- Gives a staff member scanner access for the business (p_branch_id null = every branch). The actor is a business administrator of
-- the legacy business; the target an ACTIVE staff row with an auth user; nobody grants to themselves. 'unchanged' when it exists.
create or replace function public.customer_scanner_grant(p_actor_auth_user_id uuid, p_business_id uuid, p_staff_id uuid, p_branch_id uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_actor jsonb;
  v_target uuid;
  v_existing uuid;
  v_grant uuid;
begin
  if p_actor_auth_user_id is null or p_business_id is null or p_staff_id is null then return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;
  perform 1 from public.customer_businesses b where b.id = p_business_id for update;
  v_actor := public.customer_access_check(p_actor_auth_user_id, 'business_admin', p_business_id, null, null);
  if not coalesce((v_actor ->> 'ok')::boolean, false)
     or not exists (select 1 from public.customer_businesses b where b.id = p_business_id and b.legacy_owner_access) then
    return jsonb_build_object('ok', false, 'error', 'denied');
  end if;
  if p_branch_id is not null and not exists (select 1 from public.customer_business_branches m where m.business_id = p_business_id and m.branch_id = p_branch_id) then
    return jsonb_build_object('ok', false, 'error', 'denied');
  end if;
  select s.auth_user_id into v_target from public.staff s where s.id = p_staff_id and s.active and s.auth_user_id is not null;
  if v_target is null or v_target = p_actor_auth_user_id then return jsonb_build_object('ok', false, 'error', 'denied'); end if;
  select g.id into v_existing from public.customer_scanner_grants g
   where g.business_id = p_business_id and g.auth_user_id = v_target and g.branch_id is not distinct from p_branch_id and g.revoked_at is null;
  if v_existing is not null then return jsonb_build_object('ok', true, 'status', 'unchanged', 'grant_id', v_existing); end if;
  insert into public.customer_scanner_grants (business_id, branch_id, auth_user_id, staff_id, granted_by_auth_user_id)
  values (p_business_id, p_branch_id, v_target, p_staff_id, p_actor_auth_user_id)
  returning id into v_grant;
  insert into public.customer_identity_audit (business_id, actor_auth_user_id, actor_principal_id, actor_staff_id, operation, target_table, target_id, detail)
  values (p_business_id, p_actor_auth_user_id, (v_actor ->> 'principal_id')::uuid, (v_actor ->> 'staff_id')::uuid, 'scanner.grant', 'customer_scanner_grants', v_grant,
          jsonb_build_object('staff_id', p_staff_id, 'branch_id', p_branch_id, 'actor_via', v_actor ->> 'via'));
  return jsonb_build_object('ok', true, 'status', 'created', 'grant_id', v_grant);
end;
$$;
revoke all on function public.customer_scanner_grant(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.customer_scanner_grant(uuid, uuid, uuid, uuid) to service_role;

-- Ends a scanner grant now; open verifications of that operator in that business end with it ('cancelled').
create or replace function public.customer_scanner_revoke(p_actor_auth_user_id uuid, p_grant_id uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_grant public.customer_scanner_grants%rowtype;
  v_actor jsonb;
begin
  if p_actor_auth_user_id is null or p_grant_id is null then return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;
  select * into v_grant from public.customer_scanner_grants g where g.id = p_grant_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'denied'); end if;
  perform 1 from public.customer_businesses b where b.id = v_grant.business_id for update;
  select * into v_grant from public.customer_scanner_grants g where g.id = p_grant_id for update;
  v_actor := public.customer_access_check(p_actor_auth_user_id, 'business_admin', v_grant.business_id, null, null);
  if not coalesce((v_actor ->> 'ok')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'denied'); end if;
  if v_grant.revoked_at is not null then return jsonb_build_object('ok', true, 'status', 'unchanged', 'grant_id', v_grant.id); end if;
  update public.customer_scanner_grants set revoked_at = now(), revoked_reason = 'revoked' where id = v_grant.id;
  update public.customer_verifications set state = 'cancelled', decided_at = now()
   where business_id = v_grant.business_id and actor_auth_user_id = v_grant.auth_user_id and state = 'pending';
  update public.customer_verifications set state = 'expired'
   where business_id = v_grant.business_id and actor_auth_user_id = v_grant.auth_user_id and state = 'matched';
  insert into public.customer_identity_audit (business_id, actor_auth_user_id, actor_principal_id, actor_staff_id, operation, target_table, target_id, detail)
  values (v_grant.business_id, p_actor_auth_user_id, (v_actor ->> 'principal_id')::uuid, (v_actor ->> 'staff_id')::uuid, 'scanner.revoke', 'customer_scanner_grants', v_grant.id,
          jsonb_build_object('staff_id', v_grant.staff_id, 'branch_id', v_grant.branch_id));
  return jsonb_build_object('ok', true, 'status', 'revoked', 'grant_id', v_grant.id);
end;
$$;
revoke all on function public.customer_scanner_revoke(uuid, uuid) from public, anon, authenticated;
grant execute on function public.customer_scanner_revoke(uuid, uuid) to service_role;

-- ---------------------------------------------------------------- the employee's card

-- Makes the QR credential of the signed-in employee's OWN approved membership (organization and department on), valid until
-- p_expires_at (at most a day), and revokes every earlier live credential of that membership ('superseded'). The server made the
-- token and passes its digest. At most 120 per membership per hour (the card renews itself; a loop is refused with 'limit').
create or replace function public.customer_credential_issue(p_auth_user_id uuid, p_membership_id uuid, p_token_digest text, p_expires_at timestamptz)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_membership public.customer_org_memberships%rowtype;
  v_credential uuid;
  v_superseded integer;
begin
  if p_auth_user_id is null or p_membership_id is null or p_token_digest is null or p_token_digest !~ '^[0-9a-f]{64}$'
     or p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '1 day' then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  select * into v_membership from public.customer_org_memberships m where m.id = p_membership_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'denied'); end if;
  perform 1 from public.customer_organizations o where o.id = v_membership.organization_id for update;
  select m.* into v_membership from public.customer_org_memberships m
    join public.customer_member_profiles f on f.membership_id = m.id and f.erased_at is null
    join public.customer_principals p on p.id = f.applicant_principal_id and p.auth_user_id = p_auth_user_id and p.state = 'active'
    join public.customer_departments d on d.id = m.department_id and d.organization_id = m.organization_id and d.state = 'active'
    join public.customer_organizations o on o.id = m.organization_id and o.state = 'active'
   where m.id = p_membership_id and m.state = 'approved'
   for update of m;
  if not found then return jsonb_build_object('ok', false, 'error', 'denied'); end if;
  if exists (select 1 from public.customer_credentials c where c.token_digest = p_token_digest) then return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;
  if (select count(*) from public.customer_credentials c where c.membership_id = v_membership.id and c.created_at > now() - interval '1 hour') >= 120 then
    return jsonb_build_object('ok', false, 'error', 'limit');
  end if;
  update public.customer_credentials set revoked_at = now(), revoked_reason = 'superseded' where membership_id = v_membership.id and revoked_at is null;
  get diagnostics v_superseded = row_count;
  insert into public.customer_credentials (organization_id, membership_id, token_digest, membership_version, issued_by_auth_user_id, expires_at)
  values (v_membership.organization_id, v_membership.id, p_token_digest, v_membership.version, p_auth_user_id, p_expires_at)
  returning id into v_credential;
  insert into public.customer_identity_audit (organization_id, actor_auth_user_id, operation, target_table, target_id, detail)
  values (v_membership.organization_id, p_auth_user_id, 'credential.issue', 'customer_credentials', v_credential,
          jsonb_build_object('membership_id', v_membership.id, 'version', v_membership.version, 'superseded', v_superseded, 'expires_at', p_expires_at));
  return jsonb_build_object('ok', true, 'status', 'created', 'credential_id', v_credential, 'expires_at', p_expires_at);
end;
$$;
revoke all on function public.customer_credential_issue(uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.customer_credential_issue(uuid, uuid, text, timestamptz) to service_role;

-- The employee hides the card: every live credential of the own membership is revoked now ('hidden').
create or replace function public.customer_credential_revoke(p_auth_user_id uuid, p_membership_id uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_count integer;
  v_org uuid;
begin
  if p_auth_user_id is null or p_membership_id is null then return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;
  select m.organization_id into v_org from public.customer_org_memberships m
    join public.customer_member_profiles f on f.membership_id = m.id
    join public.customer_principals p on p.id = f.applicant_principal_id and p.auth_user_id = p_auth_user_id
   where m.id = p_membership_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'denied'); end if;
  update public.customer_credentials set revoked_at = now(), revoked_reason = 'hidden' where membership_id = p_membership_id and revoked_at is null;
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', true, 'status', case when v_count > 0 then 'revoked' else 'unchanged' end, 'revoked', v_count);
end;
$$;
revoke all on function public.customer_credential_revoke(uuid, uuid) from public, anon, authenticated;
grant execute on function public.customer_credential_revoke(uuid, uuid) to service_role;

-- ---------------------------------------------------------------- verification

-- An operator scans a credential at a branch. Refused ('denied', one answer, nothing about the person; one audit row 'verification.deny'
-- in the business, ids of the operator only): no scanner grant for this business and branch; unknown, expired or revoked credential;
-- a membership that is not approved now, or of another version than the credential; its organization or department off; no ACTIVE
-- agreement between this business and that organization. Otherwise the operator's earlier open verification is cancelled and a new
-- one opens (pending, two minutes), and the minimum to show is returned. At most 30 scans per operator per minute ('limit').
create or replace function public.customer_verification_scan(p_actor_auth_user_id uuid, p_business_id uuid, p_branch_id uuid, p_token_digest text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_denied constant jsonb := jsonb_build_object('ok', false, 'error', 'denied');
  v_scanner jsonb;
  v_credential public.customer_credentials%rowtype;
  v_membership public.customer_org_memberships%rowtype;
  v_view record;
  v_verification uuid;
  v_expires timestamptz := now() + interval '2 minutes';
  v_ok boolean := false;
begin
  if p_actor_auth_user_id is null or p_business_id is null or p_branch_id is null or p_token_digest is null or p_token_digest !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  v_scanner := public.customer_scanner_check(p_actor_auth_user_id, p_business_id, p_branch_id);
  if not coalesce((v_scanner ->> 'ok')::boolean, false) then return v_denied; end if;
  if (select count(*) from public.customer_verifications v where v.actor_auth_user_id = p_actor_auth_user_id and v.created_at > now() - interval '1 minute') >= 30 then
    return jsonb_build_object('ok', false, 'error', 'limit');
  end if;

  -- every way a card can be unusable gets the same answer; v_ok stays false until all of them are ruled out
  select * into v_credential from public.customer_credentials c where c.token_digest = p_token_digest;
  if found and v_credential.revoked_at is null and v_credential.expires_at > now() then
    select m.* into v_membership from public.customer_org_memberships m where m.id = v_credential.membership_id;
    if found and v_membership.state = 'approved' and v_membership.version = v_credential.membership_version then
      select f.first_name, f.last_name, f.nickname, o.name as organization_name, d.name as department_name into v_view
        from public.customer_member_profiles f
        join public.customer_organizations o on o.id = v_membership.organization_id and o.state = 'active'
        join public.customer_departments d on d.id = v_membership.department_id and d.organization_id = v_membership.organization_id and d.state = 'active'
       where f.membership_id = v_membership.id and f.erased_at is null and f.first_name is not null;
      v_ok := found
        and exists (select 1 from public.customer_business_orgs a where a.business_id = p_business_id and a.organization_id = v_membership.organization_id and a.state = 'active')
        and exists (select 1 from public.customer_member_photos p where p.membership_id = v_membership.id and p.state = 'approved');
    end if;
  end if;
  if not v_ok then
    insert into public.customer_identity_audit (business_id, actor_auth_user_id, actor_staff_id, operation, target_table, target_id, detail)
    values (p_business_id, p_actor_auth_user_id, (v_scanner ->> 'staff_id')::uuid, 'verification.deny', 'customer_businesses', p_business_id, jsonb_build_object('branch_id', p_branch_id));
    return v_denied;
  end if;

  update public.customer_verifications set state = 'cancelled', decided_at = now()
   where actor_auth_user_id = p_actor_auth_user_id and state = 'pending';
  insert into public.customer_verifications (business_id, branch_id, organization_id, membership_id, credential_id, membership_version, actor_auth_user_id, actor_staff_id, expires_at)
  values (p_business_id, p_branch_id, v_membership.organization_id, v_membership.id, v_credential.id, v_membership.version, p_actor_auth_user_id, (v_scanner ->> 'staff_id')::uuid, v_expires)
  returning id into v_verification;
  insert into public.customer_identity_audit (business_id, actor_auth_user_id, actor_staff_id, operation, target_table, target_id, detail)
  values (p_business_id, p_actor_auth_user_id, (v_scanner ->> 'staff_id')::uuid, 'verification.scan', 'customer_verifications', v_verification,
          jsonb_build_object('branch_id', p_branch_id, 'organization_id', v_membership.organization_id, 'membership_id', v_membership.id, 'credential_id', v_credential.id));
  return jsonb_build_object('ok', true, 'verification_id', v_verification, 'expires_at', v_expires,
    'first_name', v_view.first_name, 'last_name', v_view.last_name, 'nickname', v_view.nickname,
    'organization_name', v_view.organization_name, 'department_name', v_view.department_name);
end;
$$;
revoke all on function public.customer_verification_scan(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.customer_verification_scan(uuid, uuid, uuid, text) to service_role;

-- The open verification's photo, for the operator who scanned it, while it is pending: the approved photo of that membership, if
-- the membership is still approved at that version (and the operator still holds the scanner grant). Writes 'photo.read'.
create or replace function public.customer_verification_photo(p_actor_auth_user_id uuid, p_verification_id uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_denied constant jsonb := jsonb_build_object('ok', false, 'error', 'denied');
  v_verification public.customer_verifications%rowtype;
  v_photo public.customer_member_photos%rowtype;
begin
  if p_actor_auth_user_id is null or p_verification_id is null then return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;
  select * into v_verification from public.customer_verifications v where v.id = p_verification_id;
  if not found or v_verification.actor_auth_user_id <> p_actor_auth_user_id or v_verification.state <> 'pending' or v_verification.expires_at <= now() then return v_denied; end if;
  if not coalesce((public.customer_scanner_check(p_actor_auth_user_id, v_verification.business_id, v_verification.branch_id) ->> 'ok')::boolean, false) then return v_denied; end if;
  if not exists (select 1 from public.customer_org_memberships m where m.id = v_verification.membership_id and m.state = 'approved' and m.version = v_verification.membership_version) then return v_denied; end if;
  select * into v_photo from public.customer_member_photos f where f.membership_id = v_verification.membership_id and f.state = 'approved';
  if not found then return v_denied; end if;
  insert into public.customer_identity_audit (organization_id, actor_auth_user_id, operation, target_table, target_id, detail)
  values (v_verification.organization_id, p_actor_auth_user_id, 'photo.read', 'customer_member_photos', v_photo.id,
          jsonb_build_object('membership_id', v_verification.membership_id, 'which', 'approved', 'actor_via', 'verification', 'verification_id', v_verification.id, 'business_id', v_verification.business_id));
  return jsonb_build_object('ok', true, 'object_path', v_photo.object_path, 'sha256', v_photo.sha256);
end;
$$;
revoke all on function public.customer_verification_photo(uuid, uuid) from public, anon, authenticated;
grant execute on function public.customer_verification_photo(uuid, uuid) to service_role;

-- The operator's decision on their own open verification: 'match' (the person is the one in the photo: valid five more minutes for
-- one redemption), 'mismatch' or 'cancel'. A membership that changed meanwhile (state or version) makes it 'stale'; an expired one
-- 'expired'. Another operator: 'denied'.
create or replace function public.customer_verification_decide(p_actor_auth_user_id uuid, p_verification_id uuid, p_decision text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_verification public.customer_verifications%rowtype;
  v_to text;
begin
  if p_actor_auth_user_id is null or p_verification_id is null or p_decision is null or p_decision not in ('match', 'mismatch', 'cancel') then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  select * into v_verification from public.customer_verifications v where v.id = p_verification_id for update;
  if not found or v_verification.actor_auth_user_id <> p_actor_auth_user_id then return jsonb_build_object('ok', false, 'error', 'denied'); end if;
  if v_verification.state <> 'pending' then return jsonb_build_object('ok', false, 'error', 'conflict'); end if;
  if v_verification.expires_at <= now() then
    update public.customer_verifications set state = 'expired', decided_at = now() where id = v_verification.id;
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;
  if p_decision = 'match' and (
       not coalesce((public.customer_scanner_check(p_actor_auth_user_id, v_verification.business_id, v_verification.branch_id) ->> 'ok')::boolean, false)
       or not exists (select 1 from public.customer_org_memberships m where m.id = v_verification.membership_id and m.state = 'approved' and m.version = v_verification.membership_version)) then
    update public.customer_verifications set state = 'stale', decided_at = now() where id = v_verification.id;
    return jsonb_build_object('ok', false, 'error', 'stale');
  end if;
  v_to := case p_decision when 'match' then 'matched' when 'mismatch' then 'mismatched' else 'cancelled' end;
  -- a match is valid five minutes from the decision (for one redemption, FABLE-005); the row's own expiry bound is ten minutes
  update public.customer_verifications set state = v_to, decided_at = now(),
         expires_at = case when v_to = 'matched' then least(now() + interval '5 minutes', created_at + interval '10 minutes') else expires_at end
   where id = v_verification.id;
  insert into public.customer_identity_audit (business_id, actor_auth_user_id, actor_staff_id, operation, target_table, target_id, detail)
  values (v_verification.business_id, p_actor_auth_user_id, v_verification.actor_staff_id, 'verification.' || p_decision, 'customer_verifications', v_verification.id,
          jsonb_build_object('branch_id', v_verification.branch_id, 'membership_id', v_verification.membership_id));
  return jsonb_build_object('ok', true, 'status', v_to, 'verification_id', v_verification.id);
end;
$$;
revoke all on function public.customer_verification_decide(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.customer_verification_decide(uuid, uuid, text) to service_role;

-- Check after applying (all true):
--   select (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relrowsecurity
--            and c.relname in ('customer_scanner_grants', 'customer_credentials', 'customer_verifications')) = 3 as three_tables_with_rls,
--          not has_function_privilege('authenticated', 'public.customer_verification_scan(uuid, uuid, uuid, text)', 'execute') as browser_locked,
--          (select count(*) from public.customer_scanner_grants) = 0 as nobody_scans_until_an_owner_grants_it,
--          (select count(*) from (select proname from pg_proc p where p.pronamespace = 'public'::regnamespace
--            and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') group by proname having count(*) > 1) t) = 0 as no_overloads;
-- Ledger row (only when the owner applies it; NOT applied by this change; the three earlier identity migrations must be applied first):
--   insert into supabase_migrations.schema_migrations (version, name) values ('20261124084601', 'customer_identity_verification') on conflict do nothing;
