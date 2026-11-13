// Local database check for the hybrid identity foundation (FABLE-001, 20261112125033_customer_identity_foundation.sql).
// Applies every migration in order to an in-memory Postgres (PGlite), re-applies the new one, then attacks it with a synthetic
// two-business / two-organization world: ID swaps, wrong-tenant references, duplicate-looking people, grants, RLS and browser
// denial. The last part runs the real TypeScript guard decision (src/lib/identity/access.ts) against the real SQL function for
// every kind of session. Nothing here touches production; every person and id is made up.
// Codex review round 1 (R1-R5) added: first-administrator bootstrap with two businesses and one organization, the organization row
// lock, restrictive deletes, non-disclosing grant errors and foreign-key index support. Two REAL concurrent sessions are exercised
// by scripts/identity-concurrency-docker.mjs (PGlite has one connection, so it cannot run them).
//
//   node scripts/verify-identity-sql.mjs

import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('../', import.meta.url))
const migrations = path.join(root, 'supabase/migrations') + path.sep
const NEW = '20261112125033_customer_identity_foundation.sql'
// The identity migrations that come AFTER the foundation, in order (FABLE-002 on: each has its own verifier). This file still checks
// the foundation with all of them applied, so a later migration that weakened a foundation rule would fail here.
const LATER = ['20261112162132_customer_org_management.sql']
const TABLES = ['customer_members', 'customer_principals', 'customer_businesses', 'customer_business_branches', 'customer_organizations', 'customer_departments', 'customer_business_orgs', 'customer_access_grants', 'customer_org_memberships', 'customer_business_memberships', 'customer_identity_audit']
const FUNCTIONS = ['customer_access_check(uuid,text,uuid,uuid,uuid)', 'customer_access_grant(uuid,uuid,text,uuid,uuid,uuid,timestamptz,text)', 'customer_access_revoke(uuid,uuid,text)']
const TRIGGER_FUNCTIONS = ['customer_keep_columns()', 'customer_identity_audit_keep()']

const db = new PGlite({ extensions: { pgcrypto } })
let passed = 0
const failed = []
const check = (name, okay, detail = '') => {
  if (okay) { passed++; console.log(`  ✓ ${name}`) } else { failed.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
const all = async (sql, params = []) => (await db.query(sql, params)).rows
const count = async (sql, params = []) => Number((await one(sql, params)).n)
/** The error message of a statement that must fail, or '' when it (wrongly) succeeded. */
const failure = async (sql, params = []) => { try { await db.query(sql, params); return '' } catch (error) { return String(error.message) } }
const refused = async (name, sql, params, pattern) => { const message = await failure(sql, params); check(name, pattern.test(message), message || 'the statement succeeded') }
/** Runs statements as another database role and always comes back. */
const as = async (role, fn) => { await db.exec(`set role ${role}`); try { return await fn() } finally { await db.exec('reset role') } }

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create schema storage;
  create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text);
  alter table storage.objects enable row level security;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{"session_id":"10000000-0000-4000-8000-000000000001"}'::jsonb) $$;
  create publication supabase_realtime;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  -- like Supabase: a new table in public is handed to the service role by default, so the migration's own revoke is what is tested
  alter default privileges in schema public grant all on tables to service_role;
`)

// ------------------------------------------------------------------ the migration
console.log('\nmigration')
const files = readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()
check('the foundation migration is later than every non-identity migration, and only the known identity migrations follow it, in order', JSON.stringify(files.slice(files.indexOf(NEW) + 1)) === JSON.stringify(LATER), files.slice(files.indexOf(NEW) + 1).join(', ') || 'nothing follows it')
const before = {}
const after = {}
for (const file of files) {
  if (file === NEW) {
    before.staff = await count(`select count(*) n from public.staff`)
    before.functions = await count(`select count(*) n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public'`)
    before.tables = (await all(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`)).map((r) => r.relname)
    before.policies = await count(`select count(*) n from pg_policies where schemaname = 'public'`)
  }
  try { await db.exec(readFileSync(migrations + file, 'utf8')) }
  catch (error) { check(`apply ${file}`, false, String(error.message).split('\n')[0]); console.error(error); process.exit(1) }
  if (file === NEW) {
    // what the foundation itself added, read before any later identity migration is applied
    after.functions = await count(`select count(*) n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public'`)
    after.tables = (await all(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`)).map((r) => r.relname)
  }
}
check('all migrations apply in order', true)
const snapshot = async () => JSON.stringify({
  tables: (await all(`select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`)),
  columns: await all(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name like 'customer\\_%' order by 1, 2`),
  constraints: await all(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) d from pg_constraint where conrelid::regclass::text like 'customer\\_%' or conrelid::regclass::text like 'public.customer\\_%' order by 1, 2`),
  indexes: await all(`select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename like 'customer\\_%' order by 1`),
  triggers: await all(`select tgrelid::regclass::text t, tgname from pg_trigger where not tgisinternal and tgrelid::regclass::text like '%customer\\_%' order by 1, 2`),
  functions: await all(`select p.proname, pg_get_function_identity_arguments(p.oid) a, md5(p.prosrc) body from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'customer\\_%' order by 1, 2`),
  grants: await all(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name like 'customer\\_%' and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC') order by 1, 2, 3`),
  businesses: await all(`select slug, name, legacy_owner_access, state from public.customer_businesses order by slug`),
  branches: await count(`select count(*) n from public.customer_business_branches`),
})
const first = await snapshot()
await db.exec(readFileSync(migrations + NEW, 'utf8'))
const second = await snapshot()
await db.exec(readFileSync(migrations + NEW, 'utf8'))
check('re-applying the identity migration twice changes nothing (tables, columns, constraints, indexes, triggers, functions, grants, seed)', first === second && second === await snapshot())
check('it added exactly the eleven identity tables and no other', JSON.stringify(after.tables.filter((t) => !before.tables.includes(t))) === JSON.stringify([...TABLES].sort()))
check('it added exactly five functions (three callable, two trigger functions)', after.functions === before.functions + 5)
check('it added no row-level policy and changed no existing one', await count(`select count(*) n from pg_policies where schemaname = 'public'`) === before.policies)
check('it created no staff row', await count(`select count(*) n from public.staff`) === before.staff)

// ------------------------------------------------------------------ seed
console.log('\nseed')
const sarcafe = await one(`select * from public.customer_businesses where slug = 'sarcafe'`)
check('Sarcafe is the only business, active, and the only one legacy owners reach', await count(`select count(*) n from public.customer_businesses`) === 1 && sarcafe.state === 'active' && sarcafe.legacy_owner_access === true)
check('every existing branch is mapped to Sarcafe, once', await count(`select count(*) n from public.branches`) === await count(`select count(*) n from public.customer_business_branches where business_id = $1`, [sarcafe.id]) && await count(`select count(*) n from public.branches`) > 0)
check('no member, principal, grant, membership, organization or audit row was created by the migration', await count(`select (select count(*) from public.customer_members) + (select count(*) from public.customer_principals) + (select count(*) from public.customer_access_grants) + (select count(*) from public.customer_org_memberships) + (select count(*) from public.customer_business_memberships) + (select count(*) from public.customer_organizations) + (select count(*) from public.customer_identity_audit) n`) === 0)

// ------------------------------------------------------------------ the synthetic world: two businesses, two organizations
const user = async () => (await one(`insert into auth.users default values returning id`)).id
const staffRow = async (authUser, over = {}) => {
  const s = { role: 'staff', badge: null, active: true, ...over }
  return (await one(`insert into public.staff (auth_user_id, first_name, role, badge, active) values ($1, 'Synthetic', $2, $3, $4) returning id`, [authUser, s.role, s.badge, s.active])).id
}
const U = { owner: await user(), badgeOwner: await user(), goneOwner: await user(), gm: await user(), employee: await user(), adminA: await user(), adminB: await user(), headA1: await user(), b2Admin: await user(), newcomer: await user(), stranger: await user(), revokedPrincipal: await user(), c1: await user(), c2: await user(), c3: await user(), c4: await user() }
const S = { owner: await staffRow(U.owner, { role: 'owner', badge: 'owner' }), badgeOwner: await staffRow(U.badgeOwner, { badge: 'owner' }), goneOwner: await staffRow(U.goneOwner, { role: 'owner', badge: 'owner', active: false }), gm: await staffRow(U.gm, { badge: 'general_manager' }), employee: await staffRow(U.employee, { badge: 'barista' }) }
const staffCount = await count(`select count(*) n from public.staff`)
const authCount = await count(`select count(*) n from auth.users`)

const b1 = sarcafe.id
const b2 = (await one(`insert into public.customer_businesses (slug, name) values ('other-cafe', 'Other Cafe') returning id`)).id
const orgA = (await one(`insert into public.customer_organizations (slug, name) values ('org-a', 'Organization A') returning id`)).id
const orgB = (await one(`insert into public.customer_organizations (slug, name) values ('org-b', 'Organization B') returning id`)).id
const dept = async (org, name) => (await one(`insert into public.customer_departments (organization_id, name) values ($1, $2) returning id`, [org, name])).id
const A1 = await dept(orgA, 'Kitchen'); const A2 = await dept(orgA, 'Office'); const B1 = await dept(orgB, 'Kitchen')
await db.query(`insert into public.customer_business_orgs (business_id, organization_id) values ($1, $2)`, [b1, orgA]) // draft
await db.query(`insert into public.customer_business_orgs (business_id, organization_id, state) values ($1, $2, 'active')`, [b2, orgB])
const principal = async (authUser, member = null) => (await one(`insert into public.customer_principals (auth_user_id, member_id) values ($1, $2) returning id`, [authUser, member])).id
const member = async () => (await one(`insert into public.customer_members default values returning id`)).id
const P = { adminA: await principal(U.adminA), adminB: await principal(U.adminB), headA1: await principal(U.headA1), b2Admin: await principal(U.b2Admin), newcomer: await principal(U.newcomer), revoked: await principal(U.revokedPrincipal), c1: await principal(U.c1), c2: await principal(U.c2), c3: await principal(U.c3), c4: await principal(U.c4) }
await db.query(`update public.customer_principals set state = 'revoked' where id = $1`, [P.revoked])
const grant = async (principalId, capability, kind, ids, over = {}) => (await one(
  `insert into public.customer_access_grants (principal_id, capability, scope_kind, business_id, organization_id, department_id, expires_at) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
  [principalId, capability, kind, ids.business ?? null, ids.org ?? null, ids.dept ?? null, over.expires ?? null])).id
const G = {
  adminA: await grant(P.adminA, 'organization_admin', 'organization', { org: orgA }),
  adminB: await grant(P.adminB, 'organization_admin', 'organization', { org: orgB }),
  headA1: await grant(P.headA1, 'department_head', 'department', { org: orgA, dept: A1 }),
  b2Admin: await grant(P.b2Admin, 'business_admin', 'business', { business: b2 }),
}

// ------------------------------------------------------------------ scoped foreign keys: an id from another tenant does not attach
console.log('\nscoped foreign keys and ID swaps (as the table owner AND as the service role)')
const m1 = await member()
for (const role of ['owner of the tables', 'service_role']) {
  const run = (fn) => (role === 'service_role' ? as('service_role', fn) : fn())
  await run(async () => {
    await refused(`${role}: a membership of organization A cannot point at organization B's department`, `insert into public.customer_org_memberships (member_id, organization_id, department_id) values ($1, $2, $3)`, [m1, orgA, B1], /foreign key|customer_org_memberships_department_fk/i)
    await refused(`${role}: a department-head grant in organization A cannot name organization B's department`, `insert into public.customer_access_grants (principal_id, capability, scope_kind, organization_id, department_id) values ($1, 'department_head', 'department', $2, $3)`, [P.newcomer, orgA, B1], /foreign key|customer_access_grants_department_fk/i)
    await refused(`${role}: a grant with no scope at all (a global grant) is impossible`, `insert into public.customer_access_grants (principal_id, capability, scope_kind) values ($1, 'business_admin', 'business')`, [P.newcomer], /customer_access_grants_scope_check/)
    await refused(`${role}: a business grant cannot also carry an organization`, `insert into public.customer_access_grants (principal_id, capability, scope_kind, business_id, organization_id) values ($1, 'business_admin', 'business', $2, $3)`, [P.newcomer, b1, orgA], /customer_access_grants_scope_check/)
    await refused(`${role}: an organization grant cannot carry a business`, `insert into public.customer_access_grants (principal_id, capability, scope_kind, business_id, organization_id) values ($1, 'organization_admin', 'organization', $2, $3)`, [P.newcomer, b1, orgA], /customer_access_grants_scope_check/)
    await refused(`${role}: a capability cannot be stored in another capability's scope (business_admin on an organization)`, `insert into public.customer_access_grants (principal_id, capability, scope_kind, organization_id) values ($1, 'business_admin', 'organization', $2)`, [P.newcomer, orgA], /customer_access_grants_scope_check/)
    await refused(`${role}: an unknown capability is refused`, `insert into public.customer_access_grants (principal_id, capability, scope_kind, business_id) values ($1, 'owner', 'business', $2)`, [P.newcomer, b1], /check constraint/i)
    await refused(`${role}: an existing grant cannot be re-pointed at another business`, `update public.customer_access_grants set business_id = $1 where id = $2`, [b1, G.b2Admin], /cannot change/)
    await refused(`${role}: an existing grant cannot be handed to another principal`, `update public.customer_access_grants set principal_id = $1 where id = $2`, [P.newcomer, G.adminA], /cannot change/)
    await refused(`${role}: an existing grant cannot be moved to another organization`, `update public.customer_access_grants set organization_id = $1 where id = $2`, [orgB, G.adminA], /cannot change/)
    await refused(`${role}: a department cannot be moved to another organization`, `update public.customer_departments set organization_id = $1 where id = $2`, [orgB, A1], /cannot change/)
    await refused(`${role}: an agreement cannot be re-pointed at another business or organization`, `update public.customer_business_orgs set business_id = $1 where organization_id = $2`, [b2, orgA], /cannot change/)
    await refused(`${role}: a branch mapping cannot be moved to another business`, `update public.customer_business_branches set business_id = $1`, [b2], /cannot change/)
    await refused(`${role}: a branch cannot belong to two businesses`, `insert into public.customer_business_branches (business_id, branch_id) select $1, branch_id from public.customer_business_branches limit 1`, [b2], /duplicate key|unique/i)
    await refused(`${role}: a principal cannot be re-bound to another auth user`, `update public.customer_principals set auth_user_id = $1 where id = $2`, [U.stranger, P.adminA], /cannot change/)
    await refused(`${role}: an audit row needs exactly one scope (none)`, `insert into public.customer_identity_audit (operation, target_table, target_id) values ('access.grant', 'customer_access_grants', gen_random_uuid())`, [], /customer_identity_audit_scope_check/)
    await refused(`${role}: an audit row needs exactly one scope (both)`, `insert into public.customer_identity_audit (business_id, organization_id, operation, target_table, target_id) values ($1, $2, 'access.grant', 'customer_access_grants', gen_random_uuid())`, [b1, orgA], /customer_identity_audit_scope_check/)
    await refused(`${role}: a second business cannot be flagged for legacy owners`, `update public.customer_businesses set legacy_owner_access = true where id = $1`, [b2], /duplicate key|unique/i)
  })
}

