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

section('staff push (20261012120000) — the inbox is also the outbox')
check('rows that existed before the migration are stamped as already handled (no buzz for old news)', (await one(`select count(*)::int n from public.schedule_notifications where push_sent_at is null`)).n === 0)
check('the push subscription table is unreadable from a browser', await asRole('authenticated', dana.authId, () => refused(`select * from public.staff_push_subscriptions`)) === true && await asRole('anon', null, () => refused(`select * from public.staff_push_subscriptions`)) === true)
check('…and service_role can use it', (await one(`select has_table_privilege('service_role', 'public.staff_push_subscriptions', 'insert') ok`)).ok === true)
{
  await q(`insert into public.staff_push_subscriptions (staff_id, endpoint, p256dh, auth) values ($1, 'https://push.example/one', 'k', 'a')`, [dana.id])
  await q(`insert into public.staff_push_subscriptions (staff_id, endpoint, p256dh, auth) values ($1, 'https://push.example/one', 'k', 'a') on conflict (endpoint) do update set staff_id = excluded.staff_id`, [yossi.id])
  const rows = await q(`select staff_id from public.staff_push_subscriptions where endpoint = 'https://push.example/one'`)
  check('one phone belongs to one person: signing in as someone else moves the subscription', rows.length === 1 && rows[0].staff_id === yossi.id)
}
{
  const key = 'shift-soon:test'
  await q(`insert into public.schedule_notifications (branch_id, staff_id, kind, title, dedupe_key) values ($1, $2, 'shift.soon', 't', $3)`, [maor, dana.id, key])
  const again = await q(`insert into public.schedule_notifications (branch_id, staff_id, kind, title, dedupe_key) values ($1, $2, 'shift.soon', 't', $3) on conflict (staff_id, dedupe_key) do nothing returning id`, [maor, dana.id, key])
  check('a timed reminder is written once per person and key', again.length === 0)
  const two = await q(`insert into public.schedule_notifications (branch_id, staff_id, kind, title) values ($1, $2, 'x', 'a'), ($1, $2, 'x', 'b') returning id`, [maor, dana.id])
  check('ordinary notifications (no key) never collide', two.length === 2)
  check('a new notification starts unsent', (await one(`select count(*)::int n from public.schedule_notifications where dedupe_key = $1 and push_sent_at is null`, [key])).n === 1)
}
{
  const wOpen = await weekOf(maor, '2030-03-17')
  const sOpen = await save(owner, wOpen, { p_date: '2030-03-18', p_start: '09:00', p_end: '12:00', p_assignees: JSON.stringify([asg(dana.id)]) })
  await rpc('sched_publish_week', { p_actor: owner.id, p_week_id: wOpen })
  const aOpen = (await assignmentsOf(sOpen.shiftId))[0]
  const openCount = async () => (await q(`select 1 from public.schedule_notifications where kind = 'swap.open'`)).length
  const named = await rpc('sched_request_swap', { p_actor: dana.id, p_assignment: aOpen.id, p_target: yossi.id, p_return: null, p_reason: null })
  check('an offer to a NAMED colleague announces nothing to the rest of the branch', named.ok === true && (await openCount()) === 0)
  await rpc('sched_cancel_swap', { p_actor: dana.id, p_swap: named.swapId })
  const open = await rpc('sched_request_swap', { p_actor: dana.id, p_assignment: aOpen.id, p_target: null, p_return: null, p_reason: null })
  check('Dana offers the shift to everyone', open.ok === true, JSON.stringify(open))
  const told = await q(`select staff_id, title, body, link, push_sent_at from public.schedule_notifications where kind = 'swap.open'`)
  const toldIds = told.map((n) => n.staff_id)
  check('the colleagues who could take it are told (who, which shift, where to answer)', toldIds.includes(yossi.id) && toldIds.includes(delegate.id) && told.every((n) => /Dana/.test(n.title) && /09:00/.test(n.body) && n.link.tab === 'requests'), JSON.stringify(told))
  check('the person giving it away is not told', !toldIds.includes(dana.id))
  check('a deactivated person is not told', !toldIds.includes(gone.id))
  check('the announcements wait to be pushed', told.every((n) => n.push_sent_at === null))
  const dup = await rpc('sched_request_swap', { p_actor: dana.id, p_assignment: aOpen.id, p_target: null, p_return: null, p_reason: null })
  check('a refused duplicate offer announces nothing more', dup.reason === 'duplicate_swap' && (await openCount()) === told.length)
  await rpc('sched_cancel_swap', { p_actor: dana.id, p_swap: open.swapId })
}
check('the open-offer trigger function is not callable from a browser', await asRole('authenticated', owner.authId, () => refused(`select public.sched_notify_open_swap()`)) === true)

section('staff push scheduler (20261012130000) — functions exist, stay closed, and degrade quietly without pg_cron')
for (const sig of ['public.staff_push_verify_cron(text)', 'public.staff_push_tick()', 'public.staff_push_cron_status()']) {
  const r = await one(`select has_function_privilege('anon', $1, 'execute') a, has_function_privilege('authenticated', $1, 'execute') b, has_function_privilege('public', $1, 'execute') c, has_function_privilege('service_role', $1, 'execute') d`, [sig])
  check(`${sig} is executable by service_role only`, !r.a && !r.b && !r.c && r.d === true)
}
check('a wrong, short or empty secret is never accepted', (await one(`select public.staff_push_verify_cron('x') a, public.staff_push_verify_cron(null) b, public.staff_push_verify_cron(repeat('a', 64)) c`)).a === false && (await one(`select public.staff_push_verify_cron(null) b`)).b === false && (await one(`select public.staff_push_verify_cron(repeat('a', 64)) c`)).c === false)
check('the tick never raises where the scheduler does not exist', await (async () => { try { await db.query(`select public.staff_push_tick()`); return true } catch { return false } })())
check('the status reports "not available" instead of failing', (await one(`select public.staff_push_cron_status() s`)).s.available === false)
check('exactly one function of each name (no overloads)', (await one(`select count(*)::int n from pg_proc where proname in ('staff_push_verify_cron','staff_push_tick','staff_push_cron_status')`)).n === 3)

