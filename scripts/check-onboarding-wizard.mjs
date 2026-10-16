// Checks for the employee onboarding wizard (aligned with the Ayeka Bar wizard, 2026-10-16): the steps, the words the owner
// shares with the link, the details step's rules, the tour (which must match the real home screen), and the wiring of the
// Google return trip. The real pure files are transpiled and run; the routes and components are read.
//
//   node scripts/check-onboarding-wizard.mjs

import ts from 'typescript'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

const dir = mkdtempSync(join(tmpdir(), 'check-onboarding-'))
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* temp dir */ } })
// Transpile a file next to its siblings; a relative import './x' becomes './x.mjs'.
const emit = (file, name) => {
  const js = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from '(\.\/[a-z-]+)'/g, "from '$1.mjs'")
  writeFileSync(join(dir, name), js)
}
emit('src/lib/staff/avatar.ts', 'avatar.mjs')
emit('src/lib/staff/profile.ts', 'profile.mjs')
emit('src/lib/staff/onboarding-wizard.ts', 'onboarding-wizard.mjs')
emit('src/lib/staff/tour.ts', 'tour.mjs')
const P = await import(pathToFileURL(join(dir, 'profile.mjs')).href)
const W = await import(pathToFileURL(join(dir, 'onboarding-wizard.mjs')).href)
const T = await import(pathToFileURL(join(dir, 'tour.mjs')).href)
const A = await import(pathToFileURL(join(dir, 'avatar.mjs')).href)

section('the walk: which screen, when')
const base = { person: true, noLink: false, gateDone: true, coded: false, welcomed: false, hasGoogle: false, googleSkipped: false, continuing: false, detailsDone: false }
eq('a link that does not work (used, expired, replaced) is a dead end with two ways out', W.wizardStep({ ...base, person: false }), 'dead')
eq('no link in the address, none remembered, nobody signed in: ask for it (paste), not a dead end', W.wizardStep({ ...base, person: false, noLink: true }), 'recover')
eq('FIRST, before the welcome and before the code: put the app on the Home Screen and turn notifications on', W.wizardStep({ ...base, gateDone: false }), 'setup')
eq('...also when the person is resuming (the code is set, the app was closed): setup comes first again, and passes at once if the phone is ready', W.wizardStep({ ...base, gateDone: false, coded: true, hasGoogle: true, detailsDone: true }), 'setup')
eq('with setup done, a new person starts at the welcome', W.wizardStep(base), 'welcome')
eq('after "let us begin" they choose a code', W.wizardStep({ ...base, welcomed: true }), 'code')
eq('with the code set they are offered Google (only after notifications: setup came first)', W.wizardStep({ ...base, coded: true, welcomed: true }), 'google')
eq('"later" skips Google', W.wizardStep({ ...base, coded: true, googleSkipped: true }), 'details')
eq('a person who already has Google goes straight to their details', W.wizardStep({ ...base, coded: true, hasGoogle: true }), 'details')
eq('back from Google they carry on at the details (not the Google step again)', W.wizardStep({ ...base, coded: true, hasGoogle: true, continuing: true }), 'details')
eq('after the details comes the tour', W.wizardStep({ ...base, coded: true, hasGoogle: true, detailsDone: true }), 'tour')
eq('after the details comes the style (2026-10-17), and only then the tour', W.wizardStep({ ...base, coded: true, hasGoogle: true, detailsDone: true, styleDone: false }), 'style')
eq('a person who already chose a look (this device remembers it) goes straight to the tour', W.wizardStep({ ...base, coded: true, hasGoogle: true, detailsDone: true, styleDone: true }), 'tour')
eq('the progress strip has the seven steps in order, setup first', W.WIZARD_STEPS.map((s) => s.id), ['setup', 'welcome', 'code', 'google', 'details', 'style', 'tour'])
eq('progress follows the step', ['setup', 'welcome', 'code', 'google', 'details', 'style', 'tour'].map(W.progressIndex), [0, 1, 2, 3, 4, 5, 6])
eq('the tour ends on the employee home', W.WIZARD_END_HREF, '/staff')