// ------------------------------------------------------------------ one shared identity, and people who only look alike
console.log('\none explicitly shared identity; duplicate-looking people stay separate')
const shared = m1
await db.query(`insert into public.customer_org_memberships (member_id, organization_id, department_id, display_name) values ($1, $2, $3, 'Dana K.')`, [shared, orgA, A1])
await db.query(`insert into public.customer_business_memberships (business_id, member_id, display_name) values ($1, $2, 'Dana (Sarcafe)')`, [b1, shared])
await db.query(`insert into public.customer_business_memberships (business_id, member_id, display_name) values ($1, $2, 'D. Cohen (Other)')`, [b2, shared])
check('one member is linked, by explicit rows, to organization A and to both businesses', await count(`select (select count(*) from public.customer_org_memberships where member_id = $1) + (select count(*) from public.customer_business_memberships where member_id = $1) n`, [shared]) === 3)
check('each business sees only its own membership of that person (its own display name, not the other business\'s)', (await all(`select display_name from public.customer_business_memberships where business_id = $1`, [b1])).map((r) => r.display_name).join() === 'Dana (Sarcafe)'
  && (await all(`select display_name from public.customer_business_memberships where business_id = $1`, [b2])).map((r) => r.display_name).join() === 'D. Cohen (Other)')
const twinA = await member(); const twinB = await member(); const twinC = await member()
await db.query(`insert into public.customer_org_memberships (member_id, organization_id, department_id, display_name) values ($1, $3, $4, 'Noa Levi'), ($2, $3, $4, 'Noa Levi')`, [twinA, twinB, orgA, A1])
await db.query(`insert into public.customer_business_memberships (business_id, member_id, display_name) values ($1, $2, 'Noa Levi'), ($1, $3, 'Noa Levi'), ($4, $5, 'Noa Levi')`, [b1, twinA, twinB, b2, twinC])
check('two people with the same name in the same organization and business are two members, two memberships each', twinA !== twinB && await count(`select count(distinct member_id) n from public.customer_org_memberships where display_name = 'Noa Levi'`) === 2 && await count(`select count(distinct member_id) n from public.customer_business_memberships where display_name = 'Noa Levi'`) === 3)
check('the same name in another business is yet another member: nothing joined them', await count(`select count(*) n from public.customer_members`) === 4 && await count(`select count(*) n from public.customer_business_memberships where member_id = $1`, [twinC]) === 1)
check('the member record holds no name, phone or e-mail to match on (id, state, two timestamps only)', (await all(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'customer_members' order by 1`)).map((r) => r.column_name).join() === 'created_at,id,state,updated_at')
check('no identity table has a phone or e-mail column, and no unique index covers a display name', await count(`select count(*) n from information_schema.columns where table_schema = 'public' and table_name = any($1) and column_name ~ '(phone|email|mail)'`, [TABLES]) === 0
  && await count(`select count(*) n from pg_indexes where schemaname = 'public' and tablename = any($1) and indexdef ilike '%unique%' and indexdef ilike '%display_name%'`, [TABLES]) === 0)
check('a principal is bound to a verified auth user, never to an e-mail text', (await all(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'customer_principals' order by 1`)).map((r) => r.column_name).join() === 'auth_user_id,created_at,id,member_id,state,verified_at')

