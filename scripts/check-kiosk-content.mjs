// Checks for the kiosk's content (owner, 2026-10-28): the projection behind GET /api/kiosk/content (the exact contract
// the kiosk is coded against, ordering, hidden cards, no personal data, `since`, the QR matrix, hours with exceptions,
// highlights), the poll's request contract, and the wiring of the public and owner routes. The database side is
// verify-kiosk-content-sql.
//
//   node scripts/check-kiosk-content.mjs

import ts from 'typescript'
import QRCode from 'qrcode'
import jsQR from 'jsqr'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
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

// zod must resolve from node_modules, so the transpiled files live inside the repo for the run
const dir = join(ROOT, 'scripts', '.tmp-check-kiosk-content')
mkdirSync(dir, { recursive: true })
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* temp dir */ } })
const transpile = (src, out) => writeFileSync(join(dir, out), ts.transpileModule(read(src), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText
  .replace(/from '\.\/content-project'/g, "from './content-project.mjs'"))
transpile('src/lib/kiosk/content-project.ts', 'content-project.mjs')
transpile('src/lib/kiosk/content-schema.ts', 'content-schema.mjs')
const P = await import(pathToFileURL(join(dir, 'content-project.mjs')).href)
const S = await import(pathToFileURL(join(dir, 'content-schema.mjs')).href)

// the same QR and hash the server uses (lib/kiosk/content.ts)
const qr = (url) => {
  const q = QRCode.create(url, { errorCorrectionLevel: 'M' })
  return Array.from({ length: q.modules.size }, (_, r) => Array.from({ length: q.modules.size }, (_, c) => (q.modules.get(r, c) ? '1' : '0')).join(''))
}
const deps = { qr, hash: (t) => createHash('sha256').update(t).digest('hex').slice(0, 16) }
const PREFIX = 'https://proj.supabase.co/storage/v1/object/public/'

const ad = (id, kind, extra = {}) => ({ id, kind, title: `כותרת ${id}`, body: `טקסט ${id}`, action: 'none', imageUrl: null, menuItemIds: [], enabled: true, sortOrder: 0, ...extra })
const week = [
  { open: '08:00', close: '19:00' }, { open: '08:00', close: '19:00' }, { open: '08:00', close: '19:00' }, { open: '08:00', close: '19:00' },
  { open: '08:00', close: '19:00' }, { open: '08:00', close: '13:00' }, { open: '09:00', close: '14:00' },
]
const menuItems = [
  { uid: 'm1', he: 'אספרסו', price: 8, note: { he: 'כפול' } },
  { uid: 'm2', he: 'קרואסון', price: '14' },
  { uid: 'm3', he: 'שייק', price: '20/24' },
  { uid: 'm4', he: 'עוגה', price: 18, available: false },
  { uid: 'm5', he: 'מאפה', price: 12, quantity: 0 },
  { uid: 'm6', en: 'Cookie', price: 9 },
]
const base = {
  settings: { idleSeconds: 60, graceSeconds: 10, slideSeconds: 7 },
  ads: [
    ad('a-loc', 'location', { sortOrder: 10, body: 'בואו לבקר את סניף האם שלנו במאור באווירת מושב חמה בימי ראשון עד שישי' }),
    ad('a-fb', 'feedback', { sortOrder: 20 }),
    ad('a-loy', 'loyalty', { sortOrder: 30, action: 'join' }),
    ad('a-hrs', 'hours', { sortOrder: 40, body: '' }),
    ad('a-hl', 'menu_highlight', { sortOrder: 50, action: 'menu', menuItemIds: ['m2', 'm4', 'm1', 'm5', 'm2', 'gone', 'm3'] }),
    ad('a-off', 'custom', { sortOrder: 5, enabled: false }),
  ],
  weeklyHours: week,
  exceptions: [
    { date: '2026-12-25', closed: true, open: null, close: null, note: 'חג' },
    { date: '2026-10-01', closed: true, open: null, close: null, note: 'עבר' },
    { date: '2026-11-03', closed: false, open: '10:00', close: '12:00', note: null },
    { date: '2026-11-04', closed: false, open: null, close: null, note: 'בלי שעות' },
  ],
  timezone: 'Asia/Jerusalem',
  menuItems,
  feedbackUrl: 'https://sarcafe-portal.vercel.app/feedback',
  today: '2026-10-28',
  imagePrefix: PREFIX,
}
const content = P.buildKioskContent(base, deps)

section('the contract')
eq('top-level keys are exactly the contract', Object.keys(content).sort(), ['ads', 'highlights', 'hours', 'settings', 'version'])
check('version is a short hex string', typeof content.version === 'string' && /^[0-9a-f]{16}$/.test(content.version))
eq('settings', content.settings, { idleSeconds: 60, graceSeconds: 10, slideSeconds: 7 })
check('every ad has exactly the contract keys and types', content.ads.every((a) => JSON.stringify(Object.keys(a).sort()) === '["action","body","id","imageUrl","kind","qr","title"]'
  && typeof a.id === 'string' && typeof a.title === 'string' && typeof a.body === 'string' && ['none', 'join', 'menu'].includes(a.action)
  && (a.qr === null || (typeof a.qr.url === 'string' && Array.isArray(a.qr.modules))) && (a.imageUrl === null || typeof a.imageUrl === 'string')))
check('hours has timezone, a 7-day week (0 = Sunday) and exceptions with the contract keys', content.hours.timezone === 'Asia/Jerusalem'
  && content.hours.week.length === 7 && content.hours.week.every((d, i) => d.day === i && JSON.stringify(Object.keys(d).sort()) === '["close","day","open"]')
  && content.hours.exceptions.every((e) => JSON.stringify(Object.keys(e).sort()) === '["close","closed","date","note","open"]'))
check('highlights have exactly name / price / note', content.highlights.every((h) => JSON.stringify(Object.keys(h).sort()) === '["name","note","price"]' && (h.price === null || typeof h.price === 'number')))

section('cards')
eq('only enabled cards, in the owner\'s order', content.ads.map((a) => a.id), ['a-loc', 'a-fb', 'a-loy', 'a-hrs', 'a-hl'])
eq('the location text travels untouched', content.ads[0].body, 'בואו לבקר את סניף האם שלנו במאור באווירת מושב חמה בימי ראשון עד שישי')
check('only the feedback card carries a QR, pointing at the poll page', content.ads.filter((a) => a.qr).length === 1 && content.ads[1].qr.url === 'https://sarcafe-portal.vercel.app/feedback')
check('the loyalty card keeps its join action', content.ads[2].action === 'join')
check('a card switched off is not in the answer at all', !JSON.stringify(content).includes('a-off'))
const noHours = P.buildKioskContent({ ...base, weeklyHours: null, exceptions: [] }, deps)
check('with no hours anywhere: hours is null and there is no hours card', noHours.hours === null && !noHours.ads.some((a) => a.kind === 'hours'))
const noHl = P.buildKioskContent({ ...base, ads: base.ads.map((a) => (a.kind === 'menu_highlight' ? { ...a, menuItemIds: ['m4'] } : a)) }, deps)
check('a highlight card whose items are all unavailable is left out, and highlights is empty', !noHl.ads.some((a) => a.kind === 'menu_highlight') && noHl.highlights.length === 0)
const hlOff = P.buildKioskContent({ ...base, ads: base.ads.map((a) => (a.kind === 'menu_highlight' ? { ...a, enabled: false } : a)) }, deps)
check('a switched-off highlight card means no highlights', hlOff.highlights.length === 0)
const img = P.buildKioskContent({ ...base, ads: [ad('i1', 'custom', { imageUrl: `${PREFIX}kiosk/a.png` }), ad('i2', 'custom', { imageUrl: 'https://evil.example/a.png' }), ad('i3', 'custom', { imageUrl: `${PREFIX}../x` }), ad('i4', 'custom', { imageUrl: `${PREFIX}a b.png` })] }, deps)
eq('pictures only from our own public storage (no other host, no .., no spaces)', img.ads.map((a) => a.imageUrl), [`${PREFIX}kiosk/a.png`, null, null, null])
check('no prefix configured: no pictures at all', P.buildKioskContent({ ...base, imagePrefix: null, ads: [ad('i1', 'custom', { imageUrl: `${PREFIX}a.png` })] }, deps).ads[0].imageUrl === null)
check('imageAllowed refuses http and other hosts', !P.imageAllowed('http://proj.supabase.co/storage/v1/object/public/a.png', PREFIX) && !P.imageAllowed('https://proj.supabase.co.evil.com/x', PREFIX) && !P.imageAllowed(PREFIX, PREFIX))
const unknownKind = P.buildKioskContent({ ...base, ads: [ad('u1', 'popup'), ad('u2', 'custom', { action: 'call' })] }, deps)
check('an unknown kind is dropped, an unknown action becomes none', unknownKind.ads.length === 1 && unknownKind.ads[0].action === 'none')

section('settings')
eq('missing settings fall back to 60 / 10 / 7', P.normalizeSettings(null), { idleSeconds: 60, graceSeconds: 10, slideSeconds: 7 })
eq('out-of-range values are clamped', P.normalizeSettings({ idleSeconds: 5, graceSeconds: 99, slideSeconds: 2.6 }), { idleSeconds: 30, graceSeconds: 30, slideSeconds: 3 })

section('hours')
eq('the week is projected day by day', content.hours.week[5], { day: 5, open: '08:00', close: '13:00' })
eq('exceptions: past dropped, open-without-times dropped, sorted', content.hours.exceptions.map((e) => e.date), ['2026-11-03', '2026-12-25'])
eq('a closed exception has no times', content.hours.exceptions[1], { date: '2026-12-25', closed: true, open: null, close: null, note: 'חג' })
const closedSat = P.projectHours([...week.slice(0, 6), null], [], 'Asia/Jerusalem', '2026-10-28')
eq('a closed weekday is null / null', closedSat.week[6], { day: 6, open: null, close: null })
const text = content.ads.find((a) => a.kind === 'hours').body
check('the hours card body is written from the data, with grouped days', text.startsWith('ראשון–חמישי 08:00–19:00 · שישי 08:00–13:00 · שבת 09:00–14:00'), text)
check('the hours card mentions the upcoming exceptions', /שינויים קרובים: 3\.11: 10:00–12:00 · 25\.12 \(חג\): סגור/.test(text), text)
check('a closed day reads "סגור"', P.hoursText(closedSat).includes('שבת סגור'))
const onlyEx = P.projectHours(null, [{ date: '2026-12-25', closed: true, open: null, close: null, note: null }], 'Asia/Jerusalem', '2026-10-28')
check('exceptions alone still give hours (an all-closed week, the exceptions)', onlyEx && onlyEx.week.every((d) => d.open === null) && onlyEx.exceptions.length === 1)

section('highlights')
eq('selected items in the owner\'s order, current name and price, unavailable / sold-out / missing / repeated skipped',
  content.highlights, [{ name: 'קרואסון', price: 14, note: null }, { name: 'אספרסו', price: 8, note: 'כפול' }, { name: 'שייק', price: null, note: null }])
eq('an English-only name falls back', P.projectHighlights(['m6'], menuItems), [{ name: 'Cookie', price: 9, note: null }])

section('no personal data')
const json = JSON.stringify(content)
check('no phone, e-mail, staff, uid or internal fields in the answer', !/05\d{8}|@[a-z]+\.|staff|seed_key|sortOrder|menuItemIds|branch_id|updated_by|uid/.test(json))

section('version and since')
const again = P.buildKioskContent(base, deps)
check('the same content gives the same version', again.version === content.version)
check('any visible change gives a new version', P.buildKioskContent({ ...base, settings: { ...base.settings, slideSeconds: 8 } }, deps).version !== content.version
  && P.buildKioskContent({ ...base, ads: base.ads.map((a) => (a.id === 'a-loc' ? { ...a, title: 'שונה' } : a)) }, deps).version !== content.version)
check('a change to a switched-off card does not change the version', P.buildKioskContent({ ...base, ads: base.ads.map((a) => (a.id === 'a-off' ? { ...a, title: 'שונה' } : a)) }, deps).version === content.version)
const route = read('src/app/api/kiosk/content/route.ts')
check('the route answers { unchanged: true } when since equals the version', /since && since === content\.version/.test(route) && /unchanged: true/.test(route))

section('the QR')
const m = content.ads[1].qr.modules
check('the matrix is square, rows of 0/1 only', m.length >= 21 && m.every((row) => row.length === m.length && /^[01]+$/.test(row)))
check('it has the three finder patterns', m[0].slice(0, 7) === '1111111' && m[0].slice(-7) === '1111111' && m[m.length - 1].slice(0, 7) === '1111111')
// draw it with a quiet zone and read it back with a real decoder
const scale = 6, quiet = 4, size = (m.length + quiet * 2) * scale
const pixels = new Uint8ClampedArray(size * size * 4).fill(255)
for (let r = 0; r < m.length; r++) for (let c = 0; c < m.length; c++) if (m[r][c] === '1') {
  for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
    const i = (((r + quiet) * scale + y) * size + (c + quiet) * scale + x) * 4
    pixels[i] = pixels[i + 1] = pixels[i + 2] = 0
  }
}
const decoded = jsQR(pixels, size, size)
check('a QR decoder reads back exactly the poll URL', decoded?.data === 'https://sarcafe-portal.vercel.app/feedback', decoded?.data)

