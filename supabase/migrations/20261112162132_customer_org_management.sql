-- 20261112162132_customer_org_management
--
-- FABLE-002 (docs/identity-system/fable-tasks/FABLE-002.md, docs/SARCAFE_IDENTITY.md): managing organizations and departments in an
-- exact scope, and inviting a department head with a single-use link. One new table (customer_invitations) and thirteen functions.
-- Nothing from 20261112125033_customer_identity_foundation.sql is changed: its three functions, its tables, its triggers and the
-- first-administrator bootstrap rule stay exactly as verified. No staff, owner, scheduler, checklist, POS, kiosk or waitlist object
-- is touched, and nothing here creates a staff row, an auth account or a POS / scheduler right.
--
-- WHO MAY MANAGE AN ORGANIZATION (customer_org_manage_check, one rule for every function below):
--   1. an organization administrator: an active principal with a live organization_admin grant on it; or
--   2. SETUP: only while the organization has NO live administrator, a business administrator of a business that has a draft or
--      active agreement with it. This is the bootstrap condition of customer_access_grant, word for word: before an organization
--      has its own administrator the business that brought it in sets it up; once one exists every business is refused and the
--      organization runs itself. A general manager, a schedule delegate, an employee and a department head never pass.
-- Every function that changes something locks the organization row FIRST (the same lock customer_access_grant / _revoke take), so a
-- decision that depends on "is there a live administrator?" can never interleave with a bootstrap. Lock order everywhere:
-- organization, then invitation, then principal, then grant.
--
-- INVITATIONS. The link carries a random token that the server never stores: only its SHA-256 digest is here. An invitation names
-- one department and ONE intended recipient (the digest of the e-mail address the issuer typed, plus a masked hint to show in
-- lists). It is accepted only by a signed-in user whose VERIFIED Google address has that digest (the server computes it from the
-- auth server's answer, never from anything typed), once, before it expires, while it is not revoked, while the department and the
-- organization are active and while its ISSUER still has the authority to invite. Acceptance creates the user's principal when they
-- have none, the department_head grant, and the audit rows, in one transaction. A typed address proves nothing by itself.
--
-- Refusals say nothing: 'bad_request' for a malformed call, 'denied' for everything about authority or existence. After authority
-- has passed two more answers exist: 'conflict' (a name that is taken, an invitation that was already used) and 'limit'.
--
-- Additive and idempotent (applies twice). RLS on the new table, no policy; browser roles get nothing; service_role gets select /
-- insert / update on it and execute on the thirteen functions. No row is seeded.

-- ---------------------------------------------------------------- the invitation

create table if not exists public.customer_invitations (
  id                        uuid primary key default gen_random_uuid(),
  purpose                   text not null check (purpose in ('department_head')),
  organization_id           uuid not null references public.customer_organizations(id) on delete restrict,
  department_id             uuid not null,
  -- sha-256 (hex) of the purpose-prefixed token in the link. The token itself is never stored.
  token_digest              text not null unique check (token_digest ~ '^[0-9a-f]{64}$'),
  -- sha-256 (hex) of the intended recipient's normalized e-mail address, and a masked form of it for lists (never the address)
  recipient_digest          text not null check (recipient_digest ~ '^[0-9a-f]{64}$'),
  recipient_hint            text not null check (char_length(recipient_hint) between 3 and 80),
  -- a plain value (no foreign key), like the audit's actor: a legacy owner has no principal, and the record outlives the issuer
  issued_by_auth_user_id    uuid not null,
  created_at                timestamptz not null default now(),
  expires_at                timestamptz not null,
  revoked_at                timestamptz,
  revoked_reason            text check (revoked_reason is null or char_length(revoked_reason) between 1 and 300),
  consumed_at               timestamptz,
  consumed_by_principal_id  uuid references public.customer_principals(id) on delete restrict,
  grant_id                  uuid references public.customer_access_grants(id) on delete restrict,
  constraint customer_invitations_department_fk foreign key (organization_id, department_id)
    references public.customer_departments (organization_id, id) on delete restrict,
  constraint customer_invitations_expiry_check check (expires_at > created_at),
  -- used means: by whom, and which grant it became. Never half of that.
  constraint customer_invitations_consumed_check check ((consumed_at is null) = (consumed_by_principal_id is null) and (consumed_at is null) = (grant_id is null)),
  -- an invitation ends one way only
  constraint customer_invitations_one_end_check check (consumed_at is null or revoked_at is null)
);
create index if not exists customer_invitations_department_idx on public.customer_invitations (organization_id, department_id);
-- one open invitation per department and recipient (a new one supersedes the old one inside customer_invitation_create)
create unique index if not exists customer_invitations_live_idx on public.customer_invitations (department_id, recipient_digest)
  where consumed_at is null and revoked_at is null;
create index if not exists customer_invitations_principal_idx on public.customer_invitations (consumed_by_principal_id) where consumed_by_principal_id is not null;
create index if not exists customer_invitations_grant_idx on public.customer_invitations (grant_id) where grant_id is not null;

alter table public.customer_invitations enable row level security;
revoke all on public.customer_invitations from public, anon, authenticated, service_role;
grant select, insert, update on public.customer_invitations to service_role;

-- A used or revoked invitation is final, also for the service role and the table owner: single use is a fact of the row.
create or replace function public.customer_invitations_final()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.consumed_at is not null or old.revoked_at is not null then
    raise exception 'customer identity: a used or revoked invitation cannot change' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.customer_invitations_final() from public, anon, authenticated, service_role;

drop trigger if exists customer_invitations_keep on public.customer_invitations;
create trigger customer_invitations_keep before update on public.customer_invitations
  for each row execute function public.customer_keep_columns('id', 'purpose', 'organization_id', 'department_id', 'token_digest', 'recipient_digest', 'recipient_hint', 'issued_by_auth_user_id', 'created_at', 'expires_at');
drop trigger if exists customer_invitations_final on public.customer_invitations;
create trigger customer_invitations_final before update on public.customer_invitations
  for each row execute function public.customer_invitations_final();

-- ---------------------------------------------------------------- who may manage an organization

-- { ok: true, via: 'organization_admin', grant_id, principal_id }
-- { ok: true, via: 'setup', business_id, business_via: 'legacy_owner' | 'grant', staff_id | grant_id + principal_id }
-- { ok: false, error: 'denied' | 'bad_request' }   ('denied' also for an organization that does not exist)
-- p_any_state: also answer for an inactive organization (to look at it, switch it back on, or take authority away in it). Every
-- other use needs an active one. Reads only; the functions that change something lock the organization row before asking.
create or replace function public.customer_org_manage_check(p_auth_user_id uuid, p_organization_id uuid, p_any_state boolean)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_denied constant jsonb := jsonb_build_object('ok', false, 'error', 'denied');
  v_state text;
  v_grant uuid;
  v_principal uuid;
  v_business uuid;
  v_via jsonb;
begin
  if p_auth_user_id is null or p_organization_id is null then return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;
  select o.state into v_state from public.customer_organizations o where o.id = p_organization_id;
  if not found then return v_denied; end if;
  if v_state <> 'active' and not coalesce(p_any_state, false) then return v_denied; end if;

  select g.id, g.principal_id into v_grant, v_principal
    from public.customer_access_grants g
    join public.customer_principals p on p.id = g.principal_id and p.state = 'active' and p.auth_user_id = p_auth_user_id
   where g.scope_kind = 'organization' and g.capability = 'organization_admin' and g.organization_id = p_organization_id
     and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())
   limit 1;
  if v_grant is not null then
    return jsonb_build_object('ok', true, 'via', 'organization_admin', 'grant_id', v_grant, 'principal_id', v_principal);
  end if;

  -- setup: the same condition as the first-administrator bootstrap (no live administrator at all)
  if exists (
    select 1 from public.customer_access_grants g
      join public.customer_principals p on p.id = g.principal_id and p.state = 'active'
     where g.scope_kind = 'organization' and g.capability = 'organization_admin' and g.organization_id = p_organization_id
       and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())) then
    return v_denied;
  end if;
  select a.business_id, public.customer_access_check(p_auth_user_id, 'business_admin', a.business_id, null, null)
    into v_business, v_via
    from public.customer_business_orgs a
   where a.organization_id = p_organization_id and a.state in ('draft', 'active')
     and coalesce((public.customer_access_check(p_auth_user_id, 'business_admin', a.business_id, null, null) ->> 'ok')::boolean, false)
   order by a.business_id
   limit 1;
  if v_business is null then return v_denied; end if;
  return jsonb_build_object('ok', true, 'via', 'setup', 'business_id', v_business, 'business_via', v_via ->> 'via',
                            'staff_id', v_via -> 'staff_id', 'grant_id', v_via -> 'grant_id', 'principal_id', v_via -> 'principal_id');
