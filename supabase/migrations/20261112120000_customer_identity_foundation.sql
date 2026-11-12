-- 20261112120000_customer_identity_foundation
--
-- FABLE-001 (docs/identity-system/, docs/SARCAFE_IDENTITY.md): the service-only foundation of the hybrid identity system. Eleven tables
-- and three callable functions; nothing reads or writes them yet except the new server module src/lib/identity/. No existing table, function,
-- policy or behaviour changes: staff, owner, scheduler, checklists, POS, kiosk and the customer waitlist are untouched.
--
-- Three things are kept apart on purpose:
--   identity     customer_members (a private UUID and a lifecycle state: no name, phone or e-mail, so it cannot be a directory)
--   affiliation  customer_org_memberships / customer_business_memberships (a member's relation to ONE organization or ONE business)
--   authority    customer_principals + customer_access_grants (a verified sign-in, and what it may administer in ONE exact scope)
-- None of them creates a staff row, an auth account or a POS/scheduler right, and no row here is matched to another by name, phone
-- or e-mail. Nothing is backfilled: the only seed is the Sarcafe business and its existing branches.
--
-- Scope is enforced by the database itself, so the service role (which bypasses RLS) cannot attach a row to the wrong tenant either:
-- composite foreign keys keep a department inside its organization, CHECK constraints allow exactly one scope shape per grant and
-- audit row, a trigger refuses to re-point an existing grant / membership / mapping at another scope, and the audit is append-only.
-- Legacy owners (staff.role/badge = 'owner') reach only the ONE business flagged legacy_owner_access (Sarcafe): a unique index allows
-- a single such business, so a future business never inherits them.
--
-- Additive and idempotent (applies twice). RLS on every table, no policies; browser roles get nothing; service_role gets only the
-- table rights listed below and execute on the three customer_* functions. NOT a place for discounts, Wallet, loyalty or invitations.

-- ---------------------------------------------------------------- identity

create table if not exists public.customer_members (
  id          uuid primary key default gen_random_uuid(),
  state       text not null default 'active' check (state in ('active', 'disabled', 'erased')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- A verified sign-in (Supabase Auth subject). One auth user is at most one principal, and so at most one member. member_id is null
-- for a pure operator (an organization administrator who is not a member). Never created from a typed e-mail or a name.
create table if not exists public.customer_principals (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid not null unique references auth.users(id) on delete cascade,
  member_id     uuid references public.customer_members(id) on delete restrict,
  state         text not null default 'active' check (state in ('active', 'revoked')),
  verified_at   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index if not exists customer_principals_member_idx on public.customer_principals (member_id) where member_id is not null;

-- ---------------------------------------------------------------- businesses and organizations

create table if not exists public.customer_businesses (
  id                   uuid primary key default gen_random_uuid(),
  slug                 text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name                 text not null check (char_length(btrim(name)) between 1 and 80),
  timezone             text not null default 'Asia/Jerusalem' check (char_length(timezone) between 1 and 64),
  state                text not null default 'active' check (state in ('active', 'inactive')),
  -- the ONE business the existing staff owners administer without a stored grant (Sarcafe). At most one row may have it.
  legacy_owner_access  boolean not null default false,
  created_at           timestamptz not null default now()
);
create unique index if not exists customer_businesses_one_legacy_idx on public.customer_businesses ((true)) where legacy_owner_access;

-- Which business an existing branch belongs to. A branch belongs to one business; public.branches itself is not changed.
create table if not exists public.customer_business_branches (
  business_id  uuid not null references public.customer_businesses(id) on delete restrict,
  branch_id    uuid not null unique references public.branches(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (business_id, branch_id)
);

create table if not exists public.customer_organizations (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  state       text not null default 'active' check (state in ('active', 'inactive')),
  created_at  timestamptz not null default now()
);

create table if not exists public.customer_departments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.customer_organizations(id) on delete restrict,
  name             text not null check (char_length(btrim(name)) between 1 and 80),
  state            text not null default 'active' check (state in ('active', 'inactive')),
  created_at       timestamptz not null default now(),
  -- the target of every scoped reference to a department: (organization_id, department_id) must name a real pair
  unique (organization_id, id)
);
create unique index if not exists customer_departments_name_idx on public.customer_departments (organization_id, lower(btrim(name)));

-- An explicit agreement between ONE business and ONE organization. Starts as a draft; nothing in this migration acts on 'active'.
create table if not exists public.customer_business_orgs (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.customer_businesses(id) on delete restrict,
  organization_id  uuid not null references public.customer_organizations(id) on delete restrict,
  purpose          text not null default 'employee_benefit' check (purpose in ('employee_benefit')),
  state            text not null default 'draft' check (state in ('draft', 'active', 'suspended', 'ended')),
  created_at       timestamptz not null default now(),
  unique (business_id, organization_id)
);
create index if not exists customer_business_orgs_org_idx on public.customer_business_orgs (organization_id);

-- ---------------------------------------------------------------- authority

-- What a principal may administer, in exactly one scope. There is no global grant: the CHECK allows only these three shapes.
create table if not exists public.customer_access_grants (
  id               uuid primary key default gen_random_uuid(),
  principal_id     uuid not null references public.customer_principals(id) on delete cascade,
  capability       text not null check (capability in ('business_admin', 'organization_admin', 'department_head')),
  scope_kind       text not null check (scope_kind in ('business', 'organization', 'department')),
  business_id      uuid references public.customer_businesses(id) on delete restrict,
  organization_id  uuid references public.customer_organizations(id) on delete restrict,
  department_id    uuid,
  granted_at       timestamptz not null default now(),
  expires_at       timestamptz,
  revoked_at       timestamptz,
  revoked_reason   text check (revoked_reason is null or char_length(revoked_reason) between 1 and 300),
  constraint customer_access_grants_scope_check check (
    (scope_kind = 'business'     and capability = 'business_admin'     and business_id is not null and organization_id is null     and department_id is null)
    or (scope_kind = 'organization' and capability = 'organization_admin' and business_id is null     and organization_id is not null and department_id is null)
    or (scope_kind = 'department'   and capability = 'department_head'    and business_id is null     and organization_id is not null and department_id is not null)
  ),
  constraint customer_access_grants_department_fk foreign key (organization_id, department_id)
    references public.customer_departments (organization_id, id) on delete restrict
);
-- one live grant per principal, capability and scope (an expired one is closed by customer_access_grant before a new one is written)
create unique index if not exists customer_access_grants_live_idx on public.customer_access_grants
  (principal_id, capability, coalesce(business_id, organization_id), coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where revoked_at is null;
create index if not exists customer_access_grants_business_idx on public.customer_access_grants (business_id) where business_id is not null;
create index if not exists customer_access_grants_org_idx on public.customer_access_grants (organization_id, department_id) where organization_id is not null;

-- ---------------------------------------------------------------- affiliation (skeletons: nothing writes them yet)

-- display_name is what THIS organization calls the person; it is not unique and is never used to find or join people.
create table if not exists public.customer_org_memberships (
  id                        uuid primary key default gen_random_uuid(),
  member_id                 uuid not null references public.customer_members(id) on delete restrict,
  organization_id           uuid not null references public.customer_organizations(id) on delete restrict,
  department_id             uuid not null,
  display_name              text check (display_name is null or char_length(btrim(display_name)) between 1 and 80),
  state                     text not null default 'pending' check (state in ('pending', 'approved', 'rejected', 'inactive')),
  reviewed_by_principal_id  uuid references public.customer_principals(id) on delete set null,
  reviewed_at               timestamptz,
  review_reason             text check (review_reason is null or char_length(review_reason) between 1 and 300),
  version                   integer not null default 1 check (version >= 1),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (organization_id, member_id),
  constraint customer_org_memberships_department_fk foreign key (organization_id, department_id)
    references public.customer_departments (organization_id, id) on delete restrict,
  -- a decision carries its time; a pending application carries none
  constraint customer_org_memberships_review_check check ((state = 'pending') = (reviewed_at is null))
);
create index if not exists customer_org_memberships_member_idx on public.customer_org_memberships (member_id);
create index if not exists customer_org_memberships_department_idx on public.customer_org_memberships (organization_id, department_id);

create table if not exists public.customer_business_memberships (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.customer_businesses(id) on delete restrict,
  member_id     uuid not null references public.customer_members(id) on delete restrict,
  display_name  text check (display_name is null or char_length(btrim(display_name)) between 1 and 80),
  source        text not null default 'manual' check (source in ('manual', 'invitation', 'organization', 'waitlist_claim')),
  state         text not null default 'pending' check (state in ('pending', 'active', 'inactive')),
  version       integer not null default 1 check (version >= 1),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (business_id, member_id)
);
create index if not exists customer_business_memberships_member_idx on public.customer_business_memberships (member_id);

-- ---------------------------------------------------------------- audit (append-only)

-- Who did what, in which ONE scope. Ids only: no names, contact details, tokens or photos. The actor ids are plain values (no
-- foreign key), so the record survives the actor.
create table if not exists public.customer_identity_audit (
  id                  uuid primary key default gen_random_uuid(),
  at                  timestamptz not null default now(),
  business_id         uuid references public.customer_businesses(id) on delete restrict,
  organization_id     uuid references public.customer_organizations(id) on delete restrict,
  actor_auth_user_id  uuid,
  actor_principal_id  uuid,
  actor_staff_id      uuid,
  operation           text not null check (operation ~ '^[a-z][a-z_.]{2,59}$'),
  target_table        text not null check (target_table ~ '^customer_[a-z_]{3,50}$'),
  target_id           uuid not null,
  reason              text check (reason is null or char_length(reason) between 1 and 300),
  detail              jsonb not null default '{}'::jsonb check (octet_length(detail::text) <= 2000),
  correlation_id      uuid,
  constraint customer_identity_audit_scope_check check ((business_id is not null) <> (organization_id is not null))
);
create index if not exists customer_identity_audit_business_idx on public.customer_identity_audit (business_id, at desc) where business_id is not null;
create index if not exists customer_identity_audit_org_idx on public.customer_identity_audit (organization_id, at desc) where organization_id is not null;

-- ---------------------------------------------------------------- access: RLS on, browser roles nothing, service role the minimum

alter table public.customer_members enable row level security;
alter table public.customer_principals enable row level security;
alter table public.customer_businesses enable row level security;
alter table public.customer_business_branches enable row level security;
alter table public.customer_organizations enable row level security;
alter table public.customer_departments enable row level security;
alter table public.customer_business_orgs enable row level security;
alter table public.customer_access_grants enable row level security;
alter table public.customer_org_memberships enable row level security;
alter table public.customer_business_memberships enable row level security;
alter table public.customer_identity_audit enable row level security;

revoke all on public.customer_members, public.customer_principals, public.customer_businesses, public.customer_business_branches,
  public.customer_organizations, public.customer_departments, public.customer_business_orgs, public.customer_access_grants,
  public.customer_org_memberships, public.customer_business_memberships, public.customer_identity_audit
  from public, anon, authenticated, service_role;
-- no DELETE anywhere (a lifecycle is a state, not a removed row); the audit is insert + read only
grant select, insert, update on public.customer_members, public.customer_principals, public.customer_businesses,
  public.customer_business_branches, public.customer_organizations, public.customer_departments, public.customer_business_orgs,
  public.customer_access_grants, public.customer_org_memberships, public.customer_business_memberships to service_role;
grant select, insert on public.customer_identity_audit to service_role;

-- ---------------------------------------------------------------- triggers: a row cannot be re-pointed at another scope

-- Columns named in the trigger's arguments keep their value for the life of the row (also for the service role and the table owner).
create or replace function public.customer_keep_columns()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_col text;
begin
  foreach v_col in array tg_argv loop
    if (v_old -> v_col) is distinct from (v_new -> v_col) then
      raise exception 'customer identity: % on % cannot change', v_col, tg_table_name using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.customer_keep_columns() from public, anon, authenticated, service_role;

create or replace function public.customer_identity_audit_keep()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'customer identity: the audit is append-only' using errcode = '23514';
end;
$$;
revoke all on function public.customer_identity_audit_keep() from public, anon, authenticated, service_role;

drop trigger if exists customer_principals_keep on public.customer_principals;
create trigger customer_principals_keep before update on public.customer_principals
  for each row execute function public.customer_keep_columns('id', 'auth_user_id', 'member_id');
drop trigger if exists customer_business_branches_keep on public.customer_business_branches;
create trigger customer_business_branches_keep before update on public.customer_business_branches
  for each row execute function public.customer_keep_columns('business_id', 'branch_id');
drop trigger if exists customer_departments_keep on public.customer_departments;
create trigger customer_departments_keep before update on public.customer_departments
  for each row execute function public.customer_keep_columns('id', 'organization_id');
drop trigger if exists customer_business_orgs_keep on public.customer_business_orgs;
create trigger customer_business_orgs_keep before update on public.customer_business_orgs
  for each row execute function public.customer_keep_columns('id', 'business_id', 'organization_id', 'purpose');
drop trigger if exists customer_access_grants_keep on public.customer_access_grants;
create trigger customer_access_grants_keep before update on public.customer_access_grants
  for each row execute function public.customer_keep_columns('id', 'principal_id', 'capability', 'scope_kind', 'business_id', 'organization_id', 'department_id', 'granted_at');
drop trigger if exists customer_org_memberships_keep on public.customer_org_memberships;
create trigger customer_org_memberships_keep before update on public.customer_org_memberships
  for each row execute function public.customer_keep_columns('id', 'member_id', 'organization_id');
drop trigger if exists customer_business_memberships_keep on public.customer_business_memberships;
create trigger customer_business_memberships_keep before update on public.customer_business_memberships
  for each row execute function public.customer_keep_columns('id', 'member_id', 'business_id');
drop trigger if exists customer_identity_audit_keep on public.customer_identity_audit;
create trigger customer_identity_audit_keep before update or delete on public.customer_identity_audit
  for each row execute function public.customer_identity_audit_keep();

-- ---------------------------------------------------------------- functions (service role only; one name, one signature)

-- May this signed-in user (the auth subject the SERVER resolved, never one a browser sent) use this capability in this exact scope?
-- Answers { ok: true, via, ... } or { ok: false, error }: 'bad_request' for a malformed question, 'denied' for everything else, the
-- same for "no such target" and "not yours", so an answer never says whether a business, organization or department exists.
--   business_admin      business scope. A stored live grant, or a legacy owner on the one business flagged legacy_owner_access.
--   organization_admin  organization scope. A stored live grant only.
--   department_head     department scope (organization + department). A stored live grant only.
-- A capability asked for in the wrong scope shape is refused. Session assurance (a full sign-in, not a quick code) is the caller's
-- job: src/lib/identity/access.ts refuses before it ever asks.
create or replace function public.customer_access_check(
  p_auth_user_id uuid, p_capability text, p_business_id uuid, p_organization_id uuid, p_department_id uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_denied constant jsonb := jsonb_build_object('ok', false, 'error', 'denied');
  v_bad constant jsonb := jsonb_build_object('ok', false, 'error', 'bad_request');
  v_staff uuid;
  v_grant uuid;
  v_principal uuid;
begin
  if p_auth_user_id is null or p_capability is null then return v_bad; end if;

  if p_capability = 'business_admin' then
    if p_business_id is null or p_organization_id is not null or p_department_id is not null then return v_bad; end if;
    if not exists (select 1 from public.customer_businesses b where b.id = p_business_id and b.state = 'active') then return v_denied; end if;
    select s.id into v_staff
      from public.staff s
     where s.auth_user_id = p_auth_user_id and s.active and (s.role = 'owner' or s.badge = 'owner')
       and exists (select 1 from public.customer_businesses b where b.id = p_business_id and b.state = 'active' and b.legacy_owner_access)
     limit 1;
    if v_staff is not null then
      return jsonb_build_object('ok', true, 'via', 'legacy_owner', 'staff_id', v_staff);
    end if;
    select g.id, g.principal_id into v_grant, v_principal
      from public.customer_access_grants g
      join public.customer_principals p on p.id = g.principal_id and p.state = 'active' and p.auth_user_id = p_auth_user_id
     where g.scope_kind = 'business' and g.capability = 'business_admin' and g.business_id = p_business_id
       and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())
     limit 1;

  elsif p_capability = 'organization_admin' then
    if p_organization_id is null or p_business_id is not null or p_department_id is not null then return v_bad; end if;
    if not exists (select 1 from public.customer_organizations o where o.id = p_organization_id and o.state = 'active') then return v_denied; end if;
    select g.id, g.principal_id into v_grant, v_principal
      from public.customer_access_grants g
      join public.customer_principals p on p.id = g.principal_id and p.state = 'active' and p.auth_user_id = p_auth_user_id
     where g.scope_kind = 'organization' and g.capability = 'organization_admin' and g.organization_id = p_organization_id
       and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())
     limit 1;

  elsif p_capability = 'department_head' then
    if p_organization_id is null or p_department_id is null or p_business_id is not null then return v_bad; end if;
    if not exists (
      select 1 from public.customer_departments d
        join public.customer_organizations o on o.id = d.organization_id and o.state = 'active'
       where d.id = p_department_id and d.organization_id = p_organization_id and d.state = 'active') then return v_denied; end if;
    select g.id, g.principal_id into v_grant, v_principal
      from public.customer_access_grants g
      join public.customer_principals p on p.id = g.principal_id and p.state = 'active' and p.auth_user_id = p_auth_user_id
     where g.scope_kind = 'department' and g.capability = 'department_head'
       and g.organization_id = p_organization_id and g.department_id = p_department_id
       and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())
     limit 1;

  else
    return v_bad;
  end if;

  if v_grant is null then return v_denied; end if;
  return jsonb_build_object('ok', true, 'via', 'grant', 'grant_id', v_grant, 'principal_id', v_principal);
end;
$$;
revoke all on function public.customer_access_check(uuid, text, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.customer_access_check(uuid, text, uuid, uuid, uuid) to service_role;

-- Gives a principal one capability in one exact scope, and writes the audit row in the same transaction. The actor (p_actor_auth_user_id,
-- resolved by the server) is rechecked here, so a caller holding the service key still cannot grant outside the actor's own scope:
--   business_admin of B      needs: the actor administers business B.
--   organization_admin of O  needs: the actor administers organization O, or administers a business that has a draft/active
--                            agreement with O (how an organization gets its first administrator).
--   department_head of O/D   needs: the actor administers organization O.
-- Nobody grants to themselves. A department head grants nothing. Returns { ok, status: created|unchanged, grant_id } or { ok:false, error }.
create or replace function public.customer_access_grant(
  p_actor_auth_user_id uuid, p_principal_id uuid, p_capability text, p_business_id uuid, p_organization_id uuid, p_department_id uuid,
  p_expires_at timestamptz, p_reason text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_denied constant jsonb := jsonb_build_object('ok', false, 'error', 'denied');
  v_bad constant jsonb := jsonb_build_object('ok', false, 'error', 'bad_request');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_kind text;
  v_actor jsonb;
  v_target public.customer_principals%rowtype;
  v_existing public.customer_access_grants%rowtype;
  v_grant uuid;
begin
  if p_actor_auth_user_id is null or p_principal_id is null or p_capability is null then return v_bad; end if;
  if v_reason is not null and char_length(v_reason) > 300 then return v_bad; end if;
  if p_expires_at is not null and p_expires_at <= now() then return v_bad; end if;

  if p_capability = 'business_admin' then
    if p_business_id is null or p_organization_id is not null or p_department_id is not null then return v_bad; end if;
    v_kind := 'business';
    v_actor := public.customer_access_check(p_actor_auth_user_id, 'business_admin', p_business_id, null, null);
  elsif p_capability = 'organization_admin' then
    if p_organization_id is null or p_business_id is not null or p_department_id is not null then return v_bad; end if;
    v_kind := 'organization';
    v_actor := public.customer_access_check(p_actor_auth_user_id, 'organization_admin', null, p_organization_id, null);
    if not coalesce((v_actor ->> 'ok')::boolean, false) then
      -- the first administrator: from a business that has an agreement with this (active) organization
      select public.customer_access_check(p_actor_auth_user_id, 'business_admin', a.business_id, null, null) into v_actor
        from public.customer_business_orgs a
        join public.customer_organizations o on o.id = a.organization_id and o.state = 'active'
       where a.organization_id = p_organization_id and a.state in ('draft', 'active')
         and coalesce((public.customer_access_check(p_actor_auth_user_id, 'business_admin', a.business_id, null, null) ->> 'ok')::boolean, false)
       limit 1;
    end if;
  elsif p_capability = 'department_head' then
    if p_organization_id is null or p_department_id is null or p_business_id is not null then return v_bad; end if;
    v_kind := 'department';
    if not exists (select 1 from public.customer_departments d where d.id = p_department_id and d.organization_id = p_organization_id and d.state = 'active') then return v_denied; end if;
    v_actor := public.customer_access_check(p_actor_auth_user_id, 'organization_admin', null, p_organization_id, null);
  else
    return v_bad;
  end if;
  if not coalesce((v_actor ->> 'ok')::boolean, false) then return v_denied; end if;

  select * into v_target from public.customer_principals p where p.id = p_principal_id and p.state = 'active';
  if not found then return jsonb_build_object('ok', false, 'error', 'bad_principal'); end if;
  if v_target.auth_user_id = p_actor_auth_user_id then return jsonb_build_object('ok', false, 'error', 'self_grant'); end if;

  select * into v_existing from public.customer_access_grants g
   where g.principal_id = p_principal_id and g.capability = p_capability and g.revoked_at is null
     and g.business_id is not distinct from p_business_id and g.organization_id is not distinct from p_organization_id
     and g.department_id is not distinct from p_department_id
   for update;
  if found then
    if v_existing.expires_at is null or v_existing.expires_at > now() then
      return jsonb_build_object('ok', true, 'status', 'unchanged', 'grant_id', v_existing.id);
    end if;
    update public.customer_access_grants set revoked_at = now(), revoked_reason = 'expired' where id = v_existing.id;
  end if;

  insert into public.customer_access_grants (principal_id, capability, scope_kind, business_id, organization_id, department_id, expires_at)
  values (p_principal_id, p_capability, v_kind, p_business_id, p_organization_id, p_department_id, p_expires_at)
  returning id into v_grant;

  insert into public.customer_identity_audit (business_id, organization_id, actor_auth_user_id, actor_principal_id, actor_staff_id, operation, target_table, target_id, reason, detail)
  values (p_business_id, p_organization_id, p_actor_auth_user_id, (v_actor ->> 'principal_id')::uuid, (v_actor ->> 'staff_id')::uuid,
          'access.grant', 'customer_access_grants', v_grant, v_reason,
          jsonb_build_object('capability', p_capability, 'scope_kind', v_kind, 'department_id', p_department_id, 'principal_id', p_principal_id, 'actor_via', v_actor ->> 'via'));

  return jsonb_build_object('ok', true, 'status', 'created', 'grant_id', v_grant);
end;
$$;
revoke all on function public.customer_access_grant(uuid, uuid, text, uuid, uuid, uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.customer_access_grant(uuid, uuid, text, uuid, uuid, uuid, timestamptz, text) to service_role;

-- Ends a grant now, with the audit row in the same transaction. The actor needs the same authority that could have given it (see
-- customer_access_grant); anyone may give up their OWN grant. An unknown grant and a grant outside the actor's scope answer the same.
create or replace function public.customer_access_revoke(p_actor_auth_user_id uuid, p_grant_id uuid, p_reason text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_denied constant jsonb := jsonb_build_object('ok', false, 'error', 'denied');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_grant public.customer_access_grants%rowtype;
  v_actor jsonb;
  v_own boolean;
begin
  if p_actor_auth_user_id is null or p_grant_id is null then return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;
  if v_reason is not null and char_length(v_reason) > 300 then return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;

  select * into v_grant from public.customer_access_grants g where g.id = p_grant_id for update;
  if not found then return v_denied; end if;

  select exists (select 1 from public.customer_principals p where p.id = v_grant.principal_id and p.auth_user_id = p_actor_auth_user_id and p.state = 'active') into v_own;

  if v_grant.scope_kind = 'business' then
    v_actor := public.customer_access_check(p_actor_auth_user_id, 'business_admin', v_grant.business_id, null, null);
  else
    v_actor := public.customer_access_check(p_actor_auth_user_id, 'organization_admin', null, v_grant.organization_id, null);
    if v_grant.scope_kind = 'organization' and not coalesce((v_actor ->> 'ok')::boolean, false) then
      select public.customer_access_check(p_actor_auth_user_id, 'business_admin', a.business_id, null, null) into v_actor
        from public.customer_business_orgs a
       where a.organization_id = v_grant.organization_id and a.state in ('draft', 'active')
         and coalesce((public.customer_access_check(p_actor_auth_user_id, 'business_admin', a.business_id, null, null) ->> 'ok')::boolean, false)
       limit 1;
    end if;
  end if;
  if not coalesce((v_actor ->> 'ok')::boolean, false) and not v_own then return v_denied; end if;

  if v_grant.revoked_at is not null then
    return jsonb_build_object('ok', true, 'status', 'unchanged', 'grant_id', v_grant.id);
  end if;

  update public.customer_access_grants set revoked_at = now(), revoked_reason = coalesce(v_reason, 'revoked') where id = v_grant.id;

  insert into public.customer_identity_audit (business_id, organization_id, actor_auth_user_id, actor_principal_id, actor_staff_id, operation, target_table, target_id, reason, detail)
  values (v_grant.business_id, v_grant.organization_id, p_actor_auth_user_id,
          case when coalesce((v_actor ->> 'ok')::boolean, false) then (v_actor ->> 'principal_id')::uuid else v_grant.principal_id end,
          case when coalesce((v_actor ->> 'ok')::boolean, false) then (v_actor ->> 'staff_id')::uuid end,
          'access.revoke', 'customer_access_grants', v_grant.id, v_reason,
          jsonb_build_object('capability', v_grant.capability, 'scope_kind', v_grant.scope_kind, 'department_id', v_grant.department_id,
                             'principal_id', v_grant.principal_id, 'actor_via', case when coalesce((v_actor ->> 'ok')::boolean, false) then v_actor ->> 'via' else 'self' end));

  return jsonb_build_object('ok', true, 'status', 'revoked', 'grant_id', v_grant.id);
end;
$$;
revoke all on function public.customer_access_revoke(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.customer_access_revoke(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------- seed: Sarcafe and its existing branches (configuration, not people)

insert into public.customer_businesses (slug, name, legacy_owner_access)
values ('sarcafe', 'Sarcafe', true)
on conflict (slug) do nothing;

insert into public.customer_business_branches (business_id, branch_id)
select b.id, br.id from public.customer_businesses b cross join public.branches br
 where b.slug = 'sarcafe'
on conflict do nothing;

-- Check after applying (all true):
--   select (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
--            where n.nspname = 'public' and c.relrowsecurity and c.relname in ('customer_members', 'customer_principals', 'customer_businesses',
--              'customer_business_branches', 'customer_organizations', 'customer_departments', 'customer_business_orgs', 'customer_access_grants',
--              'customer_org_memberships', 'customer_business_memberships', 'customer_identity_audit')) = 11 as eleven_tables_with_rls,
--          (select count(*) from public.customer_businesses where legacy_owner_access) = 1 as one_legacy_business,
--          not has_function_privilege('authenticated', 'public.customer_access_check(uuid, text, uuid, uuid, uuid)', 'execute') as browser_locked,
--          not has_table_privilege('authenticated', 'public.customer_members', 'select') as members_closed,
--          (select count(*) from (select proname from pg_proc p where p.pronamespace = 'public'::regnamespace
--            and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') group by proname having count(*) > 1) t) = 0 as no_overloads;
-- Ledger row (only when the owner applies it; NOT applied by this change):
--   insert into supabase_migrations.schema_migrations (version, name) values ('20261112120000', 'customer_identity_foundation') on conflict do nothing;