section('the poll request contract')
const good = { optionIds: ['4b0f1c7e-3d1a-4a52-9f0e-0a6f5b2c9d11'], suggestion: 'קפה קר', rating: 4, requestId: '5b0f1c7e-3d1a-4a52-9f0e-0a6f5b2c9d11' }
const ok = S.feedbackSchema.safeParse(good)
check('a proper answer is accepted (honeypot defaults to empty)', ok.success && ok.data.website === '')
check('an unknown field (a name, a phone) is refused', !S.feedbackSchema.safeParse({ ...good, name: 'דנה' }).success && !S.feedbackSchema.safeParse({ ...good, phone: '0541234567' }).success)
check('four votes are refused', !S.feedbackSchema.safeParse({ ...good, optionIds: Array(4).fill(good.optionIds[0]) }).success)
check('a 501-character suggestion is refused, 500 accepted', !S.feedbackSchema.safeParse({ ...good, suggestion: 'א'.repeat(501) }).success && S.feedbackSchema.safeParse({ ...good, suggestion: 'א'.repeat(500) }).success)
check('rating must be 1-5 or null', !S.feedbackSchema.safeParse({ ...good, rating: 6 }).success && !S.feedbackSchema.safeParse({ ...good, rating: 2.5 }).success && S.feedbackSchema.safeParse({ ...good, rating: null }).success)
check('the request id must be a uuid', !S.feedbackSchema.safeParse({ ...good, requestId: 'x' }).success)
check('the body limit is small', S.FEEDBACK_MAX_BODY_BYTES <= 4096)

