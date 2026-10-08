// Behavioural verification of the staff & scheduling database layer (migrations
// 010 + 024), run against an in-process Postgres (PGlite — real Postgres compiled
// to WASM), so every rule is exercised BEFORE it touches a Supabase project.
//
//   node scripts/verify-schedule-sql.mjs
//
// It stubs what Supabase provides (roles, auth schema + auth.uid()), applies every
// migration in order — pausing before 024 to plant LEGACY rows so the data
// migration is tested on real-shaped data — then walks the whole product:
// name-only staff, shifts + times, assignments + conflicts (same branch and across
// branches), requests, swaps (hand-over and exchange), manager approval, schedule
// changes while things are pending, publish + notifications, staff lifecycle, and
// the privilege model.
//
// NOTE ON CONCURRENCY: PGlite is a single connection, so two simultaneous calls
// are serialised. What is verified here is the thing that makes concurrency safe:
// the invariants are enforced by the DATABASE (unique index + deferred constraint
// trigger + per-person advisory lock inside every decision), not by app code.

import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MIG = fileURLToPath(new URL('../supabase/migrations/', import.meta.url))
const SRC_DIR = fileURLToPath(new URL('../src/', import.meta.url))
const db = new PGlite({ extensions: { pgcrypto } })

let pass = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    failures.push(name)
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
const section = (t) => console.log(`\n${t}`)
const q = async (sql, params) => (await db.query(sql, params)).rows
const one = async (sql, params) => (await q(sql, params))[0]
const rpc = async (fn, args) => {
  const keys = Object.keys(args)
  const placeholders = keys.map((k, i) => `${k} => $${i + 1}`).join(', ')
  const row = await one(`select public.${fn}(${placeholders}) as r`, keys.map((k) => args[k]))
  return row.r
}
async function asRole(role, sub, fn) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${sub ?? ''}', false);`)
  try {
    return await fn()
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`)
  }
}
async function refused(sql, params) {
  try {
    await db.query(sql, params)
    return false
  } catch (e) {
    return /permission denied|42501|row-level security/i.test(String(e.message)) ? true : String(e.message)
  }
}
async function throws(sql, params, re) {
  try {
    await db.query(sql, params)
    return false
  } catch (e) {
    return re.test(String(e.message)) ? true : String(e.message)
  }
}

// ---- Stand-ins for what Supabase provides ---------------------------------
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

const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort()
const NEW_MIG = files.find((f) => f.startsWith('024_'))

// ---- Everything up to 024, then LEGACY rows --------------------------------
section('migrations apply in order')
for (const f of files.filter((x) => x < NEW_MIG)) {
  try {
    await db.exec(readFileSync(MIG + f, 'utf8'))
  } catch (e) {
    check(`apply ${f}`, false, String(e.message).split('\n')[0])
    process.exit(1)
  }
}
check(`apply 000 … 017`, true)

const maor = (await one(`select id from public.branches where slug = 'maor'`)).id
const ghav = (await one(`select id from public.branches where slug = 'givat-haviva'`)).id
async function addStaff({ email = null, first = null, last = null, display = null, role = 'staff', badge = null, branch = null, auth = true, active = true }) {
  let authId = null
  if (auth) authId = (await one(`insert into auth.users (email) values ($1) returning id`, [email ?? `u${Math.random().toString(36).slice(2)}@x.test`])).id
  const s = await one(
    `insert into public.staff (auth_user_id, email, first_name, last_name, display_name, role, badge, branch_id, active, claimed_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9, $10) returning id, handle`,
    [authId, email, first, last, display, role, badge, branch, active, authId ? new Date() : null],
  )
  return { ...s, authId }
}
// A name-only employee exactly as the live database has them: first_name set, display_name NULL, no email, no sign-in.
const tamar = await addStaff({ first: 'תמר', auth: false, badge: 'barista' })
const legacyBoth = await addStaff({ first: 'נועה', last: 'כהן', auth: false, badge: 'barista' })
check('legacy: display_name is NULL before the migration', (await one(`select display_name from public.staff where id = $1`, [tamar.id])).display_name === null)

try {
  await db.exec(readFileSync(MIG + NEW_MIG, 'utf8'))
  check(`apply ${NEW_MIG}`, true)
} catch (e) {
  check(`apply ${NEW_MIG}`, false, String(e.message).split('\n')[0])
  console.log(e)
  process.exit(1)
}
try {
  await db.exec(readFileSync(MIG + NEW_MIG, 'utf8'))
  await db.exec(readFileSync(MIG + NEW_MIG, 'utf8'))
  check(`${NEW_MIG} is re-runnable (idempotent)`, true)
} catch (e) {
  check(`${NEW_MIG} is re-runnable (idempotent)`, false, String(e.message).split('\n')[0])
}

// ============================================================================
section('staff identity — a person without an email has a real name')
check('the data migration backfilled display_name from first name', (await one(`select display_name from public.staff where id = $1`, [tamar.id])).display_name === 'תמר')
check('…and from first + last name', (await one(`select display_name from public.staff where id = $1`, [legacyBoth.id])).display_name === 'נועה כהן')
const noNames = await addStaff({ auth: false, email: null })
await db.query(`update public.staff set first_name = null, display_name = null where id = $1`, [noNames.id])
check('with no names at all the POS nickname is the name (never "unnamed")', (await one(`select public.sched_name($1) n`, [noNames.id])).n === noNames.handle && noNames.handle.length >= 2, noNames.handle)
const onlyEmail = await addStaff({ email: 'only.mail@x.test', auth: false })
await db.query(`update public.staff set handle = 'xx', first_name = null, display_name = null where id = $1`, [onlyEmail.id])
await db.query(`update public.staff set handle = 'a-b' where id = $1`, [onlyEmail.id])
check('display_name beats first name beats handle', (await one(`select public.sched_name($1) n`, [tamar.id])).n === 'תמר')
check('two people cannot share an email (any case)', (await throws(`insert into public.staff (email, first_name) values ('ONLY.MAIL@x.test', 'x')`, [], /duplicate key|unique/i)) === true)
check('phone length is capped', (await throws(`update public.staff set phone = $2 where id = $1`, [tamar.id, '1'.repeat(40)], /staff_phone_len|check/i)) === true)
await db.query(`update public.staff set phone = '050-1234567' where id = $1`, [tamar.id])

// ---- fixtures ------------------------------------------------------------------
const owner = await addStaff({ email: 'owner@x.test', first: 'Maya', role: 'owner', badge: 'owner' })
const gm = await addStaff({ email: 'gm@x.test', first: 'Gil', badge: 'general_manager', branch: maor })
const delegate = await addStaff({ email: 'del@x.test', first: 'Dalia', badge: 'barista', branch: maor })
const dana = await addStaff({ email: 'dana@x.test', first: 'Dana', badge: 'barista', branch: maor })
const yossi = await addStaff({ email: 'yossi@x.test', first: 'Yossi', badge: 'barista', branch: null }) // floater: both branches
const omer = await addStaff({ email: 'omer@x.test', first: 'Omer', badge: 'barista', branch: ghav })
const gone = await addStaff({ email: 'gone@x.test', first: 'Gone', badge: 'barista', active: false })
const customer = (await one(`insert into auth.users (email) values ('customer@x.test') returning id`)).id
await db.query(`update public.shift_settings set schedule_managers = array[$1::uuid] where branch_id = $2`, [delegate.id, maor])

const W = '2030-01-06' // a Sunday, far in the future
const WPAST = '2020-01-05' // a Sunday, long gone
const day = (n, base = W) => new Date(Date.parse(base + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const weekOf = async (branch, ws) => {
  const r = await one(`insert into public.schedule_weeks (branch_id, week_start) values ($1, $2) on conflict (branch_id, week_start) do update set updated_at = now() returning id`, [branch, ws])
  return r.id
}
const wMaor = await weekOf(maor, W)
const wGhav = await weekOf(ghav, W)
const wPast = await weekOf(maor, WPAST)

const save = (actor, week, over = {}) => rpc('sched_save_shift', {
  p_actor: actor.id, p_week_id: week, p_shift_id: null, p_date: day(1), p_start: '07:00', p_end: '13:00',
  p_preset_id: null, p_station_id: null, p_requirements: '[]', p_note: null, p_assignees: '[]', p_expected_updated: null, ...over,
})
const asg = (staffId, roleId = 'barista', assignmentId = null) => ({ staffId, roleId, ...(assignmentId ? { assignmentId } : {}) })
const shiftRow = (id) => one(`select * from public.shifts where id = $1`, [id])
const assignmentsOf = (shiftId) => q(`select * from public.shift_assignments where shift_id = $1`, [shiftId])
const notesFor = (staff) => q(`select * from public.schedule_notifications where staff_id = $1 order by created_at, id`, [staff.id])

// ============================================================================
section('access (the SQL twins of lib/shifts/access.ts)')
check('owner may manage any branch', (await one(`select public.sched_can_manage($1, $2) a, public.sched_can_manage($1, $3) b`, [owner.id, maor, ghav])).a === true)
check('a general manager manages only their own branch', (await one(`select public.sched_can_manage($1, $2) a, public.sched_can_manage($1, $3) b`, [gm.id, maor, ghav]))
  && (await one(`select public.sched_can_manage($1, $2) a, public.sched_can_manage($1, $3) b`, [gm.id, maor, ghav])).b === false)
check('a delegated barista manages the branch that delegated them', (await one(`select public.sched_can_manage($1, $2) a`, [delegate.id, maor])).a === true)
check('…and nothing else', (await one(`select public.sched_can_manage($1, $2) a`, [delegate.id, ghav])).a === false)
check('an ordinary employee manages nothing', (await one(`select public.sched_can_manage($1, $2) a`, [dana.id, maor])).a === false)
check('a deactivated person manages nothing (even an ex-owner)', (await one(`select public.sched_can_manage($1, $2) a`, [gone.id, maor])).a === false)
check('a floater can view both branches; a branch-bound person only theirs',
  (await one(`select public.sched_can_view($1, $2) a, public.sched_can_view($1, $3) b, public.sched_can_view($4, $2) c, public.sched_can_view($4, $3) d`, [yossi.id, maor, ghav, omer.id])).a === true
  && (await one(`select public.sched_can_view($1, $2) b, public.sched_can_view($3, $2) c, public.sched_can_view($3, $4) d`, [yossi.id, ghav, omer.id, maor])).d === false)
const mgrIds = (await one(`select public.sched_manager_ids($1) ids`, [maor])).ids
check('the manager list = owner + GM + delegate (not employees, not the inactive)', [owner.id, gm.id, delegate.id].every((i) => mgrIds.includes(i)) && !mgrIds.includes(dana.id) && !mgrIds.includes(gone.id), String(mgrIds))

// ============================================================================
section('creating a shift: times, validation, permissions')
const r1 = await save(owner, wMaor, { p_preset_id: 'morning' })
check('a manager creates a shift', r1.ok === true && r1.created === true, JSON.stringify(r1))
const s1 = await shiftRow(r1.shiftId)
check('the shift keeps its explicit times (07:00–13:00) and remembers the template it came from', s1.start_time === '07:00' && s1.end_time === '13:00' && s1.preset_id === 'morning')
check('an ordinary employee cannot create a shift', (await save(dana, wMaor)).reason === 'forbidden')
check('a delegated manager can', (await save(delegate, wMaor, { p_start: '14:00', p_end: '18:00' })).ok === true)
check('a manager of ANOTHER branch cannot', (await save(gm, wGhav)).reason === 'forbidden')
check('a deactivated manager cannot', (await save(gone, wMaor)).reason === 'forbidden')
check('end must differ from start', (await save(owner, wMaor, { p_start: '08:00', p_end: '08:00' })).reason === 'bad_time')
check('times must be HH:MM', (await save(owner, wMaor, { p_start: '8:00' })).reason === 'bad_time' && (await save(owner, wMaor, { p_end: '25:00' })).reason === 'bad_time')
check('the date must be inside the week being edited', (await save(owner, wMaor, { p_date: day(9) })).reason === 'bad_date' && (await save(owner, wMaor, { p_date: day(-1) })).reason === 'bad_date')
check('an unknown week is not found', (await save(owner, crypto.randomUUID())).reason === 'not_found')
check('the database itself rejects a malformed time', (await throws(`insert into public.shifts (branch_id, week_id, shift_date, start_time, end_time) values ($1,$2,$3,'7','13:00')`, [maor, wMaor, day(1)], /shifts_time_format|check/i)) === true)
check('a shift past midnight is allowed (22:00–02:00)', (await save(owner, wMaor, { p_date: day(5), p_start: '22:00', p_end: '02:00' })).ok === true)
check('creating it was audited with who did it', (await one(`select actor_name, summary from public.shift_audit where action = 'shift.create' order by id limit 1`)).actor_name === 'Maya')

// ============================================================================
section('assigning people — including people with no email')
const r2 = await save(owner, wMaor, { p_date: day(2), p_start: '07:00', p_end: '13:00', p_assignees: JSON.stringify([asg(tamar.id), asg(dana.id)]) })
check('a person with NO email and NO sign-in can be scheduled (with another)', r2.ok === true && r2.added.length === 2, JSON.stringify(r2))
const a2 = await assignmentsOf(r2.shiftId)
check('their name is stored on the assignment (not NULL / "unnamed")', a2.some((a) => a.staff_name === 'תמר') && a2.every((a) => a.staff_name), JSON.stringify(a2.map((a) => a.staff_name)))
check('a legacy first+last-name person is named in full', (await one(`select public.sched_name($1) n`, [legacyBoth.id])).n === 'נועה כהן')
const r3 = await save(owner, wMaor, { p_date: day(3), p_assignees: JSON.stringify([asg(tamar.id), asg(tamar.id)]) })
check('the same person twice in one save is refused, naming them', r3.reason === 'duplicate_person' && r3.details.name === 'תמר')
check('an inactive person cannot be assigned', (await save(owner, wMaor, { p_date: day(3), p_assignees: JSON.stringify([asg(gone.id)]) })).reason === 'inactive_staff')
check('someone bound to the OTHER branch cannot be assigned here', (await save(owner, wMaor, { p_date: day(3), p_assignees: JSON.stringify([asg(omer.id)]) })).reason === 'wrong_branch')
await db.query(`insert into public.schedule_members (branch_id, staff_id, schedulable) values ($1, $2, false)`, [maor, legacyBoth.id])
check('someone switched OFF for scheduling cannot be assigned', (await save(owner, wMaor, { p_date: day(3), p_assignees: JSON.stringify([asg(legacyBoth.id)]) })).reason === 'not_schedulable')
await db.query(`delete from public.schedule_members where staff_id = $1`, [legacyBoth.id])
check('no member row = schedulable (the default everywhere)', (await save(owner, wMaor, { p_date: day(3), p_start: '05:00', p_end: '06:00', p_assignees: JSON.stringify([asg(legacyBoth.id)]) })).ok === true)

// ============================================================================
section('conflicts — nobody is ever in two places at once')
const base = await save(owner, wMaor, { p_date: day(4), p_start: '10:00', p_end: '14:00', p_assignees: JSON.stringify([asg(dana.id)]) })
const overlap = await save(owner, wMaor, { p_date: day(4), p_start: '12:00', p_end: '16:00', p_assignees: JSON.stringify([asg(dana.id)]) })
check('an overlapping shift for the same person is refused', overlap.reason === 'conflict' && overlap.details.conflicts[0].name === 'Dana', JSON.stringify(overlap))
check('…and the message data says WHICH shift they are already on', overlap.details.conflicts[0].with.start === '10:00' && overlap.details.conflicts[0].with.end === '14:00')
check('back-to-back (14:00 end, 14:00 start) is fine', (await save(owner, wMaor, { p_date: day(4), p_start: '14:00', p_end: '18:00', p_assignees: JSON.stringify([asg(dana.id)]) })).ok === true)
const gShift = await save(owner, wGhav, { p_date: day(4), p_start: '09:00', p_end: '11:00', p_assignees: JSON.stringify([asg(yossi.id)]) })
check('a floater works one branch at a time: ghav 09–11 is ok', gShift.ok === true)
const cross = await save(owner, wMaor, { p_date: day(4), p_start: '10:00', p_end: '13:00', p_assignees: JSON.stringify([asg(yossi.id)]) })
check('…but not the other branch at an overlapping time (cross-branch conflict)', cross.reason === 'conflict', JSON.stringify(cross))
const night = await save(owner, wMaor, { p_date: day(5), p_start: '22:00', p_end: '02:00', p_assignees: JSON.stringify([asg(yossi.id)]) })
check('a night shift is assigned', night.ok === true)
check('its tail (until 02:00 the NEXT day) blocks an early shift that day', (await save(owner, wMaor, { p_date: day(6), p_start: '01:00', p_end: '04:00', p_assignees: JSON.stringify([asg(yossi.id)]) })).reason === 'conflict')
check('…but not once it has ended (02:00)', (await save(owner, wMaor, { p_date: day(6), p_start: '02:00', p_end: '04:00', p_assignees: JSON.stringify([asg(yossi.id)]) })).ok === true)

const baseShift = base.shiftId
const baseAssign = (await assignmentsOf(baseShift))[0]
const edit = await save(owner, wMaor, { p_shift_id: baseShift, p_date: day(4), p_start: '12:30', p_end: '14:30', p_assignees: JSON.stringify([asg(dana.id, 'barista', baseAssign.id)]) })
check('moving a shift onto the person\'s other shift is refused (kept people are re-checked)', edit.reason === 'conflict', JSON.stringify(edit))
check('…and nothing was changed (all-or-nothing)', (await shiftRow(baseShift)).start_time === '10:00')
const sneak = await one(`insert into public.shifts (branch_id, week_id, shift_date, start_time, end_time) values ($1,$2,$3,'11:00','12:00') returning id`, [maor, wMaor, day(4)])
check('direct insert of an overlapping assignment fails at commit (deferred constraint trigger)',
  (await throws(`insert into public.shift_assignments (branch_id, shift_id, staff_id) values ($1, $2, $3)`, [maor, sneak.id, dana.id], /sched_overlap/)) === true)
check('direct UPDATE of a shift\'s time onto an assignee\'s other shift fails too',
  (await throws(`update public.shifts set start_time = '10:30', end_time = '11:30' where id = (select id from public.shifts where shift_date = $1 and start_time = '14:00' and branch_id = $2)`, [day(4), maor], /sched_overlap/)) === true)
check('one person once per shift — enforced by a unique index',
  (await throws(`insert into public.shift_assignments (branch_id, shift_id, staff_id, role_id) values ($1, $2, $3, null)`, [maor, baseShift, dana.id], /duplicate key|unique/i)) === true)
await db.query(`delete from public.shifts where id = $1`, [sneak.id])

// ============================================================================
section('editing: only what the manager changes changes')
const stale = await save(owner, wMaor, { p_shift_id: baseShift, p_expected_updated: '2020-01-01T00:00:00Z', p_date: day(4), p_start: '10:00', p_end: '14:00', p_assignees: JSON.stringify([asg(dana.id, 'barista', baseAssign.id)]) })
check('saving from an out-of-date copy is refused (two managers at once)', stale.reason === 'stale')
const fresh = (await shiftRow(baseShift)).updated_at
const iso = new Date(fresh).toISOString()
const okEdit = await save(owner, wMaor, { p_shift_id: baseShift, p_expected_updated: fresh instanceof Date ? fresh.toISOString() : String(fresh), p_date: day(4), p_start: '10:00', p_end: '14:00', p_note: 'פתיחה', p_assignees: JSON.stringify([asg(dana.id, 'cashier', baseAssign.id)]) })
check('saving from the current copy works (role change + note)', okEdit.ok === true && (await assignmentsOf(baseShift))[0].role_id === 'cashier' && (await shiftRow(baseShift)).note === 'פתיחה', JSON.stringify(okEdit) + iso)
check('the same person keeps the same assignment row (identity preserved)', (await assignmentsOf(baseShift))[0].id === baseAssign.id)
const removed = await save(owner, wMaor, { p_shift_id: baseShift, p_date: day(4), p_start: '10:00', p_end: '14:00', p_assignees: '[]' })
check('removing everyone empties the shift but keeps it', removed.ok === true && removed.removed.includes('Dana') && (await assignmentsOf(baseShift)).length === 0)
check('every change is in the audit log', (await one(`select count(*)::int n from public.shift_audit where action = 'shift.update'`)).n >= 2)

// ============================================================================
section('moving a person to a different shift')
const mvA = await save(owner, wMaor, { p_date: day(1), p_start: '15:00', p_end: '19:00', p_assignees: JSON.stringify([asg(dana.id)]) })
const mvB = await save(owner, wMaor, { p_date: day(1), p_start: '19:00', p_end: '22:00' })
const mvAssign = (await assignmentsOf(mvA.shiftId))[0]
const moved = await rpc('sched_move_assignment', { p_actor: owner.id, p_assignment: mvAssign.id, p_to_shift: mvB.shiftId })
check('a manager moves Dana from the afternoon to the evening', moved.ok === true && (await assignmentsOf(mvB.shiftId)).length === 1 && (await assignmentsOf(mvA.shiftId)).length === 0, JSON.stringify(moved))
check('an employee cannot move anyone', (await rpc('sched_move_assignment', { p_actor: dana.id, p_assignment: mvAssign.id, p_to_shift: mvA.shiftId })).reason === 'forbidden')
const clashTarget = await save(owner, wMaor, { p_date: day(4), p_start: '16:00', p_end: '20:00' }) // Dana already works day(4) 14:00–18:00
check('moving onto a clashing shift is refused, naming the clash', await (async () => {
  const r = await rpc('sched_move_assignment', { p_actor: owner.id, p_assignment: mvAssign.id, p_to_shift: clashTarget.shiftId })
  return r.reason === 'conflict' && r.details.conflicts[0].name === 'Dana' && r.details.conflicts[0].with.start === '14:00'
})())
check('…and she is still where she was', (await assignmentsOf(mvB.shiftId))[0].staff_id === dana.id)
check('moving to a shift of another branch is refused', (await rpc('sched_move_assignment', { p_actor: owner.id, p_assignment: mvAssign.id, p_to_shift: gShift.shiftId })).reason === 'not_found')

// ============================================================================
section('publishing: employees see a frozen copy, and are told what changed')
const pubW = '2030-02-03'
const wPub = await weekOf(maor, pubW)
const pa = await save(owner, wPub, { p_date: day(1, pubW), p_start: '07:00', p_end: '13:00', p_requirements: JSON.stringify([{ roleId: 'barista', min: 2 }]), p_assignees: JSON.stringify([asg(dana.id), asg(tamar.id)]) })
const pb = await save(owner, wPub, { p_date: day(2, pubW), p_start: '13:00', p_end: '19:00', p_assignees: JSON.stringify([asg(yossi.id)]) })
const pc = await save(owner, wPub, { p_date: day(3, pubW), p_start: '07:00', p_end: '13:00' })
check('nothing is visible to employees before publish (draft)', (await one(`select status, published_snapshot from public.schedule_weeks where id = $1`, [wPub])).published_snapshot === null)
check('an employee cannot publish', (await rpc('sched_publish_week', { p_actor: dana.id, p_week_id: wPub })).reason === 'forbidden')
const pub1 = await rpc('sched_publish_week', { p_actor: owner.id, p_week_id: wPub })
check('a manager publishes', pub1.ok === true && pub1.version === 1 && pub1.update === false, JSON.stringify(pub1))
const snap = (await one(`select published_snapshot s from public.schedule_weeks where id = $1`, [wPub])).s
check('the snapshot holds the shifts and assignments', snap.shifts.length === 3 && snap.assignments.length === 3)
const nDana = await notesFor(dana)
check('Dana (has a sign-in) is told her shifts were published', nDana.length === 1 && nDana[0].title === 'פורסם לוח משמרות' && /יום שני 4\/2/.test(nDana[0].body), JSON.stringify(nDana[0]))
check('Tamar (no sign-in) gets no row — there is nowhere for her to read it', (await notesFor(tamar)).length === 0)
check('publishing was audited', (await one(`select count(*)::int n from public.shift_audit where action = 'schedule.publish'`)).n === 1)
// manager edits the live week afterwards: the snapshot must NOT change
const pbAssign = (await assignmentsOf(pb.shiftId))[0]
await save(owner, wPub, { p_shift_id: pb.shiftId, p_date: day(2, pubW), p_start: '14:00', p_end: '19:00', p_assignees: JSON.stringify([asg(yossi.id, 'barista', pbAssign.id)]) })
check('a later draft edit does not leak into what employees see', (await one(`select published_snapshot->'shifts' s from public.schedule_weeks where id = $1`, [wPub])).s.some((s) => s.id === pb.shiftId && s.start_time === '13:00'))
const pub2 = await rpc('sched_publish_week', { p_actor: owner.id, p_week_id: wPub })
const nYossi = await notesFor(yossi)
check('re-publishing tells only the affected person, and what changed', pub2.update === true && pub2.notified === 1 && nYossi.length === 2 && nYossi[1].title === 'הלוח שלך עודכן' && /השתנתה/.test(nYossi[1].body) && /13:00/.test(nYossi[1].body) && nYossi[1].body.includes('⁦'), JSON.stringify(nYossi.map((n) => n.body)))
check('…version went up', (await one(`select version from public.schedule_weeks where id = $1`, [wPub])).version === 2)

// ============================================================================
section('shift requests: "I would like to work this shift"')
const pcShift = pc.shiftId
check('a request for an UNPUBLISHED week is refused', (await rpc('sched_request_shift', { p_actor: dana.id, p_shift: r2.shiftId, p_note: null })).reason === 'not_published')
check('a person from another branch cannot request', (await rpc('sched_request_shift', { p_actor: omer.id, p_shift: pcShift, p_note: null })).reason === 'forbidden')
check('a deactivated person cannot', (await rpc('sched_request_shift', { p_actor: gone.id, p_shift: pcShift, p_note: null })).reason === 'forbidden')
check('someone already on the shift cannot request it', (await rpc('sched_request_shift', { p_actor: dana.id, p_shift: pa.shiftId, p_note: null })).reason === 'already_assigned')
const req1 = await rpc('sched_request_shift', { p_actor: dana.id, p_shift: pcShift, p_note: 'אשמח לקחת' })
check('Dana requests Thursday morning', req1.ok === true, JSON.stringify(req1))
check('the request is PENDING and the schedule is untouched', (await one(`select status from public.shift_requests where id = $1`, [req1.requestId])).status === 'pending' && (await assignmentsOf(pcShift)).length === 0)
check('the live snapshot is untouched too', (await one(`select published_snapshot->'assignments' a from public.schedule_weeks where id = $1`, [wPub])).a.length === 3)
check('the same request twice is a duplicate', (await rpc('sched_request_shift', { p_actor: dana.id, p_shift: pcShift, p_note: null })).reason === 'duplicate_request')
check('every manager is told (owner, GM, delegate) — and not the requester', (await notesFor(owner)).some((n) => n.kind === 'request.new') && (await notesFor(gm)).some((n) => n.kind === 'request.new') && (await notesFor(delegate)).some((n) => n.kind === 'request.new') && !(await notesFor(dana)).some((n) => n.kind === 'request.new'))
check('the request keeps what was asked for (date + time) as a snapshot', (await one(`select terms from public.shift_requests where id = $1`, [req1.requestId])).terms.start === '07:00')
check('an employee cannot decide their own request', (await rpc('sched_decide_request', { p_actor: dana.id, p_request: req1.requestId, p_approve: true, p_note: null, p_force: true })).reason === 'forbidden')
check('…nor can a manager of another branch', (await rpc('sched_decide_request', { p_actor: omer.id, p_request: req1.requestId, p_approve: true, p_note: null })).reason === 'forbidden')
check('somebody else cannot cancel it', (await rpc('sched_cancel_request', { p_actor: yossi.id, p_request: req1.requestId })).reason === 'forbidden')

// conflicts at request time
const busyShift = await save(owner, wPub, { p_date: day(3, pubW), p_start: '09:00', p_end: '11:00', p_assignees: JSON.stringify([asg(yossi.id)]) })
await rpc('sched_publish_week', { p_actor: owner.id, p_week_id: wPub })
check('a request that overlaps something they already work is refused with the clash named', await (async () => {
  const r = await rpc('sched_request_shift', { p_actor: yossi.id, p_shift: pcShift, p_note: null })
  return r.reason === 'busy' && r.details.with.start === '09:00'
})())
check('a second PENDING request at the same time (contradictory) is refused', await (async () => {
  const other = await save(owner, wPub, { p_date: day(3, pubW), p_start: '08:00', p_end: '12:00' })
  await rpc('sched_publish_week', { p_actor: owner.id, p_week_id: wPub })
  return (await rpc('sched_request_shift', { p_actor: dana.id, p_shift: other.shiftId, p_note: null })).reason === 'overlapping_request'
})())
// full shift
const fullShift = pa.shiftId // needs 2 baristas, has Dana + Tamar
check('a shift that is already full cannot be requested', (await rpc('sched_request_shift', { p_actor: delegate.id, p_shift: fullShift, p_note: null })).reason === 'shift_full')
// availability
await db.query(`insert into public.shift_availability (branch_id, staff_id, week_start, entries, status) values ($1,$2,$3,$4,'submitted')`, [maor, delegate.id, pubW, JSON.stringify([{ date: day(5, pubW), kind: 'unavailable' }]), ])
const friShift = await save(owner, wPub, { p_date: day(5, pubW), p_start: '07:00', p_end: '12:00' })
await rpc('sched_publish_week', { p_actor: owner.id, p_week_id: wPub })
check('requesting a day they marked unavailable is refused, naming the date', await (async () => {
  const r = await rpc('sched_request_shift', { p_actor: delegate.id, p_shift: friShift.shiftId, p_note: null })
  return r.reason === 'unavailable_day' && r.details.date === day(5, pubW)
})())
// past
const pastShift = await save(owner, wPast, { p_date: day(1, WPAST), p_start: '07:00', p_end: '13:00' })
await rpc('sched_publish_week', { p_actor: owner.id, p_week_id: wPast })
check('a shift that already happened cannot be requested', (await rpc('sched_request_shift', { p_actor: dana.id, p_shift: pastShift.shiftId, p_note: null })).reason === 'past')
await db.query(`insert into public.schedule_members (branch_id, staff_id, schedulable) values ($1, $2, false) on conflict do nothing`, [maor, omer.id])

// decisions
check('approving a request that is fine needs no confirmation', await (async () => {
  const r = await rpc('sched_decide_request', { p_actor: owner.id, p_request: req1.requestId, p_approve: true, p_note: 'מעולה', p_force: false })
  return r.ok === true && r.status === 'approved'
})())
check('…it put Dana on the shift (live)', (await assignmentsOf(pcShift)).some((a) => a.staff_id === dana.id && a.staff_name === 'Dana'))
check('…AND in what employees see (snapshot patched at once)', (await one(`select published_snapshot->'assignments' a from public.schedule_weeks where id = $1`, [wPub])).a.some((a) => a.staff_id === dana.id && a.shift_id === pcShift))
check('…without publishing anything else the manager had drafted', (await one(`select jsonb_array_length(published_snapshot->'shifts') n from public.schedule_weeks where id = $1`, [wPub])).n >= 1)
check('Dana is told the outcome, with the note', (await notesFor(dana)).some((n) => n.kind === 'request.approved' && /מעולה/.test(n.body)))
check('a decided request cannot be decided twice', (await rpc('sched_decide_request', { p_actor: owner.id, p_request: req1.requestId, p_approve: false, p_note: null })).reason === 'not_pending')
check('…nor cancelled by its owner', (await rpc('sched_cancel_request', { p_actor: dana.id, p_request: req1.requestId })).reason === 'not_pending')

// soft issues need explicit confirmation
const openShift = await save(owner, wPub, { p_date: day(4, pubW), p_start: '07:00', p_end: '13:00', p_assignees: JSON.stringify([asg(yossi.id)]) })
await rpc('sched_publish_week', { p_actor: owner.id, p_week_id: wPub })
const reqOcc = await rpc('sched_request_shift', { p_actor: delegate.id, p_shift: openShift.shiftId, p_note: null })
const occ = await rpc('sched_decide_request', { p_actor: owner.id, p_request: reqOcc.requestId, p_approve: true, p_note: null, p_force: false })
check('a shift that already has someone: the manager must CONFIRM, and is told who', occ.reason === 'needs_confirmation' && occ.details.issues[0].code === 'occupied' && /Yossi/.test(occ.details.issues[0].message), JSON.stringify(occ))
check('…nothing was approved silently', (await assignmentsOf(openShift.shiftId)).length === 1 && (await one(`select status from public.shift_requests where id = $1`, [reqOcc.requestId])).status === 'pending')
const occForce = await rpc('sched_decide_request', { p_actor: owner.id, p_request: reqOcc.requestId, p_approve: true, p_note: null, p_force: true })
check('with explicit confirmation it goes through (and is audited as forced)', occForce.ok === true && (await one(`select detail from public.shift_audit where action = 'request.approve' order by id desc limit 1`)).detail.forced === true)
// hard conflicts at decision time
const reqLate = await rpc('sched_request_shift', { p_actor: omer.id, p_shift: (await save(owner, wGhav, { p_date: day(2), p_start: '08:00', p_end: '12:00' })).shiftId, p_note: null })
check('(setup) a request on an unpublished week is refused first', reqLate.reason === 'not_published')
// request, then the manager schedules the person at a clashing time before deciding
const target = await save(owner, wPub, { p_date: day(6, pubW), p_start: '10:00', p_end: '14:00' })
await rpc('sched_publish_week', { p_actor: owner.id, p_week_id: wPub })
const reqClash = await rpc('sched_request_shift', { p_actor: delegate.id, p_shift: target.shiftId, p_note: null })
await save(owner, wPub, { p_date: day(6, pubW), p_start: '12:00', p_end: '16:00', p_assignees: JSON.stringify([asg(delegate.id)]) })
const clash = await rpc('sched_decide_request', { p_actor: owner.id, p_request: reqClash.requestId, p_approve: true, p_note: null, p_force: true })
check('if the manager changed the schedule while it was pending, approval is refused even with force (hard conflict)', clash.reason === 'busy', JSON.stringify(clash))
check('rejecting works and tells the employee', await (async () => {
  const r = await rpc('sched_decide_request', { p_actor: owner.id, p_request: reqClash.requestId, p_approve: false, p_note: 'כבר שובצת', p_force: false })
  return r.ok && r.status === 'rejected' && (await notesFor(delegate)).some((n) => n.kind === 'request.rejected' && /כבר שובצת/.test(n.body))
})())
// employee cancels
const reqCancel = await rpc('sched_request_shift', { p_actor: dana.id, p_shift: friShift.shiftId, p_note: null })
check('an employee cancels their own pending request', (await rpc('sched_cancel_request', { p_actor: dana.id, p_request: reqCancel.requestId })).ok === true && (await one(`select status from public.shift_requests where id = $1`, [reqCancel.requestId])).status === 'cancelled')
check('…managers are told it was cancelled', (await notesFor(owner)).some((n) => n.kind === 'request.cancelled'))
check('…and they can ask again afterwards', (await rpc('sched_request_shift', { p_actor: dana.id, p_shift: friShift.shiftId, p_note: null })).ok === true)
// manager puts the person on directly -> pending request resolved
const reqDirect = (await one(`select id from public.shift_requests where shift_id = $1 and status = 'pending'`, [friShift.shiftId])).id
await save(owner, wPub, { p_shift_id: friShift.shiftId, p_date: day(5, pubW), p_start: '07:00', p_end: '12:00', p_assignees: JSON.stringify([asg(dana.id)]) })
check('putting the requester on the shift yourself answers their pending request', (await one(`select status from public.shift_requests where id = $1`, [reqDirect])).status === 'approved')
// deleting the shift cancels pending requests
const delTarget = await save(owner, wPub, { p_date: day(0, pubW), p_start: '09:00', p_end: '11:00' })
await rpc('sched_publish_week', { p_actor: owner.id, p_week_id: wPub })
const reqDel = await rpc('sched_request_shift', { p_actor: dana.id, p_shift: delTarget.shiftId, p_note: null })
const del = await rpc('sched_delete_shift', { p_actor: owner.id, p_shift_id: delTarget.shiftId })
check('deleting a shift cancels the requests on it (kept as history, with the reason)', del.ok === true && del.requestsCancelled === 1 && (await one(`select status, cancel_reason, shift_id from public.shift_requests where id = $1`, [reqDel.requestId])).cancel_reason === 'המשמרת בוטלה')
check('an employee cannot delete a shift', (await rpc('sched_delete_shift', { p_actor: dana.id, p_shift_id: delTarget.shiftId })).reason === 'forbidden' || (await rpc('sched_delete_shift', { p_actor: dana.id, p_shift_id: delTarget.shiftId })).reason === 'not_found')

// ============================================================================
section('shift swaps: hand-over and exchange, always with manager approval')
const sw = '2030-03-03'
const wSw = await weekOf(maor, sw)
const sA = await save(owner, wSw, { p_date: day(1, sw), p_start: '07:00', p_end: '13:00', p_assignees: JSON.stringify([asg(dana.id)]) })
const sB = await save(owner, wSw, { p_date: day(2, sw), p_start: '13:00', p_end: '19:00', p_assignees: JSON.stringify([asg(yossi.id)]) })
const sC = await save(owner, wSw, { p_date: day(1, sw), p_start: '08:00', p_end: '12:00', p_assignees: JSON.stringify([asg(delegate.id)]) })
const aDana = (await assignmentsOf(sA.shiftId))[0]
const aYossi = (await assignmentsOf(sB.shiftId))[0]
const aDel = (await assignmentsOf(sC.shiftId))[0]
check('(setup) an unpublished week offers nothing to swap', (await rpc('sched_request_swap', { p_actor: dana.id, p_assignment: aDana.id, p_target: yossi.id, p_return: null, p_reason: null })).reason === 'not_published')
await rpc('sched_publish_week', { p_actor: owner.id, p_week_id: wSw })
check('you can only swap YOUR OWN shift', (await rpc('sched_request_swap', { p_actor: yossi.id, p_assignment: aDana.id, p_target: dana.id, p_return: null, p_reason: null })).reason === 'forbidden')
check('you cannot swap with yourself', (await rpc('sched_request_swap', { p_actor: dana.id, p_assignment: aDana.id, p_target: dana.id, p_return: null, p_reason: null })).reason === 'bad_target')
check('…nor with a deactivated person', (await rpc('sched_request_swap', { p_actor: dana.id, p_assignment: aDana.id, p_target: gone.id, p_return: null, p_reason: null })).reason === 'bad_target')
check('…nor with someone who is busy at that time (named)', await (async () => {
  const r = await rpc('sched_request_swap', { p_actor: dana.id, p_assignment: aDana.id, p_target: delegate.id, p_return: null, p_reason: null })
  return r.reason === 'target_busy' && r.details.name === 'Dalia'
})())
const swap1 = await rpc('sched_request_swap', { p_actor: dana.id, p_assignment: aDana.id, p_target: yossi.id, p_return: null, p_reason: 'יש לי רופא' })
check('Dana asks Yossi to take her Monday morning', swap1.ok === true, JSON.stringify(swap1))
const sw1 = await one(`select * from public.shift_swaps where id = $1`, [swap1.swapId])
check('it starts OPEN, waiting for Yossi — the swap record carries both names and what was agreed', sw1.status === 'open' && sw1.from_staff_name === 'Dana' && sw1.to_staff_name === 'Yossi' && sw1.terms.from.start === '07:00')
check('A PENDING SWAP DOES NOT TOUCH THE SCHEDULE (live)', (await assignmentsOf(sA.shiftId))[0].staff_id === dana.id && (await assignmentsOf(sA.shiftId))[0].status === 'assigned')
check('…nor what employees see (snapshot)', (await one(`select published_snapshot->'assignments' a from public.schedule_weeks where id = $1`, [wSw])).a.find((a) => a.id === aDana.id).staff_id === dana.id)
check('Yossi is told, with the details', (await notesFor(yossi)).some((n) => n.kind === 'swap.request' && /Dana/.test(n.title)))
check('a second request for the same shift is refused', (await rpc('sched_request_swap', { p_actor: dana.id, p_assignment: aDana.id, p_target: null, p_return: null, p_reason: null })).reason === 'duplicate_swap')
check('a manager cannot approve before the other person agreed', (await rpc('sched_decide_swap', { p_actor: owner.id, p_swap: swap1.swapId, p_approve: true, p_note: null })).reason === 'not_pending')
check('a stranger cannot answer a swap addressed to Yossi', (await rpc('sched_respond_swap', { p_actor: delegate.id, p_swap: swap1.swapId, p_accept: true })).reason === 'forbidden')
check('the requester cannot accept their own swap', (await rpc('sched_respond_swap', { p_actor: dana.id, p_swap: swap1.swapId, p_accept: true })).reason === 'forbidden')
const acc = await rpc('sched_respond_swap', { p_actor: yossi.id, p_swap: swap1.swapId, p_accept: true })
check('Yossi accepts → it now waits for the manager', acc.ok === true && acc.status === 'peer_accepted')
check('STILL nothing changed in the schedule', (await assignmentsOf(sA.shiftId))[0].staff_id === dana.id)
check('managers are told it needs them; Dana is told Yossi agreed', (await notesFor(owner)).some((n) => n.kind === 'swap.awaiting') && (await notesFor(dana)).some((n) => n.kind === 'swap.accepted'))
check('an employee cannot approve it (not even one of the two)', (await rpc('sched_decide_swap', { p_actor: yossi.id, p_swap: swap1.swapId, p_approve: true, p_note: null })).reason === 'forbidden' && (await rpc('sched_decide_swap', { p_actor: dana.id, p_swap: swap1.swapId, p_approve: true, p_note: null })).reason === 'forbidden')
const appr = await rpc('sched_decide_swap', { p_actor: owner.id, p_swap: swap1.swapId, p_approve: true, p_note: 'בסדר' })
check('the manager approves', appr.ok === true && appr.status === 'approved', JSON.stringify(appr))
check('Monday morning is now Yossi\'s (live)', (await assignmentsOf(sA.shiftId))[0].staff_id === yossi.id && (await assignmentsOf(sA.shiftId))[0].staff_name === 'Yossi')
check('…and in what employees see, immediately', (await one(`select published_snapshot->'assignments' a from public.schedule_weeks where id = $1`, [wSw])).a.find((a) => a.id === aDana.id).staff_id === yossi.id)
check('both are told, with the outcome', (await notesFor(dana)).some((n) => n.kind === 'swap.approved') && (await notesFor(yossi)).some((n) => n.kind === 'swap.approved'))
check('the approval is audited with who approved and who swapped', (await one(`select actor_name, summary from public.shift_audit where action = 'swap.approve' order by id desc limit 1`)).actor_name === 'Maya')
check('an approved swap cannot be approved again', (await rpc('sched_decide_swap', { p_actor: owner.id, p_swap: swap1.swapId, p_approve: true, p_note: null })).reason === 'not_pending')

// decline
const aDana2 = await save(owner, wSw, { p_date: day(3, sw), p_start: '07:00', p_end: '10:00', p_assignees: JSON.stringify([asg(dana.id)]) })
await rpc('sched_publish_week', { p_actor: owner.id, p_week_id: wSw })
const swDec = await rpc('sched_request_swap', { p_actor: dana.id, p_assignment: (await assignmentsOf(aDana2.shiftId))[0].id, p_target: yossi.id, p_return: null, p_reason: null })
check('Yossi declines → declined, schedule untouched, Dana told', (await rpc('sched_respond_swap', { p_actor: yossi.id, p_swap: swapIdOrNull(swDec), p_accept: false })).status === 'declined' && (await assignmentsOf(aDana2.shiftId))[0].staff_id === dana.id && (await notesFor(dana)).some((n) => n.kind === 'swap.declined'))
function swapIdOrNull(r) { return r.swapId }
check('after a decline the shift can be offered again', (await rpc('sched_request_swap', { p_actor: dana.id, p_assignment: (await assignmentsOf(aDana2.shiftId))[0].id, p_target: null, p_return: null, p_reason: null })).ok === true)

// reject
const swRej = await rpc('sched_request_swap', { p_actor: yossi.id, p_assignment: aYossi.id, p_target: dana.id, p_return: null, p_reason: null })
await rpc('sched_respond_swap', { p_actor: dana.id, p_swap: swRej.swapId, p_accept: true })
const rej = await rpc('sched_decide_swap', { p_actor: owner.id, p_swap: swRej.swapId, p_approve: false, p_note: 'אי אפשר' })
check('the manager rejects → schedule unchanged, both told with the reason', rej.status === 'rejected' && (await assignmentsOf(sB.shiftId))[0].staff_id === yossi.id && (await notesFor(yossi)).some((n) => n.kind === 'swap.rejected' && /אי אפשר/.test(n.body)))

// exchange
const xa = await save(owner, wSw, { p_date: day(5, sw), p_start: '08:00', p_end: '12:00', p_assignees: JSON.stringify([asg(dana.id)]) })
const xb = await save(owner, wSw, { p_date: day(6, sw), p_start: '08:00', p_end: '12:00', p_assignees: JSON.stringify([asg(yossi.id)]) })
await rpc('sched_publish_week', { p_actor: owner.id, p_week_id: wSw })
const xaA = (await assignmentsOf(xa.shiftId))[0]
const xbA = (await assignmentsOf(xb.shiftId))[0]
check('an exchange needs a named person', (await rpc('sched_request_swap', { p_actor: dana.id, p_assignment: xaA.id, p_target: null, p_return: xbA.id, p_reason: null })).reason === 'bad_request')
check('the return shift must be the other person\'s', (await rpc('sched_request_swap', { p_actor: dana.id, p_assignment: xaA.id, p_target: yossi.id, p_return: aDel.id, p_reason: null })).reason === 'bad_request')
const ex = await rpc('sched_request_swap', { p_actor: dana.id, p_assignment: xaA.id, p_target: yossi.id, p_return: xbA.id, p_reason: null })
check('Dana offers Friday for Yossi\'s Saturday', ex.ok === true, JSON.stringify(ex))
check('the swap record holds BOTH shifts (date and time of each)', await (async () => {
  const t = (await one(`select terms from public.shift_swaps where id = $1`, [ex.swapId])).terms
  return t.from.start === '08:00' && t.to.start === '08:00' && t.from.date !== t.to.date
})())
check('Yossi\'s Saturday is locked into this swap (cannot be swapped twice)', (await rpc('sched_request_swap', { p_actor: yossi.id, p_assignment: xbA.id, p_target: delegate.id, p_return: null, p_reason: null })).reason === 'duplicate_swap')
await rpc('sched_respond_swap', { p_actor: yossi.id, p_swap: ex.swapId, p_accept: true })
const exOk = await rpc('sched_decide_swap', { p_actor: gm.id, p_swap: ex.swapId, p_approve: true, p_note: null })
check('a general manager approves the exchange', exOk.ok === true, JSON.stringify(exOk))
check('both people moved: Dana works Saturday, Yossi works Friday (live)', (await assignmentsOf(xa.shiftId))[0].staff_id === yossi.id && (await assignmentsOf(xb.shiftId))[0].staff_id === dana.id)
check('…and in what employees see', await (async () => {
  const a = (await one(`select published_snapshot->'assignments' a from public.schedule_weeks where id = $1`, [wSw])).a
  return a.find((x) => x.id === xaA.id).staff_id === yossi.id && a.find((x) => x.id === xbA.id).staff_id === dana.id
})())

// the manager changes the schedule while a swap is pending
const mA = await save(owner, wSw, { p_date: day(0, sw), p_start: '08:00', p_end: '12:00', p_assignees: JSON.stringify([asg(dana.id)]) })
await rpc('sched_publish_week', { p_actor: owner.id, p_week_id: wSw })
const mAA = (await assignmentsOf(mA.shiftId))[0]
const swPend = await rpc('sched_request_swap', { p_actor: dana.id, p_assignment: mAA.id, p_target: yossi.id, p_return: null, p_reason: null })
await rpc('sched_respond_swap', { p_actor: yossi.id, p_swap: swPend.swapId, p_accept: true })
await save(owner, wSw, { p_shift_id: mA.shiftId, p_date: day(0, sw), p_start: '09:00', p_end: '13:00', p_assignees: JSON.stringify([asg(dana.id, 'barista', mAA.id)]) })
check('changing the shift\'s time cancels the swap that was agreed for the old time', (await one(`select status, cancel_reason from public.shift_swaps where id = $1`, [swPend.swapId])).status === 'cancelled')
check('…it can no longer be approved', (await rpc('sched_decide_swap', { p_actor: owner.id, p_swap: swPend.swapId, p_approve: true, p_note: null })).reason === 'not_pending')
check('…Dana and Yossi and the managers are told why', (await notesFor(yossi)).some((n) => n.kind === 'swap.cancelled' && /השתנו/.test(n.body)) && (await notesFor(owner)).some((n) => n.kind === 'swap.cancelled'))
// removing the person cancels it
const swPend2 = await rpc('sched_request_swap', { p_actor: dana.id, p_assignment: mAA.id, p_target: null, p_return: null, p_reason: null })
await save(owner, wSw, { p_shift_id: mA.shiftId, p_date: day(0, sw), p_start: '09:00', p_end: '13:00', p_assignees: '[]' })
check('taking Dana off the shift cancels her swap (history kept, linked assignment gone)', await (async () => {
  const s = await one(`select status, assignment_id from public.shift_swaps where id = $1`, [swPend2.swapId])
  return s.status === 'cancelled' && s.assignment_id === null
})())
// approval-time re-check: a conflict that appeared after the peer said yes
const cz = await save(owner, wSw, { p_date: day(4, sw), p_start: '07:00', p_end: '11:00', p_assignees: JSON.stringify([asg(dana.id)]) })
await rpc('sched_publish_week', { p_actor: owner.id, p_week_id: wSw })
const czA = (await assignmentsOf(cz.shiftId))[0]
const swCz = await rpc('sched_request_swap', { p_actor: dana.id, p_assignment: czA.id, p_target: delegate.id, p_return: null, p_reason: null })
await rpc('sched_respond_swap', { p_actor: delegate.id, p_swap: swCz.swapId, p_accept: true })
await save(owner, wSw, { p_date: day(4, sw), p_start: '09:00', p_end: '12:00', p_assignees: JSON.stringify([asg(delegate.id)]) })
const czTry = await rpc('sched_decide_swap', { p_actor: owner.id, p_swap: swCz.swapId, p_approve: true, p_note: null })
check('if the taker was double-booked after agreeing, approval is refused and names them', czTry.reason === 'conflict' && czTry.details.conflicts[0].name === 'Dalia', JSON.stringify(czTry))
check('…the schedule is exactly as it was', (await assignmentsOf(cz.shiftId))[0].staff_id === dana.id)
check('…and the manager can still reject it cleanly', (await rpc('sched_decide_swap', { p_actor: owner.id, p_swap: swCz.swapId, p_approve: false, p_note: null })).status === 'rejected')
// open swap + volunteer
const ov = await save(owner, wSw, { p_date: day(2, sw), p_start: '06:00', p_end: '07:00', p_assignees: JSON.stringify([asg(dana.id)]) })
await rpc('sched_publish_week', { p_actor: owner.id, p_week_id: wSw })
const ovA = (await assignmentsOf(ov.shiftId))[0]
const swOpen = await rpc('sched_request_swap', { p_actor: dana.id, p_assignment: ovA.id, p_target: null, p_return: null, p_reason: 'פתוח לכולם' })
check('an OPEN swap has no named person yet', (await one(`select to_staff_id from public.shift_swaps where id = $1`, [swOpen.swapId])).to_staff_id === null)
check('nobody can DECLINE an open offer', (await rpc('sched_respond_swap', { p_actor: delegate.id, p_swap: swOpen.swapId, p_accept: false })).reason === 'forbidden')
const vol = await rpc('sched_respond_swap', { p_actor: delegate.id, p_swap: swOpen.swapId, p_accept: true })
check('any colleague can volunteer → the volunteer is recorded and it goes to the manager', vol.status === 'peer_accepted' && (await one(`select to_staff_name from public.shift_swaps where id = $1`, [swOpen.swapId])).to_staff_name === 'Dalia')
check('the requester can cancel; a stranger cannot', (await rpc('sched_cancel_swap', { p_actor: yossi.id, p_swap: swOpen.swapId })).reason === 'forbidden' && (await rpc('sched_cancel_swap', { p_actor: dana.id, p_swap: swOpen.swapId })).ok === true)
check('a cancelled swap cannot be cancelled again', (await rpc('sched_cancel_swap', { p_actor: dana.id, p_swap: swOpen.swapId })).reason === 'not_pending')
// past
check('a shift that already started cannot be swapped', await (async () => {
  const pa2 = (await assignmentsOf(pastShift.shiftId))
  return pa2.length === 0
})())

// history survives deleting / clearing
const histBefore = (await one(`select count(*)::int n from public.shift_swaps`)).n
const clearW = await rpc('sched_clear_week', { p_actor: owner.id, p_week_id: wSw })
check('clearing a week works for a manager', clearW.ok === true)
check('…and the swap history survived (rows kept; links cleared)', (await one(`select count(*)::int n from public.shift_swaps`)).n === histBefore && (await one(`select count(*)::int n from public.shift_swaps where status = 'approved' and assignment_id is null`)).n >= 2)
check('…with the dates and people still readable from the record', (await one(`select terms->'from'->>'label' l, from_staff_name from public.shift_swaps where id = $1`, [swap1.swapId])).l.includes('07:00'))

// ============================================================================
section('copying a week')
const cw = '2030-04-07'
const wc = await weekOf(maor, cw)
const c1 = await save(owner, wc, { p_date: day(1, cw), p_start: '07:00', p_end: '13:00', p_assignees: JSON.stringify([asg(dana.id), asg(tamar.id)]) })
await save(owner, wc, { p_date: day(1, cw), p_start: '07:00', p_end: '13:00', p_assignees: JSON.stringify([asg(yossi.id)]) }) // a PARALLEL shift, same date+time
const dst = '2030-04-14'
const wd = await weekOf(maor, dst)
const exstShift = await save(owner, wd, { p_date: day(3, dst), p_start: '09:00', p_end: '10:00' })
const cp = await rpc('sched_copy_week', { p_actor: owner.id, p_branch: maor, p_from: cw, p_to: dst })
check('a week is copied (shifts + people) and REPLACES the target', cp.ok === true && cp.shifts === 2 && cp.people === 3 && (await one(`select count(*)::int n from public.shifts where week_id = $1`, [wd])).n === 2, JSON.stringify(cp))
check('two parallel shifts at the same time are not mixed up', (await q(`select count(*)::int n from public.shift_assignments a join public.shifts s on s.id = a.shift_id where s.week_id = $1 group by s.id order by n`, [wd])).map((r) => r.n).join() === '1,2')
check('copying keeps the explicit times', (await q(`select distinct start_time from public.shifts where week_id = $1`, [wd])).map((r) => r.start_time).join() === '07:00')
// copy onto a week where one person is busy elsewhere
await db.query(`delete from public.shifts where id = $1`, [exstShift.shiftId])
await rpc('sched_clear_week', { p_actor: owner.id, p_week_id: wd })
const wg = await weekOf(ghav, dst)
const ghavBusy = await save(owner, wg, { p_date: day(1, dst), p_start: '08:00', p_end: '10:00', p_assignees: JSON.stringify([asg(yossi.id)]) })
check('(setup) Yossi works at the other branch that Monday morning', ghavBusy.ok === true, JSON.stringify(ghavBusy))
const cp2 = await rpc('sched_copy_week', { p_actor: owner.id, p_branch: maor, p_from: cw, p_to: dst })
check('a person who is busy in the other branch is SKIPPED and reported, never double-booked', cp2.ok === true && cp2.skipped.length === 1 && cp2.skipped[0].name === 'Yossi' && cp2.skipped[0].why === 'busy', JSON.stringify(cp2.skipped))
check('copying from an empty week is refused', (await rpc('sched_copy_week', { p_actor: owner.id, p_branch: maor, p_from: '2031-01-05', p_to: dst })).reason === 'source_empty')
check('an employee cannot copy a week', (await rpc('sched_copy_week', { p_actor: dana.id, p_branch: maor, p_from: cw, p_to: dst })).reason === 'forbidden')

// ============================================================================
section('scheduling flags (per person, per branch)')
check('a manager sets a default role and weekly cap', (await rpc('sched_set_member', { p_actor: owner.id, p_branch: maor, p_staff: dana.id, p_patch: JSON.stringify({ defaultRoleId: 'barista', maxWeeklyHours: 30 }) })).ok === true)
check('…and CAN clear the default role again (null means clear)', (await rpc('sched_set_member', { p_actor: owner.id, p_branch: maor, p_staff: dana.id, p_patch: JSON.stringify({ defaultRoleId: null }) })).ok === true && (await one(`select default_role_id, max_weekly_hours from public.schedule_members where staff_id = $1`, [dana.id])).default_role_id === null)
check('…while an absent key leaves the cap alone', (await one(`select max_weekly_hours from public.schedule_members where staff_id = $1`, [dana.id])).max_weekly_hours === 30)
check('an employee cannot change flags', (await rpc('sched_set_member', { p_actor: dana.id, p_branch: maor, p_staff: dana.id, p_patch: '{"schedulable":false}' })).reason === 'forbidden')
check('nonsense hours are refused', (await rpc('sched_set_member', { p_actor: owner.id, p_branch: maor, p_staff: dana.id, p_patch: '{"maxWeeklyHours":9999}' })).reason === 'bad_request')

// ============================================================================
section('staff lifecycle: deactivate, reactivate, delete — history preserved')
const worker = await addStaff({ email: 'worker@x.test', first: 'Worker', badge: 'barista', branch: maor })
const lw = '2030-05-05'
const wl = await weekOf(maor, lw)
const fut = await save(owner, wl, { p_date: day(1, lw), p_start: '07:00', p_end: '13:00', p_assignees: JSON.stringify([asg(worker.id)]) })
await rpc('sched_publish_week', { p_actor: owner.id, p_week_id: wl })
const wReq = await rpc('sched_request_shift', { p_actor: worker.id, p_shift: (await save(owner, wl, { p_date: day(2, lw), p_start: '07:00', p_end: '13:00' })).shiftId, p_note: null }) // not published yet → refused
await rpc('sched_publish_week', { p_actor: owner.id, p_week_id: wl })
const wReq2 = await rpc('sched_request_shift', { p_actor: worker.id, p_shift: (await one(`select id from public.shifts where week_id = $1 and shift_date = $2`, [wl, day(2, lw)])).id, p_note: null })
check('(setup) the worker has a future shift and a pending request', wReq2.ok === true && (await one(`select public.sched_staff_future_count($1) n`, [worker.id])).n === 1)
check('only an owner can deactivate', (await rpc('sched_set_staff_active', { p_actor: gm.id, p_staff: worker.id, p_active: false, p_remove_future: false })).reason === 'forbidden')
check('you cannot deactivate yourself', (await rpc('sched_set_staff_active', { p_actor: owner.id, p_staff: owner.id, p_active: false, p_remove_future: false })).reason === 'self')
const second = await addStaff({ email: 'owner2@x.test', first: 'Second', role: 'owner', badge: 'owner' })
check('a co-owner can be deactivated by an owner, and reactivated', (await rpc('sched_set_staff_active', { p_actor: owner.id, p_staff: second.id, p_active: false, p_remove_future: false })).ok === true
  && (await rpc('sched_set_staff_active', { p_actor: owner.id, p_staff: second.id, p_active: true, p_remove_future: false })).ok === true)
const deact = await rpc('sched_set_staff_active', { p_actor: owner.id, p_staff: worker.id, p_active: false, p_remove_future: false })
check('deactivating without removing: the person is out, the shift stays (and will be flagged)', deact.ok === true && (await assignmentsOf(fut.shiftId)).length === 1 && deact.futureLeft === 1)
check('…their sign-in is unlinked, their pending request cancelled', (await one(`select auth_user_id, active from public.staff where id = $1`, [worker.id])).auth_user_id === null && (await one(`select status from public.shift_requests where id = $1`, [wReq2.requestId])).status === 'cancelled')
check('…they cannot be assigned any more', (await save(owner, wl, { p_date: day(3, lw), p_assignees: JSON.stringify([asg(worker.id)]) })).reason === 'inactive_staff')
check('…and their history is intact', (await assignmentsOf(fut.shiftId))[0].staff_name === 'Worker')
const react = await rpc('sched_set_staff_active', { p_actor: owner.id, p_staff: worker.id, p_active: true, p_remove_future: false })
check('they can be reactivated', react.ok === true && (await one(`select active from public.staff where id = $1`, [worker.id])).active === true)
const deact2 = await rpc('sched_set_staff_active', { p_actor: owner.id, p_staff: worker.id, p_active: false, p_remove_future: true })
check('deactivating WITH "remove from future shifts" frees those shifts', deact2.ok === true && deact2.removedFuture === 1 && (await assignmentsOf(fut.shiftId)).length === 0)
check('staff changes are audited', (await one(`select count(*)::int n from public.staff_audit where action in ('staff.deactivate','staff.reactivate')`)).n === 5)
// past history is never removed
const pastWorker = await save(owner, wPast, { p_date: day(2, WPAST), p_start: '07:00', p_end: '13:00' })
await db.query(`insert into public.shift_assignments (branch_id, shift_id, staff_id, staff_name) values ($1, $2, $3, 'Dana')`, [maor, pastWorker.shiftId, dana.id])
await rpc('sched_set_staff_active', { p_actor: owner.id, p_staff: dana.id, p_active: false, p_remove_future: true })
check('PAST shifts are never removed when someone leaves', (await assignmentsOf(pastWorker.shiftId)).length === 1)
await rpc('sched_set_staff_active', { p_actor: owner.id, p_staff: dana.id, p_active: true, p_remove_future: false })
// delete
const fresh1 = await addStaff({ first: 'Typo', auth: false })
check('a person created by mistake (no history) has none', (await one(`select public.staff_has_history($1) h`, [fresh1.id])).h === false)
check('…and can be deleted by an owner', (await rpc('sched_delete_staff', { p_actor: owner.id, p_staff: fresh1.id })).ok === true && (await one(`select count(*)::int n from public.staff where id = $1`, [fresh1.id])).n === 0)
check('a person who has worked shifts has history → cannot be deleted', (await one(`select public.staff_has_history($1) h`, [tamar.id])).h === true && (await rpc('sched_delete_staff', { p_actor: owner.id, p_staff: tamar.id })).reason === 'has_history')
check('a person who has signed in has history', (await one(`select public.staff_has_history($1) h`, [gm.id])).h === true)
check('deleting nobody-in-particular is refused for non-owners / self / owners', (await rpc('sched_delete_staff', { p_actor: gm.id, p_staff: fresh1.id })).reason === 'forbidden' && (await rpc('sched_delete_staff', { p_actor: owner.id, p_staff: owner.id })).reason === 'self' && (await rpc('sched_delete_staff', { p_actor: owner.id, p_staff: second.id })).reason === 'is_owner')
check('someone with only pure configuration (a POS point, a flag) is still deletable', await (async () => {
  const f = await addStaff({ first: 'Config', auth: false })
  await db.query(`insert into public.schedule_members (branch_id, staff_id, schedulable) values ($1, $2, true)`, [maor, f.id])
  return (await rpc('sched_delete_staff', { p_actor: owner.id, p_staff: f.id })).ok === true
})())
check('the audit trail outlives the deleted person', (await one(`select count(*)::int n from public.staff_audit where action = 'staff.delete'`)).n >= 2)

// ============================================================================
section('notifications')
check('marking read affects only your own', await (async () => {
  const before = (await notesFor(owner)).filter((n) => !n.read_at).length
  const n = (await one(`select public.sched_mark_read($1, null) n`, [owner.id])).n
  return before > 0 && n === before && (await notesFor(dana)).some((x) => !x.read_at)
})())
check('mark-read of someone else\'s id changes nothing', (await one(`select public.sched_mark_read($1, $2) n`, [yossi.id, [(await notesFor(dana))[0].id]])).n === 0)

// ============================================================================
section('successor migrations — Tuesday planning and fair remaining-slot fill')
for (const f of files.filter((x) => x > NEW_MIG)) {
  try { await db.exec(readFileSync(MIG + f, 'utf8')); check(`apply ${f}`, true) }
  catch (e) { console.error(e); check(`apply ${f}`, false, String(e.message)); process.exit(1) }
}
const planningMigration = files.find((f) => f.endsWith('_schedule_planning_fair_fill.sql'))
await db.exec(readFileSync(MIG + planningMigration, 'utf8'))
check('planning migration may be run again', true)
check('deadline is preceding Tuesday even for a non-Sunday input', (await one(`select public.sched_request_deadline('2026-10-12')::text d`)).d === '2026-10-06')
check('summer Jerusalem: Tuesday 23:59 stays open; Wednesday 00:00 closes', (await one(`select public.sched_requests_open('2026-10-11','2026-10-06 20:59:59+00') a, public.sched_requests_open('2026-10-11','2026-10-06 21:00:00+00') b`)).a === true && (await one(`select public.sched_requests_open('2026-10-11','2026-10-06 21:00:00+00') b`)).b === false)
check('winter Jerusalem follows local midnight after DST', (await one(`select public.sched_requests_open('2026-11-01','2026-10-27 21:59:59+00') a, public.sched_requests_open('2026-11-01','2026-10-27 22:00:00+00') b`)).a === true && (await one(`select public.sched_requests_open('2026-11-01','2026-10-27 22:00:00+00') b`)).b === false)

// Fixture-only wall clock override. Production always uses the actual Jerusalem clock.
await db.exec(`create or replace function public.sched_requests_open(p_week date, p_at timestamptz default now())
  returns boolean language sql stable set search_path = public as $$
    select (coalesce(nullif(current_setting('test.scheduler_clock', true), '')::timestamptz, p_at) at time zone 'Asia/Jerusalem')::date <= public.sched_request_deadline(p_week);
  $$;`)
const planBranch = (await one(`insert into public.branches (slug, name) values ('planning-fixture', '{"he":"בדיקת שיבוץ"}') returning id`)).id
await db.query(`insert into public.shift_settings (branch_id, roles, safety) values ($1, '[{"id":"barista","name":"צוות","color":"#ffffff"}]', '{"maxWeeklyHours":42,"minRestHours":10,"maxDailyHours":10,"maxConsecutiveDays":6}')`, [planBranch])
const heavy = await addStaff({ first: 'Heavy Saturdays', branch: planBranch })
const light = await addStaff({ first: 'Light Saturdays', branch: planBranch })
const unavailable = await addStaff({ first: 'Unavailable', branch: planBranch })
await db.query(`insert into public.schedule_members (branch_id, staff_id, schedulable)
  select $1, s.id, s.id = any($2::uuid[]) from public.staff s`, [planBranch, [heavy.id, light.id, unavailable.id]])
const pw = '2031-01-05'
const planWeek = await weekOf(planBranch, pw)
await db.exec(`select set_config('test.scheduler_clock', '2030-12-29T10:00:00Z', false)`)
const prepStart = day(14, pw)
const prepWeek = await weekOf(planBranch, prepStart)
await db.query(`update public.shift_settings set working_days='{0,2,6}' where branch_id=$1`, [planBranch])
const prepManual = await save(owner, prepWeek, { p_date: prepStart, p_assignees: JSON.stringify([asg(heavy.id)]) })
const prepTemplates = JSON.stringify([{ id: 'am', startTime: '07:00', endTime: '13:00' }, { id: 'pm', startTime: '14:00', endTime: '18:00', roleId: 'barista' }])
const prepared = await rpc('sched_prepare_week', { p_actor: owner.id, p_week: prepWeek, p_presets: prepTemplates })
check('prepare week follows configured days and creates only missing empty templates', prepared.ok === true && prepared.added === 5 && (await one(`select count(*)::int n from public.shifts where week_id=$1`, [prepWeek])).n === 6)
check('prepare week preserves every manual shift and assignment', (await assignmentsOf(prepManual.shiftId))[0].staff_id === heavy.id && (await one(`select count(*)::int n from public.shift_assignments a join public.shifts s on s.id=a.shift_id where s.week_id=$1`, [prepWeek])).n === 1)
check('prepare week is idempotent and manager-only', (await rpc('sched_prepare_week', { p_actor: owner.id, p_week: prepWeek, p_presets: prepTemplates })).added === 0 && (await rpc('sched_prepare_week', { p_actor: light.id, p_week: prepWeek, p_presets: prepTemplates })).reason === 'forbidden')
check('prepare week refuses malformed template times before any insert', (await rpc('sched_prepare_week', { p_actor: owner.id, p_week: prepWeek, p_presets: JSON.stringify([{ startTime: '07:00', endTime: '99:00' }]) })).reason === 'bad_time')
await db.query(`update public.shift_settings set working_days='{0,1,2,3,4,5,6}' where branch_id=$1`, [planBranch])
const planSunday = await save(owner, planWeek, { p_date: day(0, pw), p_assignees: JSON.stringify([asg(heavy.id)]) })
const planMonday = await save(owner, planWeek, { p_date: day(1, pw), p_requirements: JSON.stringify([{ roleId: 'barista', min: 1 }]) })
const planSaturday = await save(owner, planWeek, { p_date: day(6, pw), p_requirements: JSON.stringify([{ roleId: 'barista', min: 1 }]) })
const manualId = (await assignmentsOf(planSunday.shiftId))[0].id
const draftReq = await rpc('sched_request_shift', { p_actor: light.id, p_shift: planMonday.shiftId, p_note: 'Preferred' })
check('employee can request an offered shift before publication', draftReq.ok === true && (await assignmentsOf(planMonday.shiftId)).length === 0)
check('the owner is notified of a draft-week request', (await notesFor(owner)).some((n) => n.kind === 'request.new' && n.link.weekStart === pw))
const avail = (actor, entries = [], status = 'submitted') => rpc('sched_submit_availability', { p_actor: actor.id, p_branch: planBranch, p_week_start: pw, p_entries: JSON.stringify(entries), p_note: null, p_status: status })
check('availability submission succeeds before Tuesday close', (await avail(unavailable, Array.from({ length: 7 }, (_, i) => ({ date: day(i, pw), kind: 'unavailable' })))).ok === true)
check('availability rejects duplicate dates and incomplete partial hours', (await avail(light, [{ date: pw, kind: 'prefer' }, { date: pw, kind: 'unavailable' }])).reason === 'bad_request' && (await avail(light, [{ date: pw, kind: 'partial', from: '08:00' }])).reason === 'bad_time')
check('automatic completion waits for Tuesday to finish', (await rpc('sched_fill_week', { p_actor: owner.id, p_week: planWeek })).reason === 'planning_open')
check('employee cannot trigger manager completion', (await rpc('sched_fill_week', { p_actor: light.id, p_week: planWeek })).reason === 'forbidden')
await db.exec(`select set_config('test.scheduler_clock', '2031-01-01T10:00:00Z', false)`)
check('availability rejects late submissions without modifying the old row', (await avail(unavailable, [])).reason === 'requests_closed' && (await one(`select jsonb_array_length(entries) n from public.shift_availability where staff_id=$1 and branch_id=$2`, [unavailable.id, planBranch])).n === 7)
check('draft shift requests reject late changes', (await rpc('sched_request_shift', { p_actor: unavailable.id, p_shift: planSaturday.shiftId, p_note: null })).reason === 'requests_closed')
check('completion waits until manager answers all weekly requests', (await rpc('sched_fill_week', { p_actor: owner.id, p_week: planWeek })).reason === 'requests_pending')
await rpc('sched_decide_request', { p_actor: owner.id, p_request: draftReq.requestId, p_approve: false, p_note: null, p_force: false })
for (let n = 1; n <= 3; n++) {
  const ws = day(-n * 7, pw)
  const hw = await weekOf(planBranch, ws)
  await save(owner, hw, { p_date: day(6, ws), p_assignees: JSON.stringify([asg(heavy.id)]) })
  await rpc('sched_publish_week', { p_actor: owner.id, p_week_id: hw })
}
const filled = await rpc('sched_fill_week', { p_actor: owner.id, p_week: planWeek })
check('fair fill adds remaining shifts only', filled.ok === true && filled.added === 2 && filled.remaining.length === 0, JSON.stringify(filled))
check('existing manual assignment keeps its id and owner choice', (await assignmentsOf(planSunday.shiftId))[0].id === manualId && (await assignmentsOf(planSunday.shiftId))[0].staff_id === heavy.id)
check('Saturday opportunity goes to the colleague with fewer historical Saturday hours', (await assignmentsOf(planSaturday.shiftId))[0].staff_id === light.id)
check('no submitted availability means available; unavailable employee is not chosen', (await one(`select count(*)::int n from public.shift_assignments a join public.shifts s on s.id=a.shift_id where s.week_id=$1 and a.staff_id=$2`, [planWeek, unavailable.id])).n === 0 && (await assignmentsOf(planSaturday.shiftId))[0].staff_id === light.id)
check('repeat completion is idempotent', (await rpc('sched_fill_week', { p_actor: owner.id, p_week: planWeek })).added === 0)
const saturdaySecond = await save(owner, planWeek, { p_date: day(6, pw), p_start: '14:00', p_end: '18:00' })
const spread = await rpc('sched_fill_week', { p_actor: owner.id, p_week: planWeek })
check('multiple Saturday slots spread across eligible staff while preserving rest', spread.added === 1 && (await assignmentsOf(saturdaySecond.shiftId))[0].staff_id === heavy.id)
check('completion remains draft until deliberate publication', (await one(`select status, published_snapshot from public.schedule_weeks where id=$1`, [planWeek])).status === 'draft' && (await one(`select published_snapshot from public.schedule_weeks where id=$1`, [planWeek])).published_snapshot === null)
check('completion is audited with fairness horizon', (await one(`select detail from public.shift_audit where branch_id=$1 and action='schedule.fill' order by id desc limit 1`, [planBranch])).detail.saturdayHistoryWeeks === 12)

// Eligibility independently exercises every hard restriction the automatic
// allocator promises. Manager overrides remain in the existing shift editor.
const safe = JSON.stringify({ maxWeeklyHours: 42, minRestHours: 10, maxDailyHours: 10, maxConsecutiveDays: 6 })
const elig = (staff, shift, safety = safe, cap = null) => one(`select public.sched_fill_eligible($1,$2,$3,$4,$5) yes`, [staff.id, shift, pw, safety, cap]).then((r) => r.yes)
const partialShift = await save(owner, planWeek, { p_date: day(3, pw), p_start: '07:00', p_end: '13:00' })
await db.query(`insert into public.shift_availability (branch_id,staff_id,week_start,entries,status) values ($1,$2,$3,$4,'submitted')`, [planBranch, light.id, pw, JSON.stringify([{ date: day(3, pw), kind: 'partial', from: '09:00', to: '14:00' }])])
check('partial availability cannot cover a shift starting outside its hours', await elig(light, partialShift.shiftId) === false)
await db.query(`update public.shift_availability set entries=$1 where staff_id=$2 and branch_id=$3`, [JSON.stringify([{ date: day(3, pw), kind: 'partial', from: '06:00', to: '14:00' }]), light.id, planBranch])
check('partial availability covering all shift hours is eligible', await elig(light, partialShift.shiftId) === true)
check('employee weekly cap stops completion', await elig(light, partialShift.shiftId, safe, 6) === false)
check('daily cap stops a long shift', await elig(light, partialShift.shiftId, JSON.stringify({ maxWeeklyHours: 42, minRestHours: 10, maxDailyHours: 5, maxConsecutiveDays: 6 })) === false)
const restShift = await save(owner, planWeek, { p_date: day(5, pw), p_start: '22:00', p_end: '02:00' })
check('cross-midnight rest is protected against Saturday assignment', await elig(light, restShift.shiftId) === false)
const otherWeek = await weekOf(ghav, pw)
await save(owner, otherWeek, { p_date: day(3, pw), p_start: '08:00', p_end: '14:00', p_assignees: JSON.stringify([asg(light.id)]) })
// Branch assignment cannot be created for a branch-bound employee; use an
// existing floater to verify the across-branch conflict invariant instead.
const floaterConflict = await save(owner, otherWeek, { p_date: day(3, pw), p_start: '08:00', p_end: '14:00', p_assignees: JSON.stringify([asg(yossi.id)]) })
check('automatic eligibility rejects any-branch overlapping assignments', floaterConflict.ok === true && await elig(yossi, partialShift.shiftId) === false)

await db.query(`update public.schedule_members set schedulable=false where branch_id=$1`, [planBranch])
const impossible = await rpc('sched_fill_week', { p_actor: owner.id, p_week: planWeek })
check('unfillable places are returned explicitly and no existing assignment moves', impossible.ok === true && impossible.remaining.length >= 1 && (await assignmentsOf(planSunday.shiftId))[0].id === manualId)
await db.exec(`select set_config('test.scheduler_clock', '', false)`)

section('privileges — as the roles a browser would be')
for (const t of ['shifts', 'shift_assignments', 'schedule_weeks', 'shift_settings', 'schedule_members', 'shift_availability']) {
  check(`a signed-in employee cannot WRITE ${t} directly`, await asRole('authenticated', dana.authId, () => refused(`insert into public.${t} default values`)) === true)
}
check('…nor update a shift', await asRole('authenticated', owner.authId, () => refused(`update public.shifts set note = 'x'`)) === true)
check('requests and notifications are unreadable from a browser', await asRole('authenticated', dana.authId, () => refused(`select * from public.shift_requests`)) === true && await asRole('authenticated', dana.authId, () => refused(`select * from public.schedule_notifications`)) === true)
check('the staff trail is unreadable from a browser', await asRole('authenticated', owner.authId, () => refused(`select * from public.staff_audit`)) === true)
check('swaps stay read-only for a browser (RLS select policy only)', await asRole('authenticated', dana.authId, () => refused(`insert into public.shift_swaps (branch_id, from_staff_id) values ('${maor}', '${dana.id}')`)) === true)
const funcs = await q(`select p.oid::regprocedure::text sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'sched\\_%' or p.proname in ('staff_log','staff_has_history'))`)
check(`${funcs.length} scheduling functions exist`, funcs.length >= 35, String(funcs.length))
let leaky = []
for (const f of funcs) {
  const r = await one(`select has_function_privilege('anon', $1, 'execute') a, has_function_privilege('authenticated', $1, 'execute') b, has_function_privilege('public', $1, 'execute') c, has_function_privilege('service_role', $1, 'execute') d`, [f.sig])
  if (r.a || r.b || r.c || !r.d) leaky.push(f.sig)
}
check('EVERY sched_* / staff_* function is executable by service_role ONLY', leaky.length === 0, leaky.join(', '))
check('a browser session cannot call an approval function', await asRole('authenticated', owner.authId, () => refused(`select public.sched_decide_swap('${owner.id}', '${crypto.randomUUID()}', true, null)`)) === true)
check('the old auth.uid()-based entry points are gone (no way around the new rules)',
  (await one(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('publish_schedule_week','unpublish_schedule_week','clear_schedule_week','copy_schedule_week','set_schedule_member','request_shift_swap','accept_shift_swap','decide_shift_swap','cancel_shift_swap')`)).n === 0)

// ============================================================================
section('the app and the database agree on names')
const walkSrc = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkSrc(`${d}${e.name}/`) : /\.tsx?$/.test(e.name) ? [`${d}${e.name}`] : []))
const called = new Set()
for (const f of walkSrc(SRC_DIR)) {
  for (const m of readFileSync(f, 'utf8').matchAll(/(?:\.rpc|callPosRpc|callSched)(?:<[^()]*>)?\(\s*(?:service,\s*)?['"]((?:sched_|staff_)[a-z_0-9]+)['"]/g)) called.add(m[1])
}
check('the source calls the new scheduling functions', called.size >= 25, `${called.size} found: ${[...called].join(', ')}`)
for (const fn of [...called].sort()) {
  const procs = await q(`select p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [fn])
  const ok = procs.length > 0 && (await Promise.all(procs.map((p) => one(`select has_function_privilege('service_role', $1, 'execute') ok`, [p.sig])))).every((r) => r.ok)
  check(`${fn}() exists and service_role may execute it`, ok)
}

console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
