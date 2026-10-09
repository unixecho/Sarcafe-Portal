// Independent test harness for the scheduling feature's PURE modules
// (src/lib/shifts/*, minus the server-only ones) — and for the places where the
// TypeScript and the SQL must say the SAME thing.
//
//   node scripts/check-schedule.mjs
//
// It transpiles and runs the REAL TypeScript sources (the check-pos.mjs / check-a11y.mjs
// technique) — nothing is re-implemented here. The oracle is the product spec
// (docs/STAFF_SCHEDULING.md) and migration 024, not the code under test.
//
// The "TS == SQL" section boots an in-process Postgres (PGlite), applies every
// migration, and compares the two implementations of each rule that exists twice:
// shift labels, overlap, headcount, names, and who may view/manage. Drift between
// them is the single bug class this codebase's own history warns about most.

import ts from 'typescript'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { inspect } from 'node:util'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const SRC = join(ROOT, 'src')
const SHIFTS = join(SRC, 'lib', 'shifts')
const MIG = join(ROOT, 'supabase', 'migrations')
const outDir = join(tmpdir(), `check-schedule-${process.pid}`)
mkdirSync(outDir, { recursive: true })
process.on('exit', () => {
  try {
    rmSync(outDir, { recursive: true, force: true })
  } catch {
    /* a leftover temp dir is harmless */
  }
})

// ---- Emit: transpile the real sources into a temp tree -------------------------------------------
const ZOD_URL = import.meta.resolve('zod')
const emittedPath = (tsPath) => join(outDir, relative(SRC, tsPath)).replace(/\.ts$/, '.mjs')

function rewrite(spec, tsPath, to) {
  if (spec === 'zod') return ZOD_URL
  let target
  if (spec.startsWith('@/')) target = join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) target = resolve(dirname(tsPath), spec)
  else return spec
  const file = [target + '.ts', join(target, 'index.ts')].find(existsSync)
  if (!file) return spec
  const rel = relative(dirname(to), emittedPath(file)).split(sep).join('/')
  return rel.startsWith('.') ? rel : `./${rel}`
}