section('the owner save contract')
const save = { settings: { idleSeconds: 60, graceSeconds: 10, slideSeconds: 7, exceptions: [] }, ads: [{ id: null, kind: 'custom', title: 'x', body: '', action: 'none', imageUrl: null, menuItemIds: [], enabled: true }], options: [{ id: null, label: 'מאפים', enabled: true }] }
check('a proper save is accepted', S.contentSaveSchema.safeParse(save).success)
check('idle 29 / 301, grace 4 / 31 are refused', [29, 301].every((v) => !S.contentSaveSchema.safeParse({ ...save, settings: { ...save.settings, idleSeconds: v } }).success)
  && [4, 31].every((v) => !S.contentSaveSchema.safeParse({ ...save, settings: { ...save.settings, graceSeconds: v } }).success))
check('an open exception needs times', !S.contentSaveSchema.safeParse({ ...save, settings: { ...save.settings, exceptions: [{ date: '2026-12-25', closed: false, open: null, close: null, note: null }] } }).success)
check('an unknown kind or extra field is refused', !S.contentSaveSchema.safeParse({ ...save, ads: [{ ...save.ads[0], kind: 'popup' }] }).success && !S.contentSaveSchema.safeParse({ ...save, extra: 1 }).success)

section('wiring')
check('public route: GET + OPTIONS only, CORS *, OPTIONS 204', /export async function GET/.test(route) && /export function OPTIONS/.test(route) && !/export (async )?function (POST|PUT|PATCH|DELETE)/.test(route)
  && /'Access-Control-Allow-Origin': '\*'/.test(route) && /status: 204/.test(route))
