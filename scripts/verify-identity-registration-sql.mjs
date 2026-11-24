// Local database check for FABLE-003 (20261124074218_customer_employee_registration.sql): employees register through a single-use
// link with first / last name, a nickname and a private photo; a reviewer of their department approves, rejects, deactivates or
// reactivates them. Every migration is applied in order to an in-memory Postgres (PGlite), the new one is re-applied, and its
// fourteen functions are attacked as the service role in a synthetic world: two businesses, two organizations, three departments,
// department heads, organization administrators, an owner, a general manager, employees and strangers. Wrong tenant, wrong
// department, self-review, stale versions, closed collection, replay, expiry, revocation, photo paths, retention and cleanup,
// triggers, RLS and browser denial. Real concurrency (two sessions) is in scripts/identity-concurrency-docker.mjs.
// Nothing here touches production; every person and id is made up.
//
//   node scripts/verify-identity-registration-sql.mjs

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openIdentityDb } from './lib/identity-pglite.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const PREVIOUS = '20261112162132_customer_org_management.sql'
const NEW = '20261124074218_customer_employee_registration.sql'
const TABLES = ['customer_consent_events', 'customer_member_photos', 'customer_member_profiles', 'customer_notices', 'customer_registration_invites', 'customer_registration_sessions']
const FUNCTIONS = [
  'customer_dept_review_check(uuid,uuid,uuid)', 'customer_registration_invite_create(uuid,uuid,uuid,text,timestamptz)', 'customer_registration_invite_revoke(uuid,uuid)',
  'customer_registration_open(text,uuid,text,timestamptz)', 'customer_registration_read(text,uuid)',
  'customer_photo_intent(uuid,text,uuid,uuid,integer,integer,integer,text)', 'customer_registration_submit(text,uuid,text,text,text,uuid,uuid)',
  'customer_membership_resubmit(uuid,uuid,text,text,text,uuid,uuid)', 'customer_membership_list(uuid,uuid,uuid,text,integer,integer)',
  'customer_membership_review(uuid,uuid,uuid,uuid,text,text,integer)', 'customer_photo_open(uuid,uuid,uuid,uuid,text)', 'customer_my_memberships(uuid)',
  'customer_photo_cleanup_due(integer)', 'customer_photo_cleanup_done(uuid[])',
]
const TRIGGER_FUNCTIONS = ['customer_append_only', 'customer_member_photos_guard']