console.log('\nuniqueness')
await refused('a person has one membership per business', `insert into public.customer_business_memberships (business_id, member_id) values ($1, $2)`, [b1, shared], /duplicate key/)
await refused('a person has one membership per organization', `insert into public.customer_org_memberships (member_id, organization_id, department_id) values ($1, $2, $3)`, [shared, orgA, A2], /duplicate key/)
await refused('an auth user is one principal', `insert into public.customer_principals (auth_user_id) values ($1)`, [U.adminA], /duplicate key/)
await refused('a business slug is unique', `insert into public.customer_businesses (slug, name) values ('sarcafe', 'Copy')`, [], /duplicate key/)
await refused('an organization slug is unique', `insert into public.customer_organizations (slug, name) values ('org-a', 'Copy')`, [], /duplicate key/)
await refused('a department name is unique inside its organization (case and spaces ignored)', `insert into public.customer_departments (organization_id, name) values ($1, '  KITCHEN ')`, [orgA], /duplicate key/)
check('the same department name in another organization is fine', (await one(`select name from public.customer_departments where id = $1`, [B1])).name === 'Kitchen')
await refused('a business and an organization have one agreement', `insert into public.customer_business_orgs (business_id, organization_id) values ($1, $2)`, [b1, orgA], /duplicate key/)
await refused('a principal cannot hold the same live grant twice', `insert into public.customer_access_grants (principal_id, capability, scope_kind, organization_id) values ($1, 'organization_admin', 'organization', $2)`, [P.adminA, orgA], /duplicate key/)
await refused('a bad slug is refused', `insert into public.customer_businesses (slug, name) values ('Bad Slug', 'x')`, [], /check constraint/i)
await refused('a decided membership needs its decision time', `update public.customer_org_memberships set state = 'approved' where member_id = $1`, [shared], /customer_org_memberships_review_check/)

// ------------------------------------------------------------------ the access decision in SQL
console.log('\ncustomer_access_check: every role, both tenants')
const ask = async (authUser, capability, ids = {}) => (await one(`select public.customer_access_check($1, $2, $3, $4, $5) r`, [authUser, capability, ids.business ?? null, ids.org ?? null, ids.dept ?? null])).r
const yes = (r, via) => r.ok === true && r.via === via
const no = (r) => r.ok === false && r.error === 'denied'
const bad = (r) => r.ok === false && r.error === 'bad_request'
const nowhere = '9f000000-0000-4000-8000-00000000dead'
let r = await ask(U.owner, 'business_admin', { business: b1 })
check('a Sarcafe owner (role) administers Sarcafe, as a legacy owner, with no stored grant', yes(r, 'legacy_owner') && r.staff_id === S.owner, JSON.stringify(r))
check('a Sarcafe owner (badge) does too', yes(await ask(U.badgeOwner, 'business_admin', { business: b1 }), 'legacy_owner'))
check('WRONG BUSINESS: the same owner does not administer the other business', no(await ask(U.owner, 'business_admin', { business: b2 })))
check('an owner does not administer an organization or a department by being an owner', no(await ask(U.owner, 'organization_admin', { org: orgA })) && no(await ask(U.owner, 'department_head', { org: orgA, dept: A1 })))
check('an inactive owner, a general manager and an employee administer nothing', no(await ask(U.goneOwner, 'business_admin', { business: b1 })) && no(await ask(U.gm, 'business_admin', { business: b1 })) && no(await ask(U.employee, 'business_admin', { business: b1 })))
check('a signed-in user with no grant and no staff row administers nothing', no(await ask(U.stranger, 'business_admin', { business: b1 })) && no(await ask(U.stranger, 'organization_admin', { org: orgA })))
r = await ask(U.b2Admin, 'business_admin', { business: b2 })
check('the other business\'s administrator (a stored grant) administers the other business', yes(r, 'grant') && r.grant_id === G.b2Admin && r.principal_id === P.b2Admin, JSON.stringify(r))
check('and not Sarcafe', no(await ask(U.b2Admin, 'business_admin', { business: b1 })))
check('organization A\'s administrator administers organization A', yes(await ask(U.adminA, 'organization_admin', { org: orgA }), 'grant'))
check('WRONG ORGANIZATION: not organization B', no(await ask(U.adminA, 'organization_admin', { org: orgB })))
check('an organization administrator administers no business (no staff or owner right follows from the grant)', no(await ask(U.adminA, 'business_admin', { business: b1 })) && no(await ask(U.adminA, 'business_admin', { business: b2 })))
check('an organization administrator is not a department head without that grant', no(await ask(U.adminA, 'department_head', { org: orgA, dept: A1 })))
check('the head of department A1 heads A1', yes(await ask(U.headA1, 'department_head', { org: orgA, dept: A1 }), 'grant'))
check('not A2 (same organization), not B1 (the other organization)', no(await ask(U.headA1, 'department_head', { org: orgA, dept: A2 })) && no(await ask(U.headA1, 'department_head', { org: orgB, dept: B1 })))
check('ID SWAP: A1 presented under organization B, and B1 under organization A, are refused', no(await ask(U.headA1, 'department_head', { org: orgB, dept: A1 })) && no(await ask(U.headA1, 'department_head', { org: orgA, dept: B1 })))
check('a department head administers neither the organization nor a business', no(await ask(U.headA1, 'organization_admin', { org: orgA })) && no(await ask(U.headA1, 'business_admin', { business: b1 })))
check('a target that does not exist answers exactly like one that is not yours', JSON.stringify(await ask(U.owner, 'business_admin', { business: nowhere })) === JSON.stringify(await ask(U.owner, 'business_admin', { business: b2 }))
  && JSON.stringify(await ask(U.adminA, 'organization_admin', { org: nowhere })) === JSON.stringify(await ask(U.adminA, 'organization_admin', { org: orgB })))
check('a malformed question is bad_request: no scope, two scopes, a department without its organization, an unknown capability, no user', bad(await ask(U.owner, 'business_admin')) && bad(await ask(U.owner, 'business_admin', { business: b1, org: orgA }))
  && bad(await ask(U.adminA, 'organization_admin', { org: orgA, dept: A1 })) && bad(await ask(U.headA1, 'department_head', { dept: A1 })) && bad(await ask(U.owner, 'owner', { business: b1 })) && bad(await ask(null, 'business_admin', { business: b1 })))

console.log('\nrevoked, expired and switched-off things stop working at once')
const expired = await grant(P.newcomer, 'organization_admin', 'organization', { org: orgB }, { expires: new Date(Date.now() - 60_000).toISOString() })
check('an expired grant gives nothing', no(await ask(U.newcomer, 'organization_admin', { org: orgB })))
await db.query(`update public.customer_access_grants set revoked_at = now(), revoked_reason = 'test' where id = $1`, [G.adminB])
check('a revoked grant gives nothing', no(await ask(U.adminB, 'organization_admin', { org: orgB })))
const revokedGrant = await grant(P.revoked, 'organization_admin', 'organization', { org: orgA })
check('a live grant of a revoked principal gives nothing', no(await ask(U.revokedPrincipal, 'organization_admin', { org: orgA })))
await db.query(`update public.customer_organizations set state = 'inactive' where id = $1`, [orgA])
check('an inactive organization cannot be administered, nor its departments', no(await ask(U.adminA, 'organization_admin', { org: orgA })) && no(await ask(U.headA1, 'department_head', { org: orgA, dept: A1 })))
await db.query(`update public.customer_organizations set state = 'active' where id = $1`, [orgA])
await db.query(`update public.customer_departments set state = 'inactive' where id = $1`, [A1])
check('an inactive department cannot be headed', no(await ask(U.headA1, 'department_head', { org: orgA, dept: A1 })))
await db.query(`update public.customer_departments set state = 'active' where id = $1`, [A1])
await db.query(`update public.customer_businesses set state = 'inactive' where id = $1`, [b1])
check('an inactive business cannot be administered, even by its legacy owner', no(await ask(U.owner, 'business_admin', { business: b1 })))
await db.query(`update public.customer_businesses set state = 'active' where id = $1`, [b1])
await db.query(`update public.customer_businesses set legacy_owner_access = false where id = $1`, [b1])
check('without the legacy flag an owner needs a stored grant like anyone else', no(await ask(U.owner, 'business_admin', { business: b1 })))
await db.query(`update public.customer_businesses set legacy_owner_access = true where id = $1`, [b1])
check('and everything works again when restored', yes(await ask(U.owner, 'business_admin', { business: b1 }), 'legacy_owner') && yes(await ask(U.adminA, 'organization_admin', { org: orgA }), 'grant') && yes(await ask(U.headA1, 'department_head', { org: orgA, dept: A1 }), 'grant'))

// ------------------------------------------------------------------ granting and revoking through the functions
console.log('\ncustomer_access_grant / customer_access_revoke: the actor is rechecked in the database')
const give = async (actor, principalId, capability, ids = {}, over = {}) => (await one(`select public.customer_access_grant($1, $2, $3, $4, $5, $6, $7, $8) r`, [actor, principalId, capability, ids.business ?? null, ids.org ?? null, ids.dept ?? null, over.expires ?? null, over.reason ?? 'synthetic test'])).r
const take = async (actor, grantId, reason = 'synthetic test') => (await one(`select public.customer_access_revoke($1, $2, $3) r`, [actor, grantId, reason])).r
const audits = async () => count(`select count(*) n from public.customer_identity_audit`)
let a0 = await audits()
r = await give(U.owner, P.newcomer, 'business_admin', { business: b1 })
check('a Sarcafe owner gives someone business_admin on Sarcafe', r.ok === true && r.status === 'created', JSON.stringify(r))
const newcomerGrant = r.grant_id
check('the grant and one audit row were written together, the audit scoped to that business with ids only', await audits() === a0 + 1 && (await one(`select * from public.customer_identity_audit where target_id = $1`, [newcomerGrant])).business_id === b1
  && (await one(`select actor_staff_id s, actor_auth_user_id u, organization_id o, operation op, detail d from public.customer_identity_audit where target_id = $1`, [newcomerGrant])).s === S.owner)