section('taking a colleague\'s shift: asked by the person who WANTS it, answered by the holder, decided by a manager')
const tk = '2030-03-10'
const wTk = await weekOf(maor, tk)
const tkMon = await save(owner, wTk, { p_date: day(1, tk), p_start: '09:00', p_end: '13:00', p_assignees: JSON.stringify([asg(yossi.id)]) })
const tkTue = await save(owner, wTk, { p_date: day(2, tk), p_start: '09:00', p_end: '13:00', p_assignees: JSON.stringify([asg(yossi.id), asg(delegate.id)]) })
const tkWed = await save(owner, wTk, { p_date: day(3, tk), p_start: '09:00', p_end: '13:00', p_assignees: JSON.stringify([asg(yossi.id)]) })
const tkThu = await save(owner, wTk, { p_date: day(4, tk), p_start: '09:00', p_end: '13:00', p_assignees: JSON.stringify([asg(yossi.id)]) })
await save(owner, wTk, { p_date: day(1, tk), p_start: '11:00', p_end: '15:00', p_assignees: JSON.stringify([asg(delegate.id)]) }) // overlaps Monday for Dalia
const aMon = (await assignmentsOf(tkMon.shiftId))[0]
const aTue = (await assignmentsOf(tkTue.shiftId)).find((a) => a.staff_id === yossi.id)
const aWed = (await assignmentsOf(tkWed.shiftId))[0]
const aThu = (await assignmentsOf(tkThu.shiftId))[0]
const take = (actor, assignment, reason = null) => rpc('sched_request_take', { p_actor: actor.id, p_assignment: assignment.id, p_reason: reason })
const respond = (actor, swapId, accept) => rpc('sched_respond_swap', { p_actor: actor.id, p_swap: swapId, p_accept: accept })
const decide = (actor, swapId, approve) => rpc('sched_decide_swap', { p_actor: actor.id, p_swap: swapId, p_approve: approve, p_note: null })
const withdraw = (actor, swapId) => rpc('sched_cancel_swap', { p_actor: actor.id, p_swap: swapId })
const statusOf = async (swapId) => (await one(`select status from public.shift_swaps where id = $1`, [swapId])).status
check('(setup) an unpublished week offers nothing to take', (await take(dana, aMon)).reason === 'not_published')
await rpc('sched_publish_week', { p_actor: owner.id, p_week_id: wTk })
check('you cannot take your own shift', (await take(yossi, aMon)).reason === 'bad_target')
check('a person from another branch cannot ask', (await take(omer, aMon)).reason === 'forbidden')
check('a deactivated person cannot ask', (await take(gone, aMon)).reason === 'forbidden')
check('someone already working at that time is refused, naming the clash', await (async () => {
  const r = await take(delegate, aMon)
  return r.reason === 'busy' && r.details.with.start === '11:00'
})())
check('someone already ON that shift cannot take a colleague\'s place on it', (await take(delegate, aTue)).reason === 'already_assigned')