end;
$$;
revoke all on function public.customer_org_manage_check(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.customer_org_manage_check(uuid, uuid, boolean) to service_role;

-- ---------------------------------------------------------------- organizations

-- A business administrator creates an organization TOGETHER with a draft agreement between it and that business, so a new
-- organization is never unattached and is never attached to a business the actor does not administer.
create or replace function public.customer_org_create(p_actor_auth_user_id uuid, p_business_id uuid, p_name text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_actor jsonb;
  v_org uuid;
  v_agreement uuid;
begin
  if p_actor_auth_user_id is null or p_business_id is null or char_length(v_name) not between 1 and 80 then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  v_actor := public.customer_access_check(p_actor_auth_user_id, 'business_admin', p_business_id, null, null);
  if not coalesce((v_actor ->> 'ok')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'denied'); end if;

  -- two clicks on "create" wait for each other here
  perform 1 from public.customer_businesses b where b.id = p_business_id for update;
  if exists (
    select 1 from public.customer_business_orgs a
      join public.customer_organizations o on o.id = a.organization_id
     where a.business_id = p_business_id and o.state = 'active' and lower(btrim(o.name)) = lower(v_name)) then
    return jsonb_build_object('ok', false, 'error', 'conflict');
  end if;
  if (select count(*) from public.customer_business_orgs a where a.business_id = p_business_id) >= 200 then
    return jsonb_build_object('ok', false, 'error', 'limit');
  end if;

  insert into public.customer_organizations (slug, name)
  values ('org-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20), v_name)
  returning id into v_org;
  insert into public.customer_business_orgs (business_id, organization_id) values (p_business_id, v_org) returning id into v_agreement;

  insert into public.customer_identity_audit (business_id, actor_auth_user_id, actor_principal_id, actor_staff_id, operation, target_table, target_id, detail)
  values (p_business_id, p_actor_auth_user_id, (v_actor ->> 'principal_id')::uuid, (v_actor ->> 'staff_id')::uuid,
          'organization.create', 'customer_organizations', v_org, jsonb_build_object('agreement_id', v_agreement, 'actor_via', v_actor ->> 'via'));

  return jsonb_build_object('ok', true, 'status', 'created', 'organization_id', v_org, 'agreement_id', v_agreement);
end;
$$;
revoke all on function public.customer_org_create(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.customer_org_create(uuid, uuid, text) to service_role;

-- Rename and / or switch an organization off or on (null = leave as it is). Switching it off revokes its open invitations; grants
-- are kept and simply stop working while it is off (customer_access_check needs an active organization).
create or replace function public.customer_org_update(p_actor_auth_user_id uuid, p_organization_id uuid, p_name text, p_state text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_actor jsonb;
  v_org public.customer_organizations%rowtype;
  v_renamed boolean := false;
  v_revoked integer := 0;
  v_detail jsonb;
begin
  if p_actor_auth_user_id is null or p_organization_id is null or (p_name is null and p_state is null)
     or (p_name is not null and (v_name is null or char_length(v_name) > 80))
     or (p_state is not null and p_state not in ('active', 'inactive')) then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  perform 1 from public.customer_organizations o where o.id = p_organization_id for update;
  v_actor := public.customer_org_manage_check(p_actor_auth_user_id, p_organization_id, true);
  if not coalesce((v_actor ->> 'ok')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'denied'); end if;
  select * into v_org from public.customer_organizations o where o.id = p_organization_id;

  v_renamed := v_name is not null and v_name <> v_org.name;
  if not v_renamed and (p_state is null or p_state = v_org.state) then
    return jsonb_build_object('ok', true, 'status', 'unchanged', 'organization_id', v_org.id);
  end if;
  update public.customer_organizations set name = coalesce(v_name, name), state = coalesce(p_state, state) where id = v_org.id;
  if p_state = 'inactive' and v_org.state = 'active' then
    update public.customer_invitations set revoked_at = now(), revoked_reason = 'organization_inactive'
     where organization_id = v_org.id and consumed_at is null and revoked_at is null;
    get diagnostics v_revoked = row_count;
  end if;

  v_detail := jsonb_build_object('renamed', v_renamed, 'state_from', v_org.state, 'state_to', coalesce(p_state, v_org.state), 'invitations_revoked', v_revoked, 'actor_via', v_actor ->> 'via');
  if v_actor ->> 'via' = 'setup' then
    v_detail := v_detail || jsonb_build_object('setup_business_id', v_actor -> 'business_id', 'setup_grant_id', v_actor -> 'grant_id');
  end if;
  insert into public.customer_identity_audit (organization_id, actor_auth_user_id, actor_principal_id, actor_staff_id, operation, target_table, target_id, detail)
  values (v_org.id, p_actor_auth_user_id, (v_actor ->> 'principal_id')::uuid, (v_actor ->> 'staff_id')::uuid, 'organization.update', 'customer_organizations', v_org.id, v_detail);

  return jsonb_build_object('ok', true, 'status', 'updated', 'organization_id', v_org.id);
end;
$$;
revoke all on function public.customer_org_update(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.customer_org_update(uuid, uuid, text, text) to service_role;

-- ---------------------------------------------------------------- departments

create or replace function public.customer_department_create(p_actor_auth_user_id uuid, p_organization_id uuid, p_name text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_actor jsonb;
  v_department uuid;
  v_detail jsonb;
begin
  if p_actor_auth_user_id is null or p_organization_id is null or char_length(v_name) not between 1 and 80 then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  perform 1 from public.customer_organizations o where o.id = p_organization_id for update;
  v_actor := public.customer_org_manage_check(p_actor_auth_user_id, p_organization_id, false);
  if not coalesce((v_actor ->> 'ok')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'denied'); end if;

  if exists (select 1 from public.customer_departments d where d.organization_id = p_organization_id and lower(btrim(d.name)) = lower(v_name)) then
    return jsonb_build_object('ok', false, 'error', 'conflict');
  end if;
  if (select count(*) from public.customer_departments d where d.organization_id = p_organization_id) >= 200 then
    return jsonb_build_object('ok', false, 'error', 'limit');
  end if;
  insert into public.customer_departments (organization_id, name) values (p_organization_id, v_name) returning id into v_department;

  v_detail := jsonb_build_object('actor_via', v_actor ->> 'via');
  if v_actor ->> 'via' = 'setup' then
    v_detail := v_detail || jsonb_build_object('setup_business_id', v_actor -> 'business_id', 'setup_grant_id', v_actor -> 'grant_id');
  end if;
  insert into public.customer_identity_audit (organization_id, actor_auth_user_id, actor_principal_id, actor_staff_id, operation, target_table, target_id, detail)
  values (p_organization_id, p_actor_auth_user_id, (v_actor ->> 'principal_id')::uuid, (v_actor ->> 'staff_id')::uuid, 'department.create', 'customer_departments', v_department, v_detail);

  return jsonb_build_object('ok', true, 'status', 'created', 'department_id', v_department);
end;
$$;
revoke all on function public.customer_department_create(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.customer_department_create(uuid, uuid, text) to service_role;

-- Rename and / or switch a department off or on. The department must belong to the organization named with it (a department id
-- from another organization is 'denied', like one that does not exist). Switching it off revokes its open invitations; its
-- heads' grants are kept and stop working while it is off.
create or replace function public.customer_department_update(p_actor_auth_user_id uuid, p_organization_id uuid, p_department_id uuid, p_name text, p_state text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_actor jsonb;
  v_department public.customer_departments%rowtype;
  v_renamed boolean := false;
  v_revoked integer := 0;
  v_detail jsonb;
begin
  if p_actor_auth_user_id is null or p_organization_id is null or p_department_id is null or (p_name is null and p_state is null)
     or (p_name is not null and (v_name is null or char_length(v_name) > 80))
     or (p_state is not null and p_state not in ('active', 'inactive')) then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  perform 1 from public.customer_organizations o where o.id = p_organization_id for update;
  v_actor := public.customer_org_manage_check(p_actor_auth_user_id, p_organization_id, false);
  if not coalesce((v_actor ->> 'ok')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'denied'); end if;
  select * into v_department from public.customer_departments d where d.id = p_department_id and d.organization_id = p_organization_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'denied'); end if;

  v_renamed := v_name is not null and v_name <> v_department.name;
  if v_renamed and exists (select 1 from public.customer_departments d where d.organization_id = p_organization_id and d.id <> v_department.id and lower(btrim(d.name)) = lower(v_name)) then
    return jsonb_build_object('ok', false, 'error', 'conflict');
  end if;
  if not v_renamed and (p_state is null or p_state = v_department.state) then
    return jsonb_build_object('ok', true, 'status', 'unchanged', 'department_id', v_department.id);
  end if;
  update public.customer_departments set name = coalesce(v_name, name), state = coalesce(p_state, state) where id = v_department.id;
  if p_state = 'inactive' and v_department.state = 'active' then
    update public.customer_invitations set revoked_at = now(), revoked_reason = 'department_inactive'
     where organization_id = p_organization_id and department_id = v_department.id and consumed_at is null and revoked_at is null;
    get diagnostics v_revoked = row_count;
  end if;

  v_detail := jsonb_build_object('renamed', v_renamed, 'state_from', v_department.state, 'state_to', coalesce(p_state, v_department.state), 'invitations_revoked', v_revoked, 'actor_via', v_actor ->> 'via');
  if v_actor ->> 'via' = 'setup' then
    v_detail := v_detail || jsonb_build_object('setup_business_id', v_actor -> 'business_id', 'setup_grant_id', v_actor -> 'grant_id');
  end if;
  insert into public.customer_identity_audit (organization_id, actor_auth_user_id, actor_principal_id, actor_staff_id, operation, target_table, target_id, detail)
  values (p_organization_id, p_actor_auth_user_id, (v_actor ->> 'principal_id')::uuid, (v_actor ->> 'staff_id')::uuid, 'department.update', 'customer_departments', v_department.id, v_detail);

  return jsonb_build_object('ok', true, 'status', 'updated', 'department_id', v_department.id);
end;
$$;
revoke all on function public.customer_department_update(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.customer_department_update(uuid, uuid, uuid, text, text) to service_role;

-- ---------------------------------------------------------------- department-head invitations

-- The server made the token, kept it out of every store and passes only its digest, the digest of the intended recipient's
-- address and a masked hint. An open invitation for the same department and recipient is superseded. At most 30 days ahead.
create or replace function public.customer_invitation_create(
  p_actor_auth_user_id uuid, p_organization_id uuid, p_department_id uuid, p_token_digest text, p_recipient_digest text,
  p_recipient_hint text, p_expires_at timestamptz)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_denied constant jsonb := jsonb_build_object('ok', false, 'error', 'denied');
  v_bad constant jsonb := jsonb_build_object('ok', false, 'error', 'bad_request');
  v_hint text := btrim(coalesce(p_recipient_hint, ''));
  v_actor jsonb;
  v_superseded uuid;
  v_invitation uuid;
  v_detail jsonb;
begin
  if p_actor_auth_user_id is null or p_organization_id is null or p_department_id is null
     or p_token_digest is null or p_token_digest !~ '^[0-9a-f]{64}$'
     or p_recipient_digest is null or p_recipient_digest !~ '^[0-9a-f]{64}$'
     or char_length(v_hint) not between 3 and 80
     or p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '30 days' then
    return v_bad;
  end if;
  perform 1 from public.customer_organizations o where o.id = p_organization_id for update;
  v_actor := public.customer_org_manage_check(p_actor_auth_user_id, p_organization_id, false);
  if not coalesce((v_actor ->> 'ok')::boolean, false) then return v_denied; end if;
  if not exists (select 1 from public.customer_departments d where d.id = p_department_id and d.organization_id = p_organization_id and d.state = 'active') then
    return v_denied;
  end if;
  if exists (select 1 from public.customer_invitations i where i.token_digest = p_token_digest) then return v_bad; end if;
  if (select count(*) from public.customer_invitations i
       where i.organization_id = p_organization_id and i.department_id = p_department_id and i.consumed_at is null and i.revoked_at is null
         and i.expires_at > now() and i.recipient_digest <> p_recipient_digest) >= 20 then
    return jsonb_build_object('ok', false, 'error', 'limit');
  end if;

  update public.customer_invitations set revoked_at = now(), revoked_reason = 'superseded'
   where department_id = p_department_id and recipient_digest = p_recipient_digest and consumed_at is null and revoked_at is null
  returning id into v_superseded;

  insert into public.customer_invitations (purpose, organization_id, department_id, token_digest, recipient_digest, recipient_hint, issued_by_auth_user_id, expires_at)
  values ('department_head', p_organization_id, p_department_id, p_token_digest, p_recipient_digest, v_hint, p_actor_auth_user_id, p_expires_at)
  returning id into v_invitation;

  v_detail := jsonb_build_object('purpose', 'department_head', 'department_id', p_department_id, 'expires_at', p_expires_at, 'superseded_id', v_superseded, 'actor_via', v_actor ->> 'via');
  if v_actor ->> 'via' = 'setup' then
    v_detail := v_detail || jsonb_build_object('setup_business_id', v_actor -> 'business_id', 'setup_grant_id', v_actor -> 'grant_id');
  end if;
  insert into public.customer_identity_audit (organization_id, actor_auth_user_id, actor_principal_id, actor_staff_id, operation, target_table, target_id, detail)
  values (p_organization_id, p_actor_auth_user_id, (v_actor ->> 'principal_id')::uuid, (v_actor ->> 'staff_id')::uuid, 'invitation.create', 'customer_invitations', v_invitation, v_detail);

  return jsonb_build_object('ok', true, 'status', 'created', 'invitation_id', v_invitation, 'expires_at', p_expires_at);
end;
$$;
revoke all on function public.customer_invitation_create(uuid, uuid, uuid, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.customer_invitation_create(uuid, uuid, uuid, text, text, text, timestamptz) to service_role;

-- Ends an open invitation now. An unknown invitation and one outside the actor's scope answer the same. One that was already used
-- is 'conflict' (said only to someone who may manage that organization): the grant it became is ended with
-- customer_department_head_revoke instead.
create or replace function public.customer_invitation_revoke(p_actor_auth_user_id uuid, p_invitation_id uuid, p_reason text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_denied constant jsonb := jsonb_build_object('ok', false, 'error', 'denied');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_invitation public.customer_invitations%rowtype;
  v_actor jsonb;
  v_detail jsonb;
begin
  if p_actor_auth_user_id is null or p_invitation_id is null or (v_reason is not null and char_length(v_reason) > 300) then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  -- the scope of an invitation never changes (customer_invitations_keep), so it can be read before anything is locked
  select * into v_invitation from public.customer_invitations i where i.id = p_invitation_id;
  if not found then return v_denied; end if;
  perform 1 from public.customer_organizations o where o.id = v_invitation.organization_id for update;
  select * into v_invitation from public.customer_invitations i where i.id = p_invitation_id for update;
  if not found then return v_denied; end if;
  v_actor := public.customer_org_manage_check(p_actor_auth_user_id, v_invitation.organization_id, true);
  if not coalesce((v_actor ->> 'ok')::boolean, false) then return v_denied; end if;

  if v_invitation.consumed_at is not null then return jsonb_build_object('ok', false, 'error', 'conflict'); end if;
  if v_invitation.revoked_at is not null then
    return jsonb_build_object('ok', true, 'status', 'unchanged', 'invitation_id', v_invitation.id);
  end if;
  update public.customer_invitations set revoked_at = now(), revoked_reason = coalesce(v_reason, 'revoked') where id = v_invitation.id;

  v_detail := jsonb_build_object('department_id', v_invitation.department_id, 'actor_via', v_actor ->> 'via');
  if v_actor ->> 'via' = 'setup' then
    v_detail := v_detail || jsonb_build_object('setup_business_id', v_actor -> 'business_id', 'setup_grant_id', v_actor -> 'grant_id');
  end if;
  insert into public.customer_identity_audit (organization_id, actor_auth_user_id, actor_principal_id, actor_staff_id, operation, target_table, target_id, reason, detail)
  values (v_invitation.organization_id, p_actor_auth_user_id, (v_actor ->> 'principal_id')::uuid, (v_actor ->> 'staff_id')::uuid, 'invitation.revoke', 'customer_invitations', v_invitation.id, v_reason, v_detail);

  return jsonb_build_object('ok', true, 'status', 'revoked', 'invitation_id', v_invitation.id);
end;
$$;
revoke all on function public.customer_invitation_revoke(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.customer_invitation_revoke(uuid, uuid, text) to service_role;

-- What the invitation page may show BEFORE acceptance, and only to the signed-in intended recipient: the names of the organization
-- and the department. Everyone else, and every invitation that could not be accepted right now, gets 'denied' and learns nothing.
-- Reads only.
create or replace function public.customer_invitation_peek(p_token_digest text, p_auth_user_id uuid, p_recipient_digest text)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_denied constant jsonb := jsonb_build_object('ok', false, 'error', 'denied');
  v_invitation public.customer_invitations%rowtype;
  v_organization text;
  v_department text;
begin
  if p_auth_user_id is null or p_token_digest is null or p_token_digest !~ '^[0-9a-f]{64}$'
     or p_recipient_digest is null or p_recipient_digest !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  select * into v_invitation from public.customer_invitations i where i.token_digest = p_token_digest;
  if not found or v_invitation.purpose <> 'department_head' or v_invitation.consumed_at is not null or v_invitation.revoked_at is not null
     or v_invitation.expires_at <= now() or v_invitation.recipient_digest <> p_recipient_digest
     or v_invitation.issued_by_auth_user_id = p_auth_user_id then
    return v_denied;
  end if;
  if exists (select 1 from public.customer_principals p where p.auth_user_id = p_auth_user_id and p.state <> 'active') then return v_denied; end if;
  select o.name, d.name into v_organization, v_department
    from public.customer_departments d
    join public.customer_organizations o on o.id = d.organization_id and o.state = 'active'
   where d.id = v_invitation.department_id and d.organization_id = v_invitation.organization_id and d.state = 'active';
  if not found then return v_denied; end if;
  if not coalesce((public.customer_org_manage_check(v_invitation.issued_by_auth_user_id, v_invitation.organization_id, false) ->> 'ok')::boolean, false) then
    return v_denied;
  end if;
  return jsonb_build_object('ok', true, 'organization_name', v_organization, 'department_name', v_department, 'expires_at', v_invitation.expires_at);
end;
$$;
revoke all on function public.customer_invitation_peek(text, uuid, text) from public, anon, authenticated;
grant execute on function public.customer_invitation_peek(text, uuid, text) to service_role;

-- Acceptance: everything or nothing, once.
--   p_auth_user_id      the signed-in user the SERVER resolved (a full Google sign-in), never a value from the browser
--   p_recipient_digest  the digest of that user's VERIFIED Google address, computed by the server from the auth server's answer
-- Refused ('denied', nothing written except the note below): an unknown, used, revoked or expired invitation; another purpose; a
-- recipient that is not the intended one (a forwarded link: one audit row 'invitation.refuse' says so, without any address); the
-- issuer accepting their own invitation; a department or organization that is off; an issuer who no longer may invite (their grant
-- ended, or the organization got its own administrator after a business set it up); a principal that was switched off.
-- Otherwise, in ONE transaction: the user's principal is created when they have none (audit 'principal.create'), the
-- department_head grant is written (audit 'access.grant') or an existing live one is kept, the invitation is marked used with
-- that principal and grant, and 'invitation.accept' is written. The organization row is locked first and the invitation row
-- second, so two acceptances at the same moment, an acceptance racing a revocation, and an acceptance racing a bootstrap or a
-- revocation of the issuer's authority each happen one after the other: exactly one acceptance can ever win.
create or replace function public.customer_invitation_accept(p_token_digest text, p_auth_user_id uuid, p_recipient_digest text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_denied constant jsonb := jsonb_build_object('ok', false, 'error', 'denied');
  v_organization uuid;
  v_invitation public.customer_invitations%rowtype;
  v_issuer jsonb;
  v_principal public.customer_principals%rowtype;
  v_principal_id uuid;
  v_existing public.customer_access_grants%rowtype;
  v_grant uuid;
  v_grant_status text := 'created';
begin
  if p_auth_user_id is null or p_token_digest is null or p_token_digest !~ '^[0-9a-f]{64}$'
     or p_recipient_digest is null or p_recipient_digest !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  select i.organization_id into v_organization from public.customer_invitations i where i.token_digest = p_token_digest;
  if not found then return v_denied; end if;
  perform 1 from public.customer_organizations o where o.id = v_organization for update;
  select * into v_invitation from public.customer_invitations i where i.token_digest = p_token_digest for update;
  if not found or v_invitation.purpose <> 'department_head' or v_invitation.consumed_at is not null or v_invitation.revoked_at is not null
     or v_invitation.expires_at <= now() then
    return v_denied;
  end if;

  if v_invitation.recipient_digest <> p_recipient_digest then
    -- a forwarded or mistaken link: no authority, and the people who manage the organization can see that it was tried
    if (select count(*) from public.customer_identity_audit a where a.target_id = v_invitation.id and a.operation = 'invitation.refuse') < 10 then
      insert into public.customer_identity_audit (organization_id, actor_auth_user_id, operation, target_table, target_id, detail)
      values (v_invitation.organization_id, p_auth_user_id, 'invitation.refuse', 'customer_invitations', v_invitation.id,
              jsonb_build_object('reason', 'wrong_recipient', 'department_id', v_invitation.department_id));
    end if;
    return v_denied;
  end if;
  if v_invitation.issued_by_auth_user_id = p_auth_user_id then return v_denied; end if;
  if not exists (
    select 1 from public.customer_departments d
      join public.customer_organizations o on o.id = d.organization_id and o.state = 'active'
     where d.id = v_invitation.department_id and d.organization_id = v_invitation.organization_id and d.state = 'active') then
    return v_denied;
  end if;
  -- an invitation carries no more authority than its issuer has NOW
  v_issuer := public.customer_org_manage_check(v_invitation.issued_by_auth_user_id, v_invitation.organization_id, false);
  if not coalesce((v_issuer ->> 'ok')::boolean, false) then return v_denied; end if;

  select * into v_principal from public.customer_principals p where p.auth_user_id = p_auth_user_id for update;
  if found then
    if v_principal.state <> 'active' then return v_denied; end if;
    v_principal_id := v_principal.id;
  else
    insert into public.customer_principals (auth_user_id) values (p_auth_user_id)
    on conflict (auth_user_id) do nothing
    returning id into v_principal_id;
    if v_principal_id is null then
      -- the same user was accepting another organization's invitation at this very moment: that transaction made the principal
      select * into v_principal from public.customer_principals p where p.auth_user_id = p_auth_user_id for update;
      if not found or v_principal.state <> 'active' then return v_denied; end if;
      v_principal_id := v_principal.id;
    else
      insert into public.customer_identity_audit (organization_id, actor_auth_user_id, actor_principal_id, operation, target_table, target_id, detail)
      values (v_invitation.organization_id, p_auth_user_id, v_principal_id, 'principal.create', 'customer_principals', v_principal_id,
              jsonb_build_object('via', 'invitation', 'invitation_id', v_invitation.id));
    end if;
  end if;

  select * into v_existing from public.customer_access_grants g
   where g.principal_id = v_principal_id and g.capability = 'department_head' and g.revoked_at is null
     and g.organization_id = v_invitation.organization_id and g.department_id = v_invitation.department_id
   for update;
  if found and (v_existing.expires_at is null or v_existing.expires_at > now()) then
    v_grant := v_existing.id;
    v_grant_status := 'unchanged';
  else
    if found then
      update public.customer_access_grants set revoked_at = now(), revoked_reason = 'expired' where id = v_existing.id;
    end if;
    insert into public.customer_access_grants (principal_id, capability, scope_kind, organization_id, department_id)
    values (v_principal_id, 'department_head', 'department', v_invitation.organization_id, v_invitation.department_id)
    returning id into v_grant;
    insert into public.customer_identity_audit (organization_id, actor_auth_user_id, actor_principal_id, operation, target_table, target_id, detail)
    values (v_invitation.organization_id, p_auth_user_id, v_principal_id, 'access.grant', 'customer_access_grants', v_grant,
            jsonb_build_object('capability', 'department_head', 'scope_kind', 'department', 'department_id', v_invitation.department_id, 'principal_id', v_principal_id,
                               'actor_via', 'invitation', 'invitation_id', v_invitation.id, 'issued_by_auth_user_id', v_invitation.issued_by_auth_user_id,
                               'issuer_via', v_issuer ->> 'via'));
  end if;

  update public.customer_invitations set consumed_at = now(), consumed_by_principal_id = v_principal_id, grant_id = v_grant where id = v_invitation.id;
  insert into public.customer_identity_audit (organization_id, actor_auth_user_id, actor_principal_id, operation, target_table, target_id, detail)
  values (v_invitation.organization_id, p_auth_user_id, v_principal_id, 'invitation.accept', 'customer_invitations', v_invitation.id,
          jsonb_build_object('department_id', v_invitation.department_id, 'principal_id', v_principal_id, 'grant_id', v_grant, 'grant_status', v_grant_status,
                             'issuer_via', v_issuer ->> 'via'));

  return jsonb_build_object('ok', true, 'status', 'accepted', 'grant_id', v_grant, 'organization_id', v_invitation.organization_id, 'department_id', v_invitation.department_id);
end;
$$;
revoke all on function public.customer_invitation_accept(text, uuid, text) from public, anon, authenticated;
grant execute on function public.customer_invitation_accept(text, uuid, text) to service_role;

-- ---------------------------------------------------------------- ending a department head's grant

-- Whoever may manage the organization (its administrator, or a business in setup) ends a department_head grant. Only department
-- grants: an organization_admin or business_admin grant is 'denied' here and stays under customer_access_revoke and its rules.
create or replace function public.customer_department_head_revoke(p_actor_auth_user_id uuid, p_grant_id uuid, p_reason text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_denied constant jsonb := jsonb_build_object('ok', false, 'error', 'denied');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_grant public.customer_access_grants%rowtype;
  v_actor jsonb;
  v_detail jsonb;
begin
  if p_actor_auth_user_id is null or p_grant_id is null or (v_reason is not null and char_length(v_reason) > 300) then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  select * into v_grant from public.customer_access_grants g where g.id = p_grant_id;
  if not found or v_grant.scope_kind <> 'department' then return v_denied; end if;
  perform 1 from public.customer_organizations o where o.id = v_grant.organization_id for update;
  select * into v_grant from public.customer_access_grants g where g.id = p_grant_id for update;
  if not found then return v_denied; end if;
  v_actor := public.customer_org_manage_check(p_actor_auth_user_id, v_grant.organization_id, true);
  if not coalesce((v_actor ->> 'ok')::boolean, false) then return v_denied; end if;

  if v_grant.revoked_at is not null then
    return jsonb_build_object('ok', true, 'status', 'unchanged', 'grant_id', v_grant.id);
  end if;
  update public.customer_access_grants set revoked_at = now(), revoked_reason = coalesce(v_reason, 'revoked') where id = v_grant.id;

  v_detail := jsonb_build_object('capability', v_grant.capability, 'scope_kind', v_grant.scope_kind, 'department_id', v_grant.department_id,
                                 'principal_id', v_grant.principal_id, 'actor_via', v_actor ->> 'via');
  if v_actor ->> 'via' = 'setup' then
    v_detail := v_detail || jsonb_build_object('setup_business_id', v_actor -> 'business_id', 'setup_grant_id', v_actor -> 'grant_id');
  end if;
  insert into public.customer_identity_audit (organization_id, actor_auth_user_id, actor_principal_id, actor_staff_id, operation, target_table, target_id, reason, detail)
  values (v_grant.organization_id, p_actor_auth_user_id, (v_actor ->> 'principal_id')::uuid, (v_actor ->> 'staff_id')::uuid, 'access.revoke', 'customer_access_grants', v_grant.id, v_reason, v_detail);

  return jsonb_build_object('ok', true, 'status', 'revoked', 'grant_id', v_grant.id);
end;
$$;
revoke all on function public.customer_department_head_revoke(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.customer_department_head_revoke(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------- reads (each rechecks the actor; names only inside the scope)

-- The organizations that have an agreement with a business, for that business's administrator.
create or replace function public.customer_org_list(p_actor_auth_user_id uuid, p_business_id uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_actor jsonb;
begin
  if p_actor_auth_user_id is null or p_business_id is null then return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;
  v_actor := public.customer_access_check(p_actor_auth_user_id, 'business_admin', p_business_id, null, null);
  if not coalesce((v_actor ->> 'ok')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'denied'); end if;
  return jsonb_build_object('ok', true, 'organizations', coalesce((
    select jsonb_agg(to_jsonb(x) order by x.state, lower(x.name), x.id) from (
      select o.id, o.name, o.state, a.state as agreement_state,
             exists (select 1 from public.customer_access_grants g
                       join public.customer_principals p on p.id = g.principal_id and p.state = 'active'
                      where g.scope_kind = 'organization' and g.capability = 'organization_admin' and g.organization_id = o.id
                        and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())) as has_admin,
             coalesce((public.customer_org_manage_check(p_actor_auth_user_id, o.id, true) ->> 'ok')::boolean, false) as can_manage,
             (select count(*) from public.customer_departments d where d.organization_id = o.id and d.state = 'active') as departments
        from public.customer_business_orgs a
        join public.customer_organizations o on o.id = a.organization_id
       where a.business_id = p_business_id) x), '[]'::jsonb));
end;
$$;
revoke all on function public.customer_org_list(uuid, uuid) from public, anon, authenticated;
grant execute on function public.customer_org_list(uuid, uuid) to service_role;

-- One organization for someone who may manage it: its departments, their heads and its invitations. A head is shown by the masked
-- hint of the invitation that made them a head (there is no name or address of a principal anywhere in the database).
create or replace function public.customer_org_detail(p_actor_auth_user_id uuid, p_organization_id uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_actor jsonb;
begin
  v_actor := public.customer_org_manage_check(p_actor_auth_user_id, p_organization_id, true);
  if not coalesce((v_actor ->> 'ok')::boolean, false) then return jsonb_build_object('ok', false, 'error', coalesce(v_actor ->> 'error', 'denied')); end if;
  return jsonb_build_object(
    'ok', true, 'via', v_actor ->> 'via',
    'organization', (select jsonb_build_object('id', o.id, 'name', o.name, 'state', o.state) from public.customer_organizations o where o.id = p_organization_id),
    'departments', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'state', d.state) order by d.state, lower(d.name), d.id)
        from public.customer_departments d where d.organization_id = p_organization_id), '[]'::jsonb),
    'heads', coalesce((
      select jsonb_agg(jsonb_build_object('grant_id', g.id, 'department_id', g.department_id, 'granted_at', g.granted_at,
               'hint', (select i.recipient_hint from public.customer_invitations i where i.grant_id = g.id order by i.consumed_at desc limit 1)) order by g.granted_at, g.id)
        from public.customer_access_grants g
        join public.customer_principals p on p.id = g.principal_id and p.state = 'active'
       where g.scope_kind = 'department' and g.capability = 'department_head' and g.organization_id = p_organization_id
         and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())), '[]'::jsonb),
    'invitations', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id) from (
        select i.id, i.department_id, i.recipient_hint as hint, i.created_at, i.expires_at,
               case when i.consumed_at is not null then 'accepted' when i.revoked_at is not null then 'revoked'
                    when i.expires_at <= now() then 'expired' else 'pending' end as status
          from public.customer_invitations i
         where i.organization_id = p_organization_id
         order by i.created_at desc, i.id
         limit 100) x), '[]'::jsonb));
end;
$$;
revoke all on function public.customer_org_detail(uuid, uuid) from public, anon, authenticated;
grant execute on function public.customer_org_detail(uuid, uuid) to service_role;

-- What the signed-in user holds: the organizations they administer and the departments they head (live grants of an active
-- principal). Someone who holds nothing gets two empty lists.
--   organizations: every organization with a live organization_admin grant, ACTIVE OR INACTIVE, with its state. An administrator who
--     switched their organization off must still find it, to switch it back on (customer_org_manage_check(..., true) already lets
--     them; FABLE-002 review R2). Being listed opens nothing by itself: every action rechecks, and while it is off only looking,
--     renaming, switching it on and taking authority away are accepted.
--   departments: only in ACTIVE organizations and ACTIVE departments. A head of a switched-off department or organization has
--     nothing to open (and invitation acceptance refuses both).
create or replace function public.customer_manage_scopes(p_auth_user_id uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
begin
  if p_auth_user_id is null then return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;
  return jsonb_build_object(
    'ok', true,
    'organizations', coalesce((
      select jsonb_agg(jsonb_build_object('organization_id', o.id, 'name', o.name, 'state', o.state) order by o.state, lower(o.name), o.id)
        from public.customer_access_grants g
        join public.customer_principals p on p.id = g.principal_id and p.state = 'active' and p.auth_user_id = p_auth_user_id
        join public.customer_organizations o on o.id = g.organization_id
       where g.scope_kind = 'organization' and g.capability = 'organization_admin'
         and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())), '[]'::jsonb),
    'departments', coalesce((
      select jsonb_agg(jsonb_build_object('organization_id', o.id, 'organization_name', o.name, 'department_id', d.id, 'department_name', d.name, 'granted_at', g.granted_at)
                       order by lower(o.name), lower(d.name), d.id)
        from public.customer_access_grants g
        join public.customer_principals p on p.id = g.principal_id and p.state = 'active' and p.auth_user_id = p_auth_user_id
        join public.customer_organizations o on o.id = g.organization_id and o.state = 'active'
        join public.customer_departments d on d.id = g.department_id and d.organization_id = g.organization_id and d.state = 'active'
       where g.scope_kind = 'department' and g.capability = 'department_head'
         and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())), '[]'::jsonb));
end;
$$;
revoke all on function public.customer_manage_scopes(uuid) from public, anon, authenticated;
grant execute on function public.customer_manage_scopes(uuid) to service_role;

-- Check after applying (all true):
--   select (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'customer_invitations') as invitations_rls,
--          not has_table_privilege('authenticated', 'public.customer_invitations', 'select') as invitations_closed,
--          not has_function_privilege('authenticated', 'public.customer_invitation_accept(text, uuid, text)', 'execute') as browser_locked,
--          has_function_privilege('service_role', 'public.customer_invitation_accept(text, uuid, text)', 'execute') as server_can_accept,
--          (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('customer_org_manage_check', 'customer_org_create',
--            'customer_org_update', 'customer_department_create', 'customer_department_update', 'customer_invitation_create', 'customer_invitation_revoke',
--            'customer_invitation_peek', 'customer_invitation_accept', 'customer_department_head_revoke', 'customer_org_list', 'customer_org_detail',
--            'customer_manage_scopes')) = 13 as thirteen_functions,
--          (select count(*) from (select proname from pg_proc p where p.pronamespace = 'public'::regnamespace
--            and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') group by proname having count(*) > 1) t) = 0 as no_overloads;
-- Ledger row (only when the owner applies it; NOT applied by this change; 20261112125033_customer_identity_foundation must be applied first):
--   insert into supabase_migrations.schema_migrations (version, name) values ('20261112162132', 'customer_org_management') on conflict do nothing;
