import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const db = new PGlite({ extensions: { pgcrypto } })
const hash = (value) => createHash('sha256').update(value).digest('hex')
let passed = 0
const failed = []
function check(name, okay) { if (okay) { passed++; console.log(`  ✓ ${name}`) } else { failed.push(name); console.log(`  ✗ ${name}`) } }
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
const rpc = async (name, params) => (await one(`select public.${name}(${params.map((_, index) => `$${index + 1}`).join(',')}) result`, params)).result
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth; create schema storage;
  create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text);
  alter table storage.objects enable row level security;
  create table auth.users(id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb default '{}'::jsonb, raw_app_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{"session_id":"10000000-0000-4000-8000-000000000001"}'::jsonb) $$;
  create publication supabase_realtime;
  grant usage on schema public, auth to anon, authenticated, service_role;
`)
const migrations = fileURLToPath(new URL('../supabase/migrations/', import.meta.url))
for (const file of readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()) await db.exec(readFileSync(migrations + file, 'utf8'))
check('all migrations apply in order', true)
const branch = (await one(`select id from public.branches where slug='givat-haviva'`)).id
const owner = (await one(`insert into public.staff(first_name,last_name,role,badge,branch_id) values('Owner','Fixture','owner','owner',$1) returning id`, [branch])).id
const createWorker = async (name = 'Employee') => one(`insert into public.staff(first_name,last_name,branch_id) values($1,'Fixture',$2) returning id,employee_no`, [name, branch])
const worker = await createWorker()
const incomplete = (await one(`insert into public.staff(first_name) values('Incomplete') returning id`)).id
const invite = async (staff, token) => rpc('staff_create_invitation', [owner, staff, hash(token)])
const complete = async (token, pin = '482951', session = `session-${token}`, link = `link-${token}`) => rpc('staff_complete_invitation', [hash(token), pin, hash(session), hash(link)])
check('staff cannot generate employee invitations', (await rpc('staff_create_invitation', [worker.id, worker.id, hash('forbidden')])).reason === 'forbidden')
check('first and last name are required for generated invitations', (await invite(incomplete, 'incomplete')).reason === 'profile_incomplete')
check('owner generates a seven-day invitation', (await invite(worker.id, 'first')).ok === true)
const firstInspection = await rpc('staff_inspect_invitation', [hash('first')])
check('invitation only exposes setup name and employee number', firstInspection.ok === true && firstInspection.employee_no === worker.employee_no && !firstInspection.staff_id && !firstInspection.email)
await invite(worker.id, 'second')
check('regeneration revokes the previous link', (await rpc('staff_inspect_invitation', [hash('first')])).ok === false)
check('weak PIN does not consume the link', (await complete('second', '111111')).reason === 'weak_pin' && (await rpc('staff_inspect_invitation', [hash('second')])).ok === true)
check('five digits do not consume the link', (await complete('second', '48295')).reason === 'invalid_pin' && (await rpc('staff_inspect_invitation', [hash('second')])).ok === true)
check('PIN setup succeeds without Google or email', (await complete('second')).ok === true)
check('PIN works on the original employee UUID', (await rpc('pos_verify_pin', [worker.employee_no, '482951'])).staff_id === worker.id)
const leading = await createWorker('Leading Zero')
await rpc('pos_set_employee_code', [owner, leading.id, '0849'])
await rpc('pos_set_pin', [owner, leading.id, '739184'])
check('leading-zero HYP code is preserved and authenticates', (await one(`select employee_code from public.staff where id=$1`, [leading.id])).employee_code === '0849' && (await rpc('pos_verify_pin', ['0849', '739184'])).staff_id === leading.id)
check('first session and OAuth proof are committed together', (await one(`select (select count(*) from public.staff_employee_sessions where token_hash=$1) sessions, (select count(*) from public.staff_google_link_intents where token_hash=$2) intents`, [hash('session-second'), hash('link-second')])).sessions === 1 && (await rpc('staff_google_link_ready', [hash('link-second')])) === true)
check('invitation cannot be replayed to replace the PIN', (await complete('second', '739184', 'replay-session', 'replay-link')).reason === 'invalid_invite' && (await rpc('pos_verify_pin', [worker.employee_no, '482951'])).ok === true)
const addAuth = async (email, provider = 'google', verified = true) => (await one(`insert into auth.users(email,email_confirmed_at,raw_app_meta_data) values($1,case when $2 then now() else null end,jsonb_build_object('provider',$3::text)) returning id`, [email, verified, provider])).id
const google = await addAuth('employee.fixture@example.test')
const finish = (link, auth) => rpc('staff_finish_google_link', [hash(link), auth])
const authorityBefore = await one(`select id,role,badge,branch_id from public.staff where id=$1`, [worker.id])
check('verified Google is linked to the same employee', (await finish('link-second', google)).staff_id === worker.id)
const linked = await one(`select id,role,badge,branch_id,auth_user_id,email from public.staff where id=$1`, [worker.id])
check('linking preserves role, branch and stable employee identity', linked.id === authorityBefore.id && linked.role === authorityBefore.role && linked.badge === authorityBefore.badge && linked.branch_id === authorityBefore.branch_id && linked.auth_user_id === google)
check('only verified Google email is recorded', linked.email === 'employee.fixture@example.test')
check('Google proof is single-use', (await finish('link-second', google)).ok === false)
const newWorker = await createWorker('New')
await invite(newWorker.id, 'new'); await complete('new')
check('Google already bound to another employee is rejected', (await finish('link-new', google)).reason === 'account_conflict')
const unconfirmed = await addAuth('unconfirmed.fixture@example.test', 'google', false)
check('unconfirmed email is rejected', (await finish('link-new', unconfirmed)).reason === 'unverified_google')
const password = await addAuth('password.fixture@example.test', 'email', true)
check('password identity cannot bind through Google onboarding', (await finish('link-new', password)).reason === 'unverified_google')
check('wrong current PIN cannot create a link intent', (await rpc('staff_prepare_google_link', [newWorker.id, '739184', hash('bad-proof')])).ok === false)
check('current PIN can prepare linking later', (await rpc('staff_prepare_google_link', [newWorker.id, '482951', hash('later-proof')])).ok === true)
check('new proof revokes the previous proof', (await rpc('staff_google_link_ready', [hash('link-new')])) === false)
await rpc('pos_set_pin', [owner, newWorker.id, '739184'])
check('PIN rotation revokes any pending Google proof', (await rpc('staff_google_link_ready', [hash('later-proof')])) === false)
await rpc('staff_prepare_google_link', [worker.id, '482951', hash('existing-proof')])
const anotherGoogle = await addAuth('different.fixture@example.test')
check('a linked employee cannot silently rebind to a different Google user', (await finish('existing-proof', anotherGoogle)).reason === 'already_linked')
const expire = await createWorker('Expire')
await invite(expire.id, 'expired')
await db.query(`update public.staff_invitations set expires_at=now()-interval '1 second' where token_hash=$1`, [hash('expired')])
check('expired invite cannot set a PIN', (await complete('expired')).reason === 'invalid_invite')
await invite(expire.id, 'revoked'); await rpc('staff_revoke_invitation', [owner, expire.id])
check('owner cancellation invalidates the invitation', (await complete('revoked')).reason === 'invalid_invite')
await invite(expire.id, 'deactivated'); await db.query(`update public.staff set active=false where id=$1`, [expire.id]); await db.query(`update public.staff set active=true where id=$1`, [expire.id])
check('deactivation invalidates setup links even after reactivation', (await complete('deactivated')).reason === 'invalid_invite')
await invite(expire.id, 'proof-expiry'); await complete('proof-expiry')
await db.query(`update public.staff_google_link_intents set expires_at=now()-interval '1 second' where token_hash=$1`, [hash('link-proof-expiry')])
check('expired Google proof cannot bind a verified user', (await finish('link-proof-expiry', anotherGoogle)).reason === 'invalid_link')
const conflictEmailWorker = await createWorker('EmailConflict')
await db.query(`update public.staff set email='different.fixture@example.test' where id=$1`, [conflictEmailWorker.id])
await rpc('staff_prepare_google_link', [newWorker.id, '739184', hash('email-conflict')])
check('Google matching another staff email cannot steal their record', (await finish('email-conflict', anotherGoogle)).reason === 'account_conflict')
await invite(conflictEmailWorker.id, 'legacy-bypass')
await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [anotherGoogle])
await rpc('claim_staff_invite', [])
check('legacy email matching cannot bypass a token-invited employee link intent', (await one(`select auth_user_id from public.staff where id=$1`, [conflictEmailWorker.id])).auth_user_id === null)
const legacyWorker = await createWorker('Legacy')
const legacyGoogle = await addAuth('legacy.fixture@example.test')
await db.query(`update public.staff set email='legacy.fixture@example.test' where id=$1`, [legacyWorker.id])
await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [legacyGoogle])
await rpc('claim_staff_invite', [])
check('older email invites still claim verified Google identities', (await one(`select auth_user_id from public.staff where id=$1`, [legacyWorker.id])).auth_user_id === legacyGoogle)
check('tokens stored in invitation and proof tables are SHA-256 hashes only', (await one(`select not exists(select 1 from public.staff_invitations where length(token_hash)<>64) and not exists(select 1 from public.staff_google_link_intents where length(token_hash)<>64) safe`)).safe === true)
const forbidden = async (sql) => { try { await db.exec(`set role authenticated; ${sql}; reset role;`); return false } catch { await db.exec('reset role'); return true } }
check('browser role cannot read invitation secrets', await forbidden(`select * from public.staff_invitations`))
check('browser role cannot consume invitation RPC', await forbidden(`select public.staff_complete_invitation('${hash('second')}','482951','${hash('browser-session')}','${hash('browser-proof')}')`))
check('browser role cannot force Google linking', await forbidden(`select public.staff_finish_google_link('${hash('email-conflict')}','${anotherGoogle}')`))

// Old quick JWTs must remain floor-only even when sent directly to PostgREST.
const ownerGoogle = await addAuth('owner.fixture@example.test')
await db.query(`update public.staff set auth_user_id=$1 where id=$2`, [ownerGoogle, owner])
const fullSession = '10000000-0000-4000-8000-000000000001'
await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [ownerGoogle])
check('Google owner retains full browser privileges', (await one(`select public.is_op() okay`)).okay === true)
await db.query(`insert into public.pos_quick_sessions(session_id,staff_id) values($1,$2)`, [fullSession, owner])
check('legacy owner PIN JWT cannot become an owner or menu editor', (await one(`select not public.is_op() and not public.is_menu_editor($1) okay`, [branch])).okay === true)
check('legacy PIN JWT cannot use published schedule view predicate', (await one(`select not public.can_view_schedule($1) okay`, [branch])).okay === true)
await db.exec(`set role authenticated`)
check('legacy PIN JWT cannot read scheduling settings directly', (await one(`select count(*) n from public.shift_settings`)).n === 0)
await db.exec('reset role')
await db.query(`delete from public.pos_quick_sessions where session_id=$1`, [fullSession])
await db.query(`select set_config('request.jwt.claims','{}',false)`)
check('missing session provenance fails closed', (await one(`select not public.staff_has_full_browser_session() okay`)).okay === true)
await db.query(`select set_config('request.jwt.claims','',false)`)

const bucket = await one(`select public, file_size_limit, allowed_mime_types from storage.buckets where id='staff-payslips'`)
check('payslip bucket is private with a bounded allowed format list', bucket.public === false && Number(bucket.file_size_limit) === 4194304 && bucket.allowed_mime_types.length === 3)
check('payslip metadata is unreadable to browser roles', await forbidden('select * from public.staff_payslips'))
// A broad policy elsewhere must never expose the payslip bucket.
await db.exec(`grant usage on schema storage to anon, authenticated; grant select, insert on storage.objects to anon, authenticated; create policy fixture_broad_storage on storage.objects for all to anon, authenticated using (true) with check (true); insert into storage.objects(bucket_id) values ('staff-payslips'),('public-fixture')`)
await db.exec('set role authenticated')
check('restrictive storage policy hides private files despite broad policy', (await one(`select count(*) n from storage.objects where bucket_id='staff-payslips'`)).n === 0)
check('unrelated storage policy continues to work', (await one(`select count(*) n from storage.objects where bucket_id='public-fixture'`)).n === 1)
await db.exec('reset role')
check('browser cannot upload into private payslip bucket', await forbidden(`insert into storage.objects(bucket_id) values ('staff-payslips')`))
console.log(`\n${passed} passed, ${failed.length} failed`)
await db.close()
if (failed.length) process.exit(1)
