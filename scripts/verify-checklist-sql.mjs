import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const migrations = fileURLToPath(new URL('../supabase/migrations/', import.meta.url))
const db = new PGlite({ extensions: { pgcrypto } })
let passed = 0
const failed = []
const check = (name, okay, detail = '') => {
  if (okay) { passed++; console.log(`  ✓ ${name}`) }
  else { failed.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
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
`)

console.log('\nchecklist migration')
for (const file of readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()) {
  try { await db.exec(readFileSync(migrations + file, 'utf8')) }
  catch (error) {
    check(`apply ${file}`, false, String(error.message).split('\n')[0])
    console.error(error)
    process.exit(1)
  }
}
check('all migrations apply in order', true)

const branch = (await one(`select id from public.branches where slug = 'givat-haviva'`)).id
const owner = (await one(`insert into public.staff (first_name, role, badge, branch_id) values ('Owner', 'owner', 'owner', $1) returning id`, [branch])).id
const worker = await one(`insert into public.staff (first_name, badge, branch_id) values ('Dana', 'barista', $1) returning id, employee_no`, [branch])
const definition = JSON.stringify({ categories: [{ id: 'main', title: 'בדיקות', items: [{ id: 'x', label: 'בדיקה', kind: 'status', issueType: 'other', required: true }] }] })
for (const kind of ['opening', 'handover', 'closing']) {
  await db.query(`insert into public.checklist_templates (branch_id, kind, name, definition, created_by) values ($1,$2,$3,$4::jsonb,$5)`, [branch, kind, kind, definition, owner])
}

const week = (await one(`insert into public.schedule_weeks (branch_id, week_start) values ($1, '2030-01-06') returning id`, [branch])).id
const firstShift = (await one(`insert into public.shifts (branch_id, week_id, shift_date, start_time, end_time) values ($1,$2,'2030-01-06','07:00','13:00') returning id`, [branch, week])).id
await db.query(`insert into public.shift_assignments (branch_id, shift_id, staff_id, staff_name) values ($1,$2,$3,'Dana')`, [branch, firstShift, worker.id])
await db.query(`update public.schedule_weeks set status='published', version=version+1 where id=$1`, [week])
check('one published shift creates opening and closing forms', Number((await one(`select count(*) n from public.checklist_assignments`)).n) === 2)

const secondShift = (await one(`insert into public.shifts (branch_id, week_id, shift_date, start_time, end_time) values ($1,$2,'2030-01-06','13:00','19:00') returning id`, [branch, week])).id
await db.query(`insert into public.shift_assignments (branch_id, shift_id, staff_id, staff_name) values ($1,$2,$3,'Dana')`, [branch, secondShift, worker.id])
await db.query(`update public.schedule_weeks set version=version+1 where id=$1`, [week])
const kinds = (await db.query(`select checklist_kind, shift_id from public.checklist_assignments order by shift_id, checklist_kind`)).rows
check('republish removes stale pending requirements and maps the handover', kinds.length === 3 && kinds.some((row) => row.checklist_kind === 'handover'))

const newTemplate = (await one(`select public.publish_checklist_template($1,$2,'opening','פתיחה חדשה',$3::jsonb) id`, [owner, branch, definition])).id
check('owner publishes an immutable new template version', !!newTemplate && Number((await one(`select max(version) v from public.checklist_templates where branch_id=$1 and kind='opening'`, [branch])).v) === 2)

await one(`select public.pos_set_pin($1,$2,'482951')`, [owner, worker.id])
const verified = (await one(`select public.pos_verify_pin($1,'482951') v`, [worker.employee_no])).v
check('number + PIN works before Google/email activation', verified.ok === true && verified.staff_id === worker.id)
await db.query(`insert into public.pos_quick_sessions (session_id, staff_id) values (gen_random_uuid(), $1)`, [worker.id])
await db.query(`insert into public.staff_employee_sessions (token_hash, staff_id, expires_at) values ('fixture-hash', $1, now() + interval '1 day')`, [worker.id])
await one(`select public.pos_set_pin($1,$2,'739184')`, [owner, worker.id])
check('PIN rotation retains floor-session provenance markers', Number((await one(`select count(*) n from public.pos_quick_sessions where staff_id=$1`, [worker.id])).n) === 1)
check('PIN rotation revokes opaque employee sessions', (await one(`select revoked_at is not null revoked from public.staff_employee_sessions where token_hash='fixture-hash'`)).revoked === true)

const browserWrite = await (async () => {
  try { await db.exec(`set role authenticated; insert into public.checklist_assignments (branch_id,shift_id,shift_assignment_id,staff_id,checklist_kind,template_version,template_snapshot) select branch_id,shift_id,id,staff_id,'opening',1,'{}'::jsonb from public.shift_assignments limit 1; reset role;`); return false }
  catch { await db.exec('reset role'); return true }
})()
check('browser roles cannot write checklist evidence', browserWrite)

console.log(`\n${passed} passed, ${failed.length} failed`)
await db.close()
if (failed.length) process.exit(1)