check('public route: a short shared cache with stale-while-revalidate, errors not cached', /s-maxage=30/.test(route) && /stale-while-revalidate/.test(route) && /no-store/.test(route))
const lib = read('src/lib/kiosk/content.ts')
check('content is pinned to the kiosk branch (KIOSK_BRANCH_SLUG)', /eq\('slug', KIOSK_BRANCH_SLUG\)/.test(lib) && /fetchMenu\(KIOSK_BRANCH_SLUG\)/.test(lib))
check('hours come from the branch operating hours (shift_settings via getBranchOpenStates)', /getBranchOpenStates/.test(lib))
const fb = read('src/app/api/kiosk/content/feedback/route.ts')
check('poll endpoint: same origin, JSON only, size limit, strict schema, honeypot, HMAC caller key, one RPC', /originHost !== request\.headers\.get\('host'\)/.test(fb) && /415/.test(fb)
  && /readLimitedText\(request, FEEDBACK_MAX_BODY_BYTES\)/.test(fb) && /feedbackSchema\.safeParse/.test(fb) && /input\.website/.test(fb) && /feedbackCallerKey/.test(fb) && /rpc\('kiosk_feedback_submit'/.test(fb))
check('poll endpoint logs nothing', !/console\./.test(fb))
check('the caller key is an HMAC with a date, never the raw address', /createHmac\('sha256', secret\)\.update\(`kiosk-feedback\|\$\{now\.toISOString\(\)\.slice\(0, 10\)\}\|\$\{ip\}`\)/.test(lib))
for (const p of ['src/app/api/owner/kiosk/content/route.ts', 'src/app/api/owner/kiosk/feedback/route.ts', 'src/app/api/owner/kiosk/feedback/export/route.ts']) {
  const src = read(p)
  const handlers = src.match(/export const (GET|POST|PUT) = apiRoute\(async/g) ?? []
  const guarded = src.match(/await requireOwner\(\)/g) ?? []
  check(`${p.replace('src/app/api/', '')}: every handler calls requireOwner first`, handlers.length > 0 && guarded.length === handlers.length)
}
for (const p of ['src/app/owner/kiosk/page.tsx', 'src/app/owner/kiosk/feedback/page.tsx']) {
  check(`${p.replace('src/app/', '')}: page refuses non-owners server-side`, /if \(!isOp\(me\)\) redirect\('\/no-access'\)/.test(read(p)))
}
check('the public poll page exists and asks for no personal data', existsSync(join(ROOT, 'src/app/feedback/page.tsx'))
  && !/type="(tel|email)"|name="(phone|email|name)"/.test(read('src/components/kiosk-feedback/PollForm.tsx')))
check('the poll form keeps nothing on the device', !/localStorage|sessionStorage|document\.cookie/.test(read('src/components/kiosk-feedback/PollForm.tsx')))
check('the owner page saves through one PUT (draft + one Save)', /method: 'PUT'/.test(read('src/components/kiosk-admin/KioskContentEditor.tsx')) && (read('src/components/kiosk-admin/KioskContentEditor.tsx').match(/fetch\(/g) ?? []).length === 1)
check('dashboard and menu link to /owner/kiosk', /'\/owner\/kiosk'/.test(read('src/components/dashboard/OwnerDashboardView.tsx')) && /'\/owner\/kiosk'/.test(read('src/components/app/AppNavigation.tsx')))
const pkg = JSON.parse(read('package.json'))
check('npm scripts are registered', pkg.scripts['check:kiosk-content'] === 'node scripts/check-kiosk-content.mjs' && pkg.scripts['verify:kiosk-content-sql'] === 'node scripts/verify-kiosk-content-sql.mjs')

console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) { console.log('FAILED:\n - ' + failures.join('\n - ')); process.exit(1) }