function emit(tsPath) {
  const to = emittedPath(tsPath)
  const source = readFileSync(tsPath, 'utf8')
  let js = ts.transpileModule(source, {
    fileName: tsPath,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true },
  }).outputText
  js = js.replace(/(\bfrom\s+|\bimport\s+)(['"])([^'"\n]+)\2/g, (_m, kw, q, spec) => `${kw}${q}${rewrite(spec, tsPath, to)}${q}`)
  mkdirSync(dirname(to), { recursive: true })
  writeFileSync(to, js)
}

// Pure modules only. Server-only files (guard, state-query, dispatch-write) and
// type-only files are deliberately NOT here — and the purity check below proves it.
const PURE = ['time', 'names', 'presets', 'coverage', 'messages', 'snapshot-diff', 'rules', 'view', 'access', 'schema', 'config', 'serialize', 'actions', 'people']
for (const n of PURE) emit(join(SHIFTS, `${n}.ts`))
emit(join(SRC, 'lib', 'staff', 'access.ts'))

const load = (rel) => import(pathToFileURL(join(outDir, rel)).href)
const T = await load('lib/shifts/time.mjs')
const N = await load('lib/shifts/names.mjs')
const P = await load('lib/shifts/presets.mjs')
const C = await load('lib/shifts/coverage.mjs')
const Msg = await load('lib/shifts/messages.mjs')
const D = await load('lib/shifts/snapshot-diff.mjs')
const R = await load('lib/shifts/rules.mjs')
const V = await load('lib/shifts/view.mjs')
const A = await load('lib/shifts/access.mjs')
const S = await load('lib/shifts/schema.mjs')
const Z = await load('lib/shifts/serialize.mjs')
const People = await load('lib/shifts/people.mjs')

// ---- Output ---------------------------------------------------------------------------------------------
let pass = 0
const failures = []
const show = (v) => inspect(v, { depth: 5, breakLength: Infinity, maxStringLength: 140 })
function check(name, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    failures.push(name)
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
const eq = (name, actual, expected) => check(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${show(actual)}, want ${show(expected)}`)
const section = (t) => console.log(`\n${t}`)
const throwsZod = (fn) => {
  try {
    fn()
    return false
  } catch (e) {
    return e?.name === 'ZodError'
  }
}

// ============================================================================================================
section('names — a person without an email is never "unnamed"')
eq('display name wins', N.staffDisplayName({ display_name: 'דנה כהן', first_name: 'דנה', handle: 'dana' }), 'דנה כהן')
eq('first + last name next', N.staffDisplayName({ first_name: 'נועה', last_name: 'לוי', handle: 'noa' }), 'נועה לוי')
eq('first name only (the live data: no email, no display name)', N.staffDisplayName({ email: null, first_name: 'תמר', display_name: null, handle: 'תמר' }), 'תמר')
eq('the POS nickname is the next fallback', N.staffDisplayName({ handle: 'סיני' }), 'סיני')
eq('email is the LAST resort, never the first', N.staffDisplayName({ email: 'a@b.co' }), 'a@b.co')
eq('whitespace-only fields do not count', N.staffDisplayName({ display_name: '   ', first_name: ' ', handle: 'x1' }), 'x1')
eq('nothing at all → a label, not a crash', N.staffDisplayName({}), N.UNNAMED)
eq('null row → label', N.staffDisplayName(null), N.UNNAMED)
eq('initials: one word', N.initialsOf('תמר'), 'ת')
eq('initials: first + last', N.initialsOf('Dana Cohen'), 'DC')
eq('initials: empty', N.initialsOf('  '), '?')

section('roster privacy — an employee never receives a colleague\'s private notes')
const staffRow = { id: 's1', display_name: null, first_name: 'דנה', badge: 'barista', active: true, auth_user_id: null }
const member = { schedulable: true, default_role_id: 'barista', max_weekly_hours: 30, employment_type: 'part', sort_order: 2, note: 'לא לשבץ בשישי — סיבה אישית' }
const asManager = Z.serializeRosterRow(staffRow, member, true)
const asEmployee = Z.serializeRosterRow(staffRow, member, false)
check('a manager sees the bookkeeping', asManager.note === member.note && asManager.maxWeeklyHours === 30 && asManager.defaultRoleId === 'barista')
check('an employee sees a name and nothing private', asEmployee.displayName === 'דנה' && asEmployee.note === null && asEmployee.maxWeeklyHours === null && asEmployee.defaultRoleId === null && asEmployee.employmentType === null)
check('…and whether the person can answer a swap (hasLogin) is shared', asEmployee.hasLogin === false && Z.serializeRosterRow({ ...staffRow, auth_user_id: 'x' }, undefined, false).hasLogin === true)
check('no member row = schedulable (the default everywhere)', Z.serializeRosterRow(staffRow, undefined, false).schedulable === true)
check('owner without an explicit member row is not schedulable', Z.serializeRosterRow({ ...staffRow, role: 'owner', badge: 'owner' }, undefined, true).schedulable === false)
check('developer display role keeps owner powers out of scheduling by default', Z.serializeRosterRow({ ...staffRow, role: 'owner', badge: 'developer' }, undefined, true).schedulable === false)
check('an explicit "off" is respected', Z.serializeRosterRow(staffRow, { ...member, schedulable: false }, true).schedulable === false)

// ============================================================================================================
section('time — labels, intervals, the branch clock')
eq('weekday label', T.weekdayLongLabel(2), 'יום שלישי')
eq('shift range', T.formatShiftRange('07:00', '13:00'), '07:00–13:00')
eq('day label (2030-01-08 is a Tuesday)', T.formatDayLabel('2030-01-08'), 'יום שלישי 8/1')
eq('shift label (the time range is bidi-isolated so it reads in clock order inside Hebrew)', T.formatShiftLabel('2030-01-08', '07:00', '13:00'), 'יום שלישי 8/1 · ⁦07:00–13:00⁩')
eq('duration', T.durationMinutes({ startTime: '07:00', endTime: '13:00' }), 360)
eq('duration across midnight', T.durationMinutes({ startTime: '22:00', endTime: '02:00' }), 240)
check('crossesMidnight', T.crossesMidnight({ startTime: '22:00', endTime: '02:00' }) && !T.crossesMidnight({ startTime: '07:00', endTime: '13:00' }))
check('valid times', T.isValidShiftTimes('07:00', '13:00') && T.isValidShiftTimes('22:00', '02:00'))
check('invalid times are rejected', !T.isValidShiftTimes('07:00', '07:00') && !T.isValidShiftTimes('7:00', '13:00') && !T.isValidShiftTimes('07:00', '25:00') && !T.isValidShiftTimes('07:60', '13:00'))
eq('week starts on Sunday', T.weekStartOf('2030-01-09'), '2030-01-06')
eq('a Sunday is its own week start', T.weekStartOf('2030-01-06'), '2030-01-06')
eq('addDays across a month', T.addDays('2030-01-30', 3), '2030-02-02')
const now = { date: '2030-01-08', time: '10:30' }
eq('"היום"', T.relativeDayLabel('2030-01-08', now), 'היום')
eq('"מחר"', T.relativeDayLabel('2030-01-09', now), 'מחר')
eq('no label for later days', T.relativeDayLabel('2030-01-12', now), null)
check('a shift later today has not started', !T.hasStarted({ date: '2030-01-08', startTime: '11:00' }, now))
check('a shift at exactly this minute HAS started (matches sched_is_past: start <= now)', T.hasStarted({ date: '2030-01-08', startTime: '10:30' }, now))
check('a shift yesterday has started; tomorrow has not', T.hasStarted({ date: '2030-01-07', startTime: '23:00' }, now) && !T.hasStarted({ date: '2030-01-09', startTime: '00:00' }, now))
const jer = T.wallClockNow('Asia/Jerusalem', new Date('2030-07-01T21:30:00Z')) // IDT = UTC+3 → 00:30 next day
eq('the branch clock follows ITS timezone, not the server\'s', jer, { date: '2030-07-02', time: '00:30' })
eq('…and winter time (IST = UTC+2)', T.wallClockNow('Asia/Jerusalem', new Date('2030-01-01T21:30:00Z')), { date: '2030-01-01', time: '23:30' })
check('midnight is 00:xx, never 24:xx', T.wallClockNow('Asia/Jerusalem', new Date('2030-01-01T22:05:00Z')).time === '00:05')
check('a bad timezone falls back instead of throwing', typeof T.wallClockNow('Not/AZone').date === 'string')
const nowMs = Date.parse('2030-01-08T12:00:00Z')
eq('timeAgo: now', T.timeAgoHe('2030-01-08T11:59:40Z', nowMs), 'ממש עכשיו')
eq('timeAgo: minutes', T.timeAgoHe('2030-01-08T11:35:00Z', nowMs), 'לפני 25 דקות')
eq('timeAgo: an hour', T.timeAgoHe('2030-01-08T11:00:00Z', nowMs), 'לפני שעה')
eq('timeAgo: hours', T.timeAgoHe('2030-01-08T07:00:00Z', nowMs), 'לפני 5 שעות')
eq('timeAgo: yesterday', T.timeAgoHe('2030-01-07T11:00:00Z', nowMs), 'אתמול')
eq('timeAgo: bad input → empty, no crash', T.timeAgoHe('nonsense', nowMs), '')

// ============================================================================================================
section('default shift times — they come from Settings, never from the code')
const presets = [
  { id: 'morning', name: 'בוקר', startTime: '07:00', endTime: '13:00' },
  { id: 'evening', name: 'ערב', startTime: '13:00', endTime: '19:00' },
]
const settings = { presets, openTime: '08:00', closeTime: '19:00', dayHours: { 5: { open: '08:00', close: '13:00' }, 6: { open: '09:00', close: '14:00' } } }
eq('first template on an empty day', P.defaultTimesFor('2030-01-08', settings, []), { startTime: '07:00', endTime: '13:00', presetId: 'morning', source: 'template' })
eq('a day that already has "morning" suggests "evening"', P.defaultTimesFor('2030-01-08', settings, [{ startTime: '07:00', endTime: '13:00' }]).presetId, 'evening')
eq('every template used → fall back to the first, not nothing', P.defaultTimesFor('2030-01-08', settings, [{ startTime: '07:00', endTime: '13:00' }, { startTime: '13:00', endTime: '19:00' }]).presetId, 'morning')
eq('NO templates configured → the day\'s own opening hours (Friday override)', P.defaultTimesFor('2030-01-11', { ...settings, presets: [] }, []), { startTime: '08:00', endTime: '13:00', presetId: null, source: 'hours' })
eq('…and the global hours on an ordinary day', P.defaultTimesFor('2030-01-08', { ...settings, presets: [] }, []), { startTime: '08:00', endTime: '19:00', presetId: null, source: 'hours' })
eq('changing a template changes the NEXT shift\'s default…', P.defaultTimesFor('2030-01-08', { ...settings, presets: [{ id: 'morning', name: 'בוקר', startTime: '06:30', endTime: '12:30' }] }, []).startTime, '06:30')
check('…and the answer never depends on a hardcoded 08:00–16:00', !JSON.stringify(P.defaultTimesFor('2030-01-08', { ...settings, presets: [{ id: 'x', name: 'x', startTime: '05:15', endTime: '09:45' }] }, [])).includes('16:00'))
eq('matchPreset finds the exact template', P.matchPreset({ startTime: '13:00', endTime: '19:00' }, presets)?.id, 'evening')
eq('custom times match nothing', P.matchPreset({ startTime: '13:30', endTime: '19:00' }, presets), null)
eq('hoursFor: Saturday override', P.hoursFor('2030-01-12', settings), { open: '09:00', close: '14:00' })
const dayHoursFromJson = JSON.parse(JSON.stringify(settings.dayHours))
eq('hoursFor works with the string keys JSON gives back', P.hoursFor('2030-01-11', { ...settings, dayHours: dayHoursFromJson }), { open: '08:00', close: '13:00' })

// ============================================================================================================
section('coverage — "is this shift staffed?" (and the same rule the database applies)')
const shiftNeeds2 = { requirements: [{ roleId: 'barista', min: 2 }] }
eq('nobody → unassigned', C.coverageOf(shiftNeeds2, []).state, 'unassigned')
eq('one of two → partial, missing 1', [C.coverageOf(shiftNeeds2, [{ roleId: 'barista' }]).state, C.coverageOf(shiftNeeds2, [{ roleId: 'barista' }]).missing], ['partial', 1])
eq('two of two → full', C.coverageOf(shiftNeeds2, [{ roleId: 'barista' }, { roleId: 'cashier' }]).state, 'full')
eq('which role is still short', C.coverageOf({ requirements: [{ roleId: 'barista', min: 1 }, { roleId: 'cashier', min: 1 }] }, [{ roleId: 'barista' }, { roleId: 'barista' }]).short, [{ roleId: 'cashier', missing: 1 }])
eq('no declared need + someone on it → staffed (never "full")', C.coverageOf({ requirements: [] }, [{ roleId: null }]).state, 'staffed')
check('a shift with no declared need is never "full" — anyone may ask to join', C.isFull(C.coverageOf({ requirements: [] }, [{ roleId: null }, { roleId: null }])) === false)
check('…but one that reached its need is', C.isFull(C.coverageOf(shiftNeeds2, [{ roleId: 'a' }, { roleId: 'b' }])))
eq('neededFor ignores junk', C.neededFor([{ roleId: 'a', min: 2 }, { roleId: 'b', min: -1 }, { roleId: 'c', min: 1.5 }]), 2)

// ============================================================================================================
section('plain-Hebrew messages — every refusal says what happened and what to do')
const REASONS = ['forbidden', 'not_found', 'stale', 'bad_request', 'bad_time', 'bad_date', 'not_published', 'past', 'not_pending', 'duplicate_request', 'overlapping_request', 'duplicate_swap', 'already_assigned', 'shift_gone', 'assignment_changed', 'bad_target', 'source_empty', 'inactive_staff', 'not_schedulable', 'wrong_branch', 'self', 'last_owner', 'is_owner', 'has_history', 'needs_confirmation', 'conflict', 'busy', 'target_busy', 'actor_busy', 'target_already_on_shift', 'target_not_schedulable', 'unavailable_day', 'shift_full', 'duplicate_person', 'rate_limited']
check('every reason the database can return has a Hebrew sentence', REASONS.every((r) => /[֐-׿]/.test(Msg.scheduleMessage(r, {}))), REASONS.filter((r) => !/[֐-׿]/.test(Msg.scheduleMessage(r, {}))).join())
check('no message leaks a code or a technical word', REASONS.every((r) => !/(null|undefined|error|exception|sql|constraint|uuid|\b[a-z_]{6,}\b)/i.test(Msg.scheduleMessage(r, { name: 'דנה' }))), REASONS.filter((r) => /(null|undefined|error|exception|sql|constraint|uuid|\b[a-z_]{6,}\b)/i.test(Msg.scheduleMessage(r, { name: 'דנה' }))).join())
check('an unknown reason still gets a safe sentence', /[֐-׿]/.test(Msg.scheduleMessage('something_new', {})))
const clashLabel = T.formatShiftLabel('2030-01-07', '07:00', '13:00')
const clash = Msg.scheduleMessage('conflict', { conflicts: [{ name: 'דנה', with: { label: clashLabel } }] })
check('a conflict NAMES the person and the shift they are already on', clash.includes('דנה') && clash.includes(clashLabel), clash)
check('a double-booking message explains the rule', clash.includes('אי אפשר') )
const busy = Msg.scheduleMessage('busy', { name: 'יוסי', with: { date: '2030-01-08', start: '09:00', end: '11:00' } })
check('"busy" falls back to date/time when there is no label', busy.includes('יוסי') && busy.includes('09:00–11:00'), busy)
check('unavailable day names the date', Msg.scheduleMessage('unavailable_day', { date: '2030-01-08' }).includes('יום שלישי 8/1'))
check('inactive staff names the person when known', Msg.scheduleMessage('inactive_staff', { name: 'גונה' }).includes('גונה'))
eq('statuses: forbidden/not found/conflict/rate/other', ['forbidden', 'not_found', 'stale', 'rate_limited', 'bad_time'].map(Msg.scheduleStatus), [403, 404, 409, 429, 400])
eq('issuesOf only returns well-formed issues', Msg.issuesOf({ issues: [{ code: 'full', message: 'מלאה' }, { code: 'x' }, null, 'junk'] }), [{ code: 'full', message: 'מלאה' }])
eq('issuesOf of nothing', Msg.issuesOf(undefined), [])

// ============================================================================================================
section('access — who may view / manage / delegate (the TS twin of sched_can_*)')
const owner = { id: 'o', role: 'owner', badge: 'owner', branch_id: null }
const ownerScoped = { id: 'o2', role: 'owner', badge: 'owner', branch_id: 'B1' } // an owner is never branch-scoped
const gm1 = { id: 'g', role: 'staff', badge: 'general_manager', branch_id: 'B1' }
const gmAll = { id: 'ga', role: 'staff', badge: 'general_manager', branch_id: null }
const barista = { id: 'b', role: 'staff', badge: 'barista', branch_id: 'B1' }
check('owner manages every branch (even one with a branch_id set)', A.canManageSchedule(owner, 'B2', []) && A.canManageSchedule(ownerScoped, 'B2', []))
check('an owner can always VIEW (never branch-scoped)', A.canViewSchedule(ownerScoped, 'B2'))
check('a GM manages their own branch only', A.canManageSchedule(gm1, 'B1', []) && !A.canManageSchedule(gm1, 'B2', []))
check('an all-branch GM manages both', A.canManageSchedule(gmAll, 'B1', []) && A.canManageSchedule(gmAll, 'B2', []))
check('a barista manages nothing…', !A.canManageSchedule(barista, 'B1', []))
check('…until their branch delegates to them', A.canManageSchedule(barista, 'B1', ['b']))
check('…and a delegation in B1 does not make them a manager in B2 (scoped)', !A.canManageSchedule(barista, 'B2', ['b']))
check('a barista views their own branch, not the other', A.canViewSchedule(barista, 'B1') && !A.canViewSchedule(barista, 'B2'))
check('delegating the schedule is narrower than managing it', A.canDelegateSchedule(owner, 'B1') && A.canDelegateSchedule(gm1, 'B1') && !A.canDelegateSchedule(barista, 'B1') && !A.canDelegateSchedule(gm1, 'B2'))
check('a delegate cannot delegate', !A.canDelegateSchedule(barista, 'B1'))
check('null row = no access to anything', !A.canViewSchedule(null, 'B1') && !A.canManageSchedule(null, 'B1', []) && !A.canDelegateSchedule(undefined, 'B1'))

// ============================================================================================================
section('the action schema — strict, so a wrong or malicious body is a 400, not a write')
const U = '123e4567-e89b-42d3-a456-426614174000'
const U2 = '223e4567-e89b-42d3-a456-426614174001'
const good = S.parseAction({ type: 'saveShift', weekId: U, date: '2030-01-08', startTime: '07:00', endTime: '13:00', requirements: [{ roleId: 'barista', min: 2 }], assignees: [{ staffId: U2, roleId: 'barista' }] })
check('a well-formed saveShift parses', good.type === 'saveShift' && good.assignees.length === 1)
check('an UNKNOWN field is refused (nobody can name an actor or a status)', throwsZod(() => S.parseAction({ type: 'publishWeek', weekId: U, actor: U2 })))
check('…including inside a nested object', throwsZod(() => S.parseAction({ type: 'saveShift', weekId: U, date: '2030-01-08', startTime: '07:00', endTime: '13:00', requirements: [], assignees: [{ staffId: U2, isOwner: true }] })))
check('a status can never be sent to a decision', throwsZod(() => S.parseAction({ type: 'decideSwap', swapId: U, approve: true, status: 'approved' })))
check('bad uuid refused', throwsZod(() => S.parseAction({ type: 'deleteShift', shiftId: 'abc' })))
check('bad date refused', throwsZod(() => S.parseAction({ type: 'saveShift', weekId: U, date: '8/1/2030', startTime: '07:00', endTime: '13:00', requirements: [], assignees: [] })))
check('bad time refused', throwsZod(() => S.parseAction({ type: 'saveShift', weekId: U, date: '2030-01-08', startTime: '7am', endTime: '13:00', requirements: [], assignees: [] })))
check('an unknown action type refused', throwsZod(() => S.parseAction({ type: 'dropDatabase' })))
check('a note over 300 chars refused', throwsZod(() => S.parseAction({ type: 'requestShift', shiftId: U, note: 'x'.repeat(301) })))
check('more than 60 assignees refused', throwsZod(() => S.parseAction({ type: 'saveShift', weekId: U, date: '2030-01-08', startTime: '07:00', endTime: '13:00', requirements: [], assignees: Array.from({ length: 61 }, () => ({ staffId: U2 })) })))
check('requestSwap accepts a named person + a return shift', S.parseAction({ type: 'requestSwap', assignmentId: U, targetStaffId: U2, returnAssignmentId: U }).type === 'requestSwap')
check('decideRequest carries force only as a boolean', throwsZod(() => S.parseAction({ type: 'decideRequest', requestId: U, approve: true, force: 'yes' })))
check('markNotificationsRead takes nothing, or a list of ids', S.parseAction({ type: 'markNotificationsRead' }).type === 'markNotificationsRead' && throwsZod(() => S.parseAction({ type: 'markNotificationsRead', ids: ['x'] })))
const settingsOk = S.parseAction({ type: 'updateSettings', branchId: U, patch: { presets: [{ id: 'm', name: 'בוקר', startTime: '07:00', endTime: '13:00' }], openTime: '08:00' } })
check('a settings patch of presets + hours parses', settingsOk.patch.presets.length === 1)
check('a template with equal start and end is refused', throwsZod(() => S.parseAction({ type: 'updateSettings', branchId: U, patch: { presets: [{ id: 'm', name: 'x', startTime: '07:00', endTime: '07:00' }] } })))
check('duplicate template ids are refused', throwsZod(() => S.parseAction({ type: 'updateSettings', branchId: U, patch: { presets: [{ id: 'm', name: 'a', startTime: '07:00', endTime: '08:00' }, { id: 'm', name: 'b', startTime: '09:00', endTime: '10:00' }] } })))
check('an unknown settings key is refused (no free-form writes)', throwsZod(() => S.parseAction({ type: 'updateSettings', branchId: U, patch: { owner_override: true } })))
check('out-of-range safety values are refused', throwsZod(() => S.parseAction({ type: 'updateSettings', branchId: U, patch: { safety: { maxWeeklyHours: 999, minRestHours: 10, maxDailyHours: 10, maxConsecutiveDays: 6 } } })))
check('a member patch is limited to its own fields', throwsZod(() => S.parseAction({ type: 'setMember', branchId: U, staffId: U2, patch: { role: 'owner' } })))

// ============================================================================================================
section('the warnings engine + "what would approving this change?"')
const wk = '2030-01-06'
const baseSettings = {
  branchId: 'B1', workingDays: [0, 1, 2, 3, 4, 5, 6], openTime: '07:00', closeTime: '19:00', dayHours: {},
  roles: [{ id: 'barista', name: 'בריסטה', color: '#fff' }], stations: [], presets: [],
  safety: { maxWeeklyHours: 20, minRestHours: 10, maxDailyHours: 10, maxConsecutiveDays: 6 }, ruleSeverity: {},
  features: { availability: true, swaps: true }, scheduleManagers: [], onboardedAt: null,
}
const roster = ['dana', 'yossi'].map((id) => ({ staffId: id, displayName: id, avatarEmoji: null, badge: null, active: true, schedulable: true, defaultRoleId: null, maxWeeklyHours: null, employmentType: null, sortOrder: null, note: null, hasLogin: true }))
const sh = (id, date, s, e, req = []) => ({ id, branchId: 'B1', weekId: 'W', date, startTime: s, endTime: e, presetId: null, stationId: null, requirements: req, requestsOpen: false, note: null, updatedAt: null })
const as = (id, shiftId, staffId) => ({ id, shiftId, staffId, staffName: staffId, roleId: 'barista', status: 'assigned' })
const shifts = [sh('s1', '2030-01-07', '07:00', '17:00'), sh('s2', '2030-01-08', '07:00', '17:00'), sh('s3', '2030-01-09', '07:00', '17:00')]
const input = { weekStart: wk, settings: baseSettings, roster, shifts, assignments: [as('a1', 's1', 'dana'), as('a2', 's2', 'yossi'), as('a3', 's3', 'yossi')], availability: [] }
const base = R.evaluate(input)
check('a schedule that respects every rule has no staff warnings', base.filter((w) => w.staffId).length === 0, show(base))
const over = R.evaluate({ ...input, assignments: [...input.assignments, as('a4', 's2', 'dana'), as('a5', 's3', 'dana')] })
check('three 10-hour shifts exceed a 20-hour cap → a weekly-hours warning for that person', over.some((w) => w.code === 'max_weekly_hours' && w.staffId === 'dana'), show(over))
check('the engine reports an overlap if one ever exists (defence in depth)', R.evaluate({ ...input, shifts: [...shifts, sh('s4', '2030-01-07', '12:00', '14:00')], assignments: [...input.assignments, as('a9', 's4', 'dana')] }).some((w) => w.code === 'overlap'))
check('a deactivated person still on a shift is flagged', R.evaluate({ ...input, roster: roster.map((r) => (r.staffId === 'dana' ? { ...r, active: false } : r)) }).some((w) => w.code === 'inactive_staff' && w.staffId === 'dana'))
check('availability "unavailable" is a warning on that day', R.evaluate({ ...input, availability: [{ id: 'v', staffId: 'dana', weekStart: wk, entries: [{ date: '2030-01-07', kind: 'unavailable' }], note: null, status: 'submitted' }] }).some((w) => w.code === 'availability_conflict'))
const swapWarn = R.swapImpact({ ...input, assignments: [as('a1', 's1', 'dana'), as('a2', 's2', 'yossi'), as('a3', 's3', 'yossi'), as('a6', 's2', 'dana')] }, { assignmentId: 'a2', returnAssignmentId: null, fromStaffId: 'yossi', toStaffId: 'dana' })
check('swap impact: only what is NEW and about the two people is reported', swapWarn.every((w) => ['dana', 'yossi'].includes(w.staffId)), show(swapWarn))
check('swap impact: a pending swap with nobody yet has no impact', R.swapImpact(input, { assignmentId: 'a1', returnAssignmentId: null, fromStaffId: 'dana', toStaffId: null }).length === 0)
const reqWarn = R.requestImpact(input, { shiftId: 's2', staffId: 'dana' })
check('request impact: Dana taking a second 10h shift pushes her past 20h? (20h is the cap, so no)', reqWarn.length === 0, show(reqWarn))
const reqWarn2 = R.requestImpact({ ...input, assignments: [...input.assignments, as('a7', 's2', 'dana')] }, { shiftId: 's3', staffId: 'dana' })
check('request impact: a third long shift does', reqWarn2.some((w) => w.code === 'max_weekly_hours'), show(reqWarn2))
check('request impact never invents "unassigned shift" noise', !reqWarn2.some((w) => w.code === 'unassigned_shift'))

// ============================================================================================================
section('"unpublished changes" — the manager is told the team is seeing an old version')
const week = (snap) => ({ id: 'W', branchId: 'B1', weekStart: wk, status: 'published', version: 1, publishedAt: null, dayNotes: {}, dismissedWarnings: [], publishedSnapshot: snap })
const live = { shifts, assignments: [as('a1', 's1', 'dana'), as('a2', 's2', 'yossi')] }
const toSnapShift = (s) => s
eq('identical → none', D.unpublishedChanges(week({ shifts: shifts.map(toSnapShift), assignments: live.assignments }), shifts, live.assignments).total, 0)
const rawWeek = Z.serializeWeek({
  id: 'W', branch_id: 'B1', week_start: wk, status: 'published', version: 1,
  published_snapshot: {
    shifts: shifts.map((shift) => ({ id: shift.id, branch_id: shift.branchId, week_id: shift.weekId, shift_date: shift.date, start_time: shift.startTime, end_time: shift.endTime, preset_id: null, station_id: null, requirements: shift.requirements, requests_open: false, note: null, updated_at: null })),
    assignments: live.assignments.map((assignment) => ({ id: assignment.id, shift_id: assignment.shiftId, staff_id: assignment.staffId, staff_name: assignment.staffName, role_id: assignment.roleId, status: assignment.status })),
  },
})
eq('raw PostgreSQL snapshot normalizes before comparison', D.unpublishedChanges(rawWeek, shifts, live.assignments).total, 0)
check('opening employee requests after publish is a real shift change', D.unpublishedChanges(week({ shifts, assignments: live.assignments }), shifts.map((shift, index) => index === 0 ? { ...shift, requestsOpen: true } : shift), live.assignments).shifts === 1)
check('a draft week has nothing to compare', D.unpublishedChanges({ ...week(null), status: 'draft' }, shifts, live.assignments).total === 0 && D.unpublishedChanges(undefined, shifts, []).total === 0)
const added = D.unpublishedChanges(week({ shifts: shifts.slice(0, 2), assignments: live.assignments }), shifts, live.assignments)
check('a new shift since publishing is counted', added.shifts === 1, show(added))
const moved = D.unpublishedChanges(week({ shifts: [{ ...shifts[0], startTime: '08:00' }, shifts[1], shifts[2]], assignments: live.assignments }), shifts, live.assignments)
check('a changed time is counted', moved.shifts === 1, show(moved))
const people = D.unpublishedChanges(week({ shifts, assignments: [as('a1', 's1', 'dana')] }), shifts, live.assignments)
check('a person added since publishing is counted', people.people === 1, show(people))
const swapped = D.unpublishedChanges(week({ shifts, assignments: [as('a1', 's1', 'dana'), as('a2', 's2', 'dana')] }), shifts, live.assignments)
check('a person swapped for another counts as two changes (one out, one in)', swapped.people === 2, show(swapped))

section('staff identity — default roles and colors')
const roles = [{ id: 'barista', name: 'בריסטה', color: '#fff' }, { id: 'cashier', name: 'קופה', color: '#000' }]
check('an explicit personal default role wins', People.suggestedRoleId({ ...roster[0], defaultRoleId: 'cashier' }, roles, undefined, [], []) === 'cashier')
check('a legacy staff badge maps to the same role automatically', People.suggestedRoleId({ ...roster[0], badge: 'barista' }, roles, undefined, [], []) === 'barista')
check('an unmet requirement is used before a generic fallback', People.suggestedRoleId(roster[0], roles, undefined, [{ roleId: 'cashier', min: 1 }], []) === 'cashier')
check('staff colors are stable and distinct inside one roster', People.staffColor('dana', roster) === People.staffColor('dana', [...roster].reverse()) && People.staffColor('dana', roster) !== People.staffColor('yossi', roster))

// ============================================================================================================
section('view helpers — names, clashes, what is waiting on whom')
const db = { roster: [{ staffId: 'dana', displayName: 'דנה כהן' }], viewerStaffId: 'dana' }
eq('a live roster name wins over the snapshot', V.nameOf(db, 'dana', 'שם ישן'), 'דנה כהן')
eq('a person no longer on the roster falls back to the snapshotted name', V.nameOf(db, 'gone', 'גונה'), 'גונה')
eq('…and to a plain label if even that is missing', V.nameOf(db, null, null), 'עובד/ת שהוסר/ה')
const swaps = [
  { id: '1', status: 'open', assignmentId: 'a1', returnAssignmentId: null, fromStaffId: 'x', toStaffId: 'dana' },
  { id: '2', status: 'peer_accepted', assignmentId: 'a2', returnAssignmentId: 'a3', fromStaffId: 'y', toStaffId: 'z' },
  { id: '3', status: 'approved', assignmentId: 'a4', returnAssignmentId: null, fromStaffId: 'y', toStaffId: 'z' },
]
eq('a pending swap marks BOTH its assignments (derived — the schedule is never altered)', [...V.swapPendingAssignmentIds(swaps)].sort(), ['a1', 'a2', 'a3'])
eq('manager inbox: swaps the peer already accepted + pending requests', V.managerInbox({ requests: [{ status: 'pending' }, { status: 'approved' }], swaps }).count, 2)
eq('employee inbox: proposals addressed to me that I have not answered', V.employeeInbox({ swaps, viewerStaffId: 'dana' }).count, 1)
const wsh = [sh('c1', '2030-01-07', '07:00', '13:00'), sh('c2', '2030-01-07', '12:00', '16:00'), sh('c3', '2030-01-07', '13:00', '16:00'), sh('c4', '2030-01-08', '01:00', '03:00'), sh('n1', '2030-01-07', '22:00', '02:00')]
const wa = [as('x1', 'c1', 'dana'), as('x2', 'n1', 'dana')]
eq('overlap (07–13 vs 12–16) is a clash', V.clashesFor('dana', wsh[1], wk, wsh, wa).map((s) => s.id), ['c1'])
eq('back-to-back (13:00 / 13:00) is NOT a clash', V.clashesFor('dana', wsh[2], wk, wsh, wa).map((s) => s.id), [])
eq('a night shift\'s tail clashes with 01:00–03:00 the next morning', V.clashesFor('dana', wsh[3], wk, wsh, wa).map((s) => s.id), ['n1'])
eq('ignoring the shift being edited', V.clashesFor('dana', wsh[0], wk, wsh, wa, 'c1').map((s) => s.id), ['n1'].filter(() => false))
eq('requests by shift only groups PENDING ones', [...V.pendingRequestsByShift([{ status: 'pending', shiftId: 's1' }, { status: 'approved', shiftId: 's1' }, { status: 'pending', shiftId: null }]).keys()], ['s1'])

// ============================================================================================================
section('purity — these modules know nothing about React, Next or the database')
for (const n of PURE.filter((n) => !['serialize'].includes(n))) {
  const src = readFileSync(join(SHIFTS, `${n}.ts`), 'utf8')
  const bad = /from\s+['"](react|next|@supabase)[^'"]*['"]/.test(src) || /createServiceRoleClient|document\.|window\./.test(src)
  check(`lib/shifts/${n}.ts is pure`, !bad)
}

// ============================================================================================================
section('TS == SQL: the rules that exist in both places agree')
const db2 = new PGlite({ extensions: { pgcrypto } })
await db2.exec(`
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
  grant usage on schema public to anon, authenticated, service_role; grant usage on schema auth to anon, authenticated, service_role;
`)
for (const f of readdirSync(MIG).filter((x) => x.endsWith('.sql')).sort()) await db2.exec(readFileSync(join(MIG, f), 'utf8'))
const q1 = async (sql, params) => (await db2.query(sql, params)).rows[0]

// Planning closes at the end of Tuesday in Jerusalem, including DST changes.
eq('weekly requests deadline is preceding Tuesday', T.requestDeadline('2026-10-11'), '2026-10-06')
check('Tuesday remains open until 23:59; Wednesday is closed', T.requestsOpen('2026-10-11', { date: '2026-10-06', time: '23:59' }) && !T.requestsOpen('2026-10-11', { date: '2026-10-07', time: '00:00' }))
for (const at of ['2026-10-06T20:59:59Z', '2026-10-06T21:00:00Z', '2026-10-27T21:59:59Z', '2026-10-27T22:00:00Z']) {
  const week = at.includes('10-06') ? '2026-10-11' : '2026-11-01'
  const sql = (await q1('select public.sched_requests_open($1::date, $2::timestamptz) v', [week, at])).v
  eq(`Jerusalem cutoff TS == SQL at ${at}`, T.requestsOpen(week, T.wallClockNow('Asia/Jerusalem', new Date(at))), sql)
}

// -- labels: the text baked into notifications must read exactly like the screens
let labelOk = true
let labelBad = ''
for (const [date, s, e] of [['2030-01-06', '07:00', '13:00'], ['2030-01-07', '22:00', '02:00'], ['2030-02-28', '09:30', '17:45'], ['2030-12-31', '00:00', '23:59'], ['2031-03-01', '06:05', '06:10']]) {
  const sql = (await q1(`select public.sched_fmt($1::date, $2, $3) v`, [date, s, e])).v
  if (sql !== T.formatShiftLabel(date, s, e)) {
    labelOk = false
    labelBad = `${sql} ≠ ${T.formatShiftLabel(date, s, e)}`
  }
}
check('shift labels: sched_fmt (notifications) === formatShiftLabel (screens)', labelOk, labelBad)

// -- overlap: random shifts, same answer from both
let seed = 7
const rnd = (n) => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed % n
}
const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
let overlapDisagree = 0
let overlapChecked = 0
for (let i = 0; i < 250; i++) {
  const mk = () => {
    const day = rnd(7)
    const start = rnd(24 * 12) * 5
    let end = rnd(24 * 12) * 5
    if (end === start) end = (start + 30) % (24 * 60)
    return { date: T.addDays(wk, day), startTime: hm(start), endTime: hm(end) }
  }
  const a = mk()
  const b = mk()
  const ia = T.intervalOf(wk, a)
  const ib = T.intervalOf(wk, b)
  const tsOverlap = ia.start < ib.end && ib.start < ia.end
  const sqlOverlap = (await q1(`select public.sched_range($1::date, $2, $3) && public.sched_range($4::date, $5, $6) v`, [a.date, a.startTime, a.endTime, b.date, b.startTime, b.endTime])).v
  overlapChecked++
  if (tsOverlap !== sqlOverlap) overlapDisagree++
}
check(`overlap: ${overlapChecked} random shift pairs (incl. past-midnight) — TS intervalOf and SQL sched_range agree on every one`, overlapDisagree === 0, `${overlapDisagree} disagreements`)
const durationSql = async (s, e) => Number((await q1(`select extract(epoch from upper(public.sched_range('2030-01-06', $1, $2)) - lower(public.sched_range('2030-01-06', $1, $2))) v`, [s, e])).v) / 60
check('overlap: durations agree (a night shift, a day shift, and 24h for equal times — which writes refuse anyway)', (await durationSql('22:00', '02:00')) === T.durationMinutes({ startTime: '22:00', endTime: '02:00' }) && (await durationSql('07:00', '13:30')) === 390 && (await durationSql('08:00', '08:00')) === T.durationMinutes({ startTime: '08:00', endTime: '08:00' }))

// -- headcount
let needOk = true
for (const reqs of [[], [{ roleId: 'a', min: 2 }], [{ roleId: 'a', min: 2 }, { roleId: 'b', min: 1 }], [{ roleId: 'a', min: 0 }], [{ roleId: 'a' }]]) {
  const sql = (await q1(`select public.sched_needed($1::jsonb) v`, [JSON.stringify(reqs)])).v
  if (sql !== C.neededFor(reqs)) needOk = false
}
check('headcount: sched_needed === neededFor', needOk)

// -- names
const nameCases = [
  { display_name: 'דנה כהן', first_name: 'דנה', last_name: 'כהן', handle: 'dana', email: 'd@x.co' },
  { display_name: null, first_name: 'תמר', last_name: null, handle: 'tamar', email: null },
  { display_name: '', first_name: 'נועה', last_name: 'לוי', handle: 'noa1', email: null },
  { display_name: null, first_name: null, last_name: null, handle: 'סיני', email: null },
  { display_name: '  ', first_name: ' ', last_name: null, handle: 'ab', email: 'ab@x.co' },
]
let nameOkAll = true
let nameBad = ''
for (const c of nameCases) {
  const r = await q1(`insert into public.staff (display_name, first_name, last_name, handle, email) values ($1,$2,$3,$4,$5) returning id`, [c.display_name, c.first_name, c.last_name, c.handle, c.email])
  const sql = (await q1(`select public.sched_name($1) v`, [r.id])).v
  if (sql !== N.staffDisplayName(c)) {
    nameOkAll = false
    nameBad += `${sql} ≠ ${N.staffDisplayName(c)}; `
  }
}
check('names: sched_name (notifications, audit, assignment snapshot) === staffDisplayName (screens)', nameOkAll, nameBad)

// -- who may view / manage
const branchA = (await q1(`select id from public.branches where slug = 'maor'`)).id
const branchB = (await q1(`select id from public.branches where slug = 'givat-haviva'`)).id
const people2 = [
  { role: 'owner', badge: 'owner', branch: null }, { role: 'owner', badge: 'owner', branch: 'A' },
  { role: 'staff', badge: 'general_manager', branch: 'A' }, { role: 'staff', badge: 'general_manager', branch: null },
  { role: 'staff', badge: 'barista', branch: 'A' }, { role: 'staff', badge: 'barista', branch: null }, { role: 'staff', badge: 'barista', branch: 'B' },
  { role: 'staff', badge: null, branch: 'A' },
]
const branchOf = (k) => (k === 'A' ? branchA : k === 'B' ? branchB : null)
let accessOk = true
let accessBad = ''
let accessCases = 0
for (const delegated of [false, true]) {
  for (const p of people2) {
    const r = await q1(`insert into public.staff (first_name, role, badge, branch_id) values ('t', $1, $2, $3) returning id`, [p.role, p.badge, branchOf(p.branch)])
    for (const [label, target] of [['A', branchA], ['B', branchB]]) {
      await db2.query(`update public.shift_settings set schedule_managers = $1::uuid[] where branch_id = $2`, [delegated ? [r.id] : [], target])
      const row = { id: r.id, role: p.role, badge: p.badge, branch_id: branchOf(p.branch) }
      const sqlManage = (await q1(`select public.sched_can_manage($1, $2) v`, [r.id, target])).v
      const tsManage = A.canManageSchedule(row, target, delegated ? [r.id] : [])
      const sqlView = (await q1(`select public.sched_can_view($1, $2) v`, [r.id, target])).v
      const tsView = A.canViewSchedule(row, target)
      accessCases++
      if (sqlManage !== tsManage || sqlView !== tsView) {
        accessOk = false
        accessBad += `[${p.badge}/${p.branch}→${label} delegated=${delegated}: manage sql=${sqlManage} ts=${tsManage}; view sql=${sqlView} ts=${tsView}] `
      }
    }
  }
}
check(`access: ${accessCases} role × branch × delegation combinations — sched_can_manage / sched_can_view === canManageSchedule / canViewSchedule`, accessOk, accessBad)

// -- the past-clock rule (sched_is_past) vs hasStarted
const pastOk = []
for (const [date, st] of [['2020-01-01', '07:00'], ['2999-01-01', '07:00']]) {
  const sql = (await q1(`select public.sched_is_past($1, $2::date, $3) v`, [branchA, date, st])).v
  const nowClock = T.wallClockNow('Asia/Jerusalem')
  pastOk.push(sql === T.hasStarted({ date, startTime: st }, nowClock))
}
check('"has it started?": sched_is_past === hasStarted, in the branch\'s own timezone', pastOk.every(Boolean))

console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