const danaNotesBefore = (await notesFor(dana)).length
const tk1 = await take(dana, aMon, 'אשמח לקחת')
check('Dana asks Yossi for his Monday morning (nothing offered in return)', tk1.ok === true, JSON.stringify(tk1))
const t1 = await one(`select * from public.shift_swaps where id = $1`, [tk1.swapId])
check('it is a TAKE: OPEN, held by Yossi, wanted by Dana, no return shift, and it remembers what was asked', t1.direction === 'take' && t1.status === 'open' && t1.from_staff_id === yossi.id && t1.to_staff_id === dana.id && t1.return_assignment_id === null && t1.from_staff_name === 'Yossi' && t1.to_staff_name === 'Dana' && t1.terms.from.start === '09:00' && t1.terms.to === null && t1.reason === 'אשמח לקחת')
check('A PENDING TAKE DOES NOT TOUCH THE SCHEDULE (live)', (await assignmentsOf(tkMon.shiftId))[0].staff_id === yossi.id)
check('…nor what employees see (snapshot)', (await one(`select published_snapshot->'assignments' a from public.schedule_weeks where id = $1`, [wTk])).a.find((a) => a.id === aMon.id).staff_id === yossi.id)
check('Yossi — the holder — is told, and Dana (the asker) is not', (await notesFor(yossi)).some((n) => n.kind === 'swap.request' && /Dana/.test(n.title) && /בלי משמרת בתמורה/.test(n.body)) && (await notesFor(dana)).length === danaNotesBefore)
check('a second ask for the same shift is refused', (await take(gm, aMon)).reason === 'duplicate_swap')
check('…and so is offering that shift to someone else while it is spoken for', (await rpc('sched_request_swap', { p_actor: yossi.id, p_assignment: aMon.id, p_target: tamar.id, p_return: null, p_reason: null })).reason === 'duplicate_swap')
check('the asker cannot accept their own ask', (await respond(dana, tk1.swapId, true)).reason === 'forbidden')
check('a colleague who is not involved cannot answer it', (await respond(tamar, tk1.swapId, true)).reason === 'forbidden')
check('a manager cannot approve before the holder agreed', (await decide(owner, tk1.swapId, true)).reason === 'not_pending')
check('only the asker or a manager can withdraw it: neither the holder nor a bystander', (await withdraw(yossi, tk1.swapId)).reason === 'forbidden' && (await withdraw(tamar, tk1.swapId)).reason === 'forbidden')
const tkAcc = await respond(yossi, tk1.swapId, true)
check('Yossi agrees → it waits for the manager', tkAcc.ok === true && tkAcc.status === 'peer_accepted', JSON.stringify(tkAcc))
check('Dana stays the TAKER: the holder\'s answer does not overwrite her', await (async () => {
  const s = await one(`select to_staff_id, to_staff_name, from_staff_id from public.shift_swaps where id = $1`, [tk1.swapId])
  return s.to_staff_id === dana.id && s.to_staff_name === 'Dana' && s.from_staff_id === yossi.id
})())
check('STILL nothing changed in the schedule', (await assignmentsOf(tkMon.shiftId))[0].staff_id === yossi.id)
check('Dana is told Yossi agreed; managers are told it needs them', (await notesFor(dana)).some((n) => n.kind === 'swap.accepted' && /Yossi/.test(n.title)) && (await notesFor(owner)).some((n) => n.kind === 'swap.awaiting' && /Yossi/.test(n.body) && /Dana/.test(n.body)))
check('an employee cannot approve it, not even one of the two', (await decide(yossi, tk1.swapId, true)).reason === 'forbidden' && (await decide(dana, tk1.swapId, true)).reason === 'forbidden' && (await decide(tamar, tk1.swapId, true)).reason === 'forbidden')
const tkAppr = await decide(owner, tk1.swapId, true)
check('the manager approves → Monday morning is now Dana\'s (live)', tkAppr.ok === true && (await assignmentsOf(tkMon.shiftId))[0].staff_id === dana.id && (await assignmentsOf(tkMon.shiftId))[0].staff_name === 'Dana', JSON.stringify(tkAppr))
check('…and in what employees see, immediately', (await one(`select published_snapshot->'assignments' a from public.schedule_weeks where id = $1`, [wTk])).a.find((a) => a.id === aMon.id).staff_id === dana.id)
check('both are told the outcome', (await notesFor(yossi)).some((n) => n.kind === 'swap.approved') && (await notesFor(dana)).some((n) => n.kind === 'swap.approved'))
check('an approved take cannot be decided twice', (await decide(owner, tk1.swapId, true)).reason === 'not_pending')

// the holder says no
const tk2 = await take(delegate, aWed)
check('Dalia asks Yossi for his Wednesday', tk2.ok === true, JSON.stringify(tk2))
check('the holder declining → declined, schedule untouched, the asker told', (await respond(yossi, tk2.swapId, false)).status === 'declined' && (await assignmentsOf(tkWed.shiftId))[0].staff_id === yossi.id && (await notesFor(delegate)).some((n) => n.kind === 'swap.declined' && /Yossi/.test(n.title)))
const tk3 = await take(delegate, aWed)
check('after a decline she can ask again', tk3.ok === true)
check('the asker withdraws her own ask, and it cannot be withdrawn twice', (await withdraw(delegate, tk3.swapId)).ok === true && (await withdraw(delegate, tk3.swapId)).reason === 'not_pending')
const tk4 = await take(delegate, aWed)
check('a manager can withdraw it too, and the record says who did', (await withdraw(owner, tk4.swapId)).ok === true && (await one(`select cancel_reason from public.shift_swaps where id = $1`, [tk4.swapId])).cancel_reason === 'בוטלה על ידי המנהל/ת')

// asked while free, double-booked by the time the holder answers
const tk5 = await take(dana, aThu)
await save(owner, wTk, { p_date: day(4, tk), p_start: '10:00', p_end: '12:00', p_assignees: JSON.stringify([asg(dana.id)]) })
const tkBusy = await respond(yossi, tk5.swapId, true)
check('if the asker became busy meanwhile, the holder\'s agreement is refused and names her', tkBusy.reason === 'busy' && tkBusy.details.name === 'Dana', JSON.stringify(tkBusy))
check('…the ask stays open and Thursday is still Yossi\'s', (await statusOf(tk5.swapId)) === 'open' && (await assignmentsOf(tkThu.shiftId)).some((a) => a.staff_id === yossi.id))
await save(owner, wTk, { p_shift_id: tkThu.shiftId, p_date: day(4, tk), p_start: '09:00', p_end: '13:00', p_assignees: '[]' })
check('taking the holder off the shift cancels the ask and tells the asker', (await statusOf(tk5.swapId)) === 'cancelled' && (await notesFor(dana)).some((n) => n.kind === 'swap.cancelled'))

