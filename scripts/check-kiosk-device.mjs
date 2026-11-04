// Checks for the kiosk tablets' own settings, shift line and registry (owner, 2026-11-04), without a browser or a database:
//   * lib/kiosk/device-settings.ts   the sparse settings, merge, rules between settings, request contracts (zod)
//   * lib/kiosk/shift-project.ts     who is on shift and when we close (the closing "chain"), against lib/checklists/window.ts
//   * lib/kiosk/device.ts            which kiosk a request is for (a registry that is not applied yet, a named tablet, a bad name)
//   * the tablet's copy of the defaults (overrides/kiosk-config.js) against the server's
//   * the wiring: the bundle's layers and their order, the routes' guards, the owner API, the app's staff bridge (compiled)
// The database side is verify-kiosk-content-sql; the screens are check-kiosk-ui.
//
//   node scripts/check-kiosk-device.mjs

import ts from 'typescript'
import vm from 'node:vm'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
let pass = 0
const failures = []
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`) } else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
// objects compare by content, not by the order their keys happen to be written in
const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x))
const eq = (name, actual, expected) => check(name, canon(actual) === canon(expected), `got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`)
const section = (t) => console.log(`\n${t}`)

const dir = join(ROOT, 'scripts', '.tmp-check-kiosk-device')
mkdirSync(dir, { recursive: true })
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* temp dir */ } })
const transpile = (src, out, swaps = []) => {
  let code = ts.transpileModule(read(src), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const [from, to] of swaps) code = code.split(from).join(to)
  writeFileSync(join(dir, out), code)
}
transpile('src/lib/kiosk/device-settings.ts', 'device-settings.mjs')
transpile('src/lib/kiosk/shift-project.ts', 'shift-project.mjs')
transpile('src/lib/checklists/window.ts', 'window.mjs')
transpile('src/lib/kiosk/content-project.ts', 'content-project.mjs', [["from './device-settings'", "from './device-settings.mjs'"]])
writeFileSync(join(dir, 'server-stub.mjs'), 'export function createServiceRoleClient() { return globalThis.__fakeService }\n')
transpile('src/lib/kiosk/device.ts', 'device.mjs', [
  ["'@/lib/supabase/server'", "'./server-stub.mjs'"],
  ["'./device-settings'", "'./device-settings.mjs'"],
])
const load = (f) => import(pathToFileURL(join(dir, f)).href)
const D = await load('device-settings.mjs')
const SH = await load('shift-project.mjs')
const W = await load('window.mjs')
const CP = await load('content-project.mjs')
const DEV = await load('device.mjs')

// ============================== settings =============================================================================
section('settings: defaults and the sparse stored form')
eq('the tablet that already existed is the default device', D.DEFAULT_KIOSK_DEVICE, 'givat-haviva-1')
eq('a request that names no device is the Givat Haviva branch', D.KIOSK_BRANCH_SLUG, 'givat-haviva')
check('every setting has a default and a spec, and nothing else', Object.entries(D.SETTINGS_SPEC).every(([s, f]) => JSON.stringify(Object.keys(f).sort()) === JSON.stringify(Object.keys(D.SETTINGS_DEFAULTS[s]).sort())))
eq('nothing stored means the defaults', D.effective({}), D.SETTINGS_DEFAULTS)
eq('null and junk stored values mean the defaults', D.effective(D.normalizeStored(null)), D.SETTINGS_DEFAULTS)
check('the default is: employees + closing + branch + count + credit + club on, arrows + swipe + auto-play + loop on, tray, alert at 50',
  D.SETTINGS_DEFAULTS.display.showEmployees && D.SETTINGS_DEFAULTS.display.showClosing && D.SETTINGS_DEFAULTS.display.clubEnabled
  && D.SETTINGS_DEFAULTS.ads.arrows && D.SETTINGS_DEFAULTS.ads.swipe && D.SETTINGS_DEFAULTS.ads.autoPlay && D.SETTINGS_DEFAULTS.ads.loop
  && D.SETTINGS_DEFAULTS.battery.display === 'tray' && D.SETTINGS_DEFAULTS.battery.alertEnabled && D.SETTINGS_DEFAULTS.battery.alertPercent === 50)
check('the battery alert is for the developer: the urgent one is off by default and lower than the ordinary one', D.SETTINGS_DEFAULTS.battery.criticalEnabled === false && D.SETTINGS_DEFAULTS.battery.criticalPercent < D.SETTINGS_DEFAULTS.battery.alertPercent)
check('Hebrew is the default language and all three are offered', D.SETTINGS_DEFAULTS.language.default === 'he' && D.SETTINGS_DEFAULTS.language.enabled.join() === 'he,en,ar')

const junk = { display: { showEmployees: 'yes', showClosing: false, bogus: 1 }, ads: { slideSeconds: 2, hiddenIds: ['not-a-uuid'], transition: 'fade', tapAction: 'x' }, timing: { idleSeconds: 90.5, graceSeconds: 20 }, language: { default: 'fr', enabled: [] }, battery: { alertPercent: 55, display: 'hidden' }, extra: { a: 1 } }
const norm = D.normalizeStored(junk)
eq('a damaged row keeps only valid known values', norm, { display: { showClosing: false }, ads: { transition: 'fade' }, timing: { graceSeconds: 20 }, battery: { alertPercent: 55, display: 'hidden' } })
eq('a stored pair that breaks a rule is repaired, never half applied (the list of languages goes, the default stays)', D.normalizeStored({ language: { default: 'ar', enabled: ['he'] } }).language, { default: 'ar' })
eq('the urgent level must be below the ordinary one', D.normalizeStored({ battery: { alertPercent: 20, criticalPercent: 30 } }).battery, { alertPercent: 20 })
eq('merge: a patch is laid over what is stored', D.mergeStored({ display: { showClosing: false } }, { display: { showEmployees: false }, battery: { alertPercent: 40 } }), { display: { showClosing: false, showEmployees: false }, battery: { alertPercent: 40 } })
eq('merge: null removes a value (back to the default), and an emptied section disappears', D.mergeStored({ display: { showClosing: false } }, { display: { showClosing: null } }), {})
eq('merge: null on the timings means "follow the branch"', D.effective(D.mergeStored({ timing: { idleSeconds: 90 } }, { timing: { idleSeconds: null } })).timing.idleSeconds, null)
eq('merge does not touch what is stored', (() => { const s = { ads: { arrows: false } }; D.mergeStored(s, { ads: { arrows: true } }); return s })(), { ads: { arrows: false } })
check('rule: the default language must be an enabled one', D.crossRuleError({ language: { default: 'en', enabled: ['he', 'ar'] } }) !== null && D.crossRuleError({ language: { default: 'ar', enabled: ['he', 'ar'] } }) === null)
check('rule: the urgent alert level must be lower than the ordinary one', D.crossRuleError({ battery: { alertPercent: 20, criticalPercent: 25 } }) !== null && D.crossRuleError({ battery: { alertPercent: 50, criticalPercent: 15 } }) === null)

section('settings: the request contracts')
const ok = (s, v) => s.safeParse(v).success
check('a patch of any subset is accepted', ok(D.settingsPatchSchema, {}) && ok(D.settingsPatchSchema, { battery: { alertEnabled: false } }) && ok(D.settingsPatchSchema, { ads: { arrows: false, slideSeconds: null, hiddenIds: [] } }))
check('an unknown section or key is refused', !ok(D.settingsPatchSchema, { nope: {} }) && !ok(D.settingsPatchSchema, { display: { nope: true } }))
check('values outside their bounds are refused', !ok(D.settingsPatchSchema, { battery: { alertPercent: 5 } }) && !ok(D.settingsPatchSchema, { battery: { alertPercent: 95 } }) && !ok(D.settingsPatchSchema, { timing: { idleSeconds: 29 } })
  && !ok(D.settingsPatchSchema, { timing: { idleSeconds: 301 } }) && !ok(D.settingsPatchSchema, { ads: { slideSeconds: 61 } }) && !ok(D.settingsPatchSchema, { timing: { graceSeconds: 4 } }) && !ok(D.settingsPatchSchema, { battery: { criticalPercent: 41 } }))
check('the edges of the bounds are accepted', ok(D.settingsPatchSchema, { battery: { alertPercent: 10 } }) && ok(D.settingsPatchSchema, { battery: { alertPercent: 90 } }) && ok(D.settingsPatchSchema, { timing: { idleSeconds: 30, graceSeconds: 5, successSeconds: 60, contentRefreshMinutes: 120 } }))
check('wrong types are refused (a string for a switch, a fraction for seconds)', !ok(D.settingsPatchSchema, { display: { showClosing: 'true' } }) && !ok(D.settingsPatchSchema, { timing: { idleSeconds: 60.5 } }))
check('enums are closed', !ok(D.settingsPatchSchema, { display: { closingSource: 'always' } }) && ok(D.settingsPatchSchema, { display: { closingSource: 'hours' } }) && !ok(D.settingsPatchSchema, { battery: { display: 'big' } }) && !ok(D.settingsPatchSchema, { ads: { tapAction: 'x' } }))
const uuid = '123e4567-e89b-42d3-a456-426614174000'
check('hidden ads are a list of ids, at most 20, no duplicates', ok(D.settingsPatchSchema, { ads: { hiddenIds: [uuid] } }) && !ok(D.settingsPatchSchema, { ads: { hiddenIds: ['x'] } }) && !ok(D.settingsPatchSchema, { ads: { hiddenIds: [uuid, uuid] } })
  && !ok(D.settingsPatchSchema, { ads: { hiddenIds: Array.from({ length: 21 }, (_, i) => `123e4567-e89b-42d3-a456-4266141740${String(i).padStart(2, '0')}`) } }))
check('languages: 1 to 3 distinct known codes', ok(D.settingsPatchSchema, { language: { enabled: ['en'] } }) && !ok(D.settingsPatchSchema, { language: { enabled: [] } }) && !ok(D.settingsPatchSchema, { language: { enabled: ['he', 'he'] } }) && !ok(D.settingsPatchSchema, { language: { enabled: ['fr'] } }))
check('a report: battery, app, page, or a test; strict', ok(D.deviceReportSchema, { battery: { level: 40, charging: false }, app: 3, web: 'abc' }) && ok(D.deviceReportSchema, { test: true }) && ok(D.deviceReportSchema, {})
  && !ok(D.deviceReportSchema, { battery: { level: 101 } }) && !ok(D.deviceReportSchema, { battery: { level: -1 } }) && !ok(D.deviceReportSchema, { test: false }) && !ok(D.deviceReportSchema, { other: 1 }) && !ok(D.deviceReportSchema, { device: 'Bad Name' }))
check('a save names a patch and optionally a device; strict', ok(D.deviceSaveSchema, { patch: { display: { showClosing: false } } }) && ok(D.deviceSaveSchema, { device: 'maor-1', patch: {} }) && !ok(D.deviceSaveSchema, {}) && !ok(D.deviceSaveSchema, { patch: {}, x: 1 }))
check('device slugs: lower case, digits, dashes, 3 to 40 characters', ['givat-haviva-1', 'a1b', 'maor-2'].every((s) => D.DEVICE_SLUG_PATTERN.test(s)) && ['', 'ab', 'Maor', '-ab', 'ab-', 'a b', 'a'.repeat(41), 'אבג'].every((s) => !D.DEVICE_SLUG_PATTERN.test(s)))
check('a device name is one line of plain text, 1 to 60 characters', D.deviceNameSchema.safeParse('  קיוסק\nמאור ').data === 'קיוסק מאור' && !D.deviceNameSchema.safeParse('   ').success && !D.deviceNameSchema.safeParse('x'.repeat(61)).success)

section('the tablet\'s copy of the defaults (overrides/kiosk-config.js) is the server\'s')
{
  const box = { document: { documentElement: { classList: { toggle() {} }, dataset: {} } }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, window: {}, navigator: {}, console }
  box.window = box
  vm.createContext(box)
  vm.runInContext(read('prototypes/sarcafe-kiosk-app/overrides/kiosk-config.js'), box)
  const K = box.KioskConfig
  eq('the defaults are identical', JSON.parse(JSON.stringify(K.DEFAULTS)), D.SETTINGS_DEFAULTS)
  const spec = {}
  for (const [s, fields] of Object.entries(D.SETTINGS_SPEC)) {
    spec[s] = {}
    for (const [k, f] of Object.entries(fields)) spec[s][k] = f.t === 'bool' ? ['bool'] : f.t === 'enum' ? ['enum', ...f.values] : f.t === 'int' ? ['int', f.min, f.max] : f.t === 'ids' ? ['ids', f.max] : ['langs']
  }
  eq('the kinds and bounds of every setting are identical', JSON.parse(JSON.stringify(K.SPEC)), spec)
  const clean = K.sanitizeKiosk({ device: 'maor-1', name: 'x', registered: true, branch: { slug: 'maor', name: { he: 'מאור', en: null, ar: null } }, branchTiming: { idleSeconds: 90, graceSeconds: 10, slideSeconds: 7 }, settings: junk, settingsUpdatedAt: '2026-11-04T10:00:00Z' })
  eq('the tablet validates the portal\'s answer the way the portal validates the database', JSON.parse(JSON.stringify(clean.settings)), norm)
  check('a "kiosk" part without a valid device name is ignored', K.sanitizeKiosk({ device: 'Bad Name', settings: {} }) === null && K.sanitizeKiosk(null) === null)
}

// ============================== shift ================================================================================
section('shift: who is on and when we close')
const S = (date, startTime, endTime, names = ['דנה']) => ({ date, startTime, endTime, names })
const clock = (date, time) => ({ date, time })
eq('no shift running: nobody, no closing time', SH.projectShift([S('2026-11-04', '16:00', '22:00')], clock('2026-11-04', '10:00')), { people: [], closesAt: null })
eq('one shift running: the name and the end of the shift', SH.projectShift([S('2026-11-04', '07:00', '14:00', ['דנה כהן'])], clock('2026-11-04', '10:00')), { people: ['דנה'], closesAt: '14:00' })
eq('only first names ever leave', SH.projectShift([S('2026-11-04', '07:00', '14:00', ['יוסי בן דוד', 'מיכל אבו-חצירה'])], clock('2026-11-04', '10:00')).people, ['יוסי', 'מיכל'])
eq('the start is included and the end is not', [SH.projectShift([S('2026-11-04', '07:00', '14:00')], clock('2026-11-04', '07:00')).closesAt, SH.projectShift([S('2026-11-04', '07:00', '14:00')], clock('2026-11-04', '14:00')).closesAt], ['14:00', null])
eq('a morning shift followed by an evening one: closing is the end of the evening (the place stays open)', SH.projectShift([S('2026-11-04', '07:00', '14:00'), S('2026-11-04', '14:00', '22:00', ['יוסי'])], clock('2026-11-04', '13:00')), { people: ['דנה'], closesAt: '22:00' })
eq('overlapping shifts: the latest end', SH.projectShift([S('2026-11-04', '07:00', '15:00'), S('2026-11-04', '10:00', '19:00', ['יוסי'])], clock('2026-11-04', '11:00')), { people: ['דנה', 'יוסי'], closesAt: '19:00' })
eq('a gap between two shifts ends the chain', SH.projectShift([S('2026-11-04', '07:00', '13:00'), S('2026-11-04', '15:00', '22:00')], clock('2026-11-04', '10:00')).closesAt, '13:00')
eq('a chain of three', SH.projectShift([S('2026-11-04', '06:00', '10:00'), S('2026-11-04', '10:00', '16:00'), S('2026-11-04', '16:00', '23:00')], clock('2026-11-04', '07:00')).closesAt, '23:00')
eq('a shift that crosses midnight runs into the next morning', SH.projectShift([S('2026-11-04', '20:00', '02:00')], clock('2026-11-05', '01:00')), { people: ['דנה'], closesAt: '02:00' })
eq('...and is running at 23:00 the day it started', SH.projectShift([S('2026-11-04', '20:00', '02:00')], clock('2026-11-04', '23:00')).closesAt, '02:00')
eq('16:00 to 00:00 ends at midnight', SH.projectShift([S('2026-11-04', '16:00', '00:00')], clock('2026-11-04', '20:00')).closesAt, '00:00')
eq('a chain continues past midnight into tomorrow\'s shift', SH.projectShift([S('2026-11-04', '16:00', '00:00'), S('2026-11-05', '00:00', '03:00', ['יוסי'])], clock('2026-11-04', '20:00')).closesAt, '03:00')
eq('the same person on two shifts is named once', SH.projectShift([S('2026-11-04', '07:00', '14:00'), S('2026-11-04', '09:00', '15:00')], clock('2026-11-04', '10:00')).people, ['דנה'])
eq('at most six names', SH.projectShift(Array.from({ length: 8 }, (_, i) => S('2026-11-04', '07:00', '14:00', [`עובד${i}`])), clock('2026-11-04', '10:00')).people.length, 6)
eq('a very long name is cut for the header', SH.firstName('א'.repeat(30)).length, 14)
eq('control characters and extra spaces are removed from a name', SH.firstName('  דנה\u0000\n כהן '), 'דנה')
check('a shift with no names still holds the place open if it is passed in (the loader filters unstaffed shifts out)', SH.projectShift([S('2026-11-04', '07:00', '14:00', [])], clock('2026-11-04', '10:00')).closesAt === '14:00')
{
  // the minute arithmetic is lib/checklists/window.ts's: the two files must agree on every shape of shift
  const shapes = [['07:00', '14:00'], ['16:00', '00:00'], ['20:00', '02:00'], ['23:30', '06:15'], ['00:00', '12:00'], ['08:00', '08:00']]
  const same = shapes.every(([a, b]) => ['2026-11-04', '2026-12-31', '2027-03-26'].every((date) => {
    const x = { date, startTime: a, endTime: b }
    return SH.shiftStart(x) === W.shiftStartAbs(x) && SH.shiftEnd(x) === W.shiftEndAbs(x) && SH.clockMinute({ date, time: a }) === W.clockAbs({ date, time: a })
  }))
  check('the minute arithmetic agrees with lib/checklists/window.ts on every shape of shift', same)
}

// ============================== which kiosk ==========================================================================
section('which kiosk a request is for')
function fakeService({ devices, branches, deviceError }) {
  const table = (rows, error) => {
    const make = (filters = []) => ({
      select: () => make(filters),
      eq: (c, v) => make([...filters, [c, v]]),
      order: () => make(filters),
      maybeSingle: async () => (error ? { data: null, error } : { data: rows.filter((r) => filters.every(([c, v]) => r[c] === v))[0] ?? null, error: null }),
      then: (resolve) => resolve(error ? { data: null, error } : { data: rows.filter((r) => filters.every(([c, v]) => r[c] === v)), error: null }),
    })
    return make()
  }
  return { from: (name) => (name === 'kiosk_devices' ? table(devices, deviceError) : table(branches, null)) }
}
const gh = { id: 'b-gh', slug: 'givat-haviva', name: { he: 'גבעת חביבה', en: 'Givat Haviva' }, timezone: 'Asia/Jerusalem' }
const maor = { id: 'b-maor', slug: 'maor', name: { he: 'מאור' }, timezone: null }
const row = (slug, branch_id, extra = {}) => ({ id: `d-${slug}`, slug, name: `kiosk ${slug}`, branch_id, active: true, settings: {}, settings_updated_at: '2026-11-04T08:00:00Z', ...extra })
const missingTable = { code: 'PGRST205', message: "Could not find the table 'public.kiosk_devices' in the schema cache" }
{
  globalThis.__fakeService = fakeService({ devices: [], branches: [gh, maor], deviceError: missingTable })
  let k = await DEV.resolveKiosk(null)
  check('before the migration every request is the legacy Givat Haviva kiosk with the defaults', k && k.legacy === true && k.slug === 'givat-haviva-1' && k.branch.slug === 'givat-haviva' && Object.keys(k.stored).length === 0 && k.settingsUpdatedAt === null)
  k = await DEV.resolveKiosk('givat-haviva-1')
  check('...also when it names the default tablet', k && k.legacy === true)
  check('...and a branch name that is not a column of the registry is never a way in', (await DEV.resolveKiosk('maor-1')) !== null, 'before the migration an unknown name is served the legacy kiosk, like the tablet that never named itself')

  globalThis.__fakeService = fakeService({ devices: [row('givat-haviva-1', 'b-gh', { settings: { display: { showClosing: false }, battery: { alertPercent: 40 } } }), row('maor-1', 'b-maor'), row('off-1', 'b-gh', { active: false })], branches: [gh, maor] })
  k = await DEV.resolveKiosk(null)
  check('a request that names no tablet is the default one, from the registry', k && k.legacy === false && k.slug === 'givat-haviva-1' && k.branch.id === 'b-gh' && k.stored.battery.alertPercent === 40 && k.settingsUpdatedAt === '2026-11-04T08:00:00Z')
  eq('its stored settings are validated on the way in', k.stored, { display: { showClosing: false }, battery: { alertPercent: 40 } })
  k = await DEV.resolveKiosk('maor-1')
  check('a named tablet gets ITS branch (not Givat Haviva)', k && k.slug === 'maor-1' && k.branch.slug === 'maor' && k.branch.timezone === 'Asia/Jerusalem' && k.branch.name.he === 'מאור' && k.branch.name.en === null)
  check('the branch name carries all three languages when the branch has them', (await DEV.resolveKiosk(null)).branch.name.en === 'Givat Haviva')
  check('an unknown tablet is not served', (await DEV.resolveKiosk('nope-1')) === null)
  check('a switched-off tablet is not served under its own name', (await DEV.resolveKiosk('off-1')) === null)
  check('a malformed name is not a tablet', (await DEV.resolveKiosk('Bad Name!')) === null && (await DEV.resolveKiosk('../etc')) === null && (await DEV.resolveKiosk('x')) === null)
  globalThis.__fakeService = fakeService({ devices: [row('givat-haviva-1', 'b-gone')], branches: [gh] })
  check('a tablet whose branch is gone is not served', (await DEV.resolveKiosk(null)) === null)
  globalThis.__fakeService = fakeService({ devices: [], branches: [gh], deviceError: { code: '500', message: 'boom' } })
  let threw = false
  try { await DEV.resolveKiosk(null) } catch { threw = true }
  check('a real read failure is an outage (it throws), not "no such tablet"', threw)
  check('a missing-table error is recognised, others are not', DEV.isMissingTable(missingTable) && DEV.isMissingTable({ code: '42P01' }) && !DEV.isMissingTable({ code: '500', message: 'boom' }) && !DEV.isMissingTable(null))
}

// ============================== content ==============================================================================
section('content: the tablet\'s settings travel with the content')
{
  const deps = { qr: () => ['1'], hash: (t) => `h${t.length}` }
  const input = { settings: { idleSeconds: 60, graceSeconds: 10, slideSeconds: 7 }, ads: [], weeklyHours: null, exceptions: [], timezone: 'Asia/Jerusalem', menuItems: [], feedbackUrl: 'https://x/feedback', today: '2026-11-04', imagePrefix: null }
  const kiosk = (s) => ({ device: 'givat-haviva-1', name: 'x', registered: true, branch: { slug: 'givat-haviva', name: { he: 'גבעת חביבה', en: null, ar: null } }, branchTiming: { idleSeconds: 60, graceSeconds: 10, slideSeconds: 7 }, settings: s, settingsUpdatedAt: null })
  const plain = CP.buildKioskContent(input, deps)
  check('without a tablet the answer is exactly what it always was (no "kiosk" key)', !('kiosk' in plain))
  const a = CP.buildKioskContent({ ...input, kiosk: kiosk(D.SETTINGS_DEFAULTS) }, deps)
  const b = CP.buildKioskContent({ ...input, kiosk: kiosk({ ...D.SETTINGS_DEFAULTS, display: { ...D.SETTINGS_DEFAULTS.display, showClosing: false } }) }, deps)
  check('with a tablet the answer carries it', a.kiosk && a.kiosk.device === 'givat-haviva-1' && a.kiosk.settings.battery.alertPercent === 50)
  check('a change of the tablet\'s settings changes the version (so ?since= never says "unchanged" over it)', a.version !== b.version && a.version !== plain.version)
}

// ============================== wiring ===============================================================================
section('wiring: the bundle, the routes, the app')
const assemble = read('scripts/assemble-kiosk-bundle.mjs')
{
  const layers = JSON.parse(assemble.match(/body: (\[[^\]]*\])/)[1].replace(/'/g, '"'))
  const at = (f) => layers.indexOf(f)
  check('the settings layer loads first, before the languages that read it', at('kiosk-config.js') === 0 && at('kiosk-config.js') < at('kiosk-i18n.js'))
  check('the header, the battery, the report and the panel load after the session, the ads and the languages', ['kiosk-shift.js', 'kiosk-battery.js', 'kiosk-device.js', 'kiosk-admin.js'].every((f) => at(f) > at('kiosk-attract.js') && at(f) > at('kiosk-i18n.js')))
  check('the battery loads before the report that reads it, and the "page booted" signal is last', at('kiosk-battery.js') < at('kiosk-device.js') && at('kiosk-ready.js') === layers.length - 1)
  check('the panel\'s styles are in the head', /head: \[[^\]]*'kiosk-admin\.css'/.test(assemble))
  check('every layer in the bundle exists', [...layers, 'kiosk-admin.css'].every((f) => existsSync(join(ROOT, 'prototypes/sarcafe-kiosk-app/overrides', f))))
}
const deviceRoute = read('src/app/api/kiosk/device/route.ts')
const shiftRoute = read('src/app/api/kiosk/shift/route.ts')
const ownerRoute = read('src/app/api/owner/kiosk/devices/route.ts')
check('the report and the save need the kiosk\'s key, answer 503 until it is set, and read a limited body', /KIOSK_SIGNUP_KEY/.test(deviceRoute) && /keysMatch\(request\.headers\.get\('x-kiosk-key'\)/.test(deviceRoute) && /not_configured/.test(deviceRoute) && /readLimitedText/.test(deviceRoute))
check('the shift line needs the key too (it names people) and is never cached', /keysMatch/.test(shiftRoute) && /not_configured/.test(shiftRoute) && /'Cache-Control': 'no-store'/.test(shiftRoute))
check('the shift line answers only what the tablet\'s settings ask to show', /showEmployees/.test(shiftRoute) && /showClosing/.test(shiftRoute))
check('the save is checked against the rules between settings and is optimistic about a concurrent writer', /crossRuleError\(merged\)/.test(deviceRoute) && /settings_updated_at/.test(deviceRoute) && /'conflict'/.test(deviceRoute))
check('the tablet can save only its own settings: no branch, name or key in its save', !/branch_id|branchId/.test(deviceRoute.slice(deviceRoute.indexOf('export async function PUT'))))
check('the database function is called with a test flag only for the test alert', /report\.test/.test(deviceRoute) && /kiosk_device_alert_test/.test(deviceRoute) && /kiosk_device_report/.test(deviceRoute))
check('a missing migration answers 503 (not 500) on the report', /PGRST202/.test(deviceRoute) && /not_ready/.test(deviceRoute))
check('the owner API is for the full owner only', /requireOwner\(\)/.test(ownerRoute) && (ownerRoute.match(/requireOwner\(\)/g) || []).length >= 3)
check('the owner page is behind the owner gate (middleware) and shows the tablets card', /OP_ONLY_PREFIXES[^]*\/owner\/kiosk/.test(read('src/middleware.ts')) && /KioskDevicesCard/.test(read('src/app/owner/kiosk/page.tsx')))
check('/api/kiosk/ stays exempt from the cross-site write block (the tablet\'s origin is not ours)', /\/api\/kiosk\//.test(read('src/middleware.ts')))
check('the content and the menu routes take the tablet\'s name', /searchParams\.get\('device'\)/.test(read('src/app/api/kiosk/content/route.ts')) && /searchParams\.get\('device'\)/.test(read('src/app/api/kiosk/menu/route.ts')))
check('the battery alert kind is the developer\'s (dev.*): in the migration and never in the owner kinds', /'dev\.kiosk_battery'/.test(read('supabase/migrations/20261104120000_kiosk_devices.sql')) && !/kiosk_battery/.test(read('src/lib/push/staff-rules.ts')))
check('the migration alerts developers only (badge = developer), not owners', /s\.badge = 'developer'/.test(read('supabase/migrations/20261104120000_kiosk_devices.sql')) && !/role = 'owner'/.test(read('supabase/migrations/20261104120000_kiosk_devices.sql')))

section('the app: the staff bridge')
{
  const bridge = read('prototypes/sarcafe-kiosk-app/src/il/co/sarcafe/kiosk/StaffBridge.java')
  const main = read('prototypes/sarcafe-kiosk-app/src/il/co/sarcafe/kiosk/MainActivity.java')
  check('every call the page can make (info, act, close) is checked against the PIN session\'s token and the kiosk page', ['info', 'act', 'close'].every((m) => new RegExp(`public \\w+ ${m}\\(String t[^)]*\\)[^{]*\\{[^]*?(valid\\(t\\))`).test(bridge)) && (bridge.match(/isKioskPageOnTop\(\)/g) || []).length >= 2)
  check('the token is random, compared in constant time, and dies with the session', /SecureRandom/.test(bridge) && /MessageDigest\.isEqual/.test(bridge) && /SESSION_MS/.test(bridge))
  check('the panel opens only after the PIN was entered, and falls back to the plain menu otherwise', /checkPin[^]*?openPanel\(\)/.test(main) && /openPanel\(\)\s*\{[^}]*staffMenu\(\)/.test(main))
  check('the staff door is registered on the page next to the read-only facts', /addJavascriptInterface\(staff\.js\(\), "KioskStaff"\)/.test(main) && /public String battery|@JavascriptInterface public String battery/.test(main))
  check('an update never reloads the page while the panel is open', /staff != null && staff\.panelOpen\(\)/.test(main))
  check('a new PIN needs the current one, shares the lockout of the PIN dialog, and must be 6 to 8 digits', /pin_locked_until/.test(bridge) && /StaffPin\.verify/.test(bridge) && /isAcceptableNewPin\(newPin\)/.test(bridge))
  check('the restart of the whole tablet is only for the device owner and asks first', /isDeviceOwnerApp/.test(bridge) && /confirmReboot/.test(main) && /setNegativeButton\("Cancel"/.test(main))
  const jdk = ['C:/Program Files/Eclipse Adoptium/jdk-21.0.7.6-hotspot/bin/javac.exe'].find(existsSync)
  const androidJar = join(process.env.LOCALAPPDATA || '', 'Android/Sdk/platforms/android-36/android.jar')
  if (jdk && existsSync(androidJar)) {
    const out = join(dir, 'classes')
    mkdirSync(out, { recursive: true })
    const sources = ['KioskAdminReceiver', 'KioskConfigReceiver', 'MainActivity', 'OtaReceiver', 'OtaRules', 'OtaUpdater', 'StaffBridge', 'StaffPin'].map((n) => join(ROOT, `prototypes/sarcafe-kiosk-app/src/il/co/sarcafe/kiosk/${n}.java`))
    const r = spawnSync(jdk, ['--release', '8', '-encoding', 'UTF-8', '-Xlint:-options', '-classpath', androidJar, '-d', out, ...sources], { encoding: 'utf8' })
    check('the whole app compiles (javac --release 8 against android-36)', r.status === 0, (r.stderr || '').split('\n').slice(0, 6).join(' | '))
  } else console.log('  - the compile check needs the JDK and android.jar of this PC: skipped')
}

console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) { console.log('FAILED:\n - ' + failures.join('\n - ')); process.exit(1) }
