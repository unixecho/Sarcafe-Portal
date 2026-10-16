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
const ownerMember = await one(`select count(*)::int n, bool_and(not schedulable) disabled from public.schedule_members where staff_id=$1`, [owner])
check('new owner is excluded from scheduling until explicitly enabled', ownerMember.n > 0 && ownerMember.disabled === true)
await db.query(`update public.schedule_members set schedulable=true where branch_id=$1 and staff_id=$2`, [branch, owner])
await db.query(`update public.staff set badge='developer' where id=$1`, [owner])
check('an explicit operator scheduling opt-in survives owner-to-developer display change', (await one(`select schedulable from public.schedule_members where branch_id=$1 and staff_id=$2`, [branch, owner])).schedulable === true)
const promoted = (await one(`insert into public.staff (first_name, role, badge, branch_id) values ('Promoted', 'staff', 'barista', $1) returning id`, [branch])).id
await db.query(`insert into public.schedule_members (branch_id, staff_id, schedulable) values ($1,$2,true)`, [branch, promoted])
await db.query(`update public.staff set role='owner', badge='developer' where id=$1`, [promoted])
check('promotion to developer resets scheduling off until explicitly enabled', (await one(`select schedulable from public.schedule_members where branch_id=$1 and staff_id=$2`, [branch, promoted])).schedulable === false)
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
const handovers = kinds.filter((row) => row.checklist_kind === 'handover')
check('republish maps handover to both the outgoing and incoming shifts', kinds.length === 4 && handovers.length === 2 && new Set(handovers.map((row) => row.shift_id)).size === 2)

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

// ---- One person does a shift's checklists (20261015090000) ------------------------------------------------------
console.log('\nsingle responsible per shift')
const eli = (await one(`insert into public.staff (first_name, badge, branch_id) values ('Eli', 'barista', $1) returning id`, [branch])).id
const statusOf = async (id) => (await one(`select status from public.checklist_assignments where id=$1`, [id])).status
const rowOf = async (shift, staff, kind) => (await one(`select id from public.checklist_assignments where shift_id=$1 and staff_id=$2 and checklist_kind=$3`, [shift, staff, kind]))?.id
const submit = async (id) => db.query(`update public.checklist_assignments set status='submitted', submitted_at=now() where id=$1`, [id])
const failsWith = async (fn, re) => { try { await fn(); return false } catch (error) { return re.test(String(error.message)) } }
const republish = () => db.query(`update public.schedule_weeks set version=version+1 where id=$1`, [week])

// A: nobody picked, two people on one shift -> both get forms, the first one sent wins
const shiftA = (await one(`insert into public.shifts (branch_id, week_id, shift_date, start_time, end_time) values ($1,$2,'2030-01-08','07:00','13:00') returning id`, [branch, week])).id
for (const [id, name] of [[worker.id, 'Dana'], [eli, 'Eli']]) await db.query(`insert into public.shift_assignments (branch_id, shift_id, staff_id, staff_name) values ($1,$2,$3,$4)`, [branch, shiftA, id, name])
await republish()
check('with nobody picked every person on the shift gets both forms', Number((await one(`select count(*) n from public.checklist_assignments where shift_id=$1 and status='pending'`, [shiftA])).n) === 4)
await submit(await rowOf(shiftA, eli, 'opening'))
check('the first one sent wins: the other copy of that checklist is covered', (await statusOf(await rowOf(shiftA, worker.id, 'opening'))) === 'covered')
check('the other checklist of the shift stays open for both', (await statusOf(await rowOf(shiftA, worker.id, 'closing'))) === 'pending' && (await statusOf(await rowOf(shiftA, eli, 'closing'))) === 'pending')
check('sending the same checklist twice is refused', await failsWith(async () => submit(await rowOf(shiftA, worker.id, 'opening')), /checklist_covered/))
await submit(await rowOf(shiftA, worker.id, 'closing'))
check('the second person can send the shift\'s other checklist', (await statusOf(await rowOf(shiftA, worker.id, 'closing'))) === 'submitted' && (await statusOf(await rowOf(shiftA, eli, 'closing'))) === 'covered')
check('sent checklists are never changed by a later sync', (await statusOf(await rowOf(shiftA, eli, 'opening'))) === 'submitted' && ((await republish()), (await statusOf(await rowOf(shiftA, eli, 'opening')))) === 'submitted')