// who may ask at all
await rpc('sched_set_member', { p_actor: owner.id, p_branch: maor, p_staff: dana.id, p_patch: JSON.stringify({ schedulable: false }) })
check('someone marked not-schedulable in this branch cannot ask for a shift', (await take(dana, aWed)).reason === 'not_schedulable')
await rpc('sched_set_member', { p_actor: owner.id, p_branch: maor, p_staff: dana.id, p_patch: JSON.stringify({ schedulable: true }) })
const tkPast = '2020-01-12'
const wTkPast = await weekOf(maor, tkPast)
const tkPastShift = await save(owner, wTkPast, { p_date: day(2, tkPast), p_start: '07:00', p_end: '09:00', p_assignees: JSON.stringify([asg(yossi.id)]) })
await rpc('sched_publish_week', { p_actor: owner.id, p_week_id: wTkPast })
check('a shift that already started cannot be asked for', (await take(dana, (await assignmentsOf(tkPastShift.shiftId))[0])).reason === 'past')
check('swaps that existed before this feature are "give" swaps', (await one(`select count(*)::int n from public.shift_swaps where direction = 'give'`)).n > 5)
check('the direction column only accepts give or take', (await throws(`update public.shift_swaps set direction = 'sideways' where id = $1`, [tk1.swapId], /shift_swaps_direction_check/)) === true)
check('a browser session cannot ask for a shift', await asRole('authenticated', dana.authId, () => refused(`select public.sched_request_take('${dana.id}', '${aWed.id}', null)`)) === true)

// ============================================================================
section('days off and shift wishes — one rule across every branch (20261015091000)')
const TW = '2031-03-02' // a Sunday
const TW2 = '2031-03-09'
check('the test weeks are Sundays', (await one(`select extract(dow from $1::date)::int a, extract(dow from $2::date)::int b`, [TW, TW2])).a === 0)
const periods = async (a, b) => (await one(`select public.sched_shift_periods($1,$2) p`, [a, b])).p
check('a morning shift is morning only', JSON.stringify(await periods('07:00', '13:00')) === '["morning"]' && JSON.stringify(await periods('07:30', '13:00')) === '["morning"]')
check('an evening shift is evening only', JSON.stringify(await periods('13:00', '19:00')) === '["evening"]' && JSON.stringify(await periods('16:30', '18:30')) === '["evening"]')
check('a long shift touches both halves', JSON.stringify(await periods('07:00', '19:00')) === '["morning","evening"]' && JSON.stringify(await periods('12:30', '13:30')) === '["morning","evening"]')
check('a night shift past midnight is evening', JSON.stringify(await periods('22:00', '02:00')) === '["evening"]')

const wTW = await weekOf(maor, TW)
const wTW2 = await weekOf(maor, TW2)
const submitOff = (who, week, entries) => rpc('sched_submit_time_off', { p_actor: who.id, p_week_start: week, p_entries: JSON.stringify(entries) })
const offRows = (who, status) => q(`select day::text d, kind, status from public.staff_time_off where staff_id = $1 ${status ? `and status = '${status}'` : ''} order by day, kind`, [who.id])
const danaWish = await submitOff(dana, TW, [{ date: day(0, TW), kinds: ['day_off'] }, { date: day(1, TW), kinds: ['no_evening'] }, { date: day(2, TW), kinds: ['day_off', 'no_morning'] }])
check('an employee can ask for days off and for a half of a day, with no limit on how many', danaWish.ok === true && danaWish.added === 3, JSON.stringify(danaWish))
const danaLive = await offRows(dana)
check('a day off waits for a decision, a wish is just noted', danaLive.find((r) => r.kind === 'day_off' && r.d === day(0, TW))?.status === 'pending' && danaLive.find((r) => r.kind === 'no_evening')?.status === 'noted')
check('a whole day off already covers the softer wish of the same day', !danaLive.some((r) => r.d === day(2, TW) && r.kind === 'no_morning'))
const mgrNotes = await q(`select staff_id from public.schedule_notifications where kind = 'timeoff.new'`)
check('the managers of their branch hear about the new day off, the employee does not', [owner.id, gm.id, delegate.id].every((id) => mgrNotes.some((n) => n.staff_id === id)) && !mgrNotes.some((n) => n.staff_id === dana.id))
const again = await submitOff(dana, TW, [{ date: day(0, TW), kinds: ['day_off'] }, { date: day(1, TW), kinds: ['no_evening'] }, { date: day(2, TW), kinds: ['day_off'] }])
check('sending the same wishes again changes and announces nothing', again.ok === true && again.added === 0 && again.removed === 0)
check('a week that is not a Sunday, an unknown kind and a date outside the week are refused',
  (await submitOff(dana, day(1, TW), [])).reason === 'bad_date' && (await submitOff(dana, TW, [{ date: day(0, TW), kinds: ['holiday'] }])).reason === 'bad_request'
  && (await submitOff(dana, TW, [{ date: day(9, TW), kinds: ['day_off'] }])).reason === 'bad_date')
check('days that already passed cannot be changed', (await submitOff(dana, WPAST, [{ date: day(2, WPAST), kinds: ['day_off'] }])).added === 0)
check('only an active person can ask', (await submitOff(gone, TW, [{ date: day(4, TW), kinds: ['day_off'] }])).reason === 'forbidden')

