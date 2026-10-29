// Checks for the notifications gate (owner, 2026-10-16): staff pages and the onboarding walk open only on a device that can be told
// things; and the survival and recovery rules that keep the gate from ever being the reason someone cannot work.
//
//   node scripts/check-notifications-gate.mjs

import ts from 'typescript'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
let pass = 0
const failures = []
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`) } else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const eq = (name, actual, expected) => check(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`)
const section = (t) => console.log(`\n${t}`)

const dir = mkdtempSync(join(tmpdir(), 'check-gate-'))
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* temp dir */ } })
writeFileSync(join(dir, 'gate.mjs'), ts.transpileModule(read('src/lib/staff/gate-rules.ts'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText)
const G = await import(pathToFileURL(join(dir, 'gate.mjs')).href)

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.0.0 Mobile/15E148 Safari/604.1',
  iphoneInstagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 320.0.0.12.108',
  iphoneWebView: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  androidFacebook: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/450.0.0.0;]',
  androidWebView: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36',
  desktopChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  desktopSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
}

section('what kind of device is this')
eq('iPhone, Android, desktop', [G.detectPlatform(UA.iphoneSafari, 'iPhone', 5), G.detectPlatform(UA.androidChrome, 'Linux armv81', 5), G.detectPlatform(UA.desktopChrome, 'Win32', 0)], ['ios', 'android', 'desktop'])
eq('an iPad that reports as a Mac is still an iOS device', G.detectPlatform(UA.desktopSafari, 'MacIntel', 5), 'ios')
eq('a real Mac is not', G.detectPlatform(UA.desktopSafari, 'MacIntel', 0), 'desktop')
eq('a browser INSIDE another app is told apart from a real one', [UA.iphoneSafari, UA.iphoneChrome, UA.androidChrome, UA.desktopChrome].map((ua) => G.detectInAppBrowser(ua, G.detectPlatform(ua, ua.includes('iPhone') ? 'iPhone' : 'Linux', 5))), [false, false, false, false])
eq('Instagram, Facebook and a bare WebView are in-app browsers', [G.detectInAppBrowser(UA.iphoneInstagram, 'ios'), G.detectInAppBrowser(UA.androidFacebook, 'android'), G.detectInAppBrowser(UA.iphoneWebView, 'ios'), G.detectInAppBrowser(UA.androidWebView, 'android')], [true, true, true, true])
eq('a desktop browser is never an in-app browser', G.detectInAppBrowser(UA.desktopChrome, 'desktop'), false)

section('the one decision: which step')
const env = (over = {}) => ({ platform: 'android', standalone: true, inAppBrowser: false, pushSupported: true, permission: 'default', subscribed: 'no', ...over })
eq('a phone browser inside another app: open it in a real browser first', G.gateStep(env({ standalone: false, inAppBrowser: true })), 'browser')
eq('a phone in an ordinary tab: put it on the Home Screen', G.gateStep(env({ standalone: false })), 'install')
eq('iPhone in a tab is the same (permission cannot even be asked there)', G.gateStep(env({ platform: 'ios', standalone: false, permission: 'default' })), 'install')
eq('installed, not asked yet: the notifications step', G.gateStep(env()), 'notifications')
eq('installed, said no: how to undo it', G.gateStep(env({ permission: 'denied' })), 'blocked')
eq('installed but the browser cannot do push at all: say so', G.gateStep(env({ pushSupported: false })), 'unsupported')
eq('allowed AND filed for the person: done', G.gateStep(env({ permission: 'granted', subscribed: 'yes' })), 'done')
eq('allowed but the phone is not filed yet: finish subscribing (no prompt)', G.gateStep(env({ permission: 'granted', subscribed: 'no' })), 'notifications')
eq('allowed, and the server could not be asked (offline): NOT locked out', G.gateStep(env({ permission: 'granted', subscribed: 'unknown' })), 'done')
eq('a laptop needs no install step', G.gateStep(env({ platform: 'desktop', standalone: false })), 'notifications')
eq('a laptop that said no is blocked, one that allowed is done', [G.gateStep(env({ platform: 'desktop', standalone: false, permission: 'denied' })), G.gateStep(env({ platform: 'desktop', standalone: false, permission: 'granted', subscribed: 'yes' }))], ['blocked', 'done'])
eq('an unsupported desktop browser says so (and an in-app test never applies to a desktop)', G.gateStep(env({ platform: 'desktop', standalone: false, pushSupported: false, inAppBrowser: true })), 'unsupported')
eq('permission "unsupported" is the same as no push', G.gateStep(env({ permission: 'unsupported' })), 'unsupported')
eq('the rows: a phone sees install then notifications; the first is "now" until installed', G.stepRows(env({ standalone: false })), [{ key: 'install', done: false, now: true }, { key: 'notifications', done: false, now: false }])
eq('...a laptop sees only notifications', G.stepRows(env({ platform: 'desktop', standalone: false })), [{ key: 'notifications', done: false, now: true }])
eq('...once everything is done both rows are done', G.stepRows(env({ permission: 'granted', subscribed: 'yes' })), [{ key: 'install', done: true, now: false }, { key: 'notifications', done: true, now: false }])

