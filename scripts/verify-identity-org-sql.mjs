// Local database check for FABLE-002 (20261112162132_customer_org_management.sql): managing organizations and departments in an
// exact scope, and department-head invitations. Every migration is applied in order to an in-memory Postgres (PGlite), the new one
// is re-applied, and its thirteen functions are attacked as the service role with a synthetic world: two businesses, several
// organizations, an owner, a general manager, an employee, external administrators, department heads and strangers. Wrong tenant,
// wrong recipient, expiry, revocation, replay, an issuer who lost authority, ID swaps, grants, RLS and browser denial.
// The foundation itself is checked by scripts/verify-identity-sql.mjs; two REAL concurrent sessions (PGlite has one connection)
// by scripts/identity-concurrency-docker.mjs. Nothing here touches production; every person, address and id is made up.
//
//   node scripts/verify-identity-org-sql.mjs

import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openIdentityDb } from './lib/identity-pglite.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const FOUNDATION = '20261112125033_customer_identity_foundation.sql'
const NEW = '20261112162132_customer_org_management.sql'
const FUNCTIONS = [
  'customer_org_manage_check(uuid,uuid,boolean)', 'customer_org_create(uuid,uuid,text)', 'customer_org_update(uuid,uuid,text,text)',
  'customer_department_create(uuid,uuid,text)', 'customer_department_update(uuid,uuid,uuid,text,text)',
  'customer_invitation_create(uuid,uuid,uuid,text,text,text,timestamptz)', 'customer_invitation_revoke(uuid,uuid,text)',
  'customer_invitation_peek(text,uuid,text)', 'customer_invitation_accept(text,uuid,text)', 'customer_department_head_revoke(uuid,uuid,text)',
  'customer_org_list(uuid,uuid)', 'customer_org_detail(uuid,uuid)', 'customer_manage_scopes(uuid)',
]
const CHANGING = ['customer_org_update', 'customer_department_create', 'customer_department_update', 'customer_invitation_create', 'customer_invitation_revoke', 'customer_invitation_accept', 'customer_department_head_revoke']
const FOUNDATION_FUNCTIONS = ['customer_access_check', 'customer_access_grant', 'customer_access_revoke', 'customer_keep_columns', 'customer_identity_audit_keep']