check('the new administrator now administers Sarcafe, by grant', yes(await ask(U.newcomer, 'business_admin', { business: b1 }), 'grant'))
check('giving the same thing again changes nothing and writes no second audit row', (await give(U.owner, P.newcomer, 'business_admin', { business: b1 })).status === 'unchanged' && await audits() === a0 + 1)
check('WRONG BUSINESS: a Sarcafe owner cannot give business_admin on the other business', no(await give(U.owner, P.newcomer, 'business_admin', { business: b2 })))
check('the other business\'s administrator cannot give anything on Sarcafe', no(await give(U.b2Admin, P.adminA, 'business_admin', { business: b1 })))
check('an employee, a general manager and a stranger cannot give anything', no(await give(U.employee, P.adminA, 'business_admin', { business: b1 })) && no(await give(U.gm, P.adminA, 'business_admin', { business: b1 })) && no(await give(U.stranger, P.adminA, 'organization_admin', { org: orgA })))
check('nobody grants to themselves (refused as denied)', no(await give(U.b2Admin, P.b2Admin, 'business_admin', { business: b2 })) && no(await give(U.adminA, P.adminA, 'department_head', { org: orgA, dept: A1 })) && no(await give(U.adminA, P.adminA, 'organization_admin', { org: orgA })))
check('a revoked or unknown principal cannot be given anything (refused as denied)', no(await give(U.owner, P.revoked, 'business_admin', { business: b1 })) && no(await give(U.owner, nowhere, 'business_admin', { business: b1 }))
  && no(await give(U.stranger, nowhere, 'business_admin', { business: b1 })))
// R3: the answer must not say whether the target principal exists. Every refusal below must be byte-for-byte the same answer.
{
  const g0 = await count(`select count(*) n from public.customer_access_grants`); const au0 = await audits()
  const answers = {
    'business scope: an actor with no authority, a real target': await give(U.stranger, P.adminA, 'business_admin', { business: b1 }),
    'business scope: an actor with no authority, an unknown target': await give(U.stranger, nowhere, 'business_admin', { business: b1 }),
    'business scope: the owner, an unknown target': await give(U.owner, nowhere, 'business_admin', { business: b1 }),
    'business scope: the owner, a switched-off target': await give(U.owner, P.revoked, 'business_admin', { business: b1 }),
    'business scope: an administrator by grant, their own principal': await give(U.b2Admin, P.b2Admin, 'business_admin', { business: b2 }),
    'business scope: an administrator by grant, an unknown target': await give(U.b2Admin, nowhere, 'business_admin', { business: b2 }),
    'organization scope: the administrator, an unknown target': await give(U.adminA, nowhere, 'organization_admin', { org: orgA }),
    'organization scope: the administrator, a switched-off target': await give(U.adminA, P.revoked, 'organization_admin', { org: orgA }),
    'organization scope: the administrator, their own principal': await give(U.adminA, P.adminA, 'organization_admin', { org: orgA }),
    'organization scope: the wrong organization, a real target': await give(U.adminA, P.newcomer, 'organization_admin', { org: orgB }),
    'department scope: the administrator, an unknown target': await give(U.adminA, nowhere, 'department_head', { org: orgA, dept: A2 }),
    'department scope: the administrator, a switched-off target': await give(U.adminA, P.revoked, 'department_head', { org: orgA, dept: A2 }),
    'department scope: the administrator, their own principal': await give(U.adminA, P.adminA, 'department_head', { org: orgA, dept: A2 }),
    'department scope: a department head (no authority), a real target': await give(U.headA1, P.newcomer, 'department_head', { org: orgA, dept: A2 }),
  }
  const distinct = [...new Set(Object.values(answers).map((x) => JSON.stringify(x)))]
  check('R3: unknown, switched-off and own targets answer exactly like "no authority" (one identical answer in 14 cases)', distinct.length === 1 && distinct[0] === JSON.stringify({ ok: false, error: 'denied' }), JSON.stringify(Object.entries(answers).filter(([, x]) => JSON.stringify(x) !== JSON.stringify({ ok: false, error: 'denied' }))))
  check('R3: none of those refusals wrote a grant or an audit row', await count(`select count(*) n from public.customer_access_grants`) === g0 && await audits() === au0)
  const sources = (await all(`select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('customer_access_grant', 'customer_access_revoke', 'customer_access_check')`)).map((x) => x.prosrc).join('\n')
  const errors = [...new Set([...sources.matchAll(/'error',\s*'([a-z_]+)'/g)].map((m) => m[1]))].sort().join()
  check('R3: the three functions can only ever answer bad_request or denied', errors === 'bad_request,denied', errors)
  check('R3: the server repository knows no other refusal either (no bad_principal / self_grant)', !/bad_principal|self_grant/.test(readFileSync(path.join(root, 'src/lib/identity/server/repository.ts'), 'utf8')) && /error: 'denied' \| 'bad_request' \}/.test(readFileSync(path.join(root, 'src/lib/identity/server/repository.ts'), 'utf8')))
}
a0 = await audits()
check('R1: organization A already has an administrator, so Sarcafe (which has an agreement with it) can no longer appoint one', no(await give(U.owner, P.adminB, 'organization_admin', { org: orgA })) && await audits() === a0)
check('R1: nor revoke organization A\'s administrator', no(await take(U.owner, G.adminA)) && (await one(`select revoked_at x from public.customer_access_grants where id = $1`, [G.adminA])).x === null && await audits() === a0)
check('but not for an organization it has no agreement with (Sarcafe ↮ organization B)', no(await give(U.owner, P.adminA, 'organization_admin', { org: orgB })))
check('the other business (agreement with B only) cannot appoint in organization A', no(await give(U.b2Admin, P.newcomer, 'organization_admin', { org: orgA })))
r = await give(U.adminA, P.newcomer, 'department_head', { org: orgA, dept: A2 })
check('organization A\'s administrator appoints a head of A2', r.ok === true && r.status === 'created', JSON.stringify(r))
check('and cannot appoint in organization B, nor smuggle B1 in under organization A, nor A1 under organization B', no(await give(U.adminA, P.newcomer, 'department_head', { org: orgB, dept: B1 })) && no(await give(U.adminA, P.newcomer, 'department_head', { org: orgA, dept: B1 })) && no(await give(U.adminA, P.newcomer, 'department_head', { org: orgB, dept: A1 })))
check('a department head appoints nobody, in their own department or elsewhere', no(await give(U.headA1, P.newcomer, 'department_head', { org: orgA, dept: A1 })) && no(await give(U.headA1, P.newcomer, 'organization_admin', { org: orgA })))
check('a malformed request is refused: wrong scope shape, an expiry in the past, an unknown capability, a 301-letter reason', bad(await give(U.owner, P.newcomer, 'business_admin', { business: b1, org: orgA })) && bad(await give(U.owner, P.newcomer, 'business_admin', { business: b1 }, { expires: new Date(Date.now() - 1000).toISOString() }))
  && bad(await give(U.owner, P.newcomer, 'owner', { business: b1 })) && bad(await give(U.owner, P.adminA, 'business_admin', { business: b1 }, { reason: 'x'.repeat(301) })))
// ------------------------------------------------------------------ R1: first-administrator bootstrap
console.log('\nR1: bootstrap of the first organization administrator (two businesses with agreements to ONE organization)')
const orgC = (await one(`insert into public.customer_organizations (slug, name) values ('org-c', 'Organization C') returning id`)).id
await db.query(`insert into public.customer_business_orgs (business_id, organization_id, state) values ($1, $3, 'draft'), ($2, $3, 'active')`, [b1, b2, orgC])
const liveAdmins = (org) => count(`select count(*) n from public.customer_access_grants g join public.customer_principals p on p.id = g.principal_id and p.state = 'active' where g.capability = 'organization_admin' and g.organization_id = $1 and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())`, [org])
const auditOf = (grantId, operation = 'access.grant') => one(`select * from public.customer_identity_audit where target_id = $1 and operation = $2`, [grantId, operation])
const BASE_KEYS = 'actor_via,capability,department_id,principal_id,scope_kind'
const BOOT_KEYS = 'actor_via,bootstrap_business_id,bootstrap_grant_id,capability,department_id,principal_id,scope_kind'
const keys = (detail) => Object.keys(detail).sort().join()
check('organization C has no administrator; a stranger, an employee and organization A\'s administrator cannot appoint one', await liveAdmins(orgC) === 0 && no(await give(U.stranger, P.c1, 'organization_admin', { org: orgC })) && no(await give(U.employee, P.c1, 'organization_admin', { org: orgC })) && no(await give(U.adminA, P.c1, 'organization_admin', { org: orgC })))
r = await give(U.owner, P.c1, 'organization_admin', { org: orgC })
const c1Grant = r.grant_id
check('business A (Sarcafe, by its legacy owner) bootstraps the FIRST administrator', r.ok === true && r.status === 'created' && await liveAdmins(orgC) === 1 && yes(await ask(U.c1, 'organization_admin', { org: orgC }), 'grant'), JSON.stringify(r))
let row = await auditOf(c1Grant)
check('the bootstrap audit row names the authorizing business (Sarcafe) and the legacy owner; no stored grant was involved', row.organization_id === orgC && row.business_id === null && row.actor_staff_id === S.owner && row.actor_principal_id === null
  && keys(row.detail) === BOOT_KEYS && row.detail.bootstrap_business_id === b1 && row.detail.bootstrap_grant_id === null && row.detail.actor_via === 'legacy_owner', JSON.stringify(row.detail))