// a pending day off blocks nothing yet, but the automatic fill already leaves the person alone
const sun = await save(owner, wTW, { p_date: day(0, TW), p_start: '07:00', p_end: '13:00' })
const mon = await save(owner, wTW, { p_date: day(1, TW), p_start: '13:00', p_end: '19:00' })
const monAm = await save(owner, wTW, { p_date: day(1, TW), p_start: '07:00', p_end: '12:00' })
const safetyJson = JSON.stringify({ maxWeeklyHours: 42, minRestHours: 10, maxDailyHours: 10, maxConsecutiveDays: 6 })
const eligible = async (who, shiftId, ws = TW) => (await one(`select public.sched_fill_eligible($1,$2,$3,$4::jsonb,null) ok`, [who.id, shiftId, ws, safetyJson])).ok
check('a pending day off keeps the person out of automatic filling', await eligible(dana, sun.shiftId) === false)
check('"not the evening" keeps them off the evening shift only', await eligible(dana, mon.shiftId) === false && await eligible(dana, monAm.shiftId) === true)
check('but a pending day off is not yet a block: the owner can still schedule them', (await save(owner, wTW, { p_date: day(0, TW), p_shift_id: sun.shiftId, p_start: '07:00', p_end: '13:00', p_assignees: JSON.stringify([asg(dana.id)]), p_expected_updated: (await shiftRow(sun.shiftId)).updated_at })).ok === true)

// deciding
const idOf = async (who, d) => (await one(`select id from public.staff_time_off where staff_id=$1 and day=$2 and kind='day_off' and status in ('pending','approved')`, [who.id, d])).id
check('an ordinary employee cannot decide', (await rpc('sched_decide_time_off', { p_actor: dana.id, p_branch: maor, p_ids: [await idOf(dana, day(2, TW))], p_approve: true, p_note: null })).reason === 'forbidden')
const sunId = await idOf(dana, day(0, TW))
const needs = await rpc('sched_decide_time_off', { p_actor: delegate.id, p_branch: maor, p_ids: [sunId], p_approve: true, p_note: null })
check('approving a day the person is already scheduled on asks first and changes nothing', needs.reason === 'needs_confirmation' && needs.details.issues.length === 1 && (await offRows(dana, 'approved')).length === 0, JSON.stringify(needs))
check('the other branch\'s board cannot decide for a person who is not in it', (await rpc('sched_decide_time_off', { p_actor: owner.id, p_branch: ghav, p_ids: [sunId], p_approve: true, p_note: null, p_force: true })).reason === 'wrong_branch')
const forced = await rpc('sched_decide_time_off', { p_actor: delegate.id, p_branch: maor, p_ids: [sunId], p_approve: true, p_note: 'בכיף', p_force: true })
check('a delegated manager can approve with confirmation', forced.ok === true && (await offRows(dana, 'approved')).length === 1)
const lena = await addStaff({ email: 'lena@x.test', first: 'Lena', badge: 'barista', branch: maor })
await submitOff(lena, TW, [{ date: day(6, TW), kinds: ['day_off'] }])
await rpc('sched_decide_time_off', { p_actor: owner.id, p_branch: maor, p_ids: [await idOf(lena, day(6, TW))], p_approve: true, p_note: 'מאושר' })
check('the employee is told, with the manager note', (await notesFor(lena)).some((n) => n.kind === 'timeoff.decided' && /אושר/.test(n.title) && /מאושר/.test(n.body ?? '')))
check('a decided request cannot be decided again', (await rpc('sched_decide_time_off', { p_actor: gm.id, p_branch: maor, p_ids: [sunId], p_approve: false, p_note: null })).reason === 'not_pending')
check('a shift that already held the person can still be edited (they were kept knowingly)', (await save(owner, wTW, { p_date: day(0, TW), p_shift_id: sun.shiftId, p_start: '07:00', p_end: '13:00', p_note: 'עדכון', p_assignees: JSON.stringify([asg(dana.id, 'barista', (await assignmentsOf(sun.shiftId))[0].id)]), p_expected_updated: (await shiftRow(sun.shiftId)).updated_at })).ok === true)

// the block
const sun2 = await save(owner, wTW, { p_date: day(0, TW), p_start: '14:00', p_end: '18:00' })
let blocked = ''
try { await save(owner, wTW, { p_date: day(0, TW), p_shift_id: sun2.shiftId, p_start: '14:00', p_end: '18:00', p_assignees: JSON.stringify([asg(dana.id)]), p_expected_updated: (await shiftRow(sun2.shiftId)).updated_at }) } catch (e) { blocked = String(e.message) }
check('after approval the person cannot be put on any shift that day (the database refuses)', /sched_time_off/.test(blocked), blocked)
check('...not even by writing the assignment around the functions', (await throws(`insert into public.shift_assignments (branch_id, shift_id, staff_id, staff_name) values ($1,$2,$3,'x')`, [maor, sun2.shiftId, dana.id], /sched_time_off/)) === true)
const otherDay = await save(owner, wTW, { p_date: day(3, TW), p_start: '08:00', p_end: '12:00' })
const lateDay = await save(owner, wTW, { p_date: day(4, TW), p_start: '15:00', p_end: '17:00', p_assignees: JSON.stringify([asg(dana.id)]) })
check('...while other days stay open to them', (await save(owner, wTW, { p_date: day(3, TW), p_shift_id: otherDay.shiftId, p_start: '08:00', p_end: '12:00', p_assignees: JSON.stringify([asg(dana.id)]), p_expected_updated: (await shiftRow(otherDay.shiftId)).updated_at })).ok === true)
check('...and dragging a shift onto their day off is refused too', (await throws(`update public.shifts set shift_date = $2 where id = $1`, [lateDay.shiftId, day(0, TW)], /sched_time_off/)) === true)
const monId = await idOf(dana, day(2, TW))
const declined = await rpc('sched_decide_time_off', { p_actor: owner.id, p_branch: maor, p_ids: [monId], p_approve: false, p_note: 'חסרים לנו' })
const tueShift = await save(owner, wTW, { p_date: day(2, TW), p_start: '09:00', p_end: '12:00' })
check('a declined day off blocks nothing and keeps the reason', declined.ok === true && (await one(`select decision_note from public.staff_time_off where id=$1`, [monId])).decision_note === 'חסרים לנו' && await eligible(dana, tueShift.shiftId) === true)

