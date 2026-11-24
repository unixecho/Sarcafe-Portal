// Local database check for FABLE-004 (20261124084601_customer_identity_verification.sql): revocable QR credentials for approved employees, scanner grants for Sarcafe staff,
// and verification with a human photo comparison. Every migration is applied in order to an in-memory Postgres (PGlite), the new one
// is re-applied, and its functions are attacked as the service role in a synthetic world: two businesses, an organization with an
// active agreement and one without, approved / pending / deactivated employees, an owner, staff with and without a scanner grant,
// strangers. Expired, superseded, stale-version, wrong-business, wrong-branch, another operator, replay, decisions and the rows' own
// rules, RLS and browser denial. Nothing here touches production; every person and id is made up.
//
//   node scripts/verify-identity-verification-sql.mjs

import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrationFiles, openIdentityDb } from './lib/identity-pglite.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const PREVIOUS = '20261124074218_customer_employee_registration.sql'
const NEW = '20261124084601_customer_identity_verification.sql'
const TABLES = ['customer_credentials', 'customer_scanner_grants', 'customer_verifications']
const FUNCTIONS = [
  'customer_scanner_check(uuid,uuid,uuid)', 'customer_scanner_scope(uuid,uuid)', 'customer_scanner_list(uuid,uuid)', 'customer_scanner_grant(uuid,uuid,uuid,uuid)', 'customer_scanner_revoke(uuid,uuid)',
  'customer_credential_issue(uuid,uuid,text,timestamptz)', 'customer_credential_revoke(uuid,uuid)',
  'customer_verification_scan(uuid,uuid,uuid,text)', 'customer_verification_photo(uuid,uuid)', 'customer_verification_decide(uuid,uuid,text)',
]
const TRIGGER_FUNCTIONS = ['customer_revoked_final', 'customer_verifications_final']

let passed = 0
const failed = []
const check = (name, okay, detail = '') => { if (okay) { passed++; console.log(`  ✓ ${name}`) } else { failed.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) } }
const section = (title) => console.log(`\n${title}`)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const err = (answer, code) => !!answer && answer.ok === false && answer.error === code
const denied = (answer) => err(answer, 'denied') && Object.keys(answer).filter((k) => k !== 'digest').length === 2
const hex = () => randomBytes(32).toString('hex')