section('who is held, who may carry on, where it stands aside')
eq('an employee is held (hard)', G.gateModeFor({ role: 'staff', badge: 'barista' }), 'hard')
eq('an owner, a developer, a general manager and a shift manager may carry on without alerts (soft): never bricked', [{ role: 'owner', badge: null }, { role: 'staff', badge: 'owner' }, { role: 'staff', badge: 'developer' }, { role: 'staff', badge: 'general_manager' }, { role: 'staff', badge: 'manager' }].map(G.gateModeFor), ['soft', 'soft', 'soft', 'soft', 'soft'])
eq('the owner can exempt one employee (recovery for a phone that cannot do push)', G.gateModeFor({ role: 'staff', badge: 'barista', pushGateExempt: true }), 'off')
eq('nobody signed in: the gate is off (the page sends them to sign in)', [G.gateModeFor(null), G.gateModeFor(undefined)], ['off', 'off'])
eq('the onboarding walk runs the same steps itself, so the gate stands aside there only', ['/staff/onboarding', '/staff/onboarding/x', '/staff', '/staff/checklists', '/staff/schedule', '/staff/profile', '/staff/dev', '/staff/onboardingx'].map(G.gateAppliesTo), [false, false, true, true, true, true, true, true])
check('it looks again often enough to notice a revoked permission within a minute', G.GATE_RECHECK_MS <= 30_000)