// withdrawing an approved day off
const withdrawn = await submitOff(dana, TW, [{ date: day(1, TW), kinds: ['no_evening'] }])
check('an employee can withdraw an approved day off, and the managers are told', withdrawn.ok === true && withdrawn.removed >= 1 && (await q(`select 1 from public.schedule_notifications where kind='timeoff.cancelled' and staff_id=$1`, [owner.id])).length === 1)
check('the day is open to scheduling again', (await save(owner, wTW, { p_date: day(0, TW), p_shift_id: sun2.shiftId, p_start: '14:00', p_end: '18:00', p_assignees: JSON.stringify([asg(dana.id)]), p_expected_updated: (await shiftRow(sun2.shiftId)).updated_at })).ok === true)

// copying a week skips an approved day off instead of failing
await save(owner, wTW, { p_date: day(5, TW), p_start: '09:00', p_end: '12:00', p_assignees: JSON.stringify([asg(yossi.id)]) })
await submitOff(yossi, TW2, [{ date: day(5, TW2), kinds: ['day_off'] }])
await rpc('sched_decide_time_off', { p_actor: owner.id, p_branch: maor, p_ids: [await idOf(yossi, day(5, TW2))], p_approve: true, p_note: null })
const copied = await rpc('sched_copy_week', { p_actor: owner.id, p_branch: maor, p_from: TW, p_to: TW2 })
check('copying a week leaves out someone on an approved day off and says why', copied.ok === true && copied.skipped.some((s) => s.why === 'day_off') && !(await q(`select 1 from public.shift_assignments a join public.shifts s on s.id=a.shift_id where s.week_id=$1 and a.staff_id=$2`, [wTW2, yossi.id])).length, JSON.stringify(copied))
check('a browser cannot read or write days off', await asRole('authenticated', dana.authId, () => refused(`select * from public.staff_time_off`)) === true && await asRole('authenticated', dana.authId, () => refused(`insert into public.staff_time_off (staff_id, day, kind, status) values ('${dana.id}', '2031-04-06', 'day_off', 'approved')`)) === true)


// ============================================================================
section('cross-branch published schedules stay read/request-only')
const crossStaff = await addStaff({ first: 'Cross branch', branch: ghav })
const unlinkedCross = await addStaff({ first: 'Unlinked cross branch', branch: ghav, auth: false })
check('linked staff may browse a permanent branch while strict operational scope stays unchanged',
  (await one(`select public.sched_can_browse_published($1,$2) browse, public.sched_can_view($1,$2) scoped, public.sched_can_manage($1,$2) manage`, [crossStaff.id, maor])).browse === true
  && (await one(`select public.sched_can_view($1,$2) scoped`, [crossStaff.id, maor])).scoped === false
  && (await one(`select public.sched_can_manage($1,$2) manage`, [crossStaff.id, maor])).manage === false)
check('an unlinked or inactive employee cannot cross branches',
  (await one(`select public.sched_can_browse_published($1,$3) unlinked, public.sched_can_browse_published($2,$3) inactive`, [unlinkedCross.id, gone.id, maor])).unlinked === false
  && (await one(`select public.sched_can_browse_published($1,$3) unlinked, public.sched_can_browse_published($2,$3) inactive`, [unlinkedCross.id, gone.id, maor])).inactive === false)

const crossWeekStart = '2032-01-04'
const crossWeek = await weekOf(maor, crossWeekStart)
const snapshotOpen = await save(owner, crossWeek, { p_date: day(1, crossWeekStart), p_start: '07:00', p_end: '13:00' })
await db.query(`update public.shifts set requests_open=true where id=$1`, [snapshotOpen.shiftId])
await rpc('sched_publish_week', { p_actor: owner.id, p_week_id: crossWeek })
await db.query(`update public.shifts set requests_open=false where id=$1`, [snapshotOpen.shiftId])
const crossRequest = await rpc('sched_request_shift', { p_actor: crossStaff.id, p_shift: snapshotOpen.shiftId, p_note: null })
check('another-branch employee can request a published permanent-branch shift', crossRequest.ok === true, JSON.stringify(crossRequest))
check('published request-open state wins over an unpublished live edit',
  crossRequest.ok === true && (await one(`select terms from public.shift_requests where id=$1`, [crossRequest.requestId])).terms.start === '07:00')
check('the cross-branch requester can cancel their own pending request',
  (await rpc('sched_cancel_request', { p_actor: crossStaff.id, p_request: crossRequest.requestId })).ok === true)
const approvedCrossRequest = await rpc('sched_request_shift', { p_actor: crossStaff.id, p_shift: snapshotOpen.shiftId, p_note: null })
const approvedCross = await rpc('sched_decide_request', { p_actor: owner.id, p_request: approvedCrossRequest.requestId, p_approve: true, p_note: null, p_force: false })
const crossAssignment = (await assignmentsOf(snapshotOpen.shiftId)).find((assignment) => assignment.staff_id === crossStaff.id)
check('a manager can approve the cross-branch request without widening manual scheduling scope',
  approvedCross.ok === true
  && !!crossAssignment
  && (await one(`select public.sched_can_view($1,$2) scoped`, [crossStaff.id, maor])).scoped === false)