section('migration')
const before = {}
let opened
try {
  // only up to THIS migration: what it adds is measured exactly, also when later identity migrations exist
  opened = await openIdentityDb(root, {
    upTo: NEW,
    onFile: async (file, db) => {
      if (file !== NEW) return
      before.tables = (await db.query(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`)).rows.map((r) => r.relname)
      before.functions = (await db.query(`select p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' order by 1`)).rows.map((r) => r.proname)
      before.identity = (await db.query(`select p.proname, md5(p.prosrc) body, pg_get_function_identity_arguments(p.oid) a, p.proacl::text acl from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'customer\\_%' order by 1, 3`)).rows
      before.grants = (await db.query(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name like 'customer\\_%' order by 1, 2, 3`)).rows
      before.columns = (await db.query(`select table_name, column_name, data_type from information_schema.columns where table_schema = 'public' and table_name like 'customer\\_%' order by 1, 2`)).rows
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
const call = (fn, args) => as('service_role', async () => (await one(`select public.${fn}(${Object.keys(args).map((key, i) => `${key} => $${i + 1}`).join(', ')}) r`, Object.values(args))).r)

check('all migrations apply in order', true)
// the later identity migrations that may follow it (each has its own verifier); nothing else may come after
const LATER = []
const everyFile = migrationFiles(root)
check('the new migration comes right after FABLE-003, and only the known later identity migrations follow it', files[files.length - 1] === NEW && files[files.length - 2] === PREVIOUS && JSON.stringify(everyFile.slice(everyFile.indexOf(NEW) + 1)) === JSON.stringify(LATER), everyFile.slice(everyFile.indexOf(PREVIOUS)).join(', '))
const snapshot = async () => JSON.stringify({
  columns: await all(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name like 'customer\\_%' order by 1, 2`),
  constraints: await all(`select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) d from pg_constraint where conrelid::regclass::text like '%customer\\_%' order by 1, 2`),
  indexes: await all(`select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename like 'customer\\_%' order by 1`),
  triggers: await all(`select tgrelid::regclass::text t, tgname from pg_trigger where not tgisinternal and tgrelid::regclass::text like '%customer\\_%' order by 1, 2`),
  functions: await all(`select p.proname, pg_get_function_identity_arguments(p.oid) a, md5(p.prosrc) body, p.proacl::text acl from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'customer\\_%' order by 1, 2`),
  grants: await all(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name like 'customer\\_%' order by 1, 2, 3`),
  rows: await count(`select (select count(*) from public.customer_credentials) + (select count(*) from public.customer_scanner_grants) + (select count(*) from public.customer_verifications) n`),
})
const first = await snapshot()
const sqlText = readFileSync(path.join(root, 'supabase/migrations', NEW), 'utf8')
await db.exec(sqlText); const second = await snapshot(); await db.exec(sqlText)
check('re-applying the new migration twice changes nothing', first === second && second === await snapshot())
const tablesNow = (await all(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`)).map((r) => r.relname)
check('it added exactly three tables', same(tablesNow.filter((t) => !before.tables.includes(t)), TABLES), tablesNow.filter((t) => !before.tables.includes(t)).join(', '))
const functionsNow = (await all(`select p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' order by 1`)).map((r) => r.proname)
check('it added exactly twelve functions: ten callable and two trigger functions', same(functionsNow.filter((f) => !before.functions.includes(f)), [...FUNCTIONS.map((f) => f.split('(')[0]), ...TRIGGER_FUNCTIONS].sort()), functionsNow.filter((f) => !before.functions.includes(f)).join(', '))
check('every earlier identity function is byte for byte what it was', same(await all(`select p.proname, md5(p.prosrc) body, pg_get_function_identity_arguments(p.oid) a, p.proacl::text acl from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'customer\\_%' and p.proname <> all($1) order by 1, 3`, [[...FUNCTIONS.map((f) => f.split('(')[0]), ...TRIGGER_FUNCTIONS]]), before.identity))
check('no earlier identity table gained a column or changed a privilege', same(await all(`select table_name, column_name, data_type from information_schema.columns where table_schema = 'public' and table_name like 'customer\\_%' and table_name <> all($1) order by 1, 2`, [TABLES]), before.columns)
  && same(await all(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name like 'customer\\_%' and table_name <> all($1) order by 1, 2, 3`, [TABLES]), before.grants))
const code = sqlText.replace(/^\s*--.*$/gm, '')
check('the migration never writes staff, auth, POS or the waitlist (staff is only read)', !/insert\s+into\s+(public\.)?(staff|customer_waitlist|pos_)|insert\s+into\s+auth\.|update\s+(public\.)?(staff|pos_|customer_waitlist)\b|alter\s+table\s+(public\.)?(staff|branches|customer_waitlist)\b|delete\s+from/i.test(code))
check('nobody can scan until an owner grants it (no row is seeded)', await count(`select count(*) n from public.customer_scanner_grants`) === 0)

section('privileges')
const rls = await all(`select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = any($1)`, [TABLES])
check('RLS on all three', rls.length === 3 && rls.every((r) => r.relrowsecurity))
check('browser roles hold nothing on them', (await all(`select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = any($1) and grantee in ('anon', 'authenticated', 'public')`, [TABLES])).length === 0)
const service = await all(`select table_name, string_agg(privilege_type, ',' order by privilege_type) p from information_schema.role_table_grants where table_schema = 'public' and table_name = any($1) and grantee = 'service_role' group by 1 order by 1`, [TABLES])
check('the service role: select / insert / update, never delete', same(service.map((r) => r.p), ['INSERT,SELECT,UPDATE', 'INSERT,SELECT,UPDATE', 'INSERT,SELECT,UPDATE']), JSON.stringify(service))
for (const fn of FUNCTIONS) {
  const ok = await one(`select has_function_privilege('service_role', $1, 'execute') s, has_function_privilege('authenticated', $1, 'execute') a, has_function_privilege('anon', $1, 'execute') n`, [`public.${fn}`])
  check(`${fn.split('(')[0]}: service role only`, ok.s && !ok.a && !ok.n)
}
check('no function name has two signatures', await count(`select count(*) n from (select proname from pg_proc p where p.pronamespace = 'public'::regnamespace and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') group by proname having count(*) > 1) t`) === 0)
for (const role of ['anon', 'authenticated']) {
  const m = await as(role, () => failure(`select * from public.customer_credentials`))
  check(`${role} cannot read credentials`, /permission denied/.test(m), m || 'it could')
  const e = await as(role, () => failure(`select public.customer_verification_scan(null, null, null, null)`))
  check(`${role} cannot scan`, /permission denied/.test(e), e || 'it could')
}

section('the synthetic world')
const U = Object.fromEntries(['owner', 'gm', 'cashier', 'cashier2', 'plainStaff', 'codeOnly', 'emp', 'empPending', 'empOther', 'head', 'stranger'].map((k) => [k, randomUUID()]))
for (const v of Object.values(U)) await db.query(`insert into auth.users (id) values ($1)`, [v])
const staffRow = async (who, role = 'staff', badge = null, active = true) => (await one(`insert into public.staff (id, auth_user_id, first_name, role, badge, active) values (gen_random_uuid(), $1, $2, $3, $4, $5) returning id`, [U[who], who, role, badge, active])).id
const S = { owner: await staffRow('owner', 'owner'), gm: await staffRow('gm', 'staff', 'general_manager'), cashier: await staffRow('cashier'), cashier2: await staffRow('cashier2'), plainStaff: await staffRow('plainStaff') }
const codeOnly = (await one(`insert into public.staff (id, auth_user_id, first_name, role, active) values (gen_random_uuid(), null, 'code', 'staff', true) returning id`)).id
const sarcafe = (await one(`select id from public.customer_businesses where slug = 'sarcafe'`)).id
const branchA = (await one(`insert into public.branches (slug, name) values ('qa-a', '{"he":"סניף א"}') returning id`)).id
const branchB = (await one(`insert into public.branches (slug, name) values ('qa-b', '{"he":"סניף ב"}') returning id`)).id
await db.query(`insert into public.customer_business_branches (business_id, branch_id) values ($1, $2), ($1, $3)`, [sarcafe, branchA, branchB])
const other = (await one(`insert into public.customer_businesses (slug, name) values ('other-cafe', 'Other') returning id`)).id
const branchO = (await one(`insert into public.branches (slug, name) values ('qa-o', '{"he":"אחר"}') returning id`)).id
await db.query(`insert into public.customer_business_branches (business_id, branch_id) values ($1, $2)`, [other, branchO])
const org = (await one(`insert into public.customer_organizations (slug, name) values ('qa-org', 'Alpha') returning id`)).id
const orgNoDeal = (await one(`insert into public.customer_organizations (slug, name) values ('qa-org2', 'Beta') returning id`)).id
const agreement = (await one(`insert into public.customer_business_orgs (business_id, organization_id, state) values ($1, $2, 'active') returning id`, [sarcafe, org])).id
await db.query(`insert into public.customer_business_orgs (business_id, organization_id, state) values ($1, $2, 'draft')`, [sarcafe, orgNoDeal])
const dept = (await one(`insert into public.customer_departments (organization_id, name) values ($1, 'Kitchen') returning id`, [org])).id
const dept2 = (await one(`insert into public.customer_departments (organization_id, name) values ($1, 'Other') returning id`, [orgNoDeal])).id
// employees: an approved one with an approved photo, a pending one, and one of an organization without an ACTIVE agreement
const employee = async (who, organization, department, state) => {
  const member = (await one(`insert into public.customer_members default values returning id`)).id
  const principal = (await one(`insert into public.customer_principals (auth_user_id, member_id) values ($1, $2) returning id`, [U[who], member])).id
  const m = (await one(`insert into public.customer_org_memberships (member_id, organization_id, department_id, state, reviewed_at) values ($1, $2, $3, $4, case when $4 = 'pending' then null else now() end) returning id`, [member, organization, department, state])).id
  await db.query(`insert into public.customer_member_profiles (membership_id, organization_id, applicant_principal_id, first_name, last_name, nickname) values ($1, $2, $3, 'דנה', 'בדיקה', 'דני')`, [m, organization, principal])
  const photo = randomUUID()
  await db.query(`insert into public.customer_member_photos (id, organization_id, membership_id, uploaded_by_auth_user_id, object_path, state, width, height, byte_size, sha256) values ($1, $2, $3, $4, $5, $6, 600, 800, 1000, $7)`,
    [photo, organization, m, U[who], `org/${organization}/${photo}.jpg`, state === 'pending' ? 'pending' : 'approved', hex()])
  return m
}
const M = { emp: await employee('emp', org, dept, 'approved'), empPending: await employee('empPending', org, dept, 'pending'), empOther: await employee('empOther', orgNoDeal, dept2, 'approved') }
check('two businesses, three branches, two organizations (one with an ACTIVE agreement), staff, employees', true)

section('scanner grants (owner) and the scanner rule')
const grant = (who, staff, branch) => call('customer_scanner_grant', { p_actor_auth_user_id: U[who], p_business_id: sarcafe, p_staff_id: staff, p_branch_id: branch })
const scanCheck = (who, business, branch) => call('customer_scanner_check', { p_auth_user_id: U[who], p_business_id: business, p_branch_id: branch })
check('before any grant, no staff member scans (an owner, a general manager, a cashier)', denied(await scanCheck('owner', sarcafe, branchA)) && denied(await scanCheck('gm', sarcafe, branchA)) && denied(await scanCheck('cashier', sarcafe, branchA)))
for (const [label, who] of [['a general manager', 'gm'], ['a cashier', 'cashier'], ['an employee of an organization', 'emp'], ['a stranger', 'stranger']]) check(`refused: ${label} grants scanner access`, denied(await grant(who, S.cashier, null)))
check('nobody grants to themselves (the owner)', denied(await grant('owner', S.owner, null)))
check('an inactive staff member or one without an account cannot be given access', denied(await grant('owner', codeOnly, null)))
check('a branch of another business is refused', denied(await grant('owner', S.cashier, branchO)))
check('a business that is not the legacy one (its staff are not Sarcafe\'s) is refused', denied(await call('customer_scanner_grant', { p_actor_auth_user_id: U.owner, p_business_id: other, p_staff_id: S.cashier, p_branch_id: null })))
const g1 = await grant('owner', S.cashier, null)
check('the owner gives a cashier access to every branch; again is "unchanged"', g1.status === 'created' && (await grant('owner', S.cashier, null)).status === 'unchanged')
const g2 = await grant('owner', S.cashier2, branchA)
check('…and another cashier access to one branch', g2.status === 'created')
check('the cashier scans at both branches; the second cashier at branch A only', (await scanCheck('cashier', sarcafe, branchA)).ok && (await scanCheck('cashier', sarcafe, branchB)).ok && (await scanCheck('cashier2', sarcafe, branchA)).ok && denied(await scanCheck('cashier2', sarcafe, branchB)))
check('a branch that is not the business\'s is refused even for a full grant', denied(await scanCheck('cashier', sarcafe, branchO)) && denied(await scanCheck('cashier', other, branchO)))
const scope = await call('customer_scanner_scope', { p_auth_user_id: U.cashier, p_business_id: sarcafe })
check('the cashier\'s scope lists every branch of the business with its name (the two seeded ones and the two made here)', scope.branches.length === 4 && ['סניף א', 'סניף ב'].every((n) => scope.branches.some((b) => b.name === n)) && scope.branches.every((b) => b.name))
check('a staff member without a grant has no scope', denied(await call('customer_scanner_scope', { p_auth_user_id: U.plainStaff, p_business_id: sarcafe })))
const listed = await call('customer_scanner_list', { p_actor_auth_user_id: U.owner, p_business_id: sarcafe })
check('the owner lists active staff with accounts and their grants (no code-only staff)', listed.ok && listed.staff.some((s) => s.staff_id === S.cashier && s.grants.length === 1) && !listed.staff.some((s) => s.staff_id === codeOnly))
check('nobody else lists them', denied(await call('customer_scanner_list', { p_actor_auth_user_id: U.gm, p_business_id: sarcafe })) && denied(await call('customer_scanner_list', { p_actor_auth_user_id: U.cashier, p_business_id: sarcafe })))
await db.query(`update public.staff set active = false where id = $1`, [S.cashier2])
check('a switched-off staff member stops scanning at once (the grant is checked against the live staff row)', denied(await scanCheck('cashier2', sarcafe, branchA)))
await db.query(`update public.staff set active = true where id = $1`, [S.cashier2])

section('the employee\'s card (customer_credential_issue)')
const card = (who, membership, digest = hex(), minutes = 15) => call('customer_credential_issue', { p_auth_user_id: U[who], p_membership_id: membership, p_token_digest: digest, p_expires_at: new Date(Date.now() + minutes * 60_000).toISOString() }).then((r) => ({ ...r, digest }))
const c1 = await card('emp', M.emp)
check('an approved employee gets a card for their own membership', c1.ok && c1.status === 'created')
check('another person cannot make a card of it', denied(await card('stranger', M.emp)) && denied(await card('head', M.emp)))
check('a pending application gets no card', denied(await card('empPending', M.empPending)))
check('at most a day; a past expiry and a malformed digest are bad requests', err(await card('emp', M.emp, hex(), 60 * 25), 'bad_request') && err(await card('emp', M.emp, hex(), -1), 'bad_request') && err(await card('emp', M.emp, 'xyz'), 'bad_request'))
check('the card row holds the digest, the membership and its version; no token column', same((await all(`select column_name from information_schema.columns where table_name = 'customer_credentials' order by 1`)).map((r) => r.column_name).filter((c) => /token/.test(c)), ['token_digest'])
  && (await one(`select membership_version from public.customer_credentials where token_digest = $1`, [c1.digest])).membership_version === 1)

section('verification (scan, photo, decide)')
const scan = (who, digest, branch = branchA, business = sarcafe) => call('customer_verification_scan', { p_actor_auth_user_id: U[who], p_business_id: business, p_branch_id: branch, p_token_digest: digest })
const deny0 = await count(`select count(*) n from public.customer_identity_audit where operation = 'verification.deny'`)
for (const [label, who, digest, branch] of [['a staff member without a grant', 'plainStaff', c1.digest, branchA], ['the owner (no grant)', 'owner', c1.digest, branchA], ['the second cashier at a branch outside their grant', 'cashier2', c1.digest, branchB], ['an unknown card', 'cashier', hex(), branchA]]) {
  check(`refused: ${label}`, denied(await scan(who, digest, branch)))
}
check('a refused scan by an operator is in the audit (ids of the operator only, nothing about the card)', await count(`select count(*) n from public.customer_identity_audit where operation = 'verification.deny'`) === deny0 + 1
  && !/membership|credential/.test((await one(`select detail::text d from public.customer_identity_audit where operation = 'verification.deny' order by at desc limit 1`)).d))
const v1 = await scan('cashier', c1.digest)
check('the cashier scans the card: a pending verification and the minimum to show', v1.ok && v1.first_name === 'דנה' && v1.organization_name === 'Alpha' && v1.department_name === 'Kitchen' && !('membership_id' in v1) && !('object_path' in v1))
check('the verification is bound to the operator, the business, the branch, the card and the membership version', !!(await one(`select 1 x from public.customer_verifications where id = $1 and actor_auth_user_id = $2 and business_id = $3 and branch_id = $4 and membership_version = 1 and state = 'pending' and expires_at <= now() + interval '2 minutes 1 second'`, [v1.verification_id, U.cashier, sarcafe, branchA])))
const vp = (who, v) => call('customer_verification_photo', { p_actor_auth_user_id: U[who], p_verification_id: v })
check('the operator reads the approved photo of the open verification (audited)', (await vp('cashier', v1.verification_id)).ok && await count(`select count(*) n from public.customer_identity_audit where operation = 'photo.read' and actor_auth_user_id = $1`, [U.cashier]) === 1)
check('another operator cannot read it, nor the employee, nor the owner', denied(await vp('cashier2', v1.verification_id)) && denied(await vp('emp', v1.verification_id)) && denied(await vp('owner', v1.verification_id)))
const decideV = (who, v, decision) => call('customer_verification_decide', { p_actor_auth_user_id: U[who], p_verification_id: v, p_decision: decision })
check('another operator cannot decide it', denied(await decideV('cashier2', v1.verification_id, 'match')))
check('an unknown decision is a bad request', err(await decideV('cashier', v1.verification_id, 'approve'), 'bad_request'))
const matched = await decideV('cashier', v1.verification_id, 'match')
check('the operator matches: matched, valid five minutes for one redemption', matched.status === 'matched' && !!(await one(`select 1 x from public.customer_verifications where id = $1 and state = 'matched' and expires_at <= now() + interval '5 minutes 1 second'`, [v1.verification_id])))
check('a decided verification is not decided again', err(await decideV('cashier', v1.verification_id, 'mismatch'), 'conflict'))
check('a decided verification\'s photo is not shown any more', denied(await vp('cashier', v1.verification_id)))

// a newer card supersedes the older one: a screenshot of the old QR is dead
const c2 = await card('emp', M.emp)
check('a new card revokes the earlier one (superseded): the old QR scans as nothing', denied(await scan('cashier', c1.digest)) && (await one(`select revoked_reason from public.customer_credentials where token_digest = $1`, [c1.digest])).revoked_reason === 'superseded')
const v2 = await scan('cashier', c2.digest)
const v3 = await scan('cashier', c2.digest)
check('an operator has one open verification at a time (the earlier is cancelled)', (await one(`select state from public.customer_verifications where id = $1`, [v2.verification_id])).state === 'cancelled' && v3.ok)
// a review decision between the scan and the decision
await db.query(`update public.customer_org_memberships set state = 'inactive', version = version + 1 where id = $1`, [M.emp])
check('deactivation between scan and decision: the match is refused as stale, and no photo is shown', err(await decideV('cashier', v3.verification_id, 'match'), 'stale') && denied(await vp('cashier', v3.verification_id)))
check('…and the card scans as nothing (state and version both)', denied(await scan('cashier', c2.digest)))
await db.query(`update public.customer_org_memberships set state = 'approved', version = version + 1 where id = $1`, [M.emp])
check('reactivated: the OLD card stays dead (it was made for an older version); a new card works', denied(await scan('cashier', c2.digest)) && (await scan('cashier', (await card('emp', M.emp)).digest)).ok)
const c4 = await card('emp', M.emp)
check('an organization without an ACTIVE agreement with the scanning business: refused', denied(await scan('cashier', (await card('empOther', M.empOther)).digest)))
await db.query(`update public.customer_business_orgs set state = 'suspended' where id = $1`, [agreement])
check('a suspended agreement stops verification at once', denied(await scan('cashier', c4.digest)))
await db.query(`update public.customer_business_orgs set state = 'active' where id = $1`, [agreement])
await db.query(`update public.customer_departments set state = 'inactive' where id = $1`, [dept])
check('a switched-off department stops verification', denied(await scan('cashier', c4.digest)))
await db.query(`update public.customer_departments set state = 'active' where id = $1`, [dept])
const c5 = await card('emp', M.emp)
await db.query(`alter table public.customer_credentials disable trigger customer_credentials_keep`)
await db.query(`update public.customer_credentials set created_at = now() - interval '20 minutes', expires_at = now() - interval '1 minute' where token_digest = $1`, [c5.digest])
await db.query(`alter table public.customer_credentials enable trigger customer_credentials_keep`)
check('an expired card scans as nothing', denied(await scan('cashier', c5.digest)))
const c6 = await card('emp', M.emp)
const v6 = await scan('cashier', c6.digest)
await db.query(`alter table public.customer_verifications disable trigger customer_verifications_keep`)
await db.query(`update public.customer_verifications set created_at = now() - interval '3 minutes', expires_at = now() - interval '1 second' where id = $1`, [v6.verification_id])
await db.query(`alter table public.customer_verifications enable trigger customer_verifications_keep`)
check('an expired verification cannot be matched ("expired") and shows no photo', err(await decideV('cashier', v6.verification_id, 'match'), 'expired') && denied(await vp('cashier', v6.verification_id)))
const v7 = await scan('cashier', c6.digest)
check('mismatch and cancel are recorded too', (await decideV('cashier', v7.verification_id, 'mismatch')).status === 'mismatched' && (await decideV('cashier', (await scan('cashier', c6.digest)).verification_id, 'cancel')).status === 'cancelled')
check('the employee hides the card: every live card of the membership stops working', (await call('customer_credential_revoke', { p_auth_user_id: U.emp, p_membership_id: M.emp })).status === 'revoked' && denied(await scan('cashier', c6.digest)))
check('nobody else hides it', denied(await call('customer_credential_revoke', { p_auth_user_id: U.stranger, p_membership_id: M.emp })))
const c7 = await card('emp', M.emp)
const v8 = await scan('cashier', c7.digest)
check('revoking the operator\'s grant ends their open verification', (await call('customer_scanner_revoke', { p_actor_auth_user_id: U.owner, p_grant_id: g1.grant_id })).status === 'revoked'
  && (await one(`select state from public.customer_verifications where id = $1`, [v8.verification_id])).state === 'cancelled' && denied(await scanCheck('cashier', sarcafe, branchA)))
check('only a business administrator revokes a grant', denied(await call('customer_scanner_revoke', { p_actor_auth_user_id: U.gm, p_grant_id: g2.grant_id })))
let scans = 0
await grant('owner', S.cashier, null)
for (let i = 0; i < 32; i++) if ((await scan('cashier', c7.digest)).ok) scans++
check('at most 30 scans a minute per operator ("limit")', scans <= 30 && err(await scan('cashier', c7.digest), 'limit'))

section('the rows\' own rules')
await refused('a revoked credential stays revoked', `update public.customer_credentials set revoked_at = null where token_digest = $1`, [c1.digest], /revoked for good/)
await refused('a credential\'s membership version never changes', `update public.customer_credentials set membership_version = 99 where token_digest = $1`, [c7.digest], /cannot change/)
await refused('a decided verification is final', `update public.customer_verifications set state = 'pending', decided_at = null where id = $1`, [v7.verification_id], /final|check/)
await refused('a verification never moves to another operator', `update public.customer_verifications set actor_auth_user_id = $2 where id = $1`, [v7.verification_id, U.cashier2], /cannot change/)
await refused('a credential cannot point at a membership of another organization', `insert into public.customer_credentials (organization_id, membership_id, token_digest, membership_version, issued_by_auth_user_id, expires_at) values ($1, $2, $3, 1, $4, now() + interval '1 hour')`, [orgNoDeal, M.emp, hex(), U.emp], /foreign key|violates/)
await refused('a card valid for more than a day is refused by the table', `insert into public.customer_credentials (organization_id, membership_id, token_digest, membership_version, issued_by_auth_user_id, expires_at) values ($1, $2, $3, 1, $4, now() + interval '2 days')`, [org, M.emp, hex(), U.emp], /check/)
{ const m = await as('service_role', () => failure(`delete from public.customer_verifications`)); check('the service role cannot delete a verification', /permission denied/.test(m), m || 'it could') }
check('nobody became staff; no staff row was written', await count(`select count(*) n from public.staff`) === 6)

console.log(`\n${passed} passed, ${failed.length} failed`)
if (failed.length) { console.log(failed.map((f) => `  - ${f}`).join('\n')); process.exit(1) }