section('survival and recovery, in the code')
const gate = read('src/components/staff/NotificationsGate.tsx')
const client = read('src/lib/push/client.ts')
const layout = read('src/app/staff/layout.tsx')
// the gate, the install sheet and the page live in StaffShell (the part behind the layout's Suspense boundary)
const shell = layout.slice(layout.indexOf('async function StaffShell'))
check('every staff page is behind the gate; the install sheet and the page are inside it, so nothing shows over the gate', /<NotificationsGate mode=\{mode\}>/.test(shell) && shell.indexOf('<NotificationsGate') < shell.indexOf('<StaffInstallIntro />') && shell.indexOf('<StaffInstallIntro />') < shell.indexOf('{children}'))
check('the mode is decided on the server from the person (role, badge, developer, the owner\'s exemption)', /gateModeFor\(me \? \{ role: me\.role, badge: isDeveloper\(me\) \? 'developer' : me\.badge, pushGateExempt: state\?\.exempt \} : null\)/.test(layout))
check('the gate is a function of the device NOW: no progress is stored (only management\'s "continue" for the life of the tab)', !/localStorage/.test(gate) && /sessionStorage\.setItem\(GATE_SKIP_KEY/.test(gate))
check('it re-checks on focus, on becoming visible, on install and every 30 s', /visibilitychange/.test(gate) && /addEventListener\('focus'/.test(gate) && /appinstalled/.test(gate) && /GATE_RECHECK_MS/.test(gate))
check('the check can never hang the screen: a time limit falls back to what the device says on its own', /setTimeout\(\(\) => resolve\(quickEnv\(\)\), 12_000\)/.test(gate) && /subscribed: permission === 'granted' \? 'unknown' : 'no'/.test(gate))
check('waiting for the worker is bounded too (a worker that cannot start must not hang setup)', /Promise\.race\(\[navigator\.serviceWorker\.ready, new Promise\(\(resolve\) => setTimeout\(resolve, 8000\)\)\]\)/.test(client))
check('an unreachable server is "unknown", not "no": the person is not locked out by a network (and the phone is filed again when it is back)', /if \(filed === null\) return 'unknown'/.test(client) && /catch \{\s*return 'unknown'\s*\}/.test(client))
check('granted but not filed (a wiped worker, a rotated key, another person\'s phone): it is filed WITHOUT asking again', /return \(await registrar\.register\(subscription\.toJSON\(\)\)\) \? 'yes' : 'unknown'/.test(client))
check('asking happens only from a tap, never on load', /onClick=\{\(\) => void turnOn\(\)\}/.test(gate) && !/requestPermission/.test(gate))
check('a refusal says how to undo it on this platform, an unsupported browser says who can fix it', /BLOCKED: Record<Platform, string>/.test(gate) && /אפשר לאשר לכם כניסה בלי התראות מדף הצוות/.test(gate))
check('the install step has the exact taps for iPhone and Android, a one-tap button where the browser offers it, and "I installed it"', /IOS_STEPS/.test(gate) && /ANDROID_STEPS/.test(gate) && /beforeinstallprompt/.test(gate) && /התקנתי, פתחתי מהסמל/.test(gate))
check('a browser inside another app is told to open it in a real browser, with a copy-link button', /step === 'browser'/.test(gate) && /העתקת הקישור/.test(gate))
check('management can continue without alerts; an employee cannot (the button exists only in the soft mode)', /skip=\{mode === 'soft' \?/.test(gate) && /hard=\{mode === 'hard'\}/.test(gate))
check('a signed-in person can always sign out from the gate', /signOut\b/.test(gate) && /<SignOutButton/.test(gate))
const gateState = read('src/lib/staff/gate-state.ts')
check('the extra columns are read APART from the session and tolerantly: a missing column or a failed read never signs anyone out or locks anyone in', /catch \{\s*return quiet\s*\}/.test(gateState) && /if \(error \|\| !data\) return quiet/.test(gateState) && !/push_gate_exempt|onboarding_done_at/.test(read('src/lib/staff/session.ts')))
check('the owner can exempt one employee, and it is logged', /pushGateExempt: z\.boolean\(\)\.optional\(\)/.test(read('src/app/api/owner/staff/route.ts')) && /updates\.push_gate_exempt = body\.pushGateExempt/.test(read('src/app/api/owner/staff/route.ts')) && /מותר להיכנס בלי התראות/.test(read('src/components/staff/StaffCard.tsx')))
const mig = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('_onboarding_progress_event_parent.sql')).map((f) => read(`supabase/migrations/${f}`)).join('\n')
check('the migration backfills everyone existing as done ONCE (only when the column is created), so nobody working is sent through a wizard', /if not exists \(select 1 from information_schema\.columns[^;]*onboarding_done_at'\) then[\s\S]*alter table public\.staff add column onboarding_done_at[\s\S]*update public\.staff set onboarding_done_at = now\(\)/.test(mig))
check('the exemption defaults to off', /push_gate_exempt boolean not null default false/.test(mig))
check('the staff notifications API still takes the person from the session only (nobody can file a phone under someone else)', /const me = await resolveStaffIdentity\(\)/.test(read('src/app/api/staff/push/route.ts')) && /staff_id: me\.id,/.test(read('src/app/api/staff/push/route.ts')))

console.log(`\n${pass > 0 && failures.length === 0 ? '✓' : '✗'} ${pass} passed, ${failures.length} failed`)
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1) }