section('the invite link survives: the address, this device, or a paste')
const TOKEN = 'A'.repeat(43)
const TOKEN2 = 'b-_9'.repeat(10) + 'xyz'
eq('the whole link is accepted (fragment)', W.parseInvite(`https://sarcafe-portal.vercel.app/staff/onboarding#invite=${TOKEN}`), TOKEN)
eq('...and in a pasted message around it', W.parseInvite(`היי דנה, הוספנו אותך:\nhttps://sarcafe-portal.vercel.app/staff/onboarding#invite=${TOKEN2} תודה!`), TOKEN2)
eq('...and as a query', W.parseInvite(`https://x.test/staff/onboarding?invite=${TOKEN}`), TOKEN)
eq('...and the address-bar fragment as the browser gives it (window.location.hash, with the #)', W.parseInvite(`#invite=${TOKEN}`), TOKEN)
eq('...and the fragment with the # already cut off', W.parseInvite(`invite=${TOKEN}`), TOKEN)
eq('a longer code is not a code', W.parseInvite(`#invite=${TOKEN}x`), null)
eq('...and the bare code, with spaces around it', W.parseInvite(`  ${TOKEN}\n`), TOKEN)
eq('anything else is not a link (too short, too long, a different parameter, an object)', [W.parseInvite('abc'), W.parseInvite(`${TOKEN}X`), W.parseInvite(`https://x.test/#other=${TOKEN}`), W.parseInvite(''), W.parseInvite(null), W.parseInvite({})], [null, null, null, null, null, null])
const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), m } }
const st = store()
W.saveInvite(st, TOKEN, 1_000)
eq('a seen link is remembered on this device', W.loadInvite(st, 2_000), TOKEN)
eq('...and still on the sixth day', W.loadInvite(st, 1_000 + 6 * 86_400_000), TOKEN)
eq('...but not beyond what a link can live (and it is forgotten)', [W.loadInvite(st, 1_000 + 8 * 86_400_000), st.m.size], [null, 0])
W.saveInvite(st, 'not-a-token', 1)
check('a damaged value is never stored', st.m.size === 0)
st.m.set(W.INVITE_STORE_KEY, '{oops')
eq('a damaged stored value reads as nothing, and nothing throws', W.loadInvite(st, 5), null)
W.saveInvite(st, TOKEN, 10)
W.clearInvite(st)
check('forgetting it (the moment the code is set) leaves nothing', st.m.size === 0)
check('storage that throws never breaks the walk', (() => { const bad = { getItem() { throw new Error('x') }, setItem() { throw new Error('x') }, removeItem() { throw new Error('x') } }; W.saveInvite(bad, TOKEN, 1); W.clearInvite(bad); return W.loadInvite(bad, 1) === null && W.loadInvite(null, 1) === null })())

section('sharing the link')
const url = 'https://sarcafe-portal.vercel.app/staff/onboarding#invite=abc'
const text = W.shareText('דנה', url)
check('the message greets the person and ENDS with the link', text.startsWith('היי דנה,') && text.endsWith(url))
check('the link appears exactly once (a share sheet given text AND url prints it twice)', text.split(url).length === 2)
check('without a name the message still reads well', W.shareText(null, url).startsWith('היי, ') && W.shareText('  ', url).startsWith('היי, '))
check('the SMS link carries the whole message, encoded, and no phone number', W.shareLinks(text).sms.startsWith('sms:?&body=') && decodeURIComponent(W.shareLinks(text).sms.slice('sms:?&body='.length)) === text)
check('a link expiry reads as a day and month', /^15[./]1$/.test(W.expiryLabel('2030-01-15T10:00:00Z')))
eq('an unreadable expiry does not crash', W.expiryLabel('nonsense'), 'שבוע')
const inv = read('src/components/staff/StaffInvitation.tsx')
check('the owner sheet offers copy, SMS and the phone share sheet, and no WhatsApp button', /העתקת הקישור/.test(inv) && /links\.sms/.test(inv) && /navigator\.share\(\{ title: [^,]+, text \}\)/.test(inv) && !/wa\.me/.test(inv) && !/>\s*WhatsApp\s*</.test(inv))
check('it says the link is shown once and can be replaced', /הקישור מוצג רק עכשיו/.test(inv) && /נשרף אחרי שימוש אחד/.test(inv))