let passed = 0
const failed = []
const check = (name, okay, detail = '') => {
  if (okay) { passed++; console.log(`  ✓ ${name}`) } else { failed.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const DENIED = { ok: false, error: 'denied' }
const BAD = { ok: false, error: 'bad_request' }
const denied = (answer) => same(answer, DENIED)
const bad = (answer) => same(answer, BAD)

// ------------------------------------------------------------------ the migrations
console.log('\nmigration')
const before = {}
let opened
try {
  opened = await openIdentityDb(root, {
    onFile: async (file, db) => {
      if (file !== NEW) return
      before.tables = (await db.query(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`)).rows.map((r) => r.relname)
      before.functions = (await db.query(`select p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' order by 1`)).rows.map((r) => r.proname)
      before.foundation = (await db.query(`select p.proname, md5(p.prosrc) body, pg_get_function_identity_arguments(p.oid) a from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = any($1) order by 1`, [FOUNDATION_FUNCTIONS])).rows
      before.policies = Number((await db.query(`select count(*) n from pg_policies where schemaname = 'public'`)).rows[0].n)
      before.staff = Number((await db.query(`select count(*) n from public.staff`)).rows[0].n)
      before.grants = (await db.query(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name like 'customer\\_%' order by 1, 2, 3`)).rows
    },
  })
} catch (error) { check('all migrations apply in order', false, String(error.message)); console.error(error); process.exit(1) }
const { db, files } = opened
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
const all = async (sql, params = []) => (await db.query(sql, params)).rows
const count = async (sql, params = []) => Number((await one(sql, params)).n)
const failure = async (sql, params = []) => { try { await db.query(sql, params); return '' } catch (error) { return String(error.message) } }
const refused = async (name, sql, params, pattern) => { const message = await failure(sql, params); check(name, pattern.test(message), message || 'the statement succeeded') }
const as = async (role, fn) => { await db.exec(`set role ${role}`); try { return await fn() } finally { await db.exec('reset role') } }
/** Calls a customer_* function the way the app does: as the service role, with named arguments. */
const call = (fn, args) => as('service_role', async () => (await one(`select public.${fn}(${Object.keys(args).map((key, i) => `${key} => $${i + 1}`).join(', ')}) r`, Object.values(args))).r)

check('all migrations apply in order', true)
check('the new migration is the newest file and comes right after the foundation', files[files.length - 1] === NEW && files[files.length - 2] === FOUNDATION, files.slice(-2).join(', '))
const snapshot = async () => JSON.stringify({
  columns: await all(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name like 'customer\\_%' order by 1, 2`),
  constraints: await all(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) d from pg_constraint where conrelid::regclass::text like '%customer\\_%' order by 1, 2`),
  indexes: await all(`select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename like 'customer\\_%' order by 1`),
  triggers: await all(`select tgrelid::regclass::text t, tgname from pg_trigger where not tgisinternal and tgrelid::regclass::text like '%customer\\_%' order by 1, 2`),
  functions: await all(`select p.proname, pg_get_function_identity_arguments(p.oid) a, md5(p.prosrc) body, p.proacl::text acl from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'customer\\_%' order by 1, 2`),
  grants: await all(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name like 'customer\\_%' order by 1, 2, 3`),
  rows: await count(`select (select count(*) from public.customer_invitations) + (select count(*) from public.customer_organizations) + (select count(*) from public.customer_identity_audit) n`),
})
const first = await snapshot()
const sqlText = readFileSync(path.join(root, 'supabase/migrations', NEW), 'utf8')
await db.exec(sqlText)
const second = await snapshot()
await db.exec(sqlText)
check('re-applying the new migration twice changes nothing (columns, constraints, indexes, triggers, functions, privileges, rows)', first === second && second === await snapshot())
const tablesNow = (await all(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`)).map((r) => r.relname)
check('it added exactly one table, customer_invitations', same(tablesNow.filter((t) => !before.tables.includes(t)), ['customer_invitations']))
const functionsNow = (await all(`select p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' order by 1`)).map((r) => r.proname)
check('it added exactly fourteen functions: the thirteen callable ones and one trigger function', same(functionsNow.filter((f) => !before.functions.includes(f)), [...FUNCTIONS.map((f) => f.split('(')[0]), 'customer_invitations_final'].sort()))
check('the foundation\'s five functions are byte for byte what they were (signature and body)', same(await all(`select p.proname, md5(p.prosrc) body, pg_get_function_identity_arguments(p.oid) a from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = any($1) order by 1`, [FOUNDATION_FUNCTIONS]), before.foundation))
check('it changed no privilege on any earlier identity table', same((await all(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name like 'customer\\_%' and table_name <> 'customer_invitations' order by 1, 2, 3`)), before.grants))
check('it added no row-level policy, no staff row and no seed row', await count(`select count(*) n from pg_policies where schemaname = 'public'`) === before.policies && await count(`select count(*) n from public.staff`) === before.staff
  && await count(`select (select count(*) from public.customer_invitations) + (select count(*) from public.customer_organizations) + (select count(*) from public.customer_principals) + (select count(*) from public.customer_identity_audit) n`) === 0)
check('the migration text never redefines a foundation function and never writes staff, auth, POS or the waitlist', !/function\s+public\.customer_access_(check|grant|revoke)\s*\(/i.test(sqlText.replace(/^\s*--.*$/gm, ''))
  && !/insert\s+into\s+(public\.)?(staff|customer_waitlist|pos_)|insert\s+into\s+auth\.|update\s+(public\.)?(staff|pos_)|alter\s+table\s+(public\.)?(staff|branches|customer_waitlist|customer_(?!invitations))/i.test(sqlText))
check('the invitation table has no column for a token, an address, a phone or a name: only digests and a masked hint', same((await all(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'customer_invitations' order by 1`)).map((r) => r.column_name),
  ['consumed_at', 'consumed_by_principal_id', 'created_at', 'department_id', 'expires_at', 'grant_id', 'id', 'issued_by_auth_user_id', 'organization_id', 'purpose', 'recipient_digest', 'recipient_hint', 'revoked_at', 'revoked_reason', 'token_digest']))

// ------------------------------------------------------------------ access
console.log('\naccess: row level security, table and function privileges, a real attempt as each browser role')
check('customer_invitations has row level security on and no policy', await count(`select count(*) n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'customer_invitations' and c.relrowsecurity`) === 1
  && await count(`select count(*) n from pg_policies where schemaname = 'public' and tablename = 'customer_invitations'`) === 0)
for (const role of ['anon', 'authenticated']) {
  const privileges = await all(`select p from unnest(array['select','insert','update','delete','truncate','references','trigger']) p where has_table_privilege($1, 'public.customer_invitations', p)`, [role])
  const callable = await all(`select f from unnest($1::text[]) f where has_function_privilege($2, 'public.' || f, 'execute')`, [[...FUNCTIONS, 'customer_invitations_final()'], role])
  check(`${role} holds no privilege on the invitations and can execute none of the fourteen functions`, privileges.length === 0 && callable.length === 0, JSON.stringify([privileges, callable]))
  await as(role, async () => {
    await refused(`${role}: reading the invitations is refused by the database`, `select * from public.customer_invitations`, [], /permission denied/)
    await refused(`${role}: accepting an invitation is refused`, `select public.customer_invitation_accept($1, $2, $3)`, ['a'.repeat(64), '00000000-0000-4000-8000-000000000001', 'b'.repeat(64)], /permission denied/)
    await refused(`${role}: creating an organization is refused`, `select public.customer_org_create($1, $2, 'x')`, ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'], /permission denied/)
    await refused(`${role}: asking who manages an organization is refused`, `select public.customer_org_manage_check($1, $2, true)`, ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'], /permission denied/)
    await refused(`${role}: listing one's scopes directly is refused`, `select public.customer_manage_scopes($1)`, ['00000000-0000-4000-8000-000000000001'], /permission denied/)
  })
}
check('the service role holds select / insert / update on the invitations, and no delete or truncate', same((await all(`select p from unnest(array['select','insert','update','delete','truncate']) p where has_table_privilege('service_role', 'public.customer_invitations', p) order by 1`)).map((r) => r.p), ['insert', 'select', 'update']))
check('the service role can execute the thirteen functions and not the trigger function', (await all(`select f from unnest($1::text[]) f where has_function_privilege('service_role', 'public.' || f, 'execute')`, [FUNCTIONS])).length === 13
  && !(await one(`select has_function_privilege('service_role', 'public.customer_invitations_final()', 'execute') v`)).v)
check('no function name in the whole schema has two signatures (PGRST203)', await count(`select count(*) n from (select proname from pg_proc p where p.pronamespace = 'public'::regnamespace and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') group by proname having count(*) > 1) t`) === 0)
check('every parameter is p_*, every function runs as its caller with an empty search path, none is internal_*', (await all(`select unnest(p.proargnames) a from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = any($1)`, [FUNCTIONS.map((f) => f.split('(')[0])])).every((x) => x.a.startsWith('p_'))
  && await count(`select count(*) n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = any($1) and not p.prosecdef and p.proconfig @> array['search_path=""']`, [[...FUNCTIONS.map((f) => f.split('(')[0]), 'customer_invitations_final']]) === 14)
{
  const fks = await all(`select c.conname, c.confdeltype::text d,
      exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indisvalid
                and (select array_agg(k order by ord) from unnest(i.indkey::int2[]) with ordinality as u(k, ord) where ord <= cardinality(c.conkey)) @> c.conkey::int2[]
                and (i.indpred is null or exists (select 1 from pg_attribute a where a.attrelid = c.conrelid and a.attnum = any(c.conkey) and pg_get_expr(i.indpred, i.indrelid) = '(' || a.attname || ' IS NOT NULL)'))) indexed
     from pg_constraint c where c.conrelid = 'public.customer_invitations'::regclass and c.contype = 'f' order by 1`)
  check(`all ${fks.length} foreign keys of the invitations are on delete restrict and have a usable supporting index`, fks.length === 4 && fks.every((fk) => fk.indexed && fk.d === 'r'), JSON.stringify(fks))
}

// ------------------------------------------------------------------ the synthetic world
const digest = (text) => createHash('sha256').update(text).digest('hex')
const user = async () => (await one(`insert into auth.users default values returning id`)).id
const staffRow = async (authUser, over = {}) => {
  const s = { role: 'staff', badge: null, active: true, ...over }
  return (await one(`insert into public.staff (auth_user_id, first_name, role, badge, active) values ($1, 'Synthetic', $2, $3, $4) returning id`, [authUser, s.role, s.badge, s.active])).id
}
const U = {}
for (const who of ['owner', 'gm', 'employee', 'b2Admin', 'orgAdmin', 'otherAdmin', 'head', 'head2', 'forwarded', 'stranger', 'switchedOff', 'lateAdmin']) U[who] = await user()
const S = { owner: await staffRow(U.owner, { role: 'owner', badge: 'owner' }), gm: await staffRow(U.gm, { badge: 'general_manager' }), employee: await staffRow(U.employee, { badge: 'barista' }) }
const principal = async (authUser) => (await one(`insert into public.customer_principals (auth_user_id) values ($1) returning id`, [authUser])).id
const P = { b2Admin: await principal(U.b2Admin), orgAdmin: await principal(U.orgAdmin), otherAdmin: await principal(U.otherAdmin), switchedOff: await principal(U.switchedOff), lateAdmin: await principal(U.lateAdmin) }
await db.query(`update public.customer_principals set state = 'revoked' where id = $1`, [P.switchedOff])
const b1 = (await one(`select id from public.customer_businesses where slug = 'sarcafe'`)).id
const b2 = (await one(`insert into public.customer_businesses (slug, name) values ('other-cafe', 'Other Cafe') returning id`)).id
await db.query(`insert into public.customer_access_grants (principal_id, capability, scope_kind, business_id) values ($1, 'business_admin', 'business', $2)`, [P.b2Admin, b2])
const staffCount = await count(`select count(*) n from public.staff`)
const authCount = await count(`select count(*) n from auth.users`)
const audits = () => count(`select count(*) n from public.customer_identity_audit`)
const lastAudit = (operation) => one(`select * from public.customer_identity_audit where operation = $1 order by at desc, id desc limit 1`, [operation])
const mail = { head: 'head.one@example.test', head2: 'head.two@example.test', forwarded: 'someone.else@example.test', stranger: 'stranger@example.test', owner: 'owner@example.test' }
const R = Object.fromEntries(Object.entries(mail).map(([who, address]) => [who, digest(`recipient:${address}`)]))
const hint = (address) => `${address[0]}***${address.slice(address.indexOf('@'))}`
const soon = (hours = 72) => new Date(Date.now() + hours * 3600_000).toISOString()
let tokens = 0
const newToken = () => digest(`token:${++tokens}:${randomBytes(8).toString('hex')}`)
const invite = (actor, org, dept, who, over = {}) => call('customer_invitation_create', { p_actor_auth_user_id: U[actor] ?? actor, p_organization_id: org, p_department_id: dept, p_token_digest: over.token ?? newToken(), p_recipient_digest: R[who], p_recipient_hint: hint(mail[who]), p_expires_at: over.expires ?? soon() })
const tokenOf = async (invitationId) => (await one(`select token_digest from public.customer_invitations where id = $1`, [invitationId])).token_digest
const accept = (token, who) => call('customer_invitation_accept', { p_token_digest: token, p_auth_user_id: U[who], p_recipient_digest: R[who] })
const peek = (token, who) => call('customer_invitation_peek', { p_token_digest: token, p_auth_user_id: U[who], p_recipient_digest: R[who] })
const manage = (who, org, anyState = false) => call('customer_org_manage_check', { p_auth_user_id: U[who], p_organization_id: org, p_any_state: anyState })
const access = (who, capability, ids) => call('customer_access_check', { p_auth_user_id: U[who], p_capability: capability, p_business_id: ids.business ?? null, p_organization_id: ids.org ?? null, p_department_id: ids.dept ?? null })
const createOrg = (who, business, name) => call('customer_org_create', { p_actor_auth_user_id: U[who], p_business_id: business, p_name: name })
const createDept = (who, org, name) => call('customer_department_create', { p_actor_auth_user_id: U[who], p_organization_id: org, p_name: name })
const updateDept = (who, org, dept, patch) => call('customer_department_update', { p_actor_auth_user_id: U[who], p_organization_id: org, p_department_id: dept, p_name: patch.name ?? null, p_state: patch.state ?? null })
const updateOrg = (who, org, patch) => call('customer_org_update', { p_actor_auth_user_id: U[who], p_organization_id: org, p_name: patch.name ?? null, p_state: patch.state ?? null })
const bootstrap = (who, org, principalId) => call('customer_access_grant', { p_actor_auth_user_id: U[who], p_principal_id: principalId, p_capability: 'organization_admin', p_business_id: null, p_organization_id: org, p_department_id: null, p_expires_at: null, p_reason: 'synthetic' })

// ------------------------------------------------------------------ organizations
console.log('\norganizations: created only inside a business the actor administers, always with a draft agreement')
let before1 = await audits()
const made = await createOrg('owner', b1, '  Organization One  ')
const org1 = made.organization_id
check('a Sarcafe owner creates an organization under Sarcafe', made.ok === true && made.status === 'created' && !!org1, JSON.stringify(made))
check('it is stored trimmed, active, with a generated slug, and with exactly one DRAFT agreement to Sarcafe and to no other business', (await one(`select name, state, slug ~ '^org-[0-9a-f]{20}$' slug_ok from public.customer_organizations where id = $1`, [org1])).name === 'Organization One'
  && same(await all(`select business_id, state, purpose from public.customer_business_orgs where organization_id = $1`, [org1]), [{ business_id: b1, state: 'draft', purpose: 'employee_benefit' }]))
{
  const row = await lastAudit('organization.create')
  check('one audit row: business scope, the owner\'s auth user and staff id, the agreement, no name', await audits() === before1 + 1 && row.business_id === b1 && row.organization_id === null && row.actor_auth_user_id === U.owner && row.actor_staff_id === S.owner
    && row.target_id === org1 && row.detail.actor_via === 'legacy_owner' && !!row.detail.agreement_id && !JSON.stringify(row.detail).includes('Organization'), JSON.stringify(row.detail))
}
before1 = await audits()
check('a general manager, an employee, a stranger and the other business\'s administrator cannot create one under Sarcafe', denied(await createOrg('gm', b1, 'X')) && denied(await createOrg('employee', b1, 'X')) && denied(await createOrg('stranger', b1, 'X')) && denied(await createOrg('b2Admin', b1, 'X')))
check('WRONG BUSINESS: a Sarcafe owner cannot create one under the other business, and an unknown business answers the same', denied(await createOrg('owner', b2, 'X')) && denied(await createOrg('owner', U.stranger, 'X')))
check('an empty, blank or over-long name, or a missing actor or business, is bad_request', bad(await createOrg('owner', b1, '   ')) && bad(await createOrg('owner', b1, 'x'.repeat(81))) && bad(await createOrg('owner', b1, null)) && bad(await call('customer_org_create', { p_actor_auth_user_id: null, p_business_id: b1, p_name: 'X' })) && bad(await call('customer_org_create', { p_actor_auth_user_id: U.owner, p_business_id: null, p_name: 'X' })))
check('the same name again (any case, any spacing) under the same business is a conflict', same(await createOrg('owner', b1, ' organization ONE'), { ok: false, error: 'conflict' }))
check('none of those wrote anything', await audits() === before1 && await count(`select count(*) n from public.customer_organizations`) === 1)
const org2 = (await createOrg('b2Admin', b2, 'Organization Two')).organization_id
check('the other business\'s administrator (a stored grant, no staff row) creates one under their own business, with the same name allowed there', !!org2 && (await lastAudit('organization.create')).detail.actor_via === 'grant' && (await createOrg('b2Admin', b2, 'Organization One')).ok === true)
const orgShared = (await createOrg('owner', b1, 'Shared Organization')).organization_id
await db.query(`insert into public.customer_business_orgs (business_id, organization_id, state) values ($1, $2, 'active')`, [b2, orgShared])

// ------------------------------------------------------------------ who may manage
console.log('\nwho may manage an organization: its administrator, or a business in setup while it has none')
let m = await manage('owner', org1)
check('SETUP: the owner manages an organization that has no administrator, through Sarcafe\'s agreement', m.ok === true && m.via === 'setup' && m.business_id === b1 && m.business_via === 'legacy_owner' && m.staff_id === S.owner, JSON.stringify(m))
check('a business WITHOUT an agreement does not: the other business\'s administrator is denied organization one', denied(await manage('b2Admin', org1)))
check('a general manager, an employee and a stranger are denied; an unknown organization answers the same; a missing argument is bad_request', denied(await manage('gm', org1)) && denied(await manage('employee', org1)) && denied(await manage('stranger', org1)) && denied(await manage('owner', U.stranger)) && bad(await call('customer_org_manage_check', { p_auth_user_id: null, p_organization_id: org1, p_any_state: false })))
check('two businesses with an agreement both manage the shared organization while it has no administrator', (await manage('owner', orgShared)).via === 'setup' && (await manage('b2Admin', orgShared)).business_id === b2 && (await manage('b2Admin', orgShared)).business_via === 'grant')
const adminGrant = await bootstrap('owner', orgShared, P.orgAdmin)
check('the owner bootstraps the shared organization\'s first administrator (the verified foundation rule, unchanged)', adminGrant.ok === true && adminGrant.status === 'created', JSON.stringify(adminGrant))
m = await manage('orgAdmin', orgShared)
check('that administrator manages it by their grant', m.ok === true && m.via === 'organization_admin' && m.grant_id === adminGrant.grant_id && m.principal_id === P.orgAdmin, JSON.stringify(m))
check('SETUP ENDED: with a live administrator, BOTH businesses are denied (also the one that appointed them)', denied(await manage('owner', orgShared)) && denied(await manage('b2Admin', orgShared)) && denied(await manage('owner', orgShared, true)))
check('the administrator of one organization is denied every other organization', denied(await manage('orgAdmin', org1)) && denied(await manage('orgAdmin', org2)))

// ------------------------------------------------------------------ departments
console.log('\ndepartments: created, renamed and switched off only by whoever may manage that organization')
before1 = await audits()
const dKitchen = (await createDept('owner', org1, ' Kitchen ')).department_id
const dOffice = (await createDept('owner', org1, 'Office')).department_id
check('the owner (setup) creates two departments in organization one', !!dKitchen && !!dOffice && same((await all(`select name, state from public.customer_departments where organization_id = $1 order by name`, [org1])), [{ name: 'Kitchen', state: 'active' }, { name: 'Office', state: 'active' }]))
{
  const row = await lastAudit('department.create')
  check('each has an audit row in the organization\'s scope that names the setup business (and no department name)', await audits() === before1 + 2 && row.organization_id === org1 && row.business_id === null && row.target_table === 'customer_departments' && row.detail.actor_via === 'setup' && row.detail.setup_business_id === b1 && row.actor_staff_id === S.owner && !JSON.stringify(row.detail).includes('Office'), JSON.stringify(row.detail))
}
before1 = await audits()
check('the same name again (any case or spacing) is a conflict; a blank or long name is bad_request', same(await createDept('owner', org1, 'kitchen  '), { ok: false, error: 'conflict' }) && bad(await createDept('owner', org1, ' ')) && bad(await createDept('owner', org1, 'x'.repeat(81))))
check('a general manager, an employee, a stranger and a business without an agreement cannot create a department', denied(await createDept('gm', org1, 'X')) && denied(await createDept('employee', org1, 'X')) && denied(await createDept('stranger', org1, 'X')) && denied(await createDept('b2Admin', org1, 'X')))
check('WRONG ORGANIZATION: the owner cannot create one in an organization of the other business, nor in the shared one that now runs itself', denied(await createDept('owner', org2, 'X')) && denied(await createDept('owner', orgShared, 'X')))
const dShared = (await createDept('orgAdmin', orgShared, 'Kitchen')).department_id
check('the shared organization\'s administrator creates a department there (the same name as elsewhere is fine), audited as organization_admin', !!dShared && (await lastAudit('department.create')).detail.actor_via === 'organization_admin' && (await lastAudit('department.create')).actor_principal_id === P.orgAdmin)
check('ID SWAP: a department of another organization named under this organization is denied (rename and switch-off)', denied(await updateDept('owner', org1, dShared, { name: 'Taken' })) && denied(await updateDept('owner', org1, dShared, { state: 'inactive' })) && denied(await updateDept('orgAdmin', orgShared, dKitchen, { state: 'inactive' })))
check('and that department is untouched', (await one(`select name, state from public.customer_departments where id = $1`, [dShared])).name === 'Kitchen' && (await one(`select state from public.customer_departments where id = $1`, [dKitchen])).state === 'active')
check('renaming works, renaming onto an existing name is a conflict, an unchanged call writes nothing', (await updateDept('owner', org1, dOffice, { name: 'Back Office' })).status === 'updated' && same(await updateDept('owner', org1, dOffice, { name: 'KITCHEN' }), { ok: false, error: 'conflict' })
  && (await updateDept('owner', org1, dOffice, { name: 'Back Office' })).status === 'unchanged' && (await updateDept('owner', org1, dOffice, { state: 'active' })).status === 'unchanged')
check('nothing to change, an unknown state or a blank name is bad_request', bad(await updateDept('owner', org1, dOffice, {})) && bad(await updateDept('owner', org1, dOffice, { state: 'deleted' })) && bad(await updateDept('owner', org1, dOffice, { name: '  ' })))
check('exactly two more audit rows were written by all of that (the shared department and the rename)', await audits() === before1 + 2)

// ------------------------------------------------------------------ invitations: creation
console.log('\ninvitations: only digests are stored, one open invitation per department and recipient')
before1 = await audits()
const inv1 = await invite('owner', org1, dKitchen, 'head')
check('the owner (setup) invites a head for the kitchen', inv1.ok === true && inv1.status === 'created' && !!inv1.invitation_id, JSON.stringify(inv1))
{
  const row = await one(`select * from public.customer_invitations where id = $1`, [inv1.invitation_id])
  const text = JSON.stringify(row)
  check('the row holds the purpose, the scope, two digests, a masked hint and the issuer; no address and no token', row.purpose === 'department_head' && row.organization_id === org1 && row.department_id === dKitchen && /^[0-9a-f]{64}$/.test(row.token_digest) && row.recipient_digest === R.head
    && row.recipient_hint === 'h***@example.test' && row.issued_by_auth_user_id === U.owner && row.consumed_at === null && row.revoked_at === null && !text.includes(mail.head), text.slice(0, 200))
  const audit = await lastAudit('invitation.create')
  check('its audit row has the department and the expiry, and neither digest nor the hint', await audits() === before1 + 1 && audit.target_id === inv1.invitation_id && audit.detail.department_id === dKitchen && audit.detail.actor_via === 'setup' && !JSON.stringify(audit).includes(R.head) && !JSON.stringify(audit).includes(row.token_digest) && !JSON.stringify(audit).includes('h***'), JSON.stringify(audit.detail))
}
before1 = await audits()
check('malformed digests, a hint that is too short, an expiry in the past or more than 30 days ahead: bad_request', bad(await invite('owner', org1, dKitchen, 'head2', { token: 'not-a-digest' })) && bad(await invite('owner', org1, dKitchen, 'head2', { token: 'A'.repeat(64) }))
  && bad(await call('customer_invitation_create', { p_actor_auth_user_id: U.owner, p_organization_id: org1, p_department_id: dKitchen, p_token_digest: newToken(), p_recipient_digest: 'zz', p_recipient_hint: 'h***@x', p_expires_at: soon() }))
  && bad(await call('customer_invitation_create', { p_actor_auth_user_id: U.owner, p_organization_id: org1, p_department_id: dKitchen, p_token_digest: newToken(), p_recipient_digest: R.head2, p_recipient_hint: 'h', p_expires_at: soon() }))
  && bad(await invite('owner', org1, dKitchen, 'head2', { expires: new Date(Date.now() - 1000).toISOString() })) && bad(await invite('owner', org1, dKitchen, 'head2', { expires: soon(24 * 31) })))
const refusals = [await invite('stranger', org1, dKitchen, 'head2'), await invite('gm', org1, dKitchen, 'head2'), await invite('employee', org1, dKitchen, 'head2'), await invite('b2Admin', org1, dKitchen, 'head2'), await invite('orgAdmin', org1, dKitchen, 'head2'),
  await invite('owner', org1, dShared, 'head2'), await invite('owner', orgShared, dShared, 'head2'), await invite('owner', U.stranger, dKitchen, 'head2'), await invite('owner', org1, U.stranger, 'head2')]
check('NO DISCLOSURE: no authority, another organization\'s department, an organization that runs itself, an unknown organization and an unknown department are ONE identical answer', refusals.every(denied), JSON.stringify(refusals))
check('a token digest that is already stored is bad_request (a token is never reused)', bad(await invite('owner', org1, dKitchen, 'head2', { token: await tokenOf(inv1.invitation_id) })))
check('none of those created an invitation or an audit row', await audits() === before1 && await count(`select count(*) n from public.customer_invitations`) === 1)
const inv1b = await invite('owner', org1, dKitchen, 'head')
check('inviting the SAME recipient to the same department supersedes the open invitation: the old one is revoked, one is open', inv1b.ok === true && (await one(`select revoked_reason from public.customer_invitations where id = $1`, [inv1.invitation_id])).revoked_reason === 'superseded'
  && await count(`select count(*) n from public.customer_invitations where department_id = $1 and recipient_digest = $2 and consumed_at is null and revoked_at is null`, [dKitchen, R.head]) === 1 && (await lastAudit('invitation.create')).detail.superseded_id === inv1.invitation_id)
{
  const crowd = (await createDept('owner', org1, 'Crowded')).department_id
  let ok = 0
  for (let i = 0; i < 20; i++) { const a = await call('customer_invitation_create', { p_actor_auth_user_id: U.owner, p_organization_id: org1, p_department_id: crowd, p_token_digest: newToken(), p_recipient_digest: digest(`crowd:${i}`), p_recipient_hint: 'c***@example.test', p_expires_at: soon() }); if (a.ok) ok++ }
  const over = await call('customer_invitation_create', { p_actor_auth_user_id: U.owner, p_organization_id: org1, p_department_id: crowd, p_token_digest: newToken(), p_recipient_digest: digest('crowd:21'), p_recipient_hint: 'c***@example.test', p_expires_at: soon() })
  check('a department holds at most 20 open invitations: the 21st is refused with "limit"', ok === 20 && same(over, { ok: false, error: 'limit' }), `${ok} created, then ${JSON.stringify(over)}`)
  await updateDept('owner', org1, crowd, { state: 'inactive' })
  check('switching that department off revoked all 20 (reason department_inactive), and the audit row says how many', await count(`select count(*) n from public.customer_invitations where department_id = $1 and revoked_reason = 'department_inactive'`, [crowd]) === 20 && (await lastAudit('department.update')).detail.invitations_revoked === 20)
}

// ------------------------------------------------------------------ invitations: what a holder of the link may see
console.log('\npeek: only the signed-in intended recipient learns what an invitation is for')
const token1 = await tokenOf(inv1b.invitation_id)
before1 = await audits()
{
  const seen = await peek(token1, 'head')
  check('the intended recipient sees the organization and the department', seen.ok === true && seen.organization_name === 'Organization One' && seen.department_name === 'Kitchen' && !!seen.expires_at, JSON.stringify(seen))
  const others = [await peek(token1, 'forwarded'), await peek(token1, 'stranger'), await call('customer_invitation_peek', { p_token_digest: token1, p_auth_user_id: U.owner, p_recipient_digest: R.head }),
    await peek(newToken(), 'head'), await peek(await tokenOf(inv1.invitation_id), 'head'), await call('customer_invitation_peek', { p_token_digest: token1, p_auth_user_id: U.switchedOff, p_recipient_digest: R.head })]
  check('a forwarded link (another recipient), a stranger, the issuer, an unknown token, a superseded invitation and a switched-off principal get ONE identical refusal', others.every(denied), JSON.stringify(others))
  check('peeking wrote nothing', await audits() === before1 && (await one(`select consumed_at, revoked_at from public.customer_invitations where id = $1`, [inv1b.invitation_id])).consumed_at === null)
}

// ------------------------------------------------------------------ acceptance
console.log('\nacceptance: the intended recipient, once, while everything about it still holds')
before1 = await audits()
const principalsBefore = await count(`select count(*) n from public.customer_principals`)
const grantsBefore = await count(`select count(*) n from public.customer_access_grants`)
check('WRONG RECIPIENT: a forwarded link accepted by someone else is denied', denied(await accept(token1, 'forwarded')))
{
  const row = await lastAudit('invitation.refuse')
  check('it created no principal and no grant, left the invitation open, and wrote one audit note with no address', await count(`select count(*) n from public.customer_principals`) === principalsBefore && await count(`select count(*) n from public.customer_access_grants`) === grantsBefore
    && (await one(`select consumed_at from public.customer_invitations where id = $1`, [inv1b.invitation_id])).consumed_at === null && await audits() === before1 + 1 && row.target_id === inv1b.invitation_id && row.actor_auth_user_id === U.forwarded
    && row.detail.reason === 'wrong_recipient' && !JSON.stringify(row).includes('example.test') && !JSON.stringify(row).includes(R.forwarded), JSON.stringify(row.detail))
  for (let i = 0; i < 14; i++) await accept(token1, 'forwarded')
  check('repeated wrong attempts stop adding audit rows at ten', await count(`select count(*) n from public.customer_identity_audit where target_id = $1 and operation = 'invitation.refuse'`, [inv1b.invitation_id]) === 10)
}
before1 = await audits()
check('the right address claimed by the WRONG signed-in user is not enough either: the digest comes with the user the server resolved, and the issuer cannot accept their own invitation', denied(await call('customer_invitation_accept', { p_token_digest: token1, p_auth_user_id: U.owner, p_recipient_digest: R.head })))
check('malformed input is bad_request; an unknown token is denied', bad(await call('customer_invitation_accept', { p_token_digest: 'x', p_auth_user_id: U.head, p_recipient_digest: R.head })) && bad(await call('customer_invitation_accept', { p_token_digest: token1, p_auth_user_id: null, p_recipient_digest: R.head }))
  && bad(await call('customer_invitation_accept', { p_token_digest: token1, p_auth_user_id: U.head, p_recipient_digest: null })) && denied(await accept(newToken(), 'head')))
check('a switched-off principal cannot accept (and is not switched back on)', denied(await call('customer_invitation_accept', { p_token_digest: token1, p_auth_user_id: U.switchedOff, p_recipient_digest: R.head })) && (await one(`select state from public.customer_principals where id = $1`, [P.switchedOff])).state === 'revoked')
check('none of those wrote anything', await audits() === before1 && await count(`select count(*) n from public.customer_principals`) === principalsBefore && await count(`select count(*) n from public.customer_access_grants`) === grantsBefore)

const done = await accept(token1, 'head')
check('THE INTENDED RECIPIENT accepts', done.ok === true && done.status === 'accepted' && done.organization_id === org1 && done.department_id === dKitchen && !!done.grant_id, JSON.stringify(done))
const headPrincipal = await one(`select * from public.customer_principals where auth_user_id = $1`, [U.head])
{
  const grant = await one(`select * from public.customer_access_grants where id = $1`, [done.grant_id])
  const inv = await one(`select * from public.customer_invitations where id = $1`, [inv1b.invitation_id])
  check('one principal was created for them (active, no member, no staff row), and exactly one department_head grant in exactly that department', await count(`select count(*) n from public.customer_principals`) === principalsBefore + 1 && headPrincipal.state === 'active' && headPrincipal.member_id === null
    && await count(`select count(*) n from public.customer_access_grants`) === grantsBefore + 1 && grant.principal_id === headPrincipal.id && grant.capability === 'department_head' && grant.scope_kind === 'department' && grant.organization_id === org1 && grant.department_id === dKitchen && grant.business_id === null && grant.revoked_at === null)
  check('the invitation is marked used, by that principal, with that grant', inv.consumed_at !== null && inv.consumed_by_principal_id === headPrincipal.id && inv.grant_id === done.grant_id && inv.revoked_at === null)
  const rows = await all(`select operation, actor_auth_user_id, actor_principal_id, target_table, target_id, detail from public.customer_identity_audit where at >= (select consumed_at from public.customer_invitations where id = $1) and organization_id = $2 order by operation`, [inv1b.invitation_id, org1])
  const byOp = Object.fromEntries(rows.map((r) => [r.operation, r]))
  check('three audit rows in the same transaction: principal.create, access.grant (via the invitation, naming its issuer) and invitation.accept', await audits() === before1 + 3 && byOp['principal.create']?.target_id === headPrincipal.id && byOp['access.grant']?.target_id === done.grant_id
    && byOp['access.grant'].detail.actor_via === 'invitation' && byOp['access.grant'].detail.invitation_id === inv1b.invitation_id && byOp['access.grant'].detail.issued_by_auth_user_id === U.owner && byOp['access.grant'].detail.issuer_via === 'setup'
    && byOp['invitation.accept']?.target_id === inv1b.invitation_id && byOp['invitation.accept'].detail.grant_status === 'created' && rows.every((r) => r.actor_auth_user_id === U.head && r.actor_principal_id === headPrincipal.id), JSON.stringify(rows.map((r) => r.operation)))
}
check('the head now passes the access question for their department, and ONLY that', (await access('head', 'department_head', { org: org1, dept: dKitchen })).ok === true && denied(await access('head', 'department_head', { org: org1, dept: dOffice }))
  && denied(await access('head', 'organization_admin', { org: org1 })) && denied(await access('head', 'business_admin', { business: b1 })) && denied(await access('head', 'department_head', { org: orgShared, dept: dShared })))
check('a department head manages nothing: no department, no invitation, no organization', denied(await manage('head', org1)) && denied(await createDept('head', org1, 'X')) && denied(await invite('head', org1, dKitchen, 'head2')) && denied(await updateDept('head', org1, dKitchen, { name: 'Mine' })) && denied(await updateOrg('head', org1, { name: 'Mine' })))
before1 = await audits()
check('REPLAY: the same link again is denied for the same user, for the wrong recipient and for a stranger, and writes nothing', denied(await accept(token1, 'head')) && denied(await accept(token1, 'forwarded')) && denied(await accept(token1, 'stranger')) && denied(await peek(token1, 'head'))
  && await audits() === before1 && await count(`select count(*) n from public.customer_access_grants where principal_id = $1`, [headPrincipal.id]) === 1)

console.log('\nacceptance: every way an invitation stops being acceptable')
const fresh = async (dept = dOffice, who = 'head2', actor = 'owner', org = org1) => { const a = await invite(actor, org, dept, who); return { id: a.invitation_id, token: await tokenOf(a.invitation_id) } }
{
  const expired = newToken()
  await db.query(`insert into public.customer_invitations (purpose, organization_id, department_id, token_digest, recipient_digest, recipient_hint, issued_by_auth_user_id, created_at, expires_at) values ('department_head', $1, $2, $3, $4, 'h***@example.test', $5, now() - interval '3 days', now() - interval '1 minute')`, [org1, dOffice, expired, digest('expired-recipient'), U.owner])
  check('EXPIRED: an invitation past its time is denied (peek and accept), for its own recipient', denied(await call('customer_invitation_accept', { p_token_digest: expired, p_auth_user_id: U.head2, p_recipient_digest: digest('expired-recipient') })) && denied(await call('customer_invitation_peek', { p_token_digest: expired, p_auth_user_id: U.head2, p_recipient_digest: digest('expired-recipient') })))
}
{
  const i = await fresh()
  const answers = [await call('customer_invitation_revoke', { p_actor_auth_user_id: U.stranger, p_invitation_id: i.id, p_reason: null }), await call('customer_invitation_revoke', { p_actor_auth_user_id: U.gm, p_invitation_id: i.id, p_reason: null }),
    await call('customer_invitation_revoke', { p_actor_auth_user_id: U.orgAdmin, p_invitation_id: i.id, p_reason: null }), await call('customer_invitation_revoke', { p_actor_auth_user_id: U.head, p_invitation_id: i.id, p_reason: null }),
    await call('customer_invitation_revoke', { p_actor_auth_user_id: U.owner, p_invitation_id: U.stranger, p_reason: null })]
  check('revoking: a stranger, a general manager, another organization\'s administrator, a department head and an unknown invitation are one identical refusal', answers.every(denied), JSON.stringify(answers))
  const revoked = await call('customer_invitation_revoke', { p_actor_auth_user_id: U.owner, p_invitation_id: i.id, p_reason: 'sent to the wrong person' })
  const audit = await lastAudit('invitation.revoke')
  check('REVOKED: the issuer\'s side revokes it (audited with the reason), and it can no longer be accepted or seen', revoked.status === 'revoked' && audit.target_id === i.id && audit.reason === 'sent to the wrong person' && denied(await accept(i.token, 'head2')) && denied(await peek(i.token, 'head2'))
    && (await call('customer_invitation_revoke', { p_actor_auth_user_id: U.owner, p_invitation_id: i.id, p_reason: null })).status === 'unchanged')
  check('an invitation that was already USED cannot be revoked: conflict (its grant is ended instead)', same(await call('customer_invitation_revoke', { p_actor_auth_user_id: U.owner, p_invitation_id: inv1b.invitation_id, p_reason: null }), { ok: false, error: 'conflict' }))
}
{
  const i = await fresh()
  await db.query(`update public.customer_departments set state = 'inactive' where id = $1`, [dOffice])
  const off = [await accept(i.token, 'head2'), await peek(i.token, 'head2')]
  await db.query(`update public.customer_departments set state = 'active' where id = $1`, [dOffice])
  await db.query(`update public.customer_organizations set state = 'inactive' where id = $1`, [org1])
  off.push(await accept(i.token, 'head2'), await peek(i.token, 'head2'))
  await db.query(`update public.customer_organizations set state = 'active' where id = $1`, [org1])
  check('SWITCHED OFF: while the department or the organization is off (set directly, without the function\'s own revocation) the open invitation is denied', off.every(denied), JSON.stringify(off))
  check('and it is acceptable again once both are back on (nothing was consumed by the refusals)', (await peek(i.token, 'head2')).ok === true)
  await call('customer_invitation_revoke', { p_actor_auth_user_id: U.owner, p_invitation_id: i.id, p_reason: null })
}
{
  // an invitation issued in setup dies when the organization gets its own administrator
  const org = (await createOrg('owner', b1, 'Handed Over')).organization_id
  const dept = (await createDept('owner', org, 'Front')).department_id
  const i = await fresh(dept, 'head2', 'owner', org)
  check('ISSUER AUTHORITY: before the hand-over the invitation is acceptable', (await peek(i.token, 'head2')).ok === true)
  const late = await bootstrap('owner', org, P.lateAdmin)
  check('after the organization gets its own administrator, the owner\'s open invitation is dead: an invitation carries no more authority than its issuer has now', late.ok === true && denied(await accept(i.token, 'head2')) && denied(await peek(i.token, 'head2'))
    && await count(`select count(*) n from public.customer_principals where auth_user_id = $1`, [U.head2]) === 0)
  const own = await fresh(dept, 'head2', 'lateAdmin', org)
  const revokedAdmin = await call('customer_access_revoke', { p_actor_auth_user_id: U.lateAdmin, p_grant_id: late.grant_id, p_reason: 'leaving' })
  await bootstrap('owner', org, P.otherAdmin)
  check('an administrator\'s invitation dies with that administrator\'s grant (another administrator now runs the organization)', revokedAdmin.status === 'revoked' && denied(await accept(own.token, 'head2')) && denied(await peek(own.token, 'head2')))
  const good = await fresh(dept, 'head2', 'otherAdmin', org)
  const accepted = await accept(good.token, 'head2')
  check('the current administrator\'s invitation is accepted, audited with issuer_via organization_admin', accepted.ok === true && (await lastAudit('invitation.accept')).detail.issuer_via === 'organization_admin')
  const again = await fresh(dept, 'head2', 'otherAdmin', org)
  const twice = await accept(again.token, 'head2')
  check('someone who is ALREADY head of that department and accepts a new invitation keeps the one grant (no duplicate, no second principal)', twice.ok === true && twice.grant_id === accepted.grant_id && (await lastAudit('invitation.accept')).detail.grant_status === 'unchanged'
    && await count(`select count(*) n from public.customer_access_grants where capability = 'department_head' and department_id = $1 and revoked_at is null`, [dept]) === 1 && await count(`select count(*) n from public.customer_principals where auth_user_id = $1`, [U.head2]) === 1)
}

console.log('\nthe invitation row itself: single use and scope are facts of the database')
{
  const used = inv1b.invitation_id
  const open = await fresh(dOffice, 'head2')
  for (const role of ['owner of the tables', 'service_role']) {
    const run = (fn) => (role === 'service_role' ? as('service_role', fn) : fn())
    await run(async () => {
      await refused(`${role}: a used invitation cannot be made unused`, `update public.customer_invitations set consumed_at = null, consumed_by_principal_id = null, grant_id = null where id = $1`, [used], /used or revoked invitation cannot change/)
      await refused(`${role}: a revoked invitation cannot be reopened`, `update public.customer_invitations set revoked_at = null, revoked_reason = null where id = $1`, [inv1.invitation_id], /used or revoked invitation cannot change/)
      await refused(`${role}: an open invitation cannot be pointed at another department, recipient, token or expiry`, `update public.customer_invitations set department_id = $2 where id = $1`, [open.id, dKitchen], /cannot change/)
      await refused(`${role}: ...recipient`, `update public.customer_invitations set recipient_digest = $2 where id = $1`, [open.id, R.stranger], /cannot change/)
      await refused(`${role}: ...expiry`, `update public.customer_invitations set expires_at = now() + interval '20 days' where id = $1`, [open.id], /cannot change/)
      await refused(`${role}: an invitation cannot be marked used without its principal and grant`, `update public.customer_invitations set consumed_at = now() where id = $1`, [open.id], /customer_invitations_consumed_check/)
      await refused(`${role}: a department of another organization does not attach`, `insert into public.customer_invitations (purpose, organization_id, department_id, token_digest, recipient_digest, recipient_hint, issued_by_auth_user_id, expires_at) values ('department_head', $1, $2, $3, $4, 'x***@example.test', $5, now() + interval '1 day')`, [org1, dShared, newToken(), R.stranger, U.owner], /foreign key|customer_invitations_department_fk/i)
      await refused(`${role}: another purpose is refused`, `insert into public.customer_invitations (purpose, organization_id, department_id, token_digest, recipient_digest, recipient_hint, issued_by_auth_user_id, expires_at) values ('organization_admin', $1, $2, $3, $4, 'x***@example.test', $5, now() + interval '1 day')`, [org1, dOffice, newToken(), R.stranger, U.owner], /check constraint/i)
      await refused(`${role}: a second open invitation for the same department and recipient is refused by the index`, `insert into public.customer_invitations (purpose, organization_id, department_id, token_digest, recipient_digest, recipient_hint, issued_by_auth_user_id, expires_at) values ('department_head', $1, $2, $3, $4, 'x***@example.test', $5, now() + interval '1 day')`, [org1, dOffice, newToken(), R.head2, U.owner], /customer_invitations_live_idx/)
    })
  }
  await as('service_role', () => refused('service_role: deleting an invitation is refused', `delete from public.customer_invitations where id = $1`, [open.id], /permission denied/))
  await refused('a principal that accepted an invitation cannot be deleted, nor the grant it became', `delete from public.customer_principals where id = $1`, [headPrincipal.id], /foreign key constraint/i)
  await call('customer_invitation_revoke', { p_actor_auth_user_id: U.owner, p_invitation_id: open.id, p_reason: null })
}

// ------------------------------------------------------------------ switching off, and ending a head
console.log('\nswitching a department or an organization off, and ending a department head')
{
  const pending = await fresh(dKitchen, 'head2')
  const off = await updateDept('owner', org1, dKitchen, { state: 'inactive' })
  check('switching the kitchen off: its head loses access at once (the grant is kept), its open invitation is revoked', off.status === 'updated' && denied(await access('head', 'department_head', { org: org1, dept: dKitchen })) && (await one(`select revoked_at from public.customer_access_grants where id = $1`, [done.grant_id])).revoked_at === null
    && (await one(`select revoked_reason from public.customer_invitations where id = $1`, [pending.id])).revoked_reason === 'department_inactive' && same((await call('customer_manage_scopes', { p_auth_user_id: U.head })).departments, []))
  check('no invitation can be created for a department that is off', denied(await invite('owner', org1, dKitchen, 'head2')))
  await updateDept('owner', org1, dKitchen, { state: 'active' })
  check('switching it back on gives the head their access back, and the revoked invitation stays revoked', (await access('head', 'department_head', { org: org1, dept: dKitchen })).ok === true && denied(await accept(pending.token, 'head2')))
}
{
  const pending = await fresh(dOffice, 'head2')
  // every invitation of the organization that is neither used nor revoked is closed, also one whose time had already passed
  const open = await count(`select count(*) n from public.customer_invitations where organization_id = $1 and consumed_at is null and revoked_at is null`, [org1])
  const off = await updateOrg('owner', org1, { state: 'inactive' })
  check('switching the organization off: every authority in it stops, its open invitations are revoked (audited with the count)', off.status === 'updated' && denied(await manage('owner', org1)) && denied(await access('head', 'department_head', { org: org1, dept: dKitchen }))
    && (await one(`select revoked_reason from public.customer_invitations where id = $1`, [pending.id])).revoked_reason === 'organization_inactive' && open >= 2 && (await lastAudit('organization.update')).detail.invitations_revoked === open && (await lastAudit('organization.update')).detail.state_to === 'inactive'
    && await count(`select count(*) n from public.customer_invitations where organization_id = $1 and consumed_at is null and revoked_at is null`, [org1]) === 0, `open before: ${open}`)
  check('while it is off nothing can be added: no department, no invitation', denied(await createDept('owner', org1, 'X')) && denied(await invite('owner', org1, dOffice, 'head2')))
  check('only someone who may manage it can look at it or switch it back on; a stranger and the other business cannot', (await manage('owner', org1, true)).ok === true && denied(await updateOrg('stranger', org1, { state: 'active' })) && denied(await updateOrg('b2Admin', org1, { state: 'active' })) && denied(await updateOrg('gm', org1, { state: 'active' })))
  check('the owner (setup) switches it back on and renames it; bad input is bad_request; an unchanged call writes nothing', (await updateOrg('owner', org1, { state: 'active', name: 'Organization One (renamed)' })).status === 'updated' && bad(await updateOrg('owner', org1, {})) && bad(await updateOrg('owner', org1, { state: 'gone' }))
    && bad(await updateOrg('owner', org1, { name: 'x'.repeat(81) })) && (await updateOrg('owner', org1, { state: 'active' })).status === 'unchanged')
  check('an organization that runs itself is switched off and on by its administrator, never by a business', denied(await updateOrg('owner', orgShared, { state: 'inactive' })) && denied(await updateOrg('b2Admin', orgShared, { name: 'Ours' })) && (await updateOrg('orgAdmin', orgShared, { state: 'inactive' })).status === 'updated'
    && (await updateOrg('orgAdmin', orgShared, { state: 'active' })).status === 'updated')
}
{
  before1 = await audits()
  const headRevoke = (who, grant) => call('customer_department_head_revoke', { p_actor_auth_user_id: U[who], p_grant_id: grant, p_reason: null })
  const answers = [await headRevoke('stranger', done.grant_id), await headRevoke('gm', done.grant_id), await headRevoke('employee', done.grant_id), await headRevoke('b2Admin', done.grant_id), await headRevoke('orgAdmin', done.grant_id), await headRevoke('head', done.grant_id), await headRevoke('owner', U.stranger)]
  check('ending a head: a stranger, a general manager, an employee, another business, another organization\'s administrator, the head themself and an unknown grant are one identical refusal', answers.every(denied) && await audits() === before1, JSON.stringify(answers))
  check('an organization_admin or business_admin grant is not ended through this function (it stays under the foundation\'s rule)', denied(await headRevoke('orgAdmin', adminGrant.grant_id)) && denied(await headRevoke('owner', adminGrant.grant_id)) && (await one(`select revoked_at from public.customer_access_grants where id = $1`, [adminGrant.grant_id])).revoked_at === null)
  const ended = await call('customer_department_head_revoke', { p_actor_auth_user_id: U.owner, p_grant_id: done.grant_id, p_reason: 'left the organization' })
  const audit = await lastAudit('access.revoke')
  check('the owner (setup) ends the kitchen head: the grant is revoked, audited with the setup business and the reason, and the head is refused at once', ended.status === 'revoked' && audit.target_id === done.grant_id && audit.reason === 'left the organization' && audit.detail.actor_via === 'setup' && audit.detail.setup_business_id === b1
    && audit.detail.principal_id === headPrincipal.id && denied(await access('head', 'department_head', { org: org1, dept: dKitchen })) && (await headRevoke('owner', done.grant_id)).status === 'unchanged')
}

// ------------------------------------------------------------------ reads
console.log('\nreads: each one rechecks the actor and shows only that scope')
{
  const list = await call('customer_org_list', { p_actor_auth_user_id: U.owner, p_business_id: b1 })
  const names = list.organizations.map((o) => o.name).sort()
  check('the owner\'s list has exactly Sarcafe\'s organizations (none of the other business\'s), with who runs each', list.ok === true && same(names, ['Handed Over', 'Organization One (renamed)', 'Shared Organization'])
    && list.organizations.find((o) => o.id === org1).can_manage === true && list.organizations.find((o) => o.id === org1).has_admin === false && list.organizations.find((o) => o.id === orgShared).can_manage === false && list.organizations.find((o) => o.id === orgShared).has_admin === true, JSON.stringify(names))
  check('nobody else gets that list: a general manager, an employee, a stranger, the other business; and the owner does not get the other business\'s', denied(await call('customer_org_list', { p_actor_auth_user_id: U.gm, p_business_id: b1 })) && denied(await call('customer_org_list', { p_actor_auth_user_id: U.employee, p_business_id: b1 }))
    && denied(await call('customer_org_list', { p_actor_auth_user_id: U.stranger, p_business_id: b1 })) && denied(await call('customer_org_list', { p_actor_auth_user_id: U.b2Admin, p_business_id: b1 })) && denied(await call('customer_org_list', { p_actor_auth_user_id: U.owner, p_business_id: b2 })))
  await db.query(`insert into public.customer_invitations (purpose, organization_id, department_id, token_digest, recipient_digest, recipient_hint, issued_by_auth_user_id, created_at, expires_at) values ('department_head', $1, $2, $3, $4, 'l***@example.test', $5, now() - interval '3 days', now() - interval '1 minute')`, [org1, dOffice, newToken(), digest('late-recipient'), U.owner])
  const detail = await call('customer_org_detail', { p_actor_auth_user_id: U.owner, p_organization_id: org1 })
  check('the detail of organization one: its departments, no head after the revocation, its invitations with a status each and only masked hints', detail.ok === true && detail.via === 'setup' && detail.departments.length === 3 && detail.heads.length === 0 && detail.invitations.length > 5
    && detail.invitations.every((i) => ['pending', 'accepted', 'revoked', 'expired'].includes(i.status) && /\*\*\*@/.test(i.hint)) && ['accepted', 'revoked', 'expired'].every((status) => detail.invitations.some((i) => i.status === status)) && !JSON.stringify(detail).includes(mail.head), JSON.stringify(detail).slice(0, 160))
  check('the detail carries no digest, no token and no auth user id', !/[0-9a-f]{64}/.test(JSON.stringify(detail)) && !JSON.stringify(detail).includes(U.head) && !JSON.stringify(detail).includes(U.owner))
  check('the detail is refused to everyone who may not manage it (one answer), including the head of one of its departments and the owner for an organization that runs itself', denied(await call('customer_org_detail', { p_actor_auth_user_id: U.stranger, p_organization_id: org1 })) && denied(await call('customer_org_detail', { p_actor_auth_user_id: U.head2, p_organization_id: org1 }))
    && denied(await call('customer_org_detail', { p_actor_auth_user_id: U.owner, p_organization_id: orgShared })) && denied(await call('customer_org_detail', { p_actor_auth_user_id: U.orgAdmin, p_organization_id: org1 })) && denied(await call('customer_org_detail', { p_actor_auth_user_id: U.owner, p_organization_id: U.stranger })))
  const shared = await call('customer_org_detail', { p_actor_auth_user_id: U.orgAdmin, p_organization_id: orgShared })
  check('an organization\'s administrator gets the detail of their own organization', shared.ok === true && shared.via === 'organization_admin' && shared.departments.length === 1)
  const mine = await call('customer_manage_scopes', { p_auth_user_id: U.head2 })
  check('a department head\'s scopes: exactly their one department with its organization, no organization to administer', mine.ok === true && mine.organizations.length === 0 && mine.departments.length === 1 && mine.departments[0].department_name === 'Front' && mine.departments[0].organization_name === 'Handed Over', JSON.stringify(mine))
  check('an administrator\'s scopes: their organization; a stranger, a general manager and the owner (who holds no grant): two empty lists', same((await call('customer_manage_scopes', { p_auth_user_id: U.orgAdmin })).organizations.map((o) => o.organization_id), [orgShared])
    && [await call('customer_manage_scopes', { p_auth_user_id: U.stranger }), await call('customer_manage_scopes', { p_auth_user_id: U.gm }), await call('customer_manage_scopes', { p_auth_user_id: U.owner })].every((s) => s.ok === true && s.organizations.length === 0 && s.departments.length === 0))
  check('a head whose grant was revoked has no scope left', same((await call('customer_manage_scopes', { p_auth_user_id: U.head })).departments, []))
}

// ------------------------------------------------------------------ the organization row lock
console.log('\nthe organization row lock: every function that changes something takes it before deciding')
{
  // After SELECT ... FOR UPDATE inside a transaction the row's xmax is that transaction. A REFUSED call writes nothing, so only the
  // explicit lock can have set it; the read-only functions are the control (they must leave it unset).
  const lockedBy = async (org, fn) => {
    await db.exec('begin')
    try { const answer = await fn(); const row = await one(`select (xmax::text::bigint <> 0 and xmax::text = (txid_current() % 4294967296)::text) locked from public.customer_organizations where id = $1`, [org]); return { answer, locked: row.locked } }
    finally { await db.exec('rollback') }
  }
  const head2Grant = (await one(`select g.id from public.customer_access_grants g join public.customer_principals p on p.id = g.principal_id where p.auth_user_id = $1 and g.revoked_at is null`, [U.head2])).id
  const orgOfHead2 = (await one(`select organization_id o from public.customer_access_grants where id = $1`, [head2Grant])).o
  const openInv = await fresh(dOffice, 'head2')
  const cases = [
    ['customer_org_update', org1, () => updateOrg('stranger', org1, { name: 'X' })],
    ['customer_department_create', org1, () => createDept('stranger', org1, 'X')],
    ['customer_department_update', org1, () => updateDept('stranger', org1, dOffice, { name: 'X' })],
    ['customer_invitation_create', org1, () => invite('stranger', org1, dOffice, 'forwarded')],
    ['customer_invitation_revoke', org1, () => call('customer_invitation_revoke', { p_actor_auth_user_id: U.stranger, p_invitation_id: openInv.id, p_reason: null })],
    ['customer_invitation_accept', org1, () => call('customer_invitation_accept', { p_token_digest: openInv.token, p_auth_user_id: U.owner, p_recipient_digest: R.head2 })],
    ['customer_department_head_revoke', orgOfHead2, () => call('customer_department_head_revoke', { p_actor_auth_user_id: U.stranger, p_grant_id: head2Grant, p_reason: null })],
  ]
  for (const [name, org, fn] of cases) {
    const lock = await lockedBy(org, fn)
    check(`${name}: a refused call still held the organization row lock`, denied(lock.answer) && lock.locked === true, JSON.stringify(lock))
  }
  for (const [name, fn] of [['customer_org_manage_check', () => manage('stranger', org1)], ['customer_invitation_peek', () => peek(openInv.token, 'forwarded')], ['customer_org_detail', () => call('customer_org_detail', { p_actor_auth_user_id: U.stranger, p_organization_id: org1 })]]) {
    const lock = await lockedBy(org1, fn)
    check(`CONTROL: ${name} (read only) takes no lock, so the probe is not always true`, denied(lock.answer) && lock.locked === false, JSON.stringify(lock))
  }
  const sources = await all(`select p.proname, p.prosrc from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = any($1)`, [CHANGING])
  const order = sources.map((f) => {
    const lock = f.prosrc.search(/from public\.customer_organizations o where o\.id = [\w.]+ for update/)
    const decide = f.prosrc.indexOf('customer_org_manage_check(')
    const firstWrite = f.prosrc.search(/\b(insert into|update public\.)/)
    return { name: f.proname, ok: lock > 0 && decide > lock && firstWrite > lock }
  })
  check('in the source of all seven, the organization lock comes before the authority decision and before the first write', order.length === 7 && order.every((o) => o.ok), JSON.stringify(order.filter((o) => !o.ok)))
  await call('customer_invitation_revoke', { p_actor_auth_user_id: U.owner, p_invitation_id: openInv.id, p_reason: null })
}

// ------------------------------------------------------------------ nobody became staff
console.log('\nnobody became staff, and no account was created')
check('no staff row and no auth user was created, changed or removed by any of the above', await count(`select count(*) n from public.staff`) === staffCount && await count(`select count(*) n from auth.users`) === authCount)
check('no department head or organization administrator has a staff row', await count(`select count(*) n from public.staff where auth_user_id = any($1)`, [[U.head, U.head2, U.orgAdmin, U.otherAdmin, U.lateAdmin, U.forwarded]]) === 0)
const isOpAs = async (authUser) => { await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [authUser]); try { return await as('authenticated', async () => (await one(`select public.is_op() v`)).v) } finally { await db.query(`select set_config('request.jwt.claim.sub', '', false)`) } }
check('the existing owner predicate (public.is_op) still says yes for the owner and no for a head and an administrator', await isOpAs(U.owner) === true && await isOpAs(U.head2) === false && await isOpAs(U.orgAdmin) === false)
check('every principal created by an acceptance has no member and is active; none was created for a refused attempt', same(await all(`select p.auth_user_id, p.state, p.member_id from public.customer_principals p where p.auth_user_id = any($1) order by 1`, [[U.head, U.head2, U.forwarded, U.stranger]]),
  [U.head, U.head2].sort().map((id) => ({ auth_user_id: id, state: 'active', member_id: null }))))
check('every audit row of this slice is in exactly one scope and carries no address, digest or token', (await all(`select business_id, organization_id, detail::text d from public.customer_identity_audit`)).every((r) => (r.business_id === null) !== (r.organization_id === null) && !/example\.test|[0-9a-f]{64}/.test(r.d)))

// ------------------------------------------------------------------ open decision D1 (2026-11-13, Opus continuation): consequences
// Fable extended the zero-live-administrator bootstrap condition to managing an organization and its invitations. These checks do
// not approve that reading; they pin down what it means today so Codex reviews the real behaviour, and so a later change to it is
// a visible decision. They run after the "nobody became staff" counts on purpose (they add synthetic auth users).
console.log('\nunder review (D1): setup authority while an organization has no administrator, with two businesses sharing it')
{
  for (const who of ['d1Head', 'd1Head2', 'd1Head3', 'd1Admin']) U[who] = await user()
  for (const who of ['d1Head', 'd1Head2', 'd1Head3']) { mail[who] = `${who.toLowerCase()}@example.test`; R[who] = digest(`recipient:${mail[who]}`) }
  const pAdmin = await principal(U.d1Admin)
  const org = (await createOrg('owner', b1, 'D1 Shared')).organization_id
  const agreementB = (await one(`insert into public.customer_business_orgs (business_id, organization_id, state) values ($1, $2, 'active') returning id`, [b2, org])).id
  const dept = (await createDept('owner', org, 'Front')).department_id
  const invA = await invite('owner', org, dept, 'd1Head')
  const headA = await accept(await tokenOf(invA.invitation_id), 'd1Head')
  const invA3 = await invite('owner', org, dept, 'd1Head3')
  const headA3 = await accept(await tokenOf(invA3.invitation_id), 'd1Head3')
  const invA2 = await invite('owner', org, dept, 'd1Head2')
  check('setup world: Sarcafe made the organization, a department and two heads; the other business has an active agreement too', !!org && !!dept && headA.ok === true && headA3.ok === true && invA2.ok === true)

  const revokedByB = await call('customer_invitation_revoke', { p_actor_auth_user_id: U.b2Admin, p_invitation_id: invA2.invitation_id, p_reason: 'other business' })
  check('CONSEQUENCE: in setup the OTHER sharing business revokes an invitation Sarcafe issued (audited with that business as the setup business)', revokedByB.status === 'revoked'
    && (await lastAudit('invitation.revoke')).detail.setup_business_id === b2 && (await lastAudit('invitation.revoke')).detail.actor_via === 'setup')
  const endedByB = await call('customer_department_head_revoke', { p_actor_auth_user_id: U.b2Admin, p_grant_id: headA.grant_id, p_reason: 'other business' })
  check('CONSEQUENCE: in setup the other sharing business ends a department head Sarcafe invited', endedByB.status === 'revoked' && (await access('d1Head', 'department_head', { org, dept })).ok !== true)
  check('CONSEQUENCE: in setup the other sharing business switches the shared organization off and on (switching off ends its open invitations)', (await updateOrg('b2Admin', org, { state: 'inactive' })).status === 'updated'
    && (await lastAudit('organization.update')).detail.setup_business_id === b2 && (await updateOrg('b2Admin', org, { state: 'active' })).status === 'updated')

  const invB = await invite('b2Admin', org, dept, 'd1Head2')
  const tokenB = await tokenOf(invB.invitation_id)
  check('the other business issues an invitation in setup and its recipient can see it', invB.ok === true && (await peek(tokenB, 'd1Head2')).ok === true)
  await db.query(`update public.customer_business_orgs set state = 'suspended' where id = $1`, [agreementB])
  check('a SUSPENDED agreement gives no setup authority, and the invitation that business issued stops working at once', denied(await manage('b2Admin', org)) && denied(await peek(tokenB, 'd1Head2')) && (await manage('owner', org)).via === 'setup')
  await db.query(`update public.customer_business_orgs set state = 'active' where id = $1`, [agreementB])
  check('back to active: the same invitation can be seen again (it was never revoked, only unusable)', (await peek(tokenB, 'd1Head2')).ok === true)

  const appointed = await bootstrap('b2Admin', org, pAdmin)
  check('the other business appoints the first administrator (the foundation rule)', appointed.ok === true)
  check('SETUP ENDS FOR BOTH businesses at that moment, and the invitation issued in setup is UNUSABLE while an administrator exists (not revoked)', denied(await manage('owner', org, true)) && denied(await manage('b2Admin', org, true))
    && denied(await peek(tokenB, 'd1Head2')) && denied(await accept(tokenB, 'd1Head2')) && (await one(`select revoked_at, consumed_at from public.customer_invitations where id = $1`, [invB.invitation_id])).revoked_at === null)
  check('a head who accepted DURING setup keeps the department after the bootstrap (setup-era grants are not undone)', (await access('d1Head3', 'department_head', { org, dept })).ok === true)
  check('the new administrator can end that setup-era head; neither business can any more', denied(await call('customer_department_head_revoke', { p_actor_auth_user_id: U.owner, p_grant_id: headA3.grant_id, p_reason: null }))
    && denied(await call('customer_department_head_revoke', { p_actor_auth_user_id: U.b2Admin, p_grant_id: headA3.grant_id, p_reason: null }))
    && (await call('customer_department_head_revoke', { p_actor_auth_user_id: U.d1Admin, p_grant_id: headA3.grant_id, p_reason: null })).status === 'revoked')
  // Codex, 2026-11-13 (D1 decided): invitations are checked against the issuer's CURRENT authority. Appointment does not revoke
  // them; if the last administrator is revoked before they expire, setup returns and they are usable again. Kept, not changed.
  const adminGrant = (await one(`select id from public.customer_access_grants where principal_id = $1 and organization_id = $2 and capability = 'organization_admin' and revoked_at is null`, [pAdmin, org])).id
  const ended = await call('customer_access_revoke', { p_actor_auth_user_id: U.d1Admin, p_grant_id: adminGrant, p_reason: 'synthetic: last administrator leaves' })
  check('LIFECYCLE: after the last administrator is revoked, setup returns and the same unexpired setup invitation is usable again', ended.ok === true
    && (await manage('owner', org)).via === 'setup' && (await peek(tokenB, 'd1Head2')).ok === true)
  check('no D1 step created a staff row', await count(`select count(*) n from public.staff`) === staffCount)
}

// ------------------------------------------------------------------ review R2 (Codex, 2026-11-13): switching an organization off
// must not lose it. Its live administrator still finds it (with its state) and can switch it back on, after any reload; a head of
// one of its departments has nothing while it is off; nobody else can see or reactivate it.
console.log('\nreview R2: a switched-off organization stays with its administrator, who can switch it back on')
{
  for (const who of ['r2Admin', 'r2Head', 'r2Late', 'r2Gone']) U[who] = await user()
  for (const who of ['r2Head', 'r2Late']) { mail[who] = `${who.toLowerCase()}@example.test`; R[who] = digest(`recipient:${mail[who]}`) }
  const pR2 = await principal(U.r2Admin)
  const pGone = await principal(U.r2Gone)
  const orgA = (await createOrg('owner', b1, 'R2 Alpha')).organization_id
  const orgB = (await createOrg('owner', b1, 'R2 Beta')).organization_id
  const deptA = (await createDept('owner', orgA, 'Floor')).department_id
  const headInv = await invite('owner', orgA, deptA, 'r2Head')
  const head = await accept(await tokenOf(headInv.invitation_id), 'r2Head')
  const madeA = await bootstrap('owner', orgA, pR2)
  const madeB = await bootstrap('owner', orgB, pR2)
  check('R2 world: one administrator of two organizations; a head in the first', !!orgA && !!orgB && head.ok === true && madeA.ok === true && madeB.ok === true)
  const scopes = (who) => call('customer_manage_scopes', { p_auth_user_id: U[who] })
  const states = async (who) => (await scopes(who)).organizations.map((o) => [o.name, o.state])
  const stateOf = async (org) => (await one(`select state from public.customer_organizations where id = $1`, [org])).state
  check('before: both organizations are listed for the administrator, each with its state', same(await states('r2Admin'), [['R2 Alpha', 'active'], ['R2 Beta', 'active']]))
  check('before: the head sees their department', (await scopes('r2Head')).departments.length === 1)

  // one organization: off, read again (a reload reads the same function), still there, then on again
  const late = await invite('r2Admin', orgA, deptA, 'r2Late')
  const lateToken = await tokenOf(late.invitation_id)
  check('the administrator switches organization Alpha off', (await updateOrg('r2Admin', orgA, { state: 'inactive' })).status === 'updated' && await stateOf(orgA) === 'inactive')
  check('REGRESSION R2: Alpha is STILL listed for its administrator, marked inactive, on every fresh read; Beta is unchanged', same(await states('r2Admin'), [['R2 Beta', 'active'], ['R2 Alpha', 'inactive']])
    && same(await states('r2Admin'), [['R2 Beta', 'active'], ['R2 Alpha', 'inactive']]))
  const detail = await call('customer_org_detail', { p_actor_auth_user_id: U.r2Admin, p_organization_id: orgA })
  check('its administrator may open it (state shown as inactive) but not work in it: no new department, no invitation', detail.ok === true && detail.organization.state === 'inactive' && detail.via === 'organization_admin'
    && denied(await manage('r2Admin', orgA)) && denied(await createDept('r2Admin', orgA, 'Not now')) && denied(await invite('r2Admin', orgA, deptA, 'r2Late')))
  check('while it is off, the head of its department has no scope and no access', same((await scopes('r2Head')).departments, []) && (await access('r2Head', 'department_head', { org: orgA, dept: deptA })).ok !== true)
  check('while it is off, the invitation that was open is ended and can be neither seen nor accepted', denied(await peek(lateToken, 'r2Late')) && denied(await accept(lateToken, 'r2Late')))
  const outsiders = ['owner', 'stranger', 'gm', 'b2Admin', 'orgAdmin', 'r2Head']
  const theirs = await Promise.all(outsiders.map(async (who) => (await scopes(who)).organizations.some((o) => o.organization_id === orgA)))
  check('nobody else lists it: the owner (setup ended with the administrator), a stranger, a general manager, another business, another organization\'s administrator, its own head', theirs.every((x) => x === false), JSON.stringify(theirs))
  const tries = []
  for (const who of outsiders) tries.push(await updateOrg(who, orgA, { state: 'active' }))
  check('and nobody else can switch it back on (one answer each); it is still off', tries.every(denied) && await stateOf(orgA) === 'inactive', JSON.stringify(tries))
  check('the administrator switches it back on', (await updateOrg('r2Admin', orgA, { state: 'active' })).status === 'updated' && await stateOf(orgA) === 'active'
    && (await lastAudit('organization.update')).detail.actor_via === 'organization_admin' && (await lastAudit('organization.update')).detail.state_to === 'active')
  check('after reactivation: both listed active; the head\'s kept grant works again; the invitation ended by the switch-off stays ended', same(await states('r2Admin'), [['R2 Alpha', 'active'], ['R2 Beta', 'active']])
    && (await scopes('r2Head')).departments.length === 1 && (await access('r2Head', 'department_head', { org: orgA, dept: deptA })).ok === true && denied(await peek(lateToken, 'r2Late')))

  // several organizations: both off, then on again one at a time
  check('both organizations switched off', (await updateOrg('r2Admin', orgA, { state: 'inactive' })).status === 'updated' && (await updateOrg('r2Admin', orgB, { state: 'inactive' })).status === 'updated')
  check('both are still listed, each marked inactive', same(await states('r2Admin'), [['R2 Alpha', 'inactive'], ['R2 Beta', 'inactive']]))
  check('Beta back on: Beta active, Alpha still listed and inactive', (await updateOrg('r2Admin', orgB, { state: 'active' })).status === 'updated' && same(await states('r2Admin'), [['R2 Beta', 'active'], ['R2 Alpha', 'inactive']]))
  check('Alpha back on: both active again', (await updateOrg('r2Admin', orgA, { state: 'active' })).status === 'updated' && same(await states('r2Admin'), [['R2 Alpha', 'active'], ['R2 Beta', 'active']]))

  // only a LIVE administrator: a revoked, expired or switched-off administrator does not find the inactive organization
  await db.query(`insert into public.customer_access_grants (principal_id, capability, scope_kind, organization_id) values ($1, 'organization_admin', 'organization', $2)`, [pGone, orgB])
  await updateOrg('r2Admin', orgB, { state: 'inactive' })
  check('a second live administrator also finds the switched-off organization', same((await scopes('r2Gone')).organizations.map((o) => [o.name, o.state]), [['R2 Beta', 'inactive']]))
  await db.query(`update public.customer_access_grants set expires_at = now() - interval '1 minute' where principal_id = $1`, [pGone])
  const expired = (await scopes('r2Gone')).organizations.length
  await db.query(`update public.customer_access_grants set expires_at = null, revoked_at = now(), revoked_reason = 'synthetic' where principal_id = $1`, [pGone])
  const revoked = (await scopes('r2Gone')).organizations.length
  check('an expired or revoked administrator no longer lists it, and cannot switch it on', expired === 0 && revoked === 0 && denied(await updateOrg('r2Gone', orgB, { state: 'active' })) && await stateOf(orgB) === 'inactive')
  await db.query(`update public.customer_principals set state = 'revoked' where id = $1`, [pR2])
  check('an administrator whose principal is switched off lists nothing and changes nothing', (await scopes('r2Admin')).organizations.length === 0 && denied(await updateOrg('r2Admin', orgB, { state: 'active' })) && await stateOf(orgB) === 'inactive')
  check('no R2 step created a staff row', await count(`select count(*) n from public.staff`) === staffCount)
}

console.log(`\n${passed} passed, ${failed.length} failed`)
if (failed.length) { console.log('FAILED:\n - ' + failed.join('\n - ')); process.exit(1) }
