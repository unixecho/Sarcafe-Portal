// Checks for the public loyalty sign-up page /loyaltysignup (owner, 2026-11-04): the request contract, the form token, the language
// pick, the copy (three languages that say the same things, with the facts the system keeps true), and the wiring that keeps the
// page safe to hand out. (The database side is verify-waitlist-sql; the live behaviour was tested in a scratch copy.)
//
//   node scripts/check-loyalty-signup.mjs

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

// zod must resolve from node_modules, so the transpiled files live inside the repo for the run
const dir = join(ROOT, 'scripts', '.tmp-check-loyalty')
mkdirSync(dir, { recursive: true })
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* temp dir */ } })
for (const name of ['signup-shared', 'signup-server', 'copy']) {
  const out = ts.transpileModule(read(`src/lib/loyalty/${name}.ts`), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText
  writeFileSync(join(dir, `${name}.mjs`), out.replace(/from '\.\/signup-shared'/g, "from './signup-shared.mjs'"))
}
const S = await import(pathToFileURL(join(dir, 'signup-shared.mjs')).href)
const T = await import(pathToFileURL(join(dir, 'signup-server.mjs')).href)
const C = await import(pathToFileURL(join(dir, 'copy.mjs')).href)

const good = {
  firstName: ' דנה ', phone: '054-123 4567', email: '', acknowledged: true, marketing: false,
  requestId: '4b0f1c7e-3d1a-4a52-9f0e-0a6f5b2c9d11', lang: 'he', token: '1700000000000.abcdef0123456789abcdef0123456789', website: '',
}

section('the request contract')
const ok = S.webSignupSchema.safeParse(good)
check('a proper sign-up is accepted and trimmed', ok.success && ok.data.firstName === 'דנה' && ok.data.website === '')
check('an unknown field is refused (a client cannot send its own version ids)', !S.webSignupSchema.safeParse({ ...good, privacyVersion: 'x' }).success && !S.webSignupSchema.safeParse({ ...good, isAdmin: true }).success)
check('the confirmation must be literally true', !S.webSignupSchema.safeParse({ ...good, acknowledged: false }).success && !S.webSignupSchema.safeParse({ ...good, acknowledged: 'yes' }).success)
check('marketing is a real boolean, never inferred', !S.webSignupSchema.safeParse({ ...good, marketing: 'true' }).success && S.webSignupSchema.safeParse({ ...good, marketing: true }).success && !S.webSignupSchema.safeParse({ ...good, marketing: undefined }).success)
check('the language is one of three', ['he', 'en', 'ar'].every((lang) => S.webSignupSchema.safeParse({ ...good, lang }).success) && !S.webSignupSchema.safeParse({ ...good, lang: 'fr' }).success)
check('the request id must be a uuid and the token is required', !S.webSignupSchema.safeParse({ ...good, requestId: 'abc' }).success && !S.webSignupSchema.safeParse({ ...good, token: undefined }).success)
check('an over-long name or e-mail is refused, an empty name too', !S.webSignupSchema.safeParse({ ...good, firstName: 'א'.repeat(61) }).success && !S.webSignupSchema.safeParse({ ...good, email: 'a'.repeat(250) + '@b.co' }).success && !S.webSignupSchema.safeParse({ ...good, firstName: '   ' }).success)
check('the body limit is small (2 KB)', S.MAX_BODY_BYTES === 2048)

section('phone, e-mail, language')
check('a mobile number is accepted in the usual spellings', ['0541234567', '054-123 4567', '+972 54-1234567', '972541234567'].every(S.isMobilePhone))
check('a landline, a short number or text is not a mobile number', ['031234567', '05412345', '0641234567', 'abcdefghij', ''].every((v) => !S.isMobilePhone(v)))
check('normalizePhone gives 05XXXXXXXX', S.normalizePhone('+972 54-123-4567') === '0541234567')
check('e-mail needs an @ and a dot after it', S.isEmail('a@b.co') && !S.isEmail('a@b') && !S.isEmail('a b@c.co') && !S.isEmail('@b.co'))
check('?lang= wins, then the browser, then Hebrew', S.pickLanguage('ar', 'en-US') === 'ar' && S.pickLanguage(undefined, 'en-US,en;q=0.9') === 'en' && S.pickLanguage(null, 'ar-EG;q=0.9') === 'ar' && S.pickLanguage('xx', 'fr-FR') === 'he' && S.pickLanguage(null, null) === 'he')
check('the old Hebrew code iw is understood', S.pickLanguage(null, 'iw-IL') === 'he')

section('the form token')
const secret = 'test-secret'
const t0 = 1_800_000_000_000
const token = T.makeFormToken(secret, t0)
check('a token is "<ms>.<signature>"', /^\d{13}\.[0-9a-f]{32}$/.test(token))
check('a token a person could have filled in is accepted', T.checkFormToken(token, secret, t0 + 10_000) === 'ok')
check('a token used at once is "too fast" (a bot posts immediately)', T.checkFormToken(token, secret, t0 + 500) === 'too_fast' && T.checkFormToken(token, secret, t0 - 5_000) === 'too_fast')
check('a token older than three hours has expired', T.checkFormToken(token, secret, t0 + T.TOKEN_MAX_AGE_MS + 1) === 'expired' && T.checkFormToken(token, secret, t0 + T.TOKEN_MAX_AGE_MS - 1) === 'ok')
check('a forged, altered, foreign or malformed token is "bad"', [
  T.checkFormToken(token, 'other-secret', t0 + 10_000),
  T.checkFormToken(`${t0 + 1}.${token.split('.')[1]}`, secret, t0 + 10_000),
  T.checkFormToken('garbage', secret, t0 + 10_000),
  T.checkFormToken(`${token}.x`, secret, t0 + 10_000),
  T.checkFormToken(`${t0}.`, secret, t0 + 10_000),
  T.checkFormToken('', secret, t0 + 10_000),
].every((r) => r === 'bad'))

section('the caller key')
const day = new Date('2026-11-04T10:00:00Z')
const k1 = T.webCallerKey('203.0.113.9, 10.0.0.1', 'secret', day)
check('the caller key is a hash, stable within a day, and never contains the address', /^[0-9a-f]{64}$/.test(k1) && k1 === T.webCallerKey('203.0.113.9', 'secret', day) && !k1.includes('203'))
check('it changes with the address, the day and the secret', k1 !== T.webCallerKey('203.0.113.10', 'secret', day) && k1 !== T.webCallerKey('203.0.113.9', 'secret', new Date('2026-11-05T10:00:00Z')) && k1 !== T.webCallerKey('203.0.113.9', 'other', day))
{
  const { createHmac } = await import('node:crypto')
  const kioskStyle = createHmac('sha256', 'secret').update(`${day.toISOString().slice(0, 10)}|203.0.113.9`).digest('hex')
  check('it is never the same key the kiosk would make for the same caller', k1 !== kioskStyle)
}

section('the three languages say the same things')
const langs = ['he', 'en', 'ar']
const keysOf = (o) => Object.keys(o).sort().join(',')
check('every language has every string, and none is empty', langs.every((l) => keysOf(C.COPY[l]) === keysOf(C.COPY.he)) && langs.every((l) => Object.entries(C.COPY[l]).every(([, v]) => (typeof v === 'string' ? v.trim() !== '' : Array.isArray(v) && v.length > 0))))
check('the notice and the terms have the same number of sections in each language (11 and 7)', langs.every((l) => C.COPY[l].privacy.length === 11 && C.COPY[l].terms.length === 7))
check('every section has a heading and a body', langs.every((l) => [...C.COPY[l].privacy, ...C.COPY[l].terms].every(([h, b]) => h.trim() && b.trim().length > 30)))
check('Hebrew and Arabic are right-to-left, English left-to-right', C.COPY.he.dir === 'rtl' && C.COPY.ar.dir === 'rtl' && C.COPY.en.dir === 'ltr')
check('the language names are written in their own language', C.COPY.he.name === 'עברית' && C.COPY.en.name === 'English' && C.COPY.ar.name === 'العربية')
check('the Arabic text is Arabic and the Hebrew is Hebrew (not a copy of the English)', /[؀-ۿ]/.test(C.COPY.ar.lead) && /[א-ת]/.test(C.COPY.he.lead) && !/[א-ת؀-ۿ]/.test(C.COPY.en.lead))
for (const l of langs) {
  const text = [...C.COPY[l].privacy, ...C.COPY[l].terms].map(([h, b]) => `${h} ${b}`).join('\n')
  const v = S.WEB_LEGAL_VERSIONS[l]
  check(`${l}: the notice and terms print the very ids that are stored`, text.includes(v.privacy) && text.includes(v.terms))
  check(`${l}: states the facts the system keeps true (12 months, 30 days, 18, s.30A, hosts, the business phone)`, /12/.test(text) && /30 ?(ימים|days|يومًا)/.test(text) && /18/.test(text) && /30(א|A|أ)/.test(text) && /Supabase/.test(text) && /Vercel/.test(text) && text.includes(C.BUSINESS.phone))
  check(`${l}: says there are no cookies or tracking and that it is a request, not a club`, /(עוגיות|cookies|ملفات تعريف الارتباط)/.test(text + C.COPY[l].footer) && /(אין מועדון פעיל|no active club|لا يوجد نادٍ فعّال)/.test(text + C.COPY[l].clubNote))
  check(`${l}: discloses the Google Fonts request (the site-wide font is loaded from Google, so the visitor's address reaches Google)`, text.includes('Google Fonts') && /@import url\('https:\/\/fonts\.googleapis\.com/.test(read('src/app/globals.css')))
  check(`${l}: no kiosk or tablet wording (this is a web page)`, !/(קיוסק|טאבלט|kiosk|tablet|كشك|لوح)/i.test(JSON.stringify(C.COPY[l])))
}
check('the three consent texts are separate: required vs marketing', langs.every((l) => C.COPY[l].required !== C.COPY[l].marketing && /18/.test(C.COPY[l].required)))

section('the version ids')
const ids = langs.flatMap((l) => Object.values(S.WEB_LEGAL_VERSIONS[l]))
check('there are nine distinct ids, dated, each naming its language', new Set(ids).size === 9 && langs.every((l) => Object.values(S.WEB_LEGAL_VERSIONS[l]).every((id) => id.startsWith('web-') && id.includes(`-${l}-v`) && /-v[0-9]+-[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(id))))
const kioskLegal = read('prototypes/sarcafe-kiosk-app/overrides/kiosk-legal.js') + read('src/lib/kiosk/waitlist.ts')
check('none of them is a kiosk id (the web texts are their own)', ids.every((id) => !kioskLegal.includes(id)))

section('the business facts match the kiosk')
const biz = read('prototypes/sarcafe-kiosk-app/overrides/kiosk-business.js')
const pick = (key) => (biz.match(new RegExp(`${key}:\\s*'([^']*)'`)) || [])[1]
check('phone, owner and business names are the kiosk\'s', pick('phone') === C.BUSINESS.phone && `${pick('ownerFirstName')} ${pick('ownerLastName')}` === C.BUSINESS.ownerName && pick('businessName') === C.BUSINESS.names.he && pick('businessNameEn') === C.BUSINESS.names.en && pick('businessNameAr') === C.BUSINESS.names.ar)
{ // the business is שרקפה; the misspelling must never come back in what this feature ships
  const wrong = 'ס' + 'רקפה'
  const files = ['src/lib/loyalty/copy.ts', 'src/app/loyaltysignup/LoyaltySignupForm.tsx', 'src/app/loyaltysignup/page.tsx', 'supabase/migrations/20261104150000_customer_waitlist_web_source.sql']
  check('the business name is spelled שרקפה', files.every((f) => !read(f).includes(wrong)))
}

section('the endpoint')
const route = read('src/app/api/loyaltysignup/route.ts')
const order = (a, b) => route.indexOf(a) > 0 && route.indexOf(a) < route.indexOf(b)
check('without a secret the endpoint is off (503), before anything else runs', order("if (!secret) return reply(503", 'sameOrigin(request)'))
check('the origin check comes before the body is read, and needs an Origin that names this host', order('sameOrigin(request)', 'readLimitedText(') && /if \(!origin \|\| !host\) return false/.test(route) && /new URL\(origin\)\.host !== host/.test(route))
check('JSON only, a real size limit, a strict schema, then the honeypot, then the token', /415/.test(route) && /readLimitedText\(request, MAX_BODY_BYTES\)/.test(route) && order('webSignupSchema.safeParse', 'input.website') && order('input.website', 'checkFormToken('))
check('the token outcomes are all refused (bad, expired, too fast)', /token === 'bad'/.test(route) && /token === 'expired'/.test(route) && /token === 'too_fast'/.test(route))
check('the legal versions come from the language on the server, never from the client', /WEB_LEGAL_VERSIONS\[input\.lang\]/.test(route) && !/input\.(privacy|consent|terms)/i.test(route))
check('it registers through the one transaction as the service role, marked as the web source', /rpc\('customer_waitlist_register'/.test(route) && /createServiceRoleClient/.test(route) && /p_source: 'web'/.test(route) && /webCallerKey\(/.test(route))
check('an already-registered number looks exactly like a new sign-up (no way to ask whether a number is on the list)', /already_registered'\) return reply\(200, \{ ok: true \}\)/.test(route))
check('rate limit answers 429; nothing is logged; no CORS headers; nothing echoes the input', /rate_limited'\) return reply\(429/.test(route) && !/console\./.test(route) && !/Access-Control/i.test(route) && !/error\.message|\.details/.test(route))

section('the page')
const page = read('src/app/loyaltysignup/page.tsx')
const form = read('src/app/loyaltysignup/LoyaltySignupForm.tsx')
check('the page is never cached and never indexed', /dynamic = 'force-dynamic'/.test(page) && /index: false, follow: false/.test(page))
check('the token is issued when the page is rendered, from the shared secret', /makeFormToken\(loyaltySecret\(\)/.test(page))
check('the response headers: no-store, noindex, no Referer', /source: '\/loyaltysignup'[\s\S]{0,400}no-store[\s\S]{0,200}noindex, nofollow[\s\S]{0,200}no-referrer/.test(read('next.config.mjs')))
check('the middleware does NOT exempt the endpoint from the cross-site block', !/CROSS_ORIGIN_API_PREFIXES = \[[^\]]*loyaltysignup/.test(read('src/middleware.ts')))
check('neither box is ever pre-ticked and the marketing box is separate', /useState\(false\)/.test(form) && /\[acknowledged, setAcknowledged\] = useState\(false\)/.test(form) && /\[marketing, setMarketing\] = useState\(false\)/.test(form) && !/checked=\{true\}|defaultChecked/.test(form))
check('the honeypot exists and is hidden from people and screen readers', /name="website"/.test(form) && /aria-hidden="true"/.test(form) && /tabIndex=\{-1\}/.test(form))
check('the notice and the terms are on the page itself (two collapsible sections, no outside link)', (form.match(/<details>/g) || []).length === 2 && !/https?:\/\//.test(form + page))
check('nothing is kept in the browser and nothing leaves it but the one request', !/localStorage|sessionStorage|indexedDB|document\.cookie/.test(form) && (form.match(/fetch\(/g) || []).length === 1 && /fetch\('\/api\/loyaltysignup'/.test(form))
check('one request id per form fill, reused for a retry', /if \(!requestId\.current\) requestId\.current = newRequestId\(\)/.test(form))
check('the language switch is a labelled group of buttons with aria-pressed, and sets lang and dir', /aria-pressed/.test(form) && /role="group"/.test(form) && /html\.lang = lang/.test(form) && /html\.dir = t\.dir/.test(form))
check('every field has a label, errors are announced and tied to the field', (form.match(/<label htmlFor=/g) || []).length >= 5 && /role="alert"/.test(form) && /aria-describedby/.test(form) && /aria-invalid/.test(form))
check('the stylesheet uses logical properties (it serves both directions) and 16px+ inputs', !/\b(margin|padding)-(left|right)\b/.test(read('src/app/loyaltysignup/loyaltysignup.css')) && /font-size: 17px/.test(read('src/app/loyaltysignup/loyaltysignup.css')))
check('the page is a customer page (skip link + accessibility widget)', /'\/loyaltysignup'/.test(read('src/lib/a11y-scope.ts')))

section('the database side (migration 20261104150000)')
const mig = read('supabase/migrations/20261104150000_customer_waitlist_web_source.sql')
check('one function only: the old 9-argument one is dropped in the same migration', /drop function if exists public\.customer_waitlist_register\(text, text, text, boolean, text, text, text, uuid, text\)/.test(mig))
check('web limits are separate from the kiosk\'s (6 per caller, 120 overall)', /case when v_source = 'web' then 6 else 12 end/.test(mig) && /case when v_source = 'web' then 120 else 300 end/.test(mig))
check('service role only', /revoke all on function public\.customer_waitlist_register\([^)]*\) from public, anon, authenticated/.test(mig) && /grant execute on function public\.customer_waitlist_register\([^)]*\) to service_role/.test(mig))

console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) { console.log('FAILED:\n - ' + failures.join('\n - ')); process.exit(1) }