a0 = await audits()
check('business B (also has an agreement) cannot ADD an administrator afterwards', no(await give(U.b2Admin, P.c2, 'organization_admin', { org: orgC })) && await liveAdmins(orgC) === 1)
check('business B cannot REVOKE the administrator', no(await take(U.b2Admin, c1Grant)) && (await one(`select revoked_at x from public.customer_access_grants where id = $1`, [c1Grant])).x === null)
check('business A, which appointed the first one, cannot add a second or revoke the first either', no(await give(U.owner, P.c2, 'organization_admin', { org: orgC })) && no(await take(U.owner, c1Grant)) && await liveAdmins(orgC) === 1 && await audits() === a0)
check('a business refusal answers exactly like any other refusal', JSON.stringify(await give(U.b2Admin, P.c2, 'organization_admin', { org: orgC })) === JSON.stringify(await give(U.stranger, P.c2, 'organization_admin', { org: orgC })) && JSON.stringify(await take(U.b2Admin, c1Grant)) === JSON.stringify(await take(U.b2Admin, nowhere)))
r = await give(U.c1, P.c2, 'organization_admin', { org: orgC })
const c2Grant = r.grant_id
row = await auditOf(c2Grant)
check('the organization\'s administrator adds another administrator; that is not a bootstrap (no bootstrap detail)', r.ok === true && r.status === 'created' && await liveAdmins(orgC) === 2 && keys(row.detail) === BASE_KEYS && row.actor_principal_id === P.c1 && row.detail.actor_via === 'grant', JSON.stringify(row.detail))
check('with two administrators both businesses are still refused', no(await give(U.owner, P.c3, 'organization_admin', { org: orgC })) && no(await give(U.b2Admin, P.c3, 'organization_admin', { org: orgC })) && no(await take(U.owner, c2Grant)) && no(await take(U.b2Admin, c2Grant)))
r = await take(U.c1, c2Grant, 'synthetic')
row = await auditOf(c2Grant, 'access.revoke')
check('an organization administrator revokes another administrator (audited as an organization act, no bootstrap detail)', r.ok === true && r.status === 'revoked' && await liveAdmins(orgC) === 1 && keys(row.detail) === BASE_KEYS && row.actor_principal_id === P.c1)
check('one administrator left: business B is still refused', no(await give(U.b2Admin, P.c3, 'organization_admin', { org: orgC })))

console.log('\nR1: recovery — revoked, expired and switched-off administrators do not block bootstrap for ever')
r = await take(U.c1, c1Grant, 'leaving')
check('REVOKED: the last administrator gives up their grant, so the organization has none', r.status === 'revoked' && await liveAdmins(orgC) === 0)
r = await give(U.b2Admin, P.c3, 'organization_admin', { org: orgC })
const c3Grant = r.grant_id
row = await auditOf(c3Grant)
check('bootstrap reopens: business B (a stored business_admin grant) appoints the next first administrator', r.ok === true && r.status === 'created' && await liveAdmins(orgC) === 1, JSON.stringify(r))
check('that bootstrap audit row names business B and the exact grant that authorized it', keys(row.detail) === BOOT_KEYS && row.detail.bootstrap_business_id === b2 && row.detail.bootstrap_grant_id === G.b2Admin && row.actor_principal_id === P.b2Admin && row.actor_staff_id === null && row.organization_id === orgC, JSON.stringify(row.detail))
check('and it closes again at once: business A is refused', no(await give(U.owner, P.c4, 'organization_admin', { org: orgC })) && no(await take(U.owner, c3Grant)))
await db.query(`update public.customer_access_grants set expires_at = now() - interval '1 minute' where id = $1`, [c3Grant])
check('EXPIRED: an expired (unrevoked) administrator grant is not a live administrator', await liveAdmins(orgC) === 0 && no(await ask(U.c3, 'organization_admin', { org: orgC })))
r = await give(U.owner, P.c4, 'organization_admin', { org: orgC })
const c4Grant = r.grant_id
check('bootstrap reopens for business A', r.ok === true && r.status === 'created' && (await auditOf(c4Grant)).detail.bootstrap_business_id === b1 && await liveAdmins(orgC) === 1, JSON.stringify(r))
check('while that administrator is live, business B cannot clean up the expired leftover grant', no(await take(U.b2Admin, c3Grant)) && (await one(`select revoked_at x from public.customer_access_grants where id = $1`, [c3Grant])).x === null)
await db.query(`update public.customer_principals set state = 'revoked' where id = $1`, [P.c4])
check('SWITCHED-OFF PRINCIPAL: a live grant of a revoked principal is not a live administrator', await liveAdmins(orgC) === 0 && no(await ask(U.c4, 'organization_admin', { org: orgC })))
r = await take(U.owner, c3Grant, 'expired leftover')
row = await auditOf(c3Grant, 'access.revoke')
check('with no live administrator a business with an agreement may end a dead administrator grant, audited as a bootstrap act', r.ok === true && r.status === 'revoked' && keys(row.detail) === BOOT_KEYS && row.detail.bootstrap_business_id === b1 && row.detail.bootstrap_grant_id === null && row.actor_staff_id === S.owner, JSON.stringify(row?.detail))
r = await give(U.b2Admin, P.c2, 'organization_admin', { org: orgC })
const c2Again = r.grant_id
check('bootstrap reopens for business B, and closes again', r.ok === true && r.status === 'created' && c2Again !== c2Grant && await liveAdmins(orgC) === 1 && no(await give(U.owner, P.c1, 'organization_admin', { org: orgC })) && no(await take(U.owner, c2Again)))
const orgD = (await one(`insert into public.customer_organizations (slug, name) values ('org-d', 'Organization D') returning id`)).id
await db.query(`insert into public.customer_business_orgs (business_id, organization_id, state) values ($1, $3, 'suspended'), ($2, $3, 'ended')`, [b1, b2, orgD])
check('a suspended or ended agreement gives no bootstrap right', no(await give(U.owner, P.c1, 'organization_admin', { org: orgD })) && no(await give(U.b2Admin, P.c1, 'organization_admin', { org: orgD })) && await liveAdmins(orgD) === 0)
await db.query(`update public.customer_organizations set state = 'inactive' where id = $1`, [orgC])
await db.query(`update public.customer_access_grants set revoked_at = now(), revoked_reason = 'test' where id = $1`, [c2Again])
check('an inactive organization cannot be bootstrapped', await liveAdmins(orgC) === 0 && no(await give(U.owner, P.c1, 'organization_admin', { org: orgC })) && no(await give(U.b2Admin, P.c1, 'organization_admin', { org: orgC })))
await db.query(`update public.customer_organizations set state = 'active' where id = $1`, [orgC])
r = await give(U.b2Admin, P.c2, 'organization_admin', { org: orgC })
const c2Live = r.grant_id
check('(organization C active again, administrator c2 appointed by bootstrap for the lock checks below)', r.ok === true && r.status === 'created')