section('my details')
eq('a Hebrew first name is fine, the last name may be empty', P.validateProfile({ firstName: 'דנה', lastName: '' }), { ok: true, value: { first_name: 'דנה', last_name: null } })
check('a missing first name is refused', P.validateProfile({ firstName: '   ' }).ok === false && P.validateProfile({}).error === 'first_name')
check('names are cleaned: line breaks, zero-width characters and double spaces', P.cleanName('  דנה\n​  כהן ') === 'דנה כהן')
check('a name over 40 characters is refused', P.validateProfile({ firstName: 'א'.repeat(41) }).error === 'first_name' && P.validateProfile({ firstName: 'דנה', lastName: 'ב'.repeat(41) }).error === 'last_name')
eq('phone numbers normalise to the local form', ['050-123 4567', '+972 50 123 4567', '(050)1234567', '0501234567', '00972501234567'].map(P.normalizePhone), ['0501234567', '0501234567', '0501234567', '0501234567', '0501234567'])
eq('a landline and an international number are accepted', [P.normalizePhone('03-1234567'), P.normalizePhone('+14155550123')], ['031234567', '+14155550123'])
eq('rubbish is not a phone number', ['abc', '12', '050123', '050-123-456-789-0', '<script>', '0501234567; drop'].map(P.normalizePhone), [null, null, null, null, null, null])
check('the phone is optional: empty clears it, undefined leaves it', P.validateProfile({ firstName: 'דנה', phone: '' }).value.phone === null && !('phone' in P.validateProfile({ firstName: 'דנה' }).value))
check('a bad phone is refused with a sentence', P.validateProfile({ firstName: 'דנה', phone: 'abc' }).error === 'phone' && /050/.test(P.PROFILE_MESSAGES.phone))
check('only the avatars the app knows are accepted', P.validateProfile({ firstName: 'דנה', emoji: A.STAFF_AVATARS[0] }).value.avatar_emoji === A.STAFF_AVATARS[0] && P.validateProfile({ firstName: 'דנה', emoji: '💣' }).error === 'emoji')
check('the suggested emoji is the least used one and is always a real avatar', (() => {
  const used = A.STAFF_AVATARS.slice(1).flatMap((e) => [e, e])
  return P.suggestEmoji(used, () => 0) === A.STAFF_AVATARS[0] && A.STAFF_AVATARS.includes(P.suggestEmoji([], Math.random))
})())
const api = read('src/app/api/staff/profile/route.ts')
check('the details route edits only the signed-in person, only these fields', /resolveStaffIdentity\(\)/.test(api) && /\.eq\('id', staff\.id\)/.test(api) && /validateProfile\(/.test(api) && /\.update\(result\.value\)/.test(api) && (api.match(/\.update\(/g) ?? []).length === 1)
check('...and refuses a session-less caller', /if \(!staff\) throw Forbidden/.test(api))

section('the tour matches the real home screen')
const home = read('src/components/dashboard/EmployeeDashboardView.tsx')
const shiftCard = read('src/components/staff/ShiftStatusCard.tsx')
for (const row of T.TOUR_ROWS) check(`the tour row "${row.he}" is a real row of the employee home`, home.includes(`label: '${row.he}'`) || home.includes(`<strong>${row.he}</strong>`) || shiftCard.includes(row.he))
check('every slide that is about a row names a row that exists', T.TOUR_SLIDES.every((s) => s.row === null || T.TOUR_ROWS.some((r) => r.id === s.row)))
check('the constraints slide uses the owner\'s three options and the weekly days-off limit', T.TOUR_SLIDES.find((s) => s.key === 'schedule').points.join(' ').includes('לא יכול/ה משמרת בוקר') && T.TOUR_SLIDES.find((s) => s.key === 'schedule').points.join(' ').includes('יום חופש כל היום'))
check('the slide index is always clamped', T.clampSlide(-3) === 0 && T.clampSlide(99) === T.TOUR_SLIDES.length - 1 && T.clampSlide(Number.NaN) === 0 && T.isLastSlide(T.TOUR_SLIDES.length - 1) && !T.isLastSlide(0))
const tour = read('src/components/staff/StaffTour.tsx')
check('the last button goes to the home, "דילוג" is always there, focus follows the slide', /WIZARD_END_HREF/.test(tour) && /דילוג על הסיור/.test(tour) && /headingRef\.current\?\.focus/.test(tour) && /aria-hidden="true"/.test(tour))

section('the Google round trip comes back to the wizard')
const callback = read('src/app/auth/callback/route.ts')
const glink = read('src/app/api/staff/google-link/route.ts')
const inviteLib = read('src/lib/staff/invitations.ts')
check('the wizard asks for its return with a cookie, and Google\'s return URL stays exactly as before', /setBackCookie\(response\)/.test(glink) && /redirectTo: `\$\{origin\}\/auth\/callback\?link=\$\{tokenHash\(proof\)\}`/.test(glink) && /sarcafe_link_back/.test(inviteLib))
check('the cookie is HttpOnly, scoped to the callback and short-lived', /LINK_BACK_COOKIE, 'onboarding', \{ httpOnly: true[^}]*path: '\/auth\/callback', maxAge: LINK_SECONDS/.test(inviteLib))
check('success returns to /staff/onboarding?linked=1, failure to /staff/onboarding?error=..., both clear the cookie', /backToWizard \? '\/staff\/onboarding\?linked=1'/.test(callback) && /backToWizard \? `\/staff\/onboarding\?error=\$\{reason\}`/.test(callback) && (callback.match(/clearBackCookie\(response\)/g) ?? []).length === 2)
check('without the cookie the old return (the profile) is untouched', /'\/staff\/profile\?linked=1'/.test(callback) && /\/staff\/profile\?setup=google&error=/.test(callback))
check('only the literal "onboarding" is honoured (no free-form redirect)', /get\(LINK_BACK_COOKIE\)\?\.value === 'onboarding'/.test(callback) && /back: z\.literal\('onboarding'\)\.optional\(\)/.test(glink))
const wizard = read('src/components/staff/StaffOnboarding.tsx')
check('the button passes the wish through, and the page continues at "my details" after ?linked=1', /<GoogleLinkButton prepared=\{prepared\} back="onboarding"/.test(wizard) && /params\.get\('linked'\) === '1'/.test(wizard) && /setContinuing\(true\)/.test(wizard))
check('a person who finished the walk and opens the page again goes home (the icon always ends at the home)', /mine\.onboardingDone && !failed\) \{ window\.location\.replace\('\/staff'\)/.test(wizard))
check('the tour can be watched again with ?tour=1', /params\.get\('tour'\) === '1'/.test(wizard))
check('the bearer link stays in the address bar through setup (so the icon can be saved WITH it) and leaves it, and this device, the moment the code is set', /clearInvite\(storage\(\)\)\n      window\.history\.replaceState\(null, '', window\.location\.pathname\)/.test(wizard) && !/if \(invite\) window\.history\.replaceState/.test(wizard))
const onboardingApi = read('src/app/api/staff/onboarding/route.ts')
check('the person\'s first and last name reach the details step', /firstName: identity\.first_name/.test(onboardingApi) && /firstName: person\?\.first_name/.test(onboardingApi))

section('setup first: nothing is reachable before the app is installed and notifications are on')
check('the walk opens on the setup gate, the same one the staff pages use, before the welcome', /step === 'setup' && !tourOnly/.test(wizard) && /<SetupGate/.test(wizard) && wizard.indexOf('<SetupGate') < wizard.indexOf("step === 'welcome'"))
check('before the code exists the phone is registered with the invite link as its identity; after it, with the session', /registrar=\{coded \? sessionPushRegistrar : invitePushRegistrar\(token\)\}/.test(wizard))
check('the install step carries the way back: copy the link, and an installed app that opens without it asks for it', /הדביקו בה את הקישור/.test(wizard) && /parseInvite\(pasted\)/.test(wizard) && /loadInvite\(storage\(\), Date\.now\(\)\)/.test(wizard))
check('"recover" never offers the main page: it offers a paste and the code sign-in', /איפה הקישור שלך/.test(wizard) && /login\?next=\/staff&quick=1/.test(wizard) && !/href="\/staff"[^>]*>[^<]*(דף הבית|לאזור הצוות)/.test(wizard.slice(wizard.indexOf('no link here'))))
check('finishing (or skipping) the tour tells the server, with keepalive so it completes while the page navigates', /action: 'finish'/.test(wizard) && /keepalive: true/.test(wizard) && /onFinish=\{finish\}/.test(wizard))
const onboardingApi2 = read('src/app/api/staff/onboarding/route.ts')
check('the API registers a phone for an invite link: a live link only, the person comes from the link, nothing from the body', /action: z\.literal\('push'\), token, subscription/.test(onboardingApi2) && /staff_inspect_invitation/.test(onboardingApi2) && /staff_id: staffId,/.test(onboardingApi2) && /onConflict: 'endpoint'/.test(onboardingApi2))
check('the status check has its own, wider allowance (the gate asks on every focus); the credential steps keep theirs', /limitInvitation\(request, 'pushcheck', body\.token, \{ ip: 240, target: 120 \}\)/.test(onboardingApi2) && /else await limitInvitation\(request, body\.action, body\.token\)/.test(onboardingApi2))
check('"finish" needs a session and only marks the person themselves', /action: z\.literal\('finish'\)/.test(onboardingApi2) && /resolveStaffIdentity\(\)/.test(onboardingApi2) && /\.eq\('id', identity\.id\)/.test(onboardingApi2))
const invLib = read('src/lib/staff/invitations.ts')
check('a new or regenerated link starts the walk again (a new phone)', /update\(\{ onboarding_done_at: null \}\)/.test(invLib))
check('the staff home sends someone who set the code but never finished back to the walk', /onboardingPending\) redirect\('\/staff\/onboarding'\)/.test(read('src/app/staff/page.tsx')))

section('creating an employee: the roster scrolls to them and lights them (the Ayeka Bar roster does the same)')
const manager = read('src/components/StaffManager.tsx')
const sheet = read('src/components/staff/AddStaffSheet.tsx')
const css = read('src/components/shifts/schedule.css')
check('the sheet hands over WHO was created, not only the name', /onCreated: \(label: string, id: string\) => void/.test(sheet) && /onCreated\(made\.label, made\.id\)/.test(sheet))
check('the roster remembers the new person and makes sure their row can be seen (active, no search, any branch)', /const \[flashId, setFlashId\] = useState<string \| null>\(null\)/.test(manager) && /setFilter\('active'\)/.test(manager) && /setQuery\(''\)/.test(manager) && /setFilterSlug\(''\)/.test(manager) && /void load\(\)\.then\(\(\) => setFlashId\(id\)\)/.test(manager))
check('it scrolls the row to the middle (no smooth scroll for reduced motion) and lets go after about 3.4 s', /scrollIntoView\(\{ behavior: reduce \? 'auto' : 'smooth', block: 'center' \}\)/.test(manager) && /setFlashId\(null\), 3400\)/.test(manager) && /prefers-reduced-motion: reduce/.test(manager))
check('each row is findable by id and carries the highlight while it is the new one', /id=\{`staff-row-\$\{row\.id\}`\}/.test(manager) && /flashId === row\.id \? ' sch-staffrow--flash' : ''/.test(manager))
check('the highlight is a ring and a glow that fade (and a toast says who was added: colour is never the only signal)', /\.sch-staffrow--flash \{[^}]*0 0 0 2px var\(--neon\)/.test(css) && /transition: box-shadow \.7s/.test(css) && /נוסף\/ה לצוות ✓/.test(manager))
const staffApi = read('src/app/api/owner/staff/route.ts')
check('a new person starts with a random emoji, the least used among the active team, shown on the roster', /suggestEmoji\(/.test(staffApi) && /avatar_emoji: avatarEmoji/.test(staffApi) && /emoji=\{row\.avatar_emoji\}/.test(manager) && /colour, avatar_emoji,/.test(staffApi))
check('the wizard starts the details step from that emoji (a suggestion only when there is none)', /initialEmoji \?\? suggestEmoji\(\[\]\)/.test(read('src/components/staff/StaffProfileStep.tsx')) && /emoji=\{person\.emoji \?\? null\}/.test(wizard))

console.log(`\n${pass > 0 && failures.length === 0 ? '✓' : '✗'} ${pass} passed, ${failures.length} failed`)
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1) }
