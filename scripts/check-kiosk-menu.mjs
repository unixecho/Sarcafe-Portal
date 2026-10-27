// Checks for the kiosk's menu snapshot (owner, 2026-10-27): the projection from the published public menu to the
// kiosk's small shape, the content version, and the wiring that makes the dashboard push the update.
//
//   node scripts/check-kiosk-menu.mjs

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

const dir = mkdtempSync(join(tmpdir(), 'check-kiosk-menu-'))
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* temp dir */ } })
const out = ts.transpileModule(read('src/lib/kiosk/project.ts'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText
writeFileSync(join(dir, 'project.mjs'), out)
const K = await import(pathToFileURL(join(dir, 'project.mjs')).href)

const category = (id, he, items, extra = {}) => ({ id, title: { he }, items, ...extra })

section('what reaches the kiosk')
const published = [
  category('hot', 'קפה חם', [
    { uid: 'a1', he: 'אספרסו', price: 8, image: '/x.png', modifierGroupUids: ['g1'] },
    { uid: 'a2', he: 'הפוך', price: 13, note: { he: 'חלב מוקצף' } },
  ], { icon: 'coffee', liveOnTablet: true }),
]
const snap = K.buildKioskSnapshot('גבעת חביבה', '2026-10-27T08:00:00Z', published)
eq('only name and price travel for a plain item', snap.categories[0].items[0], { name: 'אספרסו', price: 8 })
eq('a note travels', snap.categories[0].items[1], { name: 'הפוך', price: 13, note: 'חלב מוקצף' })
check('no uid, image, icon or modifier data in the snapshot', !/uid|image|icon|modifier|liveOnTablet/.test(JSON.stringify(snap)))
eq('branch and publish time are carried', [snap.branch, snap.publishedAt], ['גבעת חביבה', '2026-10-27T08:00:00Z'])

section('sold out, quantities, badges, ranges')
const cats = K.projectKioskMenu([
  category('p', 'מאפים', [
    { he: 'מאפה', price: 15, types: [{ uid: 't1', he: 'גבינית' }, { uid: 't2', he: 'אוכמניות', available: false }, { uid: 't3', he: 'שקדים', quantity: 0 }] },
    { he: 'פרעצל', price: 15, quantity: 7 },
    { he: 'שייק', price: 25, recommended: true, available: false, note: { he: 'עם חלב' } },
    { he: 'קורנטו', price: '14/16' },
  ]),
])
eq('a sold-out type is marked, not removed', cats[0].items[0].types, ['גבינית', 'אוכמניות — אזל', 'שקדים — אזל'])
eq('a tracked quantity shows', cats[0].items[1].quantity, 7)
eq('a sold-out item keeps its note and says so', cats[0].items[2].note, 'עם חלב — אזל')
eq('the recommended badge travels', cats[0].items[2].recommended, true)
eq('a price range stays a string', cats[0].items[3].price, '14/16')
check('a zero quantity is not shown as a count', K.projectKioskMenu([category('c', 'ג', [{ he: 'x', price: 1, quantity: 0 }])])[0].items[0].quantity === undefined)

section('what is left out')
eq('items without a name or a price are dropped', K.projectKioskMenu([category('c', 'ג', [{ he: 'ללא מחיר' }, { price: 5 }, { he: 'ok', price: 5 }])])[0].items.map((i) => i.name), ['ok'])
eq('an empty category disappears', K.projectKioskMenu([category('c', 'ריקה', []), category('d', 'ג', [{ he: 'a', price: 1 }])]).map((c) => c.id), ['d'])
eq('English is used when Hebrew is missing', K.projectKioskMenu([{ id: 'e', title: { en: 'Cold' }, items: [{ en: 'Iced', price: 3 }] }])[0], { id: 'e', title: 'Cold', items: [{ name: 'Iced', price: 3 }] })

section('the version')
const a = K.buildKioskSnapshot('x', null, published).version
const b = K.buildKioskSnapshot('x', '2030-01-01T00:00:00Z', published).version
check('the same content has the same version, whatever the publish time', a === b && /^[0-9a-f]{16}$/.test(a))
const changed = JSON.parse(JSON.stringify(published)); changed[0].items[0].price = 9
check('a price change changes the version', K.buildKioskSnapshot('x', null, changed).version !== a)
const soldOut = JSON.parse(JSON.stringify(published)); soldOut[0].items[0].available = false
check('a sold-out toggle changes the version', K.buildKioskSnapshot('x', null, soldOut).version !== a)
const draftOnlyField = JSON.parse(JSON.stringify(published)); draftOnlyField[0].items[0].uid = 'zzz'
check('a field the kiosk does not show does not change the version', K.buildKioskSnapshot('x', null, draftOnlyField).version === a)

section('the push wiring')
const route = read('src/app/api/kiosk/menu/route.ts')
check('the endpoint is read-only: GET and OPTIONS only', /export async function GET/.test(route) && /export function OPTIONS/.test(route) && !/export (async )?function (POST|PUT|PATCH|DELETE)/.test(route))
check('the endpoint answers "unchanged" for a known version', /unchanged: true/.test(route) && /searchParams\.get\('since'\)/.test(route))
check('the endpoint never takes a branch from the caller', !/searchParams\.get\('branch'\)/.test(route) && /KIOSK_BRANCH_SLUG/.test(read('src/lib/kiosk/menu.ts')))
const realtime = read('src/lib/menu/realtime.ts')
const owner = read('src/app/api/owner/menu/route.ts')
check('the dashboard already broadcasts "menu-updated" on the public menu channel', /menu-updated/.test(realtime) && /menu:\$\{branchSlug\}/.test(realtime))
check('publishing from the dashboard triggers that broadcast', /action === 'save'/.test(owner) && (owner.match(/broadcastMenuUpdated\(body\.branch\)/g) || []).length >= 2)
const sync = read('prototypes/sarcafe-kiosk-app/overrides/kiosk-sync.js')
check('the kiosk listens to that same channel and event', /menu:givat-haviva/.test(read('prototypes/sarcafe-kiosk-app/src/il/co/sarcafe/kiosk/MainActivity.java')) && /menu-updated/.test(sync))
check('the kiosk never polls', !/setInterval\([^)]*refresh/.test(sync))

console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) { console.log('FAILED:\n - ' + failures.join('\n - ')); process.exit(1) }