// B: the owner picks one person -> only that person is expected to do the shift's checklists
const shiftB = (await one(`insert into public.shifts (branch_id, week_id, shift_date, start_time, end_time) values ($1,$2,'2030-01-09','07:00','13:00') returning id`, [branch, week])).id
for (const [id, name] of [[worker.id, 'Dana'], [eli, 'Eli']]) await db.query(`insert into public.shift_assignments (branch_id, shift_id, staff_id, staff_name) values ($1,$2,$3,$4)`, [branch, shiftB, id, name])
await republish()
const pickB = (await one(`select public.sched_set_checklist_lead($1,$2,$3) r`, [owner, shiftB, eli])).r
check('the owner can pick who does the checklists', pickB.ok === true)
check('the picked person keeps their forms', (await statusOf(await rowOf(shiftB, eli, 'opening'))) === 'pending' && (await statusOf(await rowOf(shiftB, eli, 'closing'))) === 'pending')
check('everybody else on the shift is covered, not chased', (await statusOf(await rowOf(shiftB, worker.id, 'opening'))) === 'covered' && (await statusOf(await rowOf(shiftB, worker.id, 'closing'))) === 'covered')
check('someone who is not the picked person cannot send it (database refuses)', await failsWith(async () => submit(await rowOf(shiftB, worker.id, 'opening')), /checklist_covered|checklist_not_lead/))
check('picking someone who is not on the shift is refused', (await one(`select public.sched_set_checklist_lead($1,$2,$3) r`, [owner, shiftB, owner])).r.reason === 'not_on_shift')
check('only a manager of the branch can pick', (await one(`select public.sched_set_checklist_lead($1,$2,$3) r`, [worker.id, shiftB, worker.id])).r.reason === 'forbidden')
await submit(await rowOf(shiftB, eli, 'opening'))
check('the picked person sends normally', (await statusOf(await rowOf(shiftB, eli, 'opening'))) === 'submitted')
await db.query(`select public.sched_set_checklist_lead($1,$2,null)`, [owner, shiftB])
check('clearing the pick reopens the covered copy of what is still unsent', (await statusOf(await rowOf(shiftB, worker.id, 'closing'))) === 'pending')
check('...but not the copy of what was already sent', (await statusOf(await rowOf(shiftB, worker.id, 'opening'))) === 'covered')
check('at most one person per shift can be picked (unique index)', await failsWith(async () => {
  await db.query(`update public.shift_assignments set checklist_lead=true where shift_id=$1`, [shiftB])
}, /shift_assignments_one_checklist_lead|duplicate key/))
const moved = (await one(`select public.sched_set_checklist_lead($1,$2,$3) r`, [owner, shiftB, eli])).r
check('picking again works', moved.ok === true && (await one(`select checklist_lead from public.shift_assignments where shift_id=$1 and staff_id=$2`, [shiftB, eli])).checklist_lead === true)
const shiftC = (await one(`insert into public.shifts (branch_id, week_id, shift_date, start_time, end_time) values ($1,$2,'2030-01-10','07:00','13:00') returning id`, [branch, week])).id
await db.query(`update public.shift_assignments set shift_id=$1 where shift_id=$2 and staff_id=$3`, [shiftC, shiftB, eli])
check('moving an assignment to another shift drops the mark', (await one(`select checklist_lead from public.shift_assignments where shift_id=$1 and staff_id=$2`, [shiftC, eli])).checklist_lead === false)

// ---- The owner switches a checklist off for one branch (20261016090000) --------------------------------------------
console.log('\nper-branch checklist switches')
const closingPending = async () => Number((await one(`select count(*) n from public.checklist_assignments where branch_id=$1 and checklist_kind='closing' and status='pending' and manager_resolved_at is null`, [branch])).n)
const closingSent = async () => Number((await one(`select count(*) n from public.checklist_assignments where branch_id=$1 and checklist_kind='closing' and status='submitted'`, [branch])).n)
const openingPending = async () => Number((await one(`select count(*) n from public.checklist_assignments where branch_id=$1 and checklist_kind='opening' and status='pending' and manager_resolved_at is null`, [branch])).n)
const beforeClosing = await closingPending()
const beforeOpening = await openingPending()
const sentBefore = await closingSent()
check('there are unsent closing forms to switch off', beforeClosing > 0 && beforeOpening > 0)
check('an employee cannot switch a checklist off', (await one(`select public.checklist_set_branch_kind($1,$2,'closing',false) r`, [worker.id, branch])).r.reason === 'forbidden')
check('an unknown kind is refused', (await one(`select public.checklist_set_branch_kind($1,$2,'lunch',false) r`, [owner, branch])).r.reason === 'bad_request')
const off = (await one(`select public.checklist_set_branch_kind($1,$2,'closing',false) r`, [owner, branch])).r
check('the owner switches closing off for the branch', off.ok === true && off.enabled === false && off.removed > 0, JSON.stringify(off))
check('unstarted closing forms are gone, the other kinds stay, sent evidence stays', (await closingPending()) === 0 && (await openingPending()) === beforeOpening && (await closingSent()) === sentBefore)
await republish()
check('a schedule change does not bring the switched-off kind back', (await closingPending()) === 0)
const newShift = (await one(`insert into public.shifts (branch_id, week_id, shift_date, start_time, end_time) values ($1,$2,'2030-01-11','07:00','13:00') returning id`, [branch, week])).id
await db.query(`insert into public.shift_assignments (branch_id, shift_id, staff_id, staff_name) values ($1,$2,$3,'Dana')`, [branch, newShift, worker.id])
await republish()
check('a new shift gets its other forms but no closing form', (await rowOf(newShift, worker.id, 'opening')) && !(await rowOf(newShift, worker.id, 'closing')))
check('the switch is recorded with who and when', (await one(`select enabled, updated_by from public.checklist_branch_settings where branch_id=$1 and kind='closing'`, [branch])).updated_by === owner)
const on = (await one(`select public.checklist_set_branch_kind($1,$2,'closing',true) r`, [owner, branch])).r
check('switching it on again brings the forms back for the days that have not started', on.ok === true && (await closingPending()) > 0 && !!(await rowOf(newShift, worker.id, 'closing')))
check('browser roles cannot read or write the switches', await (async () => {
  try { await db.exec('set role authenticated; select * from public.checklist_branch_settings; reset role;'); return false }
  catch { await db.exec('reset role'); return true }
})())

