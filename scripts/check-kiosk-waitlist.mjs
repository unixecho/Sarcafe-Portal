// Checks for the kiosk sign-up (owner, 2026-10-27): the request contract, the key and caller-hash helpers, and the wiring
// that sends each sign-up to the owner and developer and to the owner-only page. (The database side is verify-waitlist-sql.)
//
//   node scripts/check-kiosk-waitlist.mjs

import ts from 'typescript'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
let pass = 0
const failures = []
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`) } else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t) => console.log(`\n${t}`)

// zod must resolve from node_modules, so the transpiled file lives inside the repo for the run
const dir = join(ROOT, 'scripts', '.tmp-check-waitlist')
mkdirSync(dir, { recursive: true })
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* temp dir */ } })
writeFileSync(join(dir, 'waitlist.mjs'), ts.transpileModule(read('src/lib/kiosk/waitlist.ts'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText)
const W = await import(pathToFileURL(join(dir, 'waitlist.mjs')).href)

const good = {
  firstName: ' דנה ', phone: '054-123 4567', email: '', acknowledged: true, marketing: false,
  requestId: '4b0f1c7e-3d1a-4a52-9f0e-0a6f5b2c9d11',
  privacyVersion: W.KIOSK_PRIVACY_VERSION, consentVersion: W.KIOSK_CONSENT_VERSION, termsVersion: W.KIOSK_TERMS_VERSION,
}

section('the request contract')
const ok = W.signupSchema.safeParse(good)
check('a proper sign-up is accepted and trimmed', ok.success && ok.data.firstName === 'דנה' && ok.data.website === '')
check('an unknown field is refused', !W.signupSchema.safeParse({ ...good, isAdmin: true }).success)
check('the privacy / terms acknowledgement must be literally true', !W.signupSchema.safeParse({ ...good, acknowledged: false }).success && !W.signupSchema.safeParse({ ...good, acknowledged: 'yes' }).success)
check('marketing is a real boolean, never inferred', !W.signupSchema.safeParse({ ...good, marketing: 'true' }).success && W.signupSchema.safeParse({ ...good, marketing: true }).success)
check('only the CURRENT notice, consent and terms versions are accepted', ['privacyVersion', 'consentVersion', 'termsVersion'].every((k) => !W.signupSchema.safeParse({ ...good, [k]: 'old-version' }).success))
check('the request id must be a uuid', !W.signupSchema.safeParse({ ...good, requestId: 'abc' }).success)
check('an over-long name or e-mail is refused', !W.signupSchema.safeParse({ ...good, firstName: 'א'.repeat(61) }).success && !W.signupSchema.safeParse({ ...good, email: 'a'.repeat(250) + '@b.co' }).success)
check('the versions are dated ids', [W.KIOSK_PRIVACY_VERSION, W.KIOSK_CONSENT_VERSION, W.KIOSK_TERMS_VERSION].every((v) => /-v[0-9]+-[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v)))

section('body limit, key, caller hash')
const big = new Request('http://x/', { method: 'POST', body: 'x'.repeat(W.MAX_BODY_BYTES + 1) })
check('a body over the limit is refused without being read in full', (await W.readLimitedText(big)) === null)
check('a small body is read', (await W.readLimitedText(new Request('http://x/', { method: 'POST', body: '{"a":1}' }))) === '{"a":1}')
check('the kiosk key compares exactly', W.keysMatch('secret-1', 'secret-1') && !W.keysMatch('secret-2', 'secret-1') && !W.keysMatch(null, 'secret-1') && !W.keysMatch('x', ''))
const day = new Date('2026-10-27T10:00:00Z')
const k1 = W.callerKey('203.0.113.9, 10.0.0.1', 'secret', day)
check('the caller key is a hash, stable within a day, and never contains the address', /^[0-9a-f]{64}$/.test(k1) && k1 === W.callerKey('203.0.113.9', 'secret', day) && !k1.includes('203'))
check('the caller key changes with the address, the day and the secret', k1 !== W.callerKey('203.0.113.10', 'secret', day) && k1 !== W.callerKey('203.0.113.9', 'secret', new Date('2026-10-28T10:00:00Z')) && k1 !== W.callerKey('203.0.113.9', 'other', day))

section('the endpoint')
const route = read('src/app/api/kiosk/waitlist/route.ts')
check('without KIOSK_SIGNUP_KEY the endpoint is off (503), before anything else runs', /process\.env\.KIOSK_SIGNUP_KEY/.test(route) && route.indexOf('if (!secret) return reply(503') > 0 && route.indexOf('if (!secret) return reply(503') < route.indexOf('keysMatch(request'))
check('the key, content type, size, schema and honeypot are all enforced', /keysMatch\(/.test(route) && /415/.test(route) && /readLimitedText/.test(route) && /signupSchema\.safeParse/.test(route) && /input\.website/.test(route))
check('everything goes through the one transaction, as the service role', /rpc\('customer_waitlist_register'/.test(route) && /createServiceRoleClient/.test(route))
check('nothing is logged (no console call that could carry a contact detail)', !/console\./.test(route))
check('answers are generic: no error object or contact field is echoed', !/error\.message|\.details|input\.(firstName|phone|email)\b[^,]*\)\s*\)/.test(route.replace(/p_[a-z_]+: input\.[a-zA-Z]+/g, '')))

check('an already-registered number is answered 409 and the kiosk says so', /already_registered/.test(route) && /409/.test(route) && /res.status === 409/.test(read('prototypes/sarcafe-kiosk-app/overrides/kiosk-signup.js')))
check('the register function refuses a known number and writes nothing (migration 20261028150000)', /already_registered/.test(read('supabase/migrations/20261028150000_customer_waitlist_no_repeat.sql')) && !/update public.customer_waitlist_contacts/.test(read('supabase/migrations/20261028150000_customer_waitlist_no_repeat.sql').split('create or replace function public.customer_waitlist_register')[1]))

section('who is told, who can see')
const sql = read('supabase/migrations/20261027150000_customer_waitlist.sql')
check('every sign-up writes an owner row (club.signup) and a developer row (dev.club_signup)', /'club\.signup'/.test(sql) && /'dev\.club_signup'/.test(sql))
check('the notification text carries no name, phone or e-mail', !/v_name|v_phone|v_email/.test(sql.slice(sql.indexOf('v_body :='), sql.indexOf('return jsonb_build_object(\'ok\', true, \'status\', case'))))
const rules = read('src/lib/push/staff-rules.ts')
check('club.signup is an owner alert and dev.* is a developer alert', /OWNER_KINDS = new Set\(\[[^\]]*'club\.signup'/.test(rules) && /kind\.startsWith\('dev\.'\)\) return 'developer'/.test(rules))
const ownerApi = read('src/app/api/owner/waitlist/route.ts')
const exportApi = read('src/app/api/owner/waitlist/export/route.ts')
check('the list, the actions and the export are all full-owner only', (ownerApi.match(/await requireOwner\(\)/g) || []).length === 2 && /await requireOwner\(\)/.test(exportApi))
check('the export is never cached and uses the formula-injection guard', /no-store/.test(exportApi) && /csvLine/.test(exportApi))
const page = read('src/app/owner/waitlist/page.tsx')
check('the page redirects anyone who is not a full owner', /isOp\(me\)/.test(page) && /redirect\('\/no-access'\)/.test(page))
check('the dashboard and the menu link to the page', /\/owner\/waitlist/.test(read('src/components/dashboard/OwnerDashboardView.tsx')) && /\/owner\/waitlist/.test(read('src/components/app/AppNavigation.tsx')))

section('the kiosk side')
const legal = read('prototypes/sarcafe-kiosk-app/overrides/kiosk-legal.js')
const signup = read('prototypes/sarcafe-kiosk-app/overrides/kiosk-signup.js')
const idle = read('prototypes/sarcafe-kiosk-app/overrides/kiosk-idle.js')
const css = read('prototypes/sarcafe-kiosk-app/overrides/kiosk-app.css')
const perf = read('prototypes/sarcafe-kiosk-app/overrides/kiosk-perf.js')
check('the versions on the screen are the versions the server accepts', [W.KIOSK_PRIVACY_VERSION, W.KIOSK_CONSENT_VERSION, W.KIOSK_TERMS_VERSION].every((v) => legal.includes(`'${v}'`)))
check('the privacy notice has the s.11 elements: who, what, why, mandatory or not, recipients, retention, rights, spam, minors', ['מי אחראי', 'איזה מידע נאסף', 'למה אנחנו משתמשים', 'האם חייבים למסור', 'למי המידע עשוי להגיע', 'כמה זמן נשמר', 'הזכויות שלכם', 'דברי פרסומת', 'גיל'].every((h) => legal.includes(h)))
check('the terms exist and say it is not a club, not a promise', /תנאי שימוש ורשימת המתעניינים/.test(legal) && /אין מועדון פעיל, אין חברות/.test(legal))
check('a business fact that is still missing is a visible placeholder, the screen warns, and the business file lists every field', /legal-fill/.test(legal) && /legal-warning/.test(legal) && ['ownerFirstName','ownerLastName','businessName','companyId','phone'].every((k) => read('prototypes/sarcafe-kiosk-app/overrides/kiosk-business.js').includes(k + ':')))
check('the notice states the facts the system keeps true: 12-month deletion, 30-day answer, age 18, s.30A, the database host', /12 חודשים/.test(legal) && /30 ימים/.test(legal) && /18 ומעלה/.test(legal) && /30א/.test(legal) && /Supabase/.test(legal))
check('the retention promise is backed by a daily purge', /customer_waitlist_purge_expired/.test(read('supabase/migrations/20261027150000_customer_waitlist.sql')) && /customer_waitlist_purge_expired/.test(read('src/app/api/cron/cleanup-feedback/route.ts')))
check('the old "demo, nothing is saved" lines are replaced', /אב־טיפוס בלבד|אין שליחה או שמירה/.test(read('prototypes/sarcafe-kiosk/index.html')) && /footerNote\.textContent/.test(legal))
check('neither consent box is ever pre-ticked by the kiosk code', !/\.checked\s*=\s*true/.test(legal) && !/\.checked\s*=\s*true/.test(signup))
check('the sign-up sends only after the server says yes, and queues nothing on the tablet', /res\.ok/.test(signup) && !/localStorage|sessionStorage|indexedDB/.test(signup))
check('one request id per form fill, reused for a retry, renewed after clearing', /let requestId = newId\(\)/.test(signup) && /data-clear/.test(signup))
check('the idle reset waits while a sign-up is in flight', /__kioskBusy/.test(idle) && /__kioskBusy = true/.test(signup))
check('the idle timer fades out, resets while dark, and fades back in', /is-fading/.test(idle) && /\.kiosk-screen\.is-fading \{ opacity: 0/.test(css) && /transition: opacity/.test(css))
check('the light version keeps the animations (crossfade and the visible photo drift are not removed)', !/hero-slide\.is-active \{[^}]*animation: none/.test(css) && /\.hero-slide:not\(\.is-active\) \{ animation: none/.test(css))
check('the speed check can be forced either way and is only asked of web visitors, not the kiosk', /mode === 'lite'/.test(perf) && /mode === 'full'/.test(perf) && /!inApp && mode === 'auto'/.test(perf))

console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) { console.log('FAILED:\n - ' + failures.join('\n - ')); process.exit(1) }