let passed = 0
const failed = []
const check = (name, okay, detail = '') => {
  if (okay) { passed++; console.log(`  ✓ ${name}`) } else { failed.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const section = (title) => console.log(`\n${title}`)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const DENIED = { ok: false, error: 'denied' }
const denied = (answer) => !!answer && answer.ok === false && answer.error === 'denied' && Object.keys(answer).filter((k) => k !== 'id').length === 2
const err = (answer, code) => answer && answer.ok === false && answer.error === code
const hex = () => randomBytes(32).toString('hex')

// ------------------------------------------------------------------ the migrations
section('migration')
const before = {}
// what the schema was right AFTER this migration (taken when the next file starts, or at the end when it is the newest), so the
// tables and functions a LATER identity migration adds are not counted against this one
const after = {}
const picture = async (db) => ({
  tables: (await db.query(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`)).rows.map((r) => r.relname),
  functions: (await db.query(`select p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' order by 1`)).rows.map((r) => r.proname),
  grants: (await db.query(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name like 'customer\\_%' order by 1, 2, 3`)).rows,
  policies: Number((await db.query(`select count(*) n from pg_policies where schemaname = 'public'`)).rows[0].n),
  rows: Number((await db.query(`select (select count(*) from public.customer_notices) + (select count(*) from public.customer_registration_invites) + (select count(*) from public.customer_member_photos) n`)).rows[0].n),
})
let previous = null
let opened
try {
  opened = await openIdentityDb(root, {
    onFile: async (file, db) => {
      if (previous === NEW) Object.assign(after, await picture(db))
      previous = file
      if (file !== NEW) return
      before.tables = (await db.query(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`)).rows.map((r) => r.relname)
      before.functions = (await db.query(`select p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' order by 1`)).rows.map((r) => r.proname)
      before.identity = (await db.query(`select p.proname, md5(p.prosrc) body, pg_get_function_identity_arguments(p.oid) a, p.proacl::text acl from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'customer\\_%' order by 1, 3`)).rows
      before.policies = Number((await db.query(`select count(*) n from pg_policies where schemaname = 'public'`)).rows[0].n)
      before.grants = (await db.query(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name like 'customer\\_%' order by 1, 2, 3`)).rows
      before.membershipColumns = (await db.query(`select column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'customer_org_memberships' order by 1`)).rows
    },
  })
} catch (error) { check('all migrations apply in order', false, String(error.message)); console.error(error); process.exit(1) }
const { db, files } = opened
if (!after.tables) Object.assign(after, await picture(db))
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
const all = async (sql, params = []) => (await db.query(sql, params)).rows
const count = async (sql, params = []) => Number((await one(sql, params)).n)
const failure = async (sql, params = []) => { try { await db.query(sql, params); return '' } catch (error) { return String(error.message) } }
const refused = async (name, sql, params, pattern) => { const message = await failure(sql, params); check(name, pattern.test(message), message || 'the statement succeeded') }
const as = async (role, fn) => { await db.exec(`set role ${role}`); try { return await fn() } finally { await db.exec('reset role') } }
/** Calls a customer_* function the way the app does: as the service role, with named arguments. */
const call = (fn, args) => as('service_role', async () => (await one(`select public.${fn}(${Object.keys(args).map((key, i) => `${key} => $${i + 1}`).join(', ')}) r`, Object.values(args))).r)

check('all migrations apply in order', true)
// later identity migrations (FABLE-004 on) may follow it; this file checks what THIS migration added at the moment it was applied
const LATER = ['20261124084601_customer_identity_verification.sql']
check('the new migration comes right after FABLE-002, and only the known later identity migrations follow it', files[files.indexOf(NEW) - 1] === PREVIOUS && JSON.stringify(files.slice(files.indexOf(NEW) + 1)) === JSON.stringify(LATER), files.slice(files.indexOf(PREVIOUS)).join(', '))
const snapshot = async () => JSON.stringify({
  columns: await all(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name like 'customer\\_%' order by 1, 2`),
  constraints: await all(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) d from pg_constraint where conrelid::regclass::text like '%customer\\_%' order by 1, 2`),
  indexes: await all(`select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename like 'customer\\_%' order by 1`),
  triggers: await all(`select tgrelid::regclass::text t, tgname from pg_trigger where not tgisinternal and tgrelid::regclass::text like '%customer\\_%' order by 1, 2`),
  functions: await all(`select p.proname, pg_get_function_identity_arguments(p.oid) a, md5(p.prosrc) body, p.proacl::text acl from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'customer\\_%' order by 1, 2`),
  grants: await all(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name like 'customer\\_%' order by 1, 2, 3`),
  buckets: await all(`select id, public, file_size_limit, allowed_mime_types from storage.buckets order by 1`),
  policies: await all(`select schemaname, tablename, policyname, permissive, roles::text, qual, with_check from pg_policies order by 1, 2, 3`),
  rows: await count(`select (select count(*) from public.customer_notices) + (select count(*) from public.customer_member_photos) + (select count(*) from public.customer_identity_audit) n`),
})
const first = await snapshot()
const sqlText = readFileSync(path.join(root, 'supabase/migrations', NEW), 'utf8')
await db.exec(sqlText)
const second = await snapshot()
await db.exec(sqlText)
check('re-applying the new migration twice changes nothing (columns, constraints, indexes, triggers, functions, privileges, bucket, policies, rows)', first === second && second === await snapshot())
check('it added exactly six tables', same(after.tables.filter((t) => !before.tables.includes(t)), TABLES), after.tables.filter((t) => !before.tables.includes(t)).join(', '))
check('it added exactly sixteen functions: the fourteen callable ones and two trigger functions', same(after.functions.filter((f) => !before.functions.includes(f)), [...FUNCTIONS.map((f) => f.split('(')[0]), ...TRIGGER_FUNCTIONS].sort()), after.functions.filter((f) => !before.functions.includes(f)).join(', '))
check('every earlier identity function is byte for byte what it was (signature, body, privileges)', same(await all(`select p.proname, md5(p.prosrc) body, pg_get_function_identity_arguments(p.oid) a, p.proacl::text acl from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = any($1) order by 1, 3`, [[...new Set(before.identity.map((f) => f.proname))]]), before.identity))
check('it changed no privilege on any earlier identity table', same(after.grants.filter((g) => !TABLES.includes(g.table_name)), before.grants))
check('customer_org_memberships keeps its columns (only a unique index on (organization_id, id) is added for the scoped foreign keys)', same(await all(`select column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'customer_org_memberships' order by 1`), before.membershipColumns)
  && await count(`select count(*) n from pg_indexes where tablename = 'customer_org_memberships' and indexname = 'customer_org_memberships_scope_idx'`) === 1)
check('no row-level policy in public, no seed row, no notice published (collection is closed until the business publishes one)', after.policies === before.policies && after.rows === 0)
const code = sqlText.replace(/^\s*--.*$/gm, '')
check('the migration text never writes staff, auth, POS, the waitlist or customer_invitations, and redefines no earlier function', !/insert\s+into\s+(public\.)?(staff|customer_waitlist|pos_|customer_invitations)|insert\s+into\s+auth\.|update\s+(public\.)?(staff|pos_|customer_invitations)\b|alter\s+table\s+(public\.)?(staff|branches|customer_waitlist|customer_invitations)\b/i.test(code)
  && !/create\s+(or\s+replace\s+)?function\s+public\.customer_(access_check|access_grant|access_revoke|org_[a-z_]+|department_[a-z_]+|invitation_[a-z_]+|manage_scopes|keep_columns|identity_audit_keep|invitations_final)\s*\(/i.test(code))

section('privileges')
const rls = await all(`select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = any($1) order by 1`, [TABLES])
check('row-level security is on for all six tables', rls.length === 6 && rls.every((r) => r.relrowsecurity))
const browser = await all(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = any($1) and grantee in ('anon', 'authenticated', 'public') order by 1`, [TABLES])
check('anon and authenticated hold no privilege on any of them', browser.length === 0, JSON.stringify(browser).slice(0, 200))
const service = await all(`select table_name, string_agg(privilege_type, ',' order by privilege_type) p from information_schema.role_table_grants where table_schema = 'public' and table_name = any($1) and grantee = 'service_role' group by 1 order by 1`, [TABLES])
check('the service role holds select/insert/update (consent: select/insert) and never delete', same(service.map((r) => [r.table_name, r.p]), TABLES.map((t) => [t, t === 'customer_consent_events' ? 'INSERT,SELECT' : 'INSERT,SELECT,UPDATE'])), JSON.stringify(service))
for (const fn of FUNCTIONS) {
  const ok = await one(`select has_function_privilege('service_role', $1, 'execute') s, has_function_privilege('authenticated', $1, 'execute') a, has_function_privilege('anon', $1, 'execute') n`, [`public.${fn}`])
  check(`${fn.split('(')[0]}: service role only`, ok.s && !ok.a && !ok.n)
}
for (const fn of TRIGGER_FUNCTIONS) {
  const ok = await one(`select has_function_privilege('service_role', $1, 'execute') s, has_function_privilege('authenticated', $1, 'execute') a from pg_proc where proname = $2`, [`public.${fn}()`, fn])
  check(`${fn}: nobody calls it directly (a trigger function)`, ok && !ok.s && !ok.a)
}
check('no function name has two signatures (PGRST203)', await count(`select count(*) n from (select proname from pg_proc p where p.pronamespace = 'public'::regnamespace and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') group by proname having count(*) > 1) t`) === 0)
for (const role of ['anon', 'authenticated']) {
  const read = await as(role, () => failure(`select * from public.customer_member_photos`))
  check(`${role} cannot read the photos table`, /permission denied/.test(read), read || 'it could')
  const exec = await as(role, () => failure(`select public.customer_registration_submit(null, null, null, null, null, null, null)`))
  check(`${role} cannot call the submit function`, /permission denied/.test(exec), exec || 'it could')
}
const bucket = await one(`select public, file_size_limit, allowed_mime_types::text m from storage.buckets where id = 'customer-identity-photos'`)
check('the photo bucket exists, is private, takes JPEG only, at most 2 MB', bucket && bucket.public === false && Number(bucket.file_size_limit) === 2097152 && bucket.m === '{image/jpeg}')
const policy = await one(`select permissive, roles::text r, qual, with_check from pg_policies where schemaname = 'storage' and policyname = 'customer_identity_photos_browser_deny'`)
check('a RESTRICTIVE storage policy denies every browser role on that bucket (read, list, write)', policy && policy.permissive === 'RESTRICTIVE' && /anon/.test(policy.r) && /authenticated/.test(policy.r) && /customer-identity-photos/.test(policy.qual) && /customer-identity-photos/.test(policy.with_check))

// ------------------------------------------------------------------ the world
section('the synthetic world')
const U = Object.fromEntries(['owner', 'gm', 'adminA', 'headK', 'headL', 'adminB', 'headM', 'emp1', 'emp2', 'emp3', 'emp4', 'stranger'].map((k) => [k, randomUUID()]))
for (const id of Object.values(U)) await db.query(`insert into auth.users (id) values ($1)`, [id])
await db.query(`insert into public.staff (id, auth_user_id, first_name, role, active) values (gen_random_uuid(), $1, 'Owner', 'owner', true)`, [U.owner])
await db.query(`insert into public.staff (id, auth_user_id, first_name, role, badge, active) values (gen_random_uuid(), $1, 'GM', 'staff', 'general_manager', true)`, [U.gm])
const staffBefore = await count(`select count(*) n from public.staff`)
const sarcafe = (await one(`select id from public.customer_businesses where slug = 'sarcafe'`)).id
const other = (await one(`insert into public.customer_businesses (slug, name) values ('other-cafe', 'Other Cafe') returning id`)).id
const orgA = (await one(`insert into public.customer_organizations (slug, name) values ('org-a', 'Alpha College') returning id`)).id
const orgB = (await one(`insert into public.customer_organizations (slug, name) values ('org-b', 'Beta Works') returning id`)).id
await db.query(`insert into public.customer_business_orgs (business_id, organization_id, state) values ($1, $2, 'active'), ($3, $4, 'active')`, [sarcafe, orgA, other, orgB])
const K = (await one(`insert into public.customer_departments (organization_id, name) values ($1, 'Kitchen') returning id`, [orgA])).id
const L = (await one(`insert into public.customer_departments (organization_id, name) values ($1, 'Library') returning id`, [orgA])).id
const M = (await one(`insert into public.customer_departments (organization_id, name) values ($1, 'Machines') returning id`, [orgB])).id
const principal = async (who) => (await one(`insert into public.customer_principals (auth_user_id) values ($1) returning id`, [U[who]])).id
const P = {}
for (const who of ['adminA', 'headK', 'headL', 'adminB', 'headM']) P[who] = await principal(who)
const grant = (who, capability, org, dept = null) => db.query(`insert into public.customer_access_grants (principal_id, capability, scope_kind, organization_id, department_id) values ($1, $2, $3, $4, $5) returning id`, [P[who], capability, dept ? 'department' : 'organization', org, dept])
await grant('adminA', 'organization_admin', orgA); await grant('adminB', 'organization_admin', orgB)
const headKGrant = (await grant('headK', 'department_head', orgA, K)).rows[0].id
await grant('headL', 'department_head', orgA, L); await grant('headM', 'department_head', orgB, M)
check('two businesses, two organizations, three departments, five reviewers, an owner, a general manager, four employees, a stranger', true)

// ------------------------------------------------------------------ who reviews a department
section('who reviews a department (customer_dept_review_check)')
const review = (who, org, dept) => call('customer_dept_review_check', { p_auth_user_id: U[who], p_organization_id: org, p_department_id: dept })
const soonHours = (hours) => new Date(Date.now() + hours * 3600_000).toISOString()
check('the department\'s own head', (await review('headK', orgA, K)).via === 'department_head')
check('an administrator of its organization, for every department of it', (await review('adminA', orgA, K)).via === 'organization_admin' && (await review('adminA', orgA, L)).via === 'organization_admin')
for (const [label, who, org, dept] of [['the head of ANOTHER department of the same organization', 'headL', orgA, K], ['a head of another organization', 'headM', orgA, K], ['an administrator of another organization', 'adminB', orgA, K],
  ['the owner of the business that has the agreement (owners do not review employees)', 'owner', orgA, K], ['a general manager', 'gm', orgA, K], ['a stranger', 'stranger', orgA, K],
  ['a department id from another organization (ID swap)', 'adminA', orgA, M], ['an organization id with a department of another one', 'adminB', orgB, K]]) {
  check(`refused: ${label}`, denied(await review(who, org, dept)))
}
// an organization still in SETUP (no administrator of its own): the owner of the business that brought it in may set it up
// (FABLE-002), but does NOT review its employees (decision D4)
const orgSetup = (await one(`insert into public.customer_organizations (slug, name) values ('org-setup', 'Setup College') returning id`)).id
await db.query(`insert into public.customer_business_orgs (business_id, organization_id, state) values ($1, $2, 'draft')`, [sarcafe, orgSetup])
const S1 = (await one(`insert into public.customer_departments (organization_id, name) values ($1, 'Setup Dept') returning id`, [orgSetup])).id
check('control: the owner may manage the organization in setup (FABLE-002 rule)', (await call('customer_org_manage_check', { p_auth_user_id: U.owner, p_organization_id: orgSetup, p_any_state: false })).via === 'setup')
check('refused: the owner in setup reviews nothing (no employee or photo of an organization reaches a business owner)', denied(await review('owner', orgSetup, S1))
  && denied(await call('customer_registration_invite_create', { p_actor_auth_user_id: U.owner, p_organization_id: orgSetup, p_department_id: S1, p_token_digest: hex(), p_expires_at: soonHours(24) })))
await db.query(`update public.customer_departments set state = 'inactive' where id = $1`, [K])
check('a switched-off department has no reviewer (head and administrator refused)', denied(await review('headK', orgA, K)) && denied(await review('adminA', orgA, K)))
await db.query(`update public.customer_departments set state = 'active' where id = $1`, [K])
await db.query(`update public.customer_organizations set state = 'inactive' where id = $1`, [orgA])
check('a switched-off organization has no reviewer', denied(await review('headK', orgA, K)) && denied(await review('adminA', orgA, L)))
await db.query(`update public.customer_organizations set state = 'active' where id = $1`, [orgA])
await db.query(`update public.customer_access_grants set revoked_at = now() where id = $1`, [headKGrant])
check('a revoked head grant reviews nothing', denied(await review('headK', orgA, K)))
await db.query(`insert into public.customer_access_grants (principal_id, capability, scope_kind, organization_id, department_id) values ($1, 'department_head', 'department', $2, $3)`, [P.headK, orgA, K])
await db.query(`update public.customer_principals set state = 'revoked' where id = $1`, [P.headK])
check('a switched-off principal reviews nothing', denied(await review('headK', orgA, K)))
await db.query(`update public.customer_principals set state = 'active' where id = $1`, [P.headK])
check('back on: the head reviews again', (await review('headK', orgA, K)).via === 'department_head')

// ------------------------------------------------------------------ registration links
section('registration links')
const soon = (hours) => new Date(Date.now() + hours * 3600_000).toISOString()
const makeInvite = async (who = 'headK', org = orgA, dept = K, hours = 72) => {
  const token = hex()
  const r = await call('customer_registration_invite_create', { p_actor_auth_user_id: U[who], p_organization_id: org, p_department_id: dept, p_token_digest: token, p_expires_at: soon(hours) })
  return { token, r, id: r.invite_id }
}
const i1 = await makeInvite()
check('the head makes a link for their department', i1.r.ok && i1.r.status === 'created')
check('the administrator makes one for any department of the organization', (await makeInvite('adminA', orgA, L)).r.ok)
for (const [label, who, org, dept] of [['the head of another department', 'headL', orgA, K], ['the owner', 'owner', orgA, K], ['a general manager', 'gm', orgA, K], ['a stranger', 'stranger', orgA, K], ['another organization\'s administrator', 'adminB', orgA, K], ['an ID swap (organization A, department of B)', 'adminA', orgA, M]]) {
  check(`refused: ${label}`, denied((await makeInvite(who, org, dept)).r))
}
check('at most 14 days ahead; a past expiry and a malformed digest are bad requests', err((await makeInvite('headK', orgA, K, 24 * 14 + 1)).r, 'bad_request') && err((await makeInvite('headK', orgA, K, -1)).r, 'bad_request')
  && err(await call('customer_registration_invite_create', { p_actor_auth_user_id: U.headK, p_organization_id: orgA, p_department_id: K, p_token_digest: 'abc', p_expires_at: soon(1) }), 'bad_request'))
check('the same digest twice is refused', err(await call('customer_registration_invite_create', { p_actor_auth_user_id: U.headK, p_organization_id: orgA, p_department_id: K, p_token_digest: i1.token, p_expires_at: soon(1) }), 'bad_request'))
const audit1 = await one(`select operation, detail::text d from public.customer_identity_audit where target_id = $1`, [i1.id])
check('the audit names the link and the department, never the token', audit1?.operation === 'registration_invite.create' && !audit1.d.includes(i1.token))
const cols = (await all(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'customer_registration_invites' order by 1`)).map((r) => r.column_name)
check('a link row has no column for a token, a name, a phone or an address: only the digest', !cols.some((c) => /^(token|name|phone|email|address|label)$/.test(c)) && cols.includes('token_digest'))
const revokeMe = await makeInvite()
check('another department\'s head cannot end a link', denied(await call('customer_registration_invite_revoke', { p_actor_auth_user_id: U.headL, p_invite_id: revokeMe.id })))
check('an unknown link and someone else\'s answer the same', denied(await call('customer_registration_invite_revoke', { p_actor_auth_user_id: U.headK, p_invite_id: randomUUID() })))
check('the administrator ends it; twice is "unchanged"', (await call('customer_registration_invite_revoke', { p_actor_auth_user_id: U.adminA, p_invite_id: revokeMe.id })).status === 'revoked'
  && (await call('customer_registration_invite_revoke', { p_actor_auth_user_id: U.headK, p_invite_id: revokeMe.id })).status === 'unchanged')

// ------------------------------------------------------------------ the registration session
section('the registration session (customer_registration_open / _read)')
const open = (invite, who, sessionDigest = hex(), hours = 1) => call('customer_registration_open', { p_token_digest: invite.token, p_auth_user_id: U[who], p_session_digest: sessionDigest, p_expires_at: soon(hours) })
const closed = await open(i1, 'emp1')
check('CLOSED while no notice is published: nothing opens, nothing is written', err(closed, 'closed') && await count(`select count(*) n from public.customer_registration_sessions`) === 0)
await db.query(`insert into public.customer_notices (purpose, language, version, body, state) values ('employee_registration', 'he', 'draft-1', 'טקסט טיוטה לבדיקה בלבד, לא מאושר.', 'draft')`)
check('a DRAFT notice does not open collection either', err(await open(i1, 'emp1'), 'closed'))
const notice1 = (await one(`insert into public.customer_notices (purpose, language, version, body, state, published_at, retention) values ('employee_registration', 'he', 'qa-1', 'הודעה מדומה לבדיקה: השם והתמונה נשמרים בארגון שלכם בלבד.', 'published', now(), '{"rejected_days": 30, "replaced_photo_days": 7}') returning id`)).id
await refused('two published notices for one purpose and language are refused', `insert into public.customer_notices (purpose, language, version, body, state, published_at) values ('employee_registration', 'he', 'qa-2', 'עוד הודעה מדומה לבדיקה בלבד.', 'published', now())`, [], /duplicate key|unique/)
await refused('a published notice\'s text cannot be changed (the evidence would lie)', `update public.customer_notices set body = 'שונה בדיעבד, אסור לשנות.' where id = $1`, [notice1], /cannot change/)
const s1digest = hex()
const s1 = await open(i1, 'emp1', s1digest)
check('with a published notice: the session opens, with the names and the notice to show', s1.ok && s1.organization_name === 'Alpha College' && s1.department_name === 'Kitchen' && s1.notice?.id === notice1 && s1.notice.version === 'qa-1')
check('the session row holds only the digest of its secret, the link and the user', (await one(`select count(*) n from public.customer_registration_sessions where token_digest = $1 and auth_user_id = $2 and invite_id = $3`, [s1digest, U.emp1, i1.id])).n == 1)
check('the link\'s issuer cannot register through their own link', denied(await open(i1, 'headK')))
check('a session for longer than two hours is a bad request (and the table refuses it too)', err(await open(i1, 'emp1', hex(), 3), 'bad_request')
  && /check/.test(await failure(`insert into public.customer_registration_sessions (invite_id, auth_user_id, token_digest, expires_at) values ($1, $2, $3, now() + interval '3 hours')`, [i1.id, U.emp1, hex()])))
check('a revoked link opens nothing', denied(await open(revokeMe, 'emp1')))
const expired = await makeInvite()
await db.query(`alter table public.customer_registration_invites disable trigger customer_registration_invites_keep`)
await db.query(`update public.customer_registration_invites set created_at = now() - interval '2 days', expires_at = now() - interval '1 minute' where id = $1`, [expired.id])
await db.query(`alter table public.customer_registration_invites enable trigger customer_registration_invites_keep`)
check('an expired link opens nothing', denied(await open(expired, 'emp1')))
check('an unknown link answers the same', denied(await open({ token: hex() }, 'emp1')))
const iL = await makeInvite('headL', orgA, L)
await db.query(`update public.customer_departments set state = 'inactive' where id = $1`, [L])
check('a switched-off department opens nothing', denied(await open(iL, 'emp2')))
await db.query(`update public.customer_departments set state = 'active' where id = $1`, [L])
const lGrant = (await one(`select id from public.customer_access_grants where principal_id = $1 and revoked_at is null`, [P.headL])).id
await db.query(`update public.customer_access_grants set revoked_at = now() where id = $1`, [lGrant])
check('a link whose issuer may no longer review that department opens nothing (it carries no more authority than its issuer has now)', denied(await open(iL, 'emp2')))
await db.query(`insert into public.customer_access_grants (principal_id, capability, scope_kind, organization_id, department_id) values ($1, 'department_head', 'department', $2, $3)`, [P.headL, orgA, L])
check('...and works again when that authority is back', (await open(iL, 'emp2')).ok)
const read = (digest, who) => call('customer_registration_read', { p_session_digest: digest, p_auth_user_id: U[who] })
check('the page can read its live session again', (await read(s1digest, 'emp1')).notice?.id === notice1)
check('another signed-in user cannot use someone else\'s session', denied(await read(s1digest, 'emp2')) && denied(await read(s1digest, 'stranger')))
const s1again = hex()
check('opening the link again ends the person\'s earlier session (one at a time)', (await open(i1, 'emp1', s1again)).ok && denied(await read(s1digest, 'emp1')) && (await read(s1again, 'emp1')).ok)
const many = await makeInvite()
let opens = 0
for (let i = 0; i < 12; i++) if ((await open(many, 'emp3')).ok) opens++
check('a link opens at most ten times in all (then "limit")', opens === 10 && err(await open(many, 'emp3'), 'limit'))

// ------------------------------------------------------------------ photos and the application
section('photos (customer_photo_intent) and the application (customer_registration_submit)')
const photoPath = (org, id) => `org/${org}/${id}.jpg`
const intent = (who, { session = null, membership = null, id = randomUUID() } = {}) =>
  call('customer_photo_intent', { p_auth_user_id: U[who], p_session_digest: session, p_membership_id: membership, p_photo_id: id, p_width: 800, p_height: 1000, p_byte_size: 120000, p_sha256: hex() }).then((r) => ({ ...r, id }))
const ph1 = await intent('emp1', { session: s1again })
check('a checked photo is recorded as "uploading" for this session', ph1.ok && (await one(`select state from public.customer_member_photos where id = $1`, [ph1.id])).state === 'uploading')
check('someone else cannot record a photo on this session', denied(await intent('emp2', { session: s1again })))
check('the database makes the object path itself: org/<the session\'s organization>/<the photo id>.jpg (a caller never chooses it)', ph1.object_path === photoPath(orgA, ph1.id))
await refused('the table itself refuses a row whose path names another organization', `insert into public.customer_member_photos (id, organization_id, session_id, uploaded_by_auth_user_id, object_path, width, height, byte_size, sha256) values ($1, $2, $3, $4, $5, 100, 100, 10, $6)`,
  [randomUUID(), orgA, (await one(`select id from public.customer_registration_sessions where token_digest = $1`, [s1again])).id, U.emp1, photoPath(orgB, randomUUID()), hex()], /path_check|check constraint/)
check('both a session and a membership, or neither, is a bad request', err(await call('customer_photo_intent', { p_auth_user_id: U.emp1, p_session_digest: null, p_membership_id: null, p_photo_id: randomUUID(), p_width: 100, p_height: 100, p_byte_size: 1, p_sha256: hex() }), 'bad_request'))
check('the same photo id twice is a bad request', err(await intent('emp1', { session: s1again, id: ph1.id }), 'bad_request'))
for (let i = 0; i < 4; i++) await intent('emp1', { session: s1again })
check('at most five unfinished uploads per session', err(await intent('emp1', { session: s1again }), 'limit'))

const submit = (digest, who, photo, extra = {}) => call('customer_registration_submit', { p_session_digest: digest, p_auth_user_id: U[who], p_first_name: 'דנה', p_last_name: 'בדיקה', p_nickname: 'דני', p_photo_id: photo, p_notice_id: notice1, ...extra })
check('another user cannot submit on this session', denied(await submit(s1again, 'emp2', ph1.id)))
check('a notice that is not the published one is "stale"', err(await submit(s1again, 'emp1', ph1.id, { p_notice_id: randomUUID() }), 'stale'))
check('names must be 1-60 characters, a nickname at most 40, no control characters', err(await submit(s1again, 'emp1', ph1.id, { p_first_name: '' }), 'bad_request') && err(await submit(s1again, 'emp1', ph1.id, { p_last_name: 'x'.repeat(61) }), 'bad_request')
  && err(await submit(s1again, 'emp1', ph1.id, { p_nickname: 'x'.repeat(41) }), 'bad_request') && err(await submit(s1again, 'emp1', ph1.id, { p_first_name: 'a\u0007b' }), 'bad_request'))
const otherSession = hex()
await open(iL, 'emp4', otherSession)
const foreignPhoto = await intent('emp4', { session: otherSession })
check('a photo of another session is refused', err(await submit(s1again, 'emp1', foreignPhoto.id), 'bad_request'))
const principalsBefore = await count(`select count(*) n from public.customer_principals`)
const grantsBefore = await count(`select count(*) n from public.customer_access_grants`)
const applied = await submit(s1again, 'emp1', ph1.id)
check('the application is submitted: PENDING', applied.ok && applied.status === 'pending')
const m1 = applied.membership_id
const row1 = await one(`select m.state, m.department_id, m.version, f.first_name, f.last_name, f.nickname, p.auth_user_id from public.customer_org_memberships m join public.customer_member_profiles f on f.membership_id = m.id join public.customer_principals p on p.id = f.applicant_principal_id where m.id = $1`, [m1])
check('one pending membership of THAT department, the names, the applying user', row1.state === 'pending' && row1.department_id === K && row1.first_name === 'דנה' && row1.nickname === 'דני' && row1.auth_user_id === U.emp1)
check('the photo is linked and pending; the link is used; the session is used', (await one(`select state, membership_id from public.customer_member_photos where id = $1`, [ph1.id])).state === 'pending'
  && (await one(`select consumed_at is not null c, membership_id from public.customer_registration_invites where id = $1`, [i1.id])).membership_id === m1
  && (await one(`select used_at is not null u from public.customer_registration_sessions where token_digest = $1`, [s1again])).u)
check('the consent evidence names the exact notice, the purpose and the person', (await one(`select count(*) n from public.customer_consent_events where membership_id = $1 and notice_id = $2 and action = 'accept' and purpose = 'employee_registration' and actor_auth_user_id = $3`, [m1, notice1, U.emp1])).n == 1)
check('a principal was made for the new person, with a member; no grant, no staff row', await count(`select count(*) n from public.customer_principals`) === principalsBefore + 1
  && (await one(`select member_id is not null m from public.customer_principals where auth_user_id = $1`, [U.emp1])).m
  && await count(`select count(*) n from public.customer_access_grants`) === grantsBefore && await count(`select count(*) n from public.staff`) === staffBefore)
const applyAudit = await one(`select detail::text d from public.customer_identity_audit where operation = 'membership.apply' and target_id = $1`, [m1])
check('the audit row has ids only (no name, no nickname)', applyAudit && !/דנה|בדיקה|דני/.test(applyAudit.d))
check('the same session cannot submit twice (replay)', denied(await submit(s1again, 'emp1', ph1.id)))
check('a pending application gives nothing: the employee administers nothing', denied(await call('customer_access_check', { p_auth_user_id: U.emp1, p_capability: 'department_head', p_business_id: null, p_organization_id: orgA, p_department_id: K })))
const i1b = await makeInvite()
check('one application per person and organization: another link of the same organization is "conflict"', err(await open(i1b, 'emp1'), 'conflict'))

// the same person in ANOTHER organization: their own principal's member, never a name match
const iM = await makeInvite('headM', orgB, M)
const sM = hex()
await open(iM, 'emp1', sM)
const phM = await intent('emp1', { session: sM })
const mM = (await submit(sM, 'emp1', phM.id, { p_first_name: 'דנה', p_last_name: 'בדיקה' })).membership_id
check('the same signed-in person applies in another organization as the same member (their own login, not a name match)', !!mM && (await one(`select count(distinct member_id) n from public.customer_org_memberships where id = any($1)`, [[m1, mM]])).n == 1)
// two different people with the same names stay two members
const i2 = await makeInvite()
const s2 = hex()
await open(i2, 'emp2', s2)
const ph2 = await intent('emp2', { session: s2 })
const m2 = (await submit(s2, 'emp2', ph2.id)).membership_id
check('two different people with the same names are two members (nothing is matched or merged)', !!m2 && (await one(`select count(distinct member_id) n from public.customer_org_memberships where id = any($1)`, [[m1, m2]])).n == 2)
// a reviewer who applies as an employee: their principal keeps no member; the application gets one of its own
const iAdminSelf = await makeInvite('headK')
const sA = hex()
await open(iAdminSelf, 'adminA', sA)
const phA = await intent('adminA', { session: sA })
const mA = (await submit(sA, 'adminA', phA.id, { p_first_name: 'אדמין', p_last_name: 'ארגון' })).membership_id
check('an administrator can apply as an employee; their principal stays an operator (no member), the application has its own', !!mA && (await one(`select member_id from public.customer_principals where id = $1`, [P.adminA])).member_id === null)

// ------------------------------------------------------------------ review
section('review (customer_membership_review) and the department list')
const SCOPE_OF = {}
const decide = (who, membership, decision, version, reason = null, scope = SCOPE_OF[membership]) => call('customer_membership_review', { p_actor_auth_user_id: U[who], p_organization_id: scope?.[0] ?? null, p_department_id: scope?.[1] ?? null, p_membership_id: membership, p_decision: decision, p_reason: reason, p_expected_version: version })
Object.assign(SCOPE_OF, { [m1]: [orgA, K], [m2]: [orgA, K], [mA]: [orgA, K], [mM]: [orgB, M] })
check('NOBODY reviews their own application (the administrator, as the applicant)', denied(await decide('adminA', mA, 'approve', 1)))
check('a membership named with another department or organization is refused, also for someone who reviews both (ID swap)', denied(await decide('adminA', m1, 'approve', 1, null, [orgA, L])) && denied(await decide('adminA', m1, 'approve', 1, null, [orgB, M])) && denied(await decide('adminB', mM, 'approve', 1, null, [orgA, K])))
check('a missing scope is a bad request', err(await decide('headK', m1, 'approve', 1, null, [null, null]), 'bad_request'))
for (const [label, who] of [['the head of another department', 'headL'], ['another organization\'s administrator', 'adminB'], ['the owner', 'owner'], ['a general manager', 'gm'], ['the applicant', 'emp1'], ['a stranger', 'stranger']]) {
  check(`refused: ${label}`, denied(await decide(who, m1, 'approve', 1)))
}
check('a version the screen did not show is "stale" (nothing written)', err(await decide('headK', m1, 'approve', 7), 'stale') && (await one(`select state from public.customer_org_memberships where id = $1`, [m1])).state === 'pending')
check('reject and deactivate need a reason', err(await decide('headK', m1, 'reject', 1), 'bad_request') && err(await decide('headK', m1, 'deactivate', 1), 'bad_request'))
check('an unknown decision is a bad request', err(await decide('headK', m1, 'promote', 1), 'bad_request'))
check('a pending application cannot be deactivated or reactivated ("conflict")', err(await decide('headK', m1, 'deactivate', 1, 'x'), 'conflict') && err(await decide('headK', m1, 'reactivate', 1), 'conflict'))
const ok1 = await decide('headK', m1, 'approve', 1)
check('the head approves: approved, version 2, reviewer recorded, the photo becomes THE photo', ok1.status === 'approved' && ok1.version === 2
  && (await one(`select m.reviewed_by_principal_id = $2 r from public.customer_org_memberships m where m.id = $1`, [m1, P.headK])).r
  && (await one(`select state from public.customer_member_photos where id = $1`, [ph1.id])).state === 'approved')
check('approving twice is "conflict"', err(await decide('headK', m1, 'approve', 2), 'conflict'))
check('the administrator reviews the other administrator\'s... no: another reviewer (the head) approves the administrator\'s own application', (await decide('headK', mA, 'approve', 1)).status === 'approved')
const off = await decide('adminA', m1, 'deactivate', 2, 'left the job')
check('deactivation takes effect at once: inactive, version 3, reason kept', off.status === 'inactive' && off.version === 3 && (await one(`select review_reason from public.customer_org_memberships where id = $1`, [m1])).review_reason === 'left the job')
check('reactivation by a reviewer: approved, version 4; the approved photo was kept', (await decide('headK', m1, 'reactivate', 3)).version === 4 && (await one(`select state from public.customer_member_photos where id = $1`, [ph1.id])).state === 'approved')
const rej = await decide('headK', m2, 'reject', 1, 'not one of ours')
const rejRow = await one(`select p.state, p.erase_after > now() + interval '29 days' and p.erase_after < now() + interval '31 days' due, f.erase_after is not null fe from public.customer_member_photos p join public.customer_member_profiles f on f.membership_id = p.membership_id where p.id = $1`, [ph2.id])
check('rejection: rejected, its photo rejected, names and photo set to be erased after the PUBLISHED 30 days', rej.status === 'rejected' && rejRow.state === 'rejected' && rejRow.due && rejRow.fe)
const decisionAudit = await all(`select operation, reason, detail::text d from public.customer_identity_audit where target_id = $1 and operation like 'membership.%' order by at`, [m1])
check('every decision has its audit row (who, from, to, version), ids only', same(decisionAudit.map((a) => a.operation), ['membership.apply', 'membership.approve', 'membership.deactivate', 'membership.reactivate']) && decisionAudit.every((a) => !/דנה|דני/.test(a.d)))

const list = (who, org, dept, state = null, limit = 50, offset = 0) => call('customer_membership_list', { p_actor_auth_user_id: U[who], p_organization_id: org, p_department_id: dept, p_state: state, p_limit: limit, p_offset: offset })
const lk = await list('headK', orgA, K)
check('the head lists their department: names, states, versions, photo flags; the counts', lk.ok && lk.members.length === 3 && lk.counts.approved === 2 && lk.counts.rejected === 1 && lk.members.every((m) => m.membership_id && m.state && typeof m.version === 'number'))
check('the list holds no photo path, token, digest or another department\'s member', !/object_path|token_digest|org\//.test(JSON.stringify(lk)) && !lk.members.some((m) => m.membership_id === foreignPhoto.id))
check('the department\'s open links: ids and times only', lk.invites.length >= 1 && lk.invites.every((i) => Object.keys(i).sort().join() === 'created_at,expires_at,id,opened'))
check('filter by state; an unknown state is a bad request; a page holds at most 100', (await list('headK', orgA, K, 'rejected')).members.length === 1 && err(await list('headK', orgA, K, 'everything'), 'bad_request') && (await list('headK', orgA, K, null, 10000)).ok)
check('the head of another department, another organization, the owner and a stranger list nothing', denied(await list('headL', orgA, K)) && denied(await list('adminB', orgA, K)) && denied(await list('owner', orgA, K)) && denied(await list('stranger', orgA, K)))

// ------------------------------------------------------------------ reading a photo
section('reading a photo (customer_photo_open)')
const photo = (who, org, dept, membership, which = 'approved') => call('customer_photo_open', { p_auth_user_id: U[who], p_organization_id: org, p_department_id: dept, p_membership_id: membership, p_which: which })
const seen = await photo('headK', orgA, K, m1)
check('a reviewer of the department reads the approved photo: its path', seen.ok && seen.object_path === photoPath(orgA, ph1.id))
check('...and that read is in the audit (who, which, how)', (await count(`select count(*) n from public.customer_identity_audit where operation = 'photo.read' and target_id = $1 and actor_auth_user_id = $2`, [ph1.id, U.headK])) === 1)
for (const [label, who, org, dept] of [['the head of another department', 'headL', orgA, L], ['naming the right department but not reviewing it', 'headL', orgA, K], ['another organization\'s administrator', 'adminB', orgB, M], ['an ID swap: own organization and department, a membership of another', 'headM', orgB, M], ['the owner', 'owner', orgA, K], ['a stranger', 'stranger', orgA, K]]) {
  check(`refused: ${label}`, denied(await photo(who, org, dept, m1)))
}
check('the applicant reads their own photo (no scope named)', (await photo('emp1', null, null, m1)).ok)
check('nobody else reads it as "their own"', denied(await photo('emp2', null, null, m1)) && denied(await photo('headK', null, null, m1)))
check('a rejected photo is read by nobody', denied(await photo('headK', orgA, K, m2, 'pending')) && denied(await photo('headK', orgA, K, m2, 'approved')) && denied(await photo('emp2', null, null, m2, 'pending')))
check('half a scope, or another "which", is a bad request', err(await photo('headK', orgA, null, m1), 'bad_request') && err(await photo('headK', orgA, K, m1, 'rejected'), 'bad_request'))
check('a membership that does not exist answers like one that is not yours', denied(await photo('headK', orgA, K, randomUUID())))

// ------------------------------------------------------------------ changes after applying
section('changes after applying (customer_membership_resubmit): reviewed again')
const resubmit = (who, membership, extra = {}) => call('customer_membership_resubmit', { p_auth_user_id: U[who], p_membership_id: membership, p_first_name: 'דנה', p_last_name: 'בדיקה', p_nickname: 'דני', p_photo_id: null, p_notice_id: notice1, ...extra })
check('nothing changed: "unchanged", nothing written', (await resubmit('emp1', m1)).status === 'unchanged' && (await one(`select state, version from public.customer_org_memberships where id = $1`, [m1])).version === 4)
check('another user cannot change it', denied(await resubmit('emp2', m1, { p_nickname: 'x' })) && denied(await resubmit('headK', m1, { p_nickname: 'x' })))
const renamed = await resubmit('emp1', m1, { p_last_name: 'כהן' })
check('a changed name sends an approved membership back to PENDING (version 5): it counts only after review', renamed.status === 'pending' && renamed.version === 5 && (await one(`select state, reviewed_at from public.customer_org_memberships where id = $1`, [m1])).reviewed_at === null)
check('the approved photo is kept while the change waits', (await one(`select state from public.customer_member_photos where id = $1`, [ph1.id])).state === 'approved')
const newPhoto = await intent('emp1', { membership: m1 })
check('a new photo for an own membership is recorded against it', newPhoto.ok && (await one(`select membership_id, state from public.customer_member_photos where id = $1`, [newPhoto.id])).membership_id === m1)
check('a photo for someone else\'s membership is refused', denied(await intent('emp2', { membership: m1 })))
check('a photo of another membership cannot be submitted here', err(await resubmit('emp1', m1, { p_photo_id: ph2.id }), 'bad_request'))
const withPhoto = await resubmit('emp1', m1, { p_photo_id: newPhoto.id })
check('with the new photo: pending again (version 6), the new photo waits, the approved one stays', withPhoto.version === 6 && (await one(`select state from public.customer_member_photos where id = $1`, [newPhoto.id])).state === 'pending' && (await one(`select state from public.customer_member_photos where id = $1`, [ph1.id])).state === 'approved')
const newer = await intent('emp1', { membership: m1 })
await resubmit('emp1', m1, { p_photo_id: newer.id })
check('a newer photo replaces the waiting one (replaced, erase after the published 7 days)', (await one(`select state, erase_after is not null e from public.customer_member_photos where id = $1`, [newPhoto.id])).e
  && (await one(`select state from public.customer_member_photos where id = $1`, [newPhoto.id])).state === 'replaced')
check('the stale version the reviewer saw is refused; the current one approves', err(await decide('headK', m1, 'approve', 5), 'stale') && (await decide('headK', m1, 'approve', 7)).status === 'approved')
check('on approval the new photo is THE photo and the old approved one is replaced (to be erased after 7 days)', (await one(`select state from public.customer_member_photos where id = $1`, [newer.id])).state === 'approved'
  && (await one(`select state, erase_after is not null e from public.customer_member_photos where id = $1`, [ph1.id])).e)
check('the notice accepted again is evidence again', await count(`select count(*) n from public.customer_consent_events where membership_id = $1`, [m1]) === 4)
check('a stale notice is refused on a change too', err(await resubmit('emp1', m1, { p_nickname: 'חדש', p_notice_id: randomUUID() }), 'stale'))
await decide('adminA', m1, 'deactivate', 8, 'pause')
check('an INACTIVE membership cannot be changed by the employee (only a reviewer reactivates)', denied(await resubmit('emp1', m1, { p_nickname: 'חדש' })) && denied(await intent('emp1', { membership: m1 })))
check('a REJECTED application may be corrected and sent again (pending, reviewed again)', (await resubmit('emp2', m2, { p_last_name: 'אחר', p_photo_id: (await intent('emp2', { membership: m2 })).id })).status === 'pending')

// ------------------------------------------------------------------ own data
section('the person\'s own applications (customer_my_memberships)')
const mine = await call('customer_my_memberships', { p_auth_user_id: U.emp1 })
check('the employee sees their own applications in both organizations, and the notice in force', mine.ok && mine.memberships.length === 2 && mine.memberships.every((m) => m.organization_name && m.department_name) && mine.notice?.id === notice1)
check('a stranger sees nothing', (await call('customer_my_memberships', { p_auth_user_id: U.stranger })).memberships.length === 0)
check('it carries no photo path, digest or reviewer', !/object_path|digest|reviewed_by/.test(JSON.stringify(mine)))

// ------------------------------------------------------------------ cleanup
section('cleanup (customer_photo_cleanup_due / _done): nothing is left behind, nothing is guessed')
const stray = await intent('emp4', { session: otherSession })
const due0 = await call('customer_photo_cleanup_due', { p_limit: 100 })
check('a fresh upload is not due yet (an hour to finish the application)', !due0.photos.some((p) => p.photo_id === stray.id))
await db.query(`alter table public.customer_member_photos disable trigger customer_member_photos_keep`)
await db.query(`update public.customer_member_photos set created_at = now() - interval '2 hours' where id = any($1)`, [[stray.id, foreignPhoto.id]])
await db.query(`update public.customer_member_photos set erase_after = now() - interval '1 minute' where id = $1`, [ph1.id])
await db.query(`alter table public.customer_member_photos enable trigger customer_member_photos_keep`)
await db.query(`update public.customer_member_profiles set erase_after = now() - interval '1 minute' where membership_id = $1`, [m2])
await decide('headK', m2, 'reject', (await one(`select version from public.customer_org_memberships where id = $1`, [m2])).version, 'still not')
await db.query(`update public.customer_member_profiles set erase_after = now() - interval '1 minute' where membership_id = $1`, [m2])
const due = await call('customer_photo_cleanup_due', { p_limit: 100 })
const dueIds = due.photos.map((p) => p.photo_id)
check('due: abandoned uploads older than an hour, and replaced / rejected photos past their published erase date', dueIds.includes(stray.id) && dueIds.includes(foreignPhoto.id) && dueIds.includes(ph1.id) && !dueIds.includes(newer.id))
check('...with the object path the job must delete', due.photos.every((p) => /^org\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/.test(p.object_path)))
const done = await call('customer_photo_cleanup_done', { p_photo_ids: [...dueIds, newer.id] })
check('done: uploads discarded, past-due photos erased, the approved one untouched; the rejected application\'s names removed', done.ok && done.discarded >= 2 && done.erased >= 1 && done.profiles_erased === 1
  && (await one(`select state from public.customer_member_photos where id = $1`, [stray.id])).state === 'discarded' && (await one(`select state, erased_at is not null e from public.customer_member_photos where id = $1`, [ph1.id])).e
  && (await one(`select state from public.customer_member_photos where id = $1`, [newer.id])).state === 'approved'
  && (await one(`select first_name, last_name, nickname, erased_at is not null e from public.customer_member_profiles where membership_id = $1`, [m2])).e)
check('an erased application is a row of ids only: the reviewer sees it as erased, nobody reads its photo', (await list('headK', orgA, K, 'rejected')).members.every((m) => m.erased && m.first_name === null) && denied(await photo('emp2', null, null, m2, 'pending')))
check('nothing due twice', (await call('customer_photo_cleanup_due', { p_limit: 100 })).photos.every((p) => !dueIds.includes(p.photo_id)))
check('the cleanup audit names organizations and counts only', (await all(`select detail::text d from public.customer_identity_audit where operation = 'photo.cleanup'`)).every((a) => /discarded/.test(a.d) && !/org\//.test(a.d)))
check('without a published retention nothing is erased by age', (await all(`select count(*) n from public.customer_member_photos where state in ('rejected', 'replaced') and erase_after is null`)).length === 1)

// ------------------------------------------------------------------ the rows' own rules
section('the rows\' own rules (also for the service role and the table owner)')
await refused('consent evidence cannot be changed', `update public.customer_consent_events set action = 'withdraw' where membership_id = $1`, [m1], /append-only/)
await refused('consent evidence cannot be deleted', `delete from public.customer_consent_events where membership_id = $1`, [m1], /append-only/)
await refused('a photo cannot move to another membership', `update public.customer_member_photos set membership_id = $2 where id = $1`, [newer.id, mA], /another membership|cannot change/)
await refused('a discarded photo is final', `update public.customer_member_photos set state = 'pending' where id = $1`, [stray.id], /final/)
await refused('a photo\'s object path never changes', `update public.customer_member_photos set object_path = $2 where id = $1`, [newer.id, photoPath(orgA, randomUUID())], /cannot change/)
await refused('a used link is final', `update public.customer_registration_invites set revoked_at = now() where id = $1`, [i1.id], /cannot change/)
await refused('an application\'s applicant never changes', `update public.customer_member_profiles set applicant_principal_id = $2 where membership_id = $1`, [m1, P.headK], /cannot change/)
await refused('a membership cannot be moved to another organization (foundation rule still holds)', `update public.customer_org_memberships set organization_id = $2 where id = $1`, [m1, orgB], /cannot change/)
await refused('a profile cannot point at a membership of another organization (scoped foreign key)', `insert into public.customer_member_profiles (membership_id, organization_id, applicant_principal_id, first_name, last_name) values ($1, $2, $3, 'א', 'ב')`, [mM, orgA, P.adminA], /foreign key|violates/)
{ const message = await as('service_role', () => failure(`delete from public.customer_member_photos where id = $1`, [newer.id])); check('the service role cannot delete a photo row', /permission denied/.test(message), message || 'it could') }
check('nobody became staff; the employees hold no grant', await count(`select count(*) n from public.staff`) === staffBefore && await count(`select count(*) n from public.customer_access_grants g join public.customer_principals p on p.id = g.principal_id where p.auth_user_id = any($1)`, [[U.emp1, U.emp2, U.emp3, U.emp4]]) === 0)

console.log(`\n${passed} passed, ${failed.length} failed`)
if (failed.length) { console.log(failed.map((f) => `  - ${f}`).join('\n')); process.exit(1) }