// ---- Onboarding progress, the notifications exemption and events that belong to a truck (20261016140000) -------------
console.log('\nonboarding progress, exemption, event parent')
const newbie = await one(`select onboarding_done_at, push_gate_exempt from public.staff where id=$1`, [worker.id])
check('a person created after the migration starts "not onboarded" and not exempt', newbie.onboarding_done_at === null && newbie.push_gate_exempt === false)
const eventMigration = readdirSync(migrations).find((name) => name.endsWith('_onboarding_progress_event_parent.sql'))
await db.exec(readFileSync(migrations + eventMigration, 'utf8'))
check('running it again does not mark anyone done (the backfill happens only when the column is created)', (await one(`select onboarding_done_at from public.staff where id=$1`, [worker.id])).onboarding_done_at === null)
const truck = (await one(`select id from public.branches where slug='givat-haviva'`)).id
const ev1 = (await one(`insert into public.branches (slug, name, kind, parent_branch_id) values ('ev-one', '{"he":"אירוע"}', 'event', $1) returning id`, [truck])).id
check('an event can belong to a truck', (await one(`select parent_branch_id from public.branches where id=$1`, [ev1])).parent_branch_id === truck)
check('a truck cannot have a parent', await failsWith(async () => db.query(`update public.branches set parent_branch_id=$1 where id=$2`, [truck, branch]), /branch_parent_only_events/))
const ev2 = (await one(`insert into public.branches (slug, name, kind) values ('ev-two', '{"he":"אירוע ב"}', 'event') returning id`)).id
check('an event cannot be the parent of an event', await failsWith(async () => db.query(`update public.branches set parent_branch_id=$1 where id=$2`, [ev1, ev2]), /branch_parent_not_a_truck/))
check('nothing is its own parent', await failsWith(async () => db.query(`update public.branches set parent_branch_id=id where id=$1`, [ev2]), /branch_parent_only_events|branch_parent_self|branch_parent_not_a_truck/))
check('an employee cannot assign an event', (await one(`select public.branch_set_parent($1,$2,$3) r`, [worker.id, ev2, truck])).r.reason === 'forbidden')
const assigned = (await one(`select public.branch_set_parent($1,$2,$3) r`, [owner, ev2, truck])).r
check('the owner assigns an event to a truck', assigned.ok === true && (await one(`select parent_branch_id from public.branches where id=$1`, [ev2])).parent_branch_id === truck)
check('only an event can be assigned, only to a truck', (await one(`select public.branch_set_parent($1,$2,$3) r`, [owner, truck, branch])).r.reason === 'not_found' && (await one(`select public.branch_set_parent($1,$2,$3) r`, [owner, ev2, ev1])).r.reason === 'bad_target')
const detached = (await one(`select public.branch_set_parent($1,$2,null) r`, [owner, ev2])).r
check('the owner can detach it again', detached.ok === true && (await one(`select parent_branch_id from public.branches where id=$1`, [ev2])).parent_branch_id === null)
check('deleting a truck leaves its events (parent set to null), nothing cascades', await (async () => {
  const t2 = (await one(`insert into public.branches (slug, name) values ('truck-temp', '{"he":"זמני"}') returning id`)).id
  const e3 = (await one(`insert into public.branches (slug, name, kind, parent_branch_id) values ('ev-three', '{"he":"אירוע ג"}', 'event', $1) returning id`, [t2])).id
  await db.query(`delete from public.branches where id=$1`, [t2])
  const row = await one(`select parent_branch_id from public.branches where id=$1`, [e3])
  return !!row && row.parent_branch_id === null
})())
check('browser roles cannot call the assign function', await (async () => {
  try { await db.exec(`set role authenticated; select public.branch_set_parent('${owner}', '${ev2}', null); reset role;`); return false }
  catch { await db.exec('reset role'); return true }
})())

const resolutionRead = await (async () => {
  try { await db.exec('set role authenticated; select * from public.checklist_issue_resolutions; reset role;'); return false }
  catch { await db.exec('reset role'); return true }
})()
check('the issue-report resolutions table exists and is closed to browser roles', resolutionRead && (await one(`select count(*)::int n from public.checklist_issue_resolutions`)).n === 0)

console.log(`\n${passed} passed, ${failed.length} failed`)
await db.close()
if (failed.length) process.exit(1)