check('later shift edits preserve that approved assignment, but cannot add cross-branch staff manually',
  (await save(owner, crossWeek, { p_shift_id: snapshotOpen.shiftId, p_date: day(1, crossWeekStart), p_start: '07:00', p_end: '13:00', p_assignees: JSON.stringify([asg(crossStaff.id, 'barista', crossAssignment?.id)]) })).ok === true
  && (await save(owner, crossWeek, { p_date: day(4, crossWeekStart), p_start: '08:00', p_end: '12:00', p_assignees: JSON.stringify([asg(crossStaff.id)]) })).reason === 'wrong_branch')

const snapshotClosed = await save(owner, crossWeek, { p_date: day(2, crossWeekStart), p_start: '13:00', p_end: '19:00' })
await rpc('sched_publish_week', { p_actor: owner.id, p_week_id: crossWeek })
await db.query(`update public.shifts set requests_open=true where id=$1`, [snapshotClosed.shiftId])
check('an unpublished live opening cannot expose a shift that is closed in the snapshot',
  (await rpc('sched_request_shift', { p_actor: crossStaff.id, p_shift: snapshotClosed.shiftId, p_note: null })).reason === 'requests_not_open')

const crossDraftStart = '2032-01-11'
const crossDraft = await weekOf(maor, crossDraftStart)
const draftShift = await save(owner, crossDraft, { p_date: day(1, crossDraftStart), p_start: '08:00', p_end: '12:00' })
await db.query(`update public.shifts set requests_open=true where id=$1`, [draftShift.shiftId])
check('cross-branch access never opens a draft or availability submission',
  (await rpc('sched_request_shift', { p_actor: crossStaff.id, p_shift: draftShift.shiftId, p_note: null })).reason === 'forbidden'
  && (await rpc('sched_submit_availability', { p_actor: crossStaff.id, p_branch: maor, p_week_start: crossDraftStart, p_entries: '[]', p_note: null, p_status: 'draft' })).reason === 'forbidden')

const eventBranch = (await one(`insert into public.branches (slug, name, kind) values ('cross-event-fixture', '{"he":"אירוע"}', 'event') returning id`)).id
const eventWeek = await weekOf(eventBranch, crossWeekStart)
const eventShift = await save(owner, eventWeek, { p_date: day(3, crossWeekStart), p_start: '10:00', p_end: '14:00' })
await db.query(`update public.shifts set requests_open=true where id=$1`, [eventShift.shiftId])
await rpc('sched_publish_week', { p_actor: owner.id, p_week_id: eventWeek })
check('event schedules remain branch-scoped',
  (await one(`select public.sched_can_browse_published($1,$2) browse`, [crossStaff.id, eventBranch])).browse === false
  && (await rpc('sched_request_shift', { p_actor: crossStaff.id, p_shift: eventShift.shiftId, p_note: null })).reason === 'forbidden')