console.log('\nR1: the organization row is locked before bootstrap eligibility is decided (same transaction)')
// One connection cannot run two sessions; what it CAN prove is that every path takes the row lock: after the call, inside the same
// transaction, the organization row's xmax is this transaction. On a REFUSED call nothing is written, so only the explicit
// FOR UPDATE can have set it (the control below shows a refused call that takes no lock leaves it unset). A successful call also
// inserts a grant, whose foreign key takes a weaker lock on the same row, so there the xmax alone proves less: the source-order
// check and the real two-session test (scripts/identity-concurrency-docker.mjs) cover that path.
const lockedBy = async (org, call) => {
  await db.exec('begin')
  try {
    const answer = await call()
    const state = await one(`select xmax::text x, (txid_current() % 4294967296)::text t from public.customer_organizations where id = $1`, [org])
    return { answer, locked: state.x === state.t && state.x !== '0' }
  } finally { await db.exec('rollback') }
}
let lock = await lockedBy(orgC, () => give(U.owner, P.c1, 'organization_admin', { org: orgC }))
check('a REFUSED bootstrap (an administrator exists) still took the organization lock before deciding', no(lock.answer) && lock.locked, JSON.stringify(lock))
await db.query(`update public.customer_access_grants set revoked_at = now(), revoked_reason = 'test' where id = $1`, [c2Live])
lock = await lockedBy(orgC, () => give(U.owner, P.c1, 'organization_admin', { org: orgC }))
check('a SUCCESSFUL bootstrap holds the organization lock until its transaction ends', lock.answer.ok === true && lock.answer.status === 'created' && lock.locked, JSON.stringify(lock))
check('(the rolled-back bootstrap left nothing behind)', await liveAdmins(orgC) === 0)
r = await give(U.owner, P.c1, 'organization_admin', { org: orgC })
const c1Again = r.grant_id
lock = await lockedBy(orgC, () => give(U.c1, P.c3, 'organization_admin', { org: orgC }))
check('an organization administrator adding another one takes the same lock', lock.answer.ok === true && lock.locked, JSON.stringify(lock))
lock = await lockedBy(orgC, () => take(U.b2Admin, c1Again))
check('a refused revoke of an administrator grant takes it too', no(lock.answer) && lock.locked, JSON.stringify(lock))
lock = await lockedBy(orgC, () => take(U.c1, c1Again))
check('and so does a successful one', lock.answer.status === 'revoked' && lock.locked, JSON.stringify(lock))
lock = await lockedBy(orgA, () => give(U.headA1, P.c3, 'department_head', { org: orgA, dept: A2 }))
check('CONTROL: a refused department-head grant takes no organization lock, so the probe is not always true', no(lock.answer) && !lock.locked, JSON.stringify(lock))
lock = await lockedBy(orgC, () => give(U.stranger, P.c3, 'business_admin', { business: b1 }))
check('CONTROL: a refused business grant takes no organization lock', no(lock.answer) && !lock.locked, JSON.stringify(lock))
check('the lock is taken BEFORE the eligibility question in both functions (source order)', await (async () => {
  const src = async (name) => (await one(`select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [name])).prosrc
  const grantSrc = await src('customer_access_grant'); const revokeSrc = await src('customer_access_revoke')
  const before = (text, a, b) => text.indexOf(a) > 0 && text.indexOf(b) > 0 && text.indexOf(a) < text.indexOf(b)
  return before(grantSrc, 'where o.id = p_organization_id for update', 'not exists (') && before(grantSrc, 'where o.id = p_organization_id for update', `'organization_admin', null, p_organization_id`)
    && before(revokeSrc, 'where o.id = v_grant.organization_id for update', 'where g.id = p_grant_id for update') && before(revokeSrc, 'where o.id = v_grant.organization_id for update', 'not exists (')
})())

a0 = await audits()
r = await give(U.b2Admin, P.newcomer, 'organization_admin', { org: orgB })
check('an expired grant is closed (reason: expired) and replaced by a fresh one, so one live grant remains', r.ok === true && r.status === 'created' && r.grant_id !== expired
  && await count(`select count(*) n from public.customer_access_grants where principal_id = $1 and organization_id = $2 and revoked_at is null`, [P.newcomer, orgB]) === 1
  && (await one(`select revoked_reason x from public.customer_access_grants where id = $1`, [expired])).x === 'expired' && yes(await ask(U.newcomer, 'organization_admin', { org: orgB }), 'grant'), JSON.stringify(r))
check('an outsider cannot revoke a grant, and an unknown grant answers the same', JSON.stringify(await take(U.b2Admin, newcomerGrant)) === JSON.stringify(await take(U.b2Admin, nowhere)) && no(await take(U.b2Admin, newcomerGrant)) && no(await take(U.adminA, G.b2Admin)) && no(await take(U.headA1, G.adminA)))
a0 = await audits()
r = await take(U.owner, newcomerGrant, 'no longer needed')
check('the owner revokes the grant: revoked, audited once, and the access is gone at once', r.ok === true && r.status === 'revoked' && await audits() === a0 + 1 && no(await ask(U.newcomer, 'business_admin', { business: b1 })), JSON.stringify(r))
check('revoking again changes nothing', (await take(U.owner, newcomerGrant)).status === 'unchanged' && await audits() === a0 + 1)
r = await take(U.headA1, G.headA1, 'leaving')
check('someone may give up their own grant, and it is audited as their own act', r.status === 'revoked' && no(await ask(U.headA1, 'department_head', { org: orgA, dept: A1 })) && (await one(`select detail d from public.customer_identity_audit where target_id = $1 and operation = 'access.revoke'`, [G.headA1])).d.actor_via === 'self')
check('the audit holds ids and words from a fixed list only: no name, phone, e-mail or free text beyond the reason', (await all(`select detail d from public.customer_identity_audit`)).every((x) => [BASE_KEYS, BOOT_KEYS].includes(keys(x.d))))
check('bootstrap detail appears only on organization-administrator rows scoped to an organization, and there are such rows', await (async () => {
  const boots = await all(`select organization_id o, business_id b, detail d from public.customer_identity_audit where detail ? 'bootstrap_business_id'`)
  return boots.length >= 5 && boots.every((x) => x.o !== null && x.b === null && x.d.capability === 'organization_admin' && x.d.scope_kind === 'organization' && [b1, b2].includes(x.d.bootstrap_business_id))
})())
await refused('the audit cannot be rewritten', `update public.customer_identity_audit set reason = 'edited'`, [], /append-only/)
await refused('nor deleted', `delete from public.customer_identity_audit`, [], /append-only/)

console.log('\nnobody became staff, and existing owner checks are untouched')
check('no staff row and no auth user was created, changed or removed by any of the above', await count(`select count(*) n from public.staff`) === staffCount && await count(`select count(*) n from auth.users`) === authCount)
check('no administrator of an organization or of the other business has a staff row', await count(`select count(*) n from public.staff where auth_user_id = any($1)`, [[U.adminA, U.adminB, U.headA1, U.b2Admin, U.newcomer]]) === 0)
const isOpAs = async (authUser) => { await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [authUser]); try { return await as('authenticated', async () => (await one(`select public.is_op() v`)).v) } finally { await db.query(`select set_config('request.jwt.claim.sub', '', false)`) } }
check('the existing owner predicate (public.is_op) still says yes for the owner and no for every external administrator', await isOpAs(U.owner) === true && await isOpAs(U.adminA) === false && await isOpAs(U.b2Admin) === false && await isOpAs(U.headA1) === false)
check('the migration never writes to staff, auth or the waitlist', !/insert\s+into\s+(public\.)?(staff|customer_waitlist)|insert\s+into\s+auth\.|update\s+(public\.)?staff|alter\s+table\s+(public\.)?(staff|branches|customer_waitlist)/i.test(readFileSync(migrations + NEW, 'utf8')))
console.log('\nR2: deleting an auth user cannot erase authority or its history')
{
  const u = await user(); const p = await principal(u); const g = (await give(U.adminA, p, 'department_head', { org: orgA, dept: A2 })).grant_id
  const bare = await user(); const bareP = await principal(bare)
  const auditsBefore = await audits()
  const intact = async () => await count(`select count(*) n from auth.users where id = $1`, [u]) === 1 && await count(`select count(*) n from public.customer_principals where id = $1 and auth_user_id = $2 and state = 'active'`, [p, u]) === 1
    && await count(`select count(*) n from public.customer_access_grants where id = $1 and principal_id = $2 and revoked_at is null`, [g, p]) === 1 && await count(`select count(*) n from public.customer_identity_audit where target_id = $1 and operation = 'access.grant'`, [g]) === 1 && await audits() === auditsBefore
  await refused('deleting an auth user who is a principal with a grant is refused by the database', `delete from auth.users where id = $1`, [u], /foreign key constraint.*customer_principals/i)
  check('the auth user, the principal, the live grant and its audit row are all still there, unchanged', await intact())
  await refused('deleting an auth user who is a principal WITHOUT any grant is refused too', `delete from auth.users where id = $1`, [bare], /foreign key constraint.*customer_principals/i)
  check('that principal is still there', await count(`select count(*) n from public.customer_principals where id = $1`, [bareP]) === 1)
  await refused('deleting a principal that holds a grant is refused (table owner)', `delete from public.customer_principals where id = $1`, [p], /foreign key constraint.*customer_access_grants/i)
  await as('service_role', async () => {
    await refused('service_role: deleting that principal is refused', `delete from public.customer_principals where id = $1`, [p], /permission denied/)
    await refused('service_role: deleting that grant is refused', `delete from public.customer_access_grants where id = $1`, [g], /permission denied/)
  })
  check('nothing moved after those attempts', await intact())
  const reviewer = await member()
  await db.query(`insert into public.customer_org_memberships (member_id, organization_id, department_id, state, reviewed_by_principal_id, reviewed_at) values ($1, $2, $3, 'approved', $4, now())`, [reviewer, orgB, B1, bareP])
  await refused('a principal recorded as the reviewer of a membership cannot be deleted either (the decision keeps its author)', `delete from public.customer_principals where id = $1`, [bareP], /foreign key constraint.*customer_org_memberships/i)
  const ended = await take(U.adminA, g, 'synthetic end')
  check('authority ends the audited way: revoked_at is set and an access.revoke row is written', ended.status === 'revoked' && (await one(`select revoked_at x from public.customer_access_grants where id = $1`, [g])).x !== null && await count(`select count(*) n from public.customer_identity_audit where target_id = $1 and operation = 'access.revoke'`, [g]) === 1)
  await refused('and even then the auth user cannot be deleted: the principal and its history stay', `delete from auth.users where id = $1`, [u], /foreign key constraint.*customer_principals/i)
  const soft = await all(`select c.conrelid::regclass::text t, c.conname, c.confdeltype::text d from pg_constraint c join pg_class r on r.oid = c.conrelid join pg_namespace n on n.oid = r.relnamespace where n.nspname = 'public' and r.relname = any($1) and c.contype = 'f' and c.confdeltype <> 'r' order by 1, 2`, [TABLES])
  check('every foreign key of the identity tables is ON DELETE RESTRICT, except the branch mapping (a mapping, not authority, follows its branch)', soft.length === 1 && /customer_business_branches/.test(soft[0].t) && /branch_id/.test(soft[0].conname) && soft[0].d === 'c', JSON.stringify(soft))
  check('the three foreign keys named in the review are restrictive', await count(`select count(*) n from pg_constraint c where c.contype = 'f' and c.confdeltype = 'r' and ((c.conrelid = 'public.customer_principals'::regclass and c.confrelid = 'auth.users'::regclass) or (c.conrelid = 'public.customer_access_grants'::regclass and c.confrelid = 'public.customer_principals'::regclass) or (c.conrelid = 'public.customer_org_memberships'::regclass and c.confrelid = 'public.customer_principals'::regclass))`) === 3)
}

console.log('\nR5: every foreign key has a supporting index')
{
  // usable = a valid index whose LEADING plain columns are exactly the foreign key's columns (any order), and which is either not
  // partial or partial only on "<one of those columns> IS NOT NULL" (a null reference is never looked up through the key).
  const fks = await all(`
    select r.relname t, c.conname, (select string_agg(a.attname, ',' order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) cols,
           exists (
             select 1 from pg_index i
              where i.indrelid = c.conrelid and i.indisvalid and i.indnkeyatts >= cardinality(c.conkey)
                and (select array_agg(x order by x) from unnest((i.indkey::int2[])[0:cardinality(c.conkey) - 1]) x) = (select array_agg(x order by x) from unnest(c.conkey) x)
                and (i.indpred is null or exists (select 1 from pg_attribute a where a.attrelid = c.conrelid and a.attnum = any(c.conkey) and pg_get_expr(i.indpred, i.indrelid) = '(' || a.attname || ' IS NOT NULL)'))
           ) supported
      from pg_constraint c join pg_class r on r.oid = c.conrelid join pg_namespace n on n.oid = r.relnamespace
     where n.nspname = 'public' and r.relname = any($1) and c.contype = 'f' order by 1, 2`, [TABLES])
  const missing = fks.filter((x) => !x.supported).map((x) => `${x.t}(${x.cols})`)
  check(`all ${fks.length} foreign keys of the identity tables have a usable supporting index`, fks.length === 19 && missing.length === 0, `${fks.length} foreign keys; without an index: ${missing.join(' | ') || 'none'}`)
  check('customer_org_memberships.reviewed_by_principal_id has its partial non-null index', /\(reviewed_by_principal_id\) WHERE \(reviewed_by_principal_id IS NOT NULL\)/i.test((await one(`select indexdef d from pg_indexes where schemaname = 'public' and indexname = 'customer_org_memberships_reviewer_idx'`))?.d ?? ''))
  check('customer_access_grants.principal_id has a plain index (the live-grant unique index is partial, so it does not count)', /\(principal_id\)$/i.test((await one(`select indexdef d from pg_indexes where schemaname = 'public' and indexname = 'customer_access_grants_principal_idx'`))?.d ?? ''))
  check('the detector is not blind: it reports a foreign key whose only index is the partial live-grant one', await (async () => {
    await db.exec('begin')
    try {
      await db.exec('drop index public.customer_access_grants_principal_idx; drop index public.customer_org_memberships_reviewer_idx')
      const again = await all(`
        select r.relname t, (select string_agg(a.attname, ',' order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) cols
          from pg_constraint c join pg_class r on r.oid = c.conrelid join pg_namespace n on n.oid = r.relnamespace
         where n.nspname = 'public' and r.relname = any($1) and c.contype = 'f' and not exists (
             select 1 from pg_index i
              where i.indrelid = c.conrelid and i.indisvalid and i.indnkeyatts >= cardinality(c.conkey)
                and (select array_agg(x order by x) from unnest((i.indkey::int2[])[0:cardinality(c.conkey) - 1]) x) = (select array_agg(x order by x) from unnest(c.conkey) x)
                and (i.indpred is null or exists (select 1 from pg_attribute a where a.attrelid = c.conrelid and a.attnum = any(c.conkey) and pg_get_expr(i.indpred, i.indrelid) = '(' || a.attname || ' IS NOT NULL)'))) order by 1, 2`, [TABLES])
      return again.map((x) => `${x.t}(${x.cols})`).join(' | ') === 'customer_access_grants(principal_id) | customer_org_memberships(reviewed_by_principal_id)'
    } finally { await db.exec('rollback') }
  })())
}

// ------------------------------------------------------------------ grants, RLS and browser denial
console.log('\naccess: row level security, table and function privileges, a real attempt as each browser role')
check('all eleven tables have row level security on, and none has a policy', await count(`select count(*) n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = any($1) and c.relrowsecurity`, [TABLES]) === 11
  && await count(`select count(*) n from pg_policies where schemaname = 'public' and tablename = any($1)`, [TABLES]) === 0)
for (const role of ['anon', 'authenticated']) {
  const privileges = await all(`select t, p from unnest($1::text[]) t cross join unnest(array['select','insert','update','delete','truncate','references','trigger']) p where has_table_privilege($2, 'public.' || t, p)`, [TABLES, role])
  check(`${role} holds no privilege of any kind on any identity table`, privileges.length === 0, JSON.stringify(privileges))
  const callable = await all(`select f from unnest($1::text[]) f where has_function_privilege($2, 'public.' || f, 'execute')`, [[...FUNCTIONS, ...TRIGGER_FUNCTIONS], role])
  check(`${role} cannot execute any identity function`, callable.length === 0, JSON.stringify(callable))
  await as(role, async () => {
    await refused(`${role}: reading the members is refused by the database`, `select * from public.customer_members`, [], /permission denied/)
    await refused(`${role}: reading the grants is refused`, `select * from public.customer_access_grants`, [], /permission denied/)
    await refused(`${role}: writing a grant is refused`, `insert into public.customer_access_grants (principal_id, capability, scope_kind, business_id) values ($1, 'business_admin', 'business', $2)`, [P.newcomer, b1], /permission denied/)
    await refused(`${role}: asking the access question is refused`, `select public.customer_access_check($1, 'business_admin', $2, null, null)`, [U.owner, b1], /permission denied/)
    await refused(`${role}: granting through the function is refused`, `select public.customer_access_grant($1, $2, 'business_admin', $3, null, null, null, 'x')`, [U.owner, P.newcomer, b1], /permission denied/)
    await refused(`${role}: revoking through the function is refused`, `select public.customer_access_revoke($1, $2, 'x')`, [U.owner, G.adminA], /permission denied/)
  })
}
const servicePrivileges = (await all(`select t, p from unnest($1::text[]) t cross join unnest(array['select','insert','update','delete','truncate']) p where has_table_privilege('service_role', 'public.' || t, p) order by 1, 2`, [TABLES]))
check('the service role holds select / insert / update on ten tables, select / insert on the audit, and delete or truncate on none', servicePrivileges.filter((x) => x.p === 'delete' || x.p === 'truncate').length === 0
  && servicePrivileges.filter((x) => x.t === 'customer_identity_audit').map((x) => x.p).join() === 'insert,select' && servicePrivileges.filter((x) => x.t !== 'customer_identity_audit').length === 30, JSON.stringify(servicePrivileges.length))
check('the service role can execute the three functions and neither trigger function', (await all(`select f from unnest($1::text[]) f where has_function_privilege('service_role', 'public.' || f, 'execute')`, [FUNCTIONS])).length === 3
  && (await all(`select f from unnest($1::text[]) f where has_function_privilege('service_role', 'public.' || f, 'execute')`, [TRIGGER_FUNCTIONS])).length === 0)
await as('service_role', async () => {
  check('the service role really reads and asks', (await one(`select count(*) n from public.customer_businesses`)).n >= 2 && (await one(`select public.customer_access_check($1, 'business_admin', $2, null, null) r`, [U.owner, b1])).r.ok === true)
  await refused('service_role: deleting a member is refused', `delete from public.customer_members`, [], /permission denied/)
  await refused('service_role: deleting a grant is refused', `delete from public.customer_access_grants`, [], /permission denied/)
  await refused('service_role: rewriting the audit is refused', `update public.customer_identity_audit set reason = 'edited'`, [], /permission denied/)
  await refused('service_role: deleting the audit is refused', `delete from public.customer_identity_audit`, [], /permission denied/)
})
// the project's own functions (an extension's, like pgcrypto's digest, are not ours and not exposed as RPCs by name collision rules)
check('no function name in the whole schema has two signatures (PGRST203)', await count(`select count(*) n from (select proname from pg_proc p where p.pronamespace = 'public'::regnamespace and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') group by proname having count(*) > 1) t`) === 0)
check('no function is internal_*customer*, and every customer_* function outside the waitlist and feedback domains (the later identity migrations\' too) is closed to the browser roles', await count(`select count(*) n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'internal\\_%customer%'`) === 0
  && await count(`select count(*) n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'customer\\_%' and p.proname not like 'customer\\_waitlist%' and p.proname not like 'customer\\_feedback%' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`) === 0)
// (the functions of the later identity migrations are listed and checked by their own verifiers: scripts/verify-identity-org-sql.mjs)
check('the foundation\'s functions are exactly these five, each once with this signature, with every later identity migration applied', (await all(`select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' f from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname in ('customer_access_check', 'customer_access_grant', 'customer_access_revoke', 'customer_identity_audit_keep', 'customer_keep_columns') order by 1`)).map((x) => x.f).join(' | ')
  === 'customer_access_check(p_auth_user_id uuid, p_capability text, p_business_id uuid, p_organization_id uuid, p_department_id uuid) | customer_access_grant(p_actor_auth_user_id uuid, p_principal_id uuid, p_capability text, p_business_id uuid, p_organization_id uuid, p_department_id uuid, p_expires_at timestamp with time zone, p_reason text) | customer_access_revoke(p_actor_auth_user_id uuid, p_grant_id uuid, p_reason text) | customer_identity_audit_keep() | customer_keep_columns()')
check('every parameter is p_*, and the callable functions run as the caller with an empty search path', (await all(`select unnest(p.proargnames) a from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname in ('customer_access_check','customer_access_grant','customer_access_revoke')`)).every((x) => x.a.startsWith('p_'))
  && await count(`select count(*) n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname in ('customer_access_check','customer_access_grant','customer_access_revoke','customer_keep_columns','customer_identity_audit_keep') and not p.prosecdef and p.proconfig @> array['search_path=""']`) === 5)

// ------------------------------------------------------------------ the TypeScript guard decision against the real SQL function
console.log('\nguard: src/lib/identity/access.ts (the real TypeScript) deciding with the real SQL function')
const cache = mkdtempSync(path.join(os.tmpdir(), 'verify-identity-'))
let guard, rules
try {
  for (const rel of ['src/lib/staff/access.ts', 'src/lib/identity/types.ts', 'src/lib/identity/rules.ts', 'src/lib/identity/access.ts']) {
    const js = ts.transpileModule(readFileSync(path.join(root, rel), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText
      .replace(/require\("@\/([^"]+)"\)/g, (_, spec) => `require(${JSON.stringify(path.join(cache, 'src', spec))})`)
    const dest = path.join(cache, rel.replace(/\.ts$/, '.js'))
    mkdirSync(path.dirname(dest), { recursive: true })
    writeFileSync(dest, js)
  }
  const req = createRequire(path.join(cache, 'x.js'))
  guard = req('./src/lib/identity/access.js')
  rules = req('./src/lib/identity/rules.js')
} finally { process.once('exit', () => rmSync(cache, { recursive: true, force: true })) }

let asked = 0
const sqlCheck = async (args) => { asked++; return (await one(`select public.customer_access_check($1, $2, $3, $4, $5) r`, [args.authUserId, args.capability, args.businessId, args.organizationId, args.departmentId])).r }
const decide = (session, capability, scope, checker = sqlCheck) => guard.authorizeIdentityAction(session, { capability, scope }, checker)
const session = (authUser, staff = null, over = {}) => ({ authUserId: authUser, via: 'google', full: true, staff, ...over })
const ownerStaff = { id: S.owner, role: 'owner', badge: 'owner', branch_id: null }
const business = (id) => ({ kind: 'business', businessId: id })
const organization = (id) => ({ kind: 'organization', organizationId: id })
const department = (org, id) => ({ kind: 'department', organizationId: org, departmentId: id })
const denied = (o, status, code) => o.ok === false && o.status === status && o.code === code
const untouched = async (name, fn, status, code) => { const before = asked; const o = await fn(); check(name, denied(o, status, code) && asked === before, JSON.stringify(o) + (asked === before ? '' : ' (the database was asked)')) }

let o = await decide(session(U.owner, ownerStaff), 'business_admin', business(b1))
check('a Sarcafe owner on a full sign-in may administer Sarcafe (legacy owner)', o.ok === true && o.via === 'legacy_owner' && o.staffId === S.owner && o.scope.businessId === b1 && o.grantId === null, JSON.stringify(o))
check('WRONG BUSINESS: the same owner is refused the other business (403 denied)', denied(await decide(session(U.owner, ownerStaff), 'business_admin', business(b2)), 403, 'denied'))
check('an owner is refused every organization and department', denied(await decide(session(U.owner, ownerStaff), 'organization_admin', organization(orgA)), 403, 'denied') && denied(await decide(session(U.owner, ownerStaff), 'department_head', department(orgA, A2)), 403, 'denied'))
await untouched('nobody signed in: 401, and the database is not asked', () => decide(null, 'business_admin', business(b1)), 401, 'unauthenticated')
await untouched('an owner on a six-digit employee-code session: 403 full_session_required, not asked', () => decide({ authUserId: null, via: 'employee_code', full: false, staff: ownerStaff }, 'business_admin', business(b1)), 403, 'full_session_required')
await untouched('an owner on a quick (code) Google session: 403 quick_session, not asked', () => decide(session(U.owner, ownerStaff, { full: false }), 'business_admin', business(b1)), 403, 'quick_session')
await untouched('a session whose user id is not a UUID: 403, not asked', () => decide(session('owner', ownerStaff), 'business_admin', business(b1)), 403, 'full_session_required')
check('a general manager and an employee on a full sign-in are refused (403 denied)', denied(await decide(session(U.gm, { id: S.gm, role: 'staff', badge: 'general_manager', branch_id: null }), 'business_admin', business(b1)), 403, 'denied')
  && denied(await decide(session(U.employee, { id: S.employee, role: 'staff', badge: 'barista', branch_id: null }), 'business_admin', business(b1)), 403, 'denied'))
check('a session that only CLAIMS to be an owner (forged staff facts on an employee\'s user) is refused: the database decides', denied(await decide(session(U.employee, ownerStaff), 'business_admin', business(b1)), 403, 'denied'))
check('the database saying "legacy owner" for a session with no owner staff row is still refused', denied(await decide(session(U.owner, null), 'business_admin', business(b1)), 403, 'denied') && denied(await decide(session(U.owner, { id: S.owner, role: 'staff', badge: 'barista' }), 'business_admin', business(b1)), 403, 'denied'))
o = await decide(session(U.adminA), 'organization_admin', organization(orgA))
check('an external administrator (no staff row) may administer their organization, by grant', o.ok === true && o.via === 'grant' && o.principalId === P.adminA && o.staffId === null, JSON.stringify(o))
check('and is refused the other organization, both businesses and every department', denied(await decide(session(U.adminA), 'organization_admin', organization(orgB)), 403, 'denied') && denied(await decide(session(U.adminA), 'business_admin', business(b1)), 403, 'denied')
  && denied(await decide(session(U.adminA), 'business_admin', business(b2)), 403, 'denied') && denied(await decide(session(U.adminA), 'department_head', department(orgA, A1)), 403, 'denied'))
check('a REVOKED grant is refused (the department head who gave theirs up, the revoked organization B administrator)', denied(await decide(session(U.headA1), 'department_head', department(orgA, A1)), 403, 'denied') && denied(await decide(session(U.adminB), 'organization_admin', organization(orgB)), 403, 'denied'))
check('the other business\'s administrator may administer it and is refused Sarcafe', (await decide(session(U.b2Admin), 'business_admin', business(b2))).ok === true && denied(await decide(session(U.b2Admin), 'business_admin', business(b1)), 403, 'denied'))
o = await decide(session(U.newcomer), 'department_head', department(orgA, A2))
check('a department head may head their department and is refused a swapped pair (A2 under organization B)', o.ok === true && o.via === 'grant' && denied(await decide(session(U.newcomer), 'department_head', department(orgB, A2)), 403, 'denied'))
for (const [label, capability, scope] of [
  ['no scope', 'business_admin', undefined], ['an empty scope', 'business_admin', {}], ['a business scope carrying an organization too', 'business_admin', { kind: 'business', businessId: b1, organizationId: orgA }],
  ['a scope without a kind', 'business_admin', { businessId: b1 }], ['an id that is not a UUID', 'business_admin', { kind: 'business', businessId: 'sarcafe' }], ['"all" as a scope', 'business_admin', { kind: 'all' }],
  ['a capability asked in another scope shape', 'organization_admin', business(b1)], ['an unknown capability', 'owner', business(b1)], ['a department without its organization', 'department_head', { kind: 'department', departmentId: A1 }],
]) await untouched(`bad scope (${label}): 400, not asked`, () => decide(session(U.owner, ownerStaff), capability, scope), 400, 'bad_scope')
check('when the database cannot be asked the answer is 503, never access', denied(await decide(session(U.owner, ownerStaff), 'business_admin', business(b1), async () => { throw new Error('connection refused') }), 503, 'unavailable'))
check('an answer of an unknown shape is a refusal, never access', denied(await decide(session(U.owner, ownerStaff), 'business_admin', business(b1), async () => ({ ok: true })), 403, 'denied') && denied(await decide(session(U.owner, ownerStaff), 'business_admin', business(b1), async () => null), 503, 'unavailable')
  && denied(await decide(session(U.adminA), 'organization_admin', organization(orgA), async () => ({ ok: true, via: 'legacy_owner', staff_id: S.owner })), 403, 'denied'))
check('the TypeScript scope table is the database\'s: each capability passes its own scope shape and is bad_request in the others', await (async () => {
  const shapes = { business: { business: b1 }, organization: { org: orgA }, department: { org: orgA, dept: A2 } }
  for (const capability of rules.IDENTITY_CAPABILITIES) for (const [kind, ids] of Object.entries(shapes)) {
    const answer = await ask(U.stranger, capability, ids)
    if ((rules.SCOPE_OF[capability] === kind) !== (answer.error === 'denied')) return false
  }
  return rules.IDENTITY_CAPABILITIES.length === 3
})())
void revokedGrant

console.log(`\n${passed} passed, ${failed.length} failed`)
if (failed.length) { console.log('FAILED:\n - ' + failed.join('\n - ')); process.exit(1) }