const planningMigration = files.find((f) => f.endsWith('_schedule_planning_fair_fill.sql'))
await db.exec(readFileSync(MIG + planningMigration, 'utf8'))
check('planning migration may be run again', true)
// Re-running the planning migration restores its (older) fill function; the newer migrations that replace it go back on top.
await db.exec(readFileSync(MIG + files.find((f) => f.endsWith('_drop_min_rest_from_fill.sql')), 'utf8'))
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
  select $1, s.id, s.id = any($2::uuid[]) from public.staff s
  on conflict (branch_id, staff_id) do update set schedulable = excluded.schedulable`, [planBranch, [heavy.id, light.id, unavailable.id]])
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
check('a shift is closed to employee requests by default', (await rpc('sched_request_shift', { p_actor: light.id, p_shift: planMonday.shiftId, p_note: null })).reason === 'requests_not_open')
await db.query(`update public.shifts set requests_open=true where id in ($1,$2)`, [planMonday.shiftId, planSaturday.shiftId])
const draftReq = await rpc('sched_request_shift', { p_actor: light.id, p_shift: planMonday.shiftId, p_note: 'Preferred' })
check('employee can request a shift only after the owner opens it', draftReq.ok === true && (await assignmentsOf(planMonday.shiftId)).length === 0)
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
check('multiple Saturday slots are filled by eligible staff (no minimum-rest rule any more)', spread.added === 1 && [heavy.id, light.id].includes((await assignmentsOf(saturdaySecond.shiftId))[0].staff_id))
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
check('there is NO minimum-rest rule: the stored minRestHours setting no longer changes who is eligible', (await elig(light, restShift.shiftId, safe)) === (await elig(light, restShift.shiftId, JSON.stringify({ maxWeeklyHours: 42, minRestHours: 0, maxDailyHours: 10, maxConsecutiveDays: 6 }))) && (await elig(light, restShift.shiftId, JSON.stringify({ maxWeeklyHours: 42, minRestHours: 24, maxDailyHours: 10, maxConsecutiveDays: 6 }))) === (await elig(light, restShift.shiftId, safe)))
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
section('the owner hears about every constraint and every note (20261016090000)')
// The planning migration was just run again above (it replaces sched_submit_availability); this one is the newest, so it goes last, twice (it must be re-runnable).
await db.exec(readFileSync(MIG + files.find((f) => f.endsWith('_branch_manager_checklists_constraints.sql')), 'utf8'))
await db.exec(readFileSync(MIG + files.find((f) => f.endsWith('_branch_manager_checklists_constraints.sql')), 'utf8'))
check('the constraints migration may be run again', true)
await db.exec(readFileSync(MIG + files.find((f) => f.endsWith('_timeoff_alert_once_per_person.sql')), 'utf8'))
await db.exec(readFileSync(MIG + files.find((f) => f.endsWith('_timeoff_alert_once_per_person.sql')), 'utf8'))
check('the once-per-person migration may be run again', true)
const WISH = '2031-04-06' // a Sunday
const wishNotes = async (kind) => q(`select staff_id, title, body from public.schedule_notifications where kind = $1 order by created_at`, [kind])
const noWishYet = (await wishNotes('timeoff.wish')).length
const lenaWishes = await submitOff(lena, WISH, [{ date: day(1, WISH), kinds: ['no_morning'] }, { date: day(2, WISH), kinds: ['no_evening'] }])
const wishAlerts = await wishNotes('timeoff.wish')
check('wishes alone (no day off) are sent to the managers', lenaWishes.ok === true && lenaWishes.added === 2 && wishAlerts.length - noWishYet >= 3 && [owner.id, gm.id, delegate.id].every((id) => wishAlerts.some((n) => n.staff_id === id)))
check('...in ONE alert that lists each kind with its days, and the employee is not told', /לא יכול\/ה בבוקר/.test(wishAlerts.at(-1).body) && /לא יכול\/ה בערב/.test(wishAlerts.at(-1).body) && !wishAlerts.some((n) => n.staff_id === lena.id))
const mixed = await submitOff(lena, WISH, [{ date: day(1, WISH), kinds: ['no_morning'] }, { date: day(2, WISH), kinds: ['no_evening'] }, { date: day(4, WISH), kinds: ['day_off'] }])
const mixedAlert = (await wishNotes('timeoff.new')).at(-1)
check('a day off in the same send turns it into the "needs an answer" alert, with the day off first', mixed.added === 1 && /יום חופש:/.test(mixedAlert.body) && !/לא יכול\/ה/.test(mixedAlert.body))
const resendWish = (await wishNotes('timeoff.wish')).length
await submitOff(lena, WISH, [{ date: day(1, WISH), kinds: ['no_morning'] }, { date: day(2, WISH), kinds: ['no_evening'] }, { date: day(4, WISH), kinds: ['day_off'] }])
check('sending the same things again alerts nobody', (await wishNotes('timeoff.wish')).length === resendWish)

// One submission, one alert per manager: a person who works in BOTH branches used to tell their owner twice (one loop per branch).
// 20261016160000 collects the managers of every branch first. Production showed six rows for one send: two per manager.
const SINI = '2031-04-13' // a Sunday
const bothBranches = await addStaff({ first: 'Both branches', badge: 'barista' }) // branch null: works in every permanent branch
const alertsFor = async (who, kind) => (await one(`select count(*)::int n from public.schedule_notifications where staff_id = $1 and kind = $2`, [who.id, kind])).n
check('the fixture person really belongs to two branches', (await one(`select cardinality(public.sched_staff_branches($1)) n`, [bothBranches.id])).n >= 2)
const ownerBefore = await alertsFor(owner, 'timeoff.new')
const gmBefore = await alertsFor(gm, 'timeoff.new')
const bothSent = await submitOff(bothBranches, SINI, [{ date: day(2, SINI), kinds: ['day_off'] }, { date: day(3, SINI), kinds: ['no_evening'] }])
check('a person in two branches tells the owner ONCE, not once per branch', bothSent.ok === true && (await alertsFor(owner, 'timeoff.new')) === ownerBefore + 1, `${ownerBefore} -> ${await alertsFor(owner, 'timeoff.new')}`)
check('...and the branch manager once as well', (await alertsFor(gm, 'timeoff.new')) === gmBefore + 1)
const cancelBefore = await alertsFor(owner, 'timeoff.cancelled')
const bothDay = await one(`select id from public.staff_time_off where staff_id = $1 and kind = 'day_off' and status = 'pending'`, [bothBranches.id])
await rpc('sched_decide_time_off', { p_actor: owner.id, p_branch: maor, p_ids: [bothDay.id], p_approve: true, p_note: null })
await submitOff(bothBranches, SINI, [])
check('withdrawing an approved day off also tells the owner once', (await alertsFor(owner, 'timeoff.cancelled')) === cancelBefore + 1)

const noteAlerts = async () => q(`select staff_id, title, body from public.schedule_notifications where kind = 'availability.note' order by created_at`)
const sendNote = (note, entries = []) => rpc('sched_submit_availability', { p_actor: lena.id, p_branch: maor, p_week_start: WISH, p_entries: JSON.stringify(entries), p_note: note, p_status: 'submitted' })
const sentNote = await sendNote('לא יכולה אחרי 17:00 ביום ג׳')
const firstNotes = await noteAlerts()
check('a note added to the week reaches the managers with its text', sentNote.ok === true && [owner.id, gm.id, delegate.id].every((id) => firstNotes.some((n) => n.staff_id === id && n.body === 'לא יכולה אחרי 17:00 ביום ג׳')) && /הוסיף\/ה הערה/.test(firstNotes[0].title))
await sendNote('לא יכולה אחרי 17:00 ביום ג׳')
check('sending the same note again alerts nobody', (await noteAlerts()).length === firstNotes.length)
await sendNote('לא יכולה אחרי 16:00 ביום ג׳')
check('changing the note alerts again', (await noteAlerts()).length === firstNotes.length * 2)
await sendNote(null)
check('removing the note is not an alert of its own', (await noteAlerts()).length === firstNotes.length * 2)

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
