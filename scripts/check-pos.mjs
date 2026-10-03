// Independent test harness for the POS's pure modules (src/lib/pos/*).
//
//   node scripts/check-pos.mjs
//
// It transpiles and runs the REAL TypeScript sources (the check-a11y.mjs
// technique) — nothing is re-implemented here. The ORACLE is not the code: it is
// docs/POS_BLUEPRINT.md, the two migrations (014/015), and the rules written in
// each module's header comment. Where a test and the code disagree, the spec
// decides which one is wrong.
//
// What it covers: money, pricing (every LineProblemCode path), modifiers,
// routing precedence, the lifecycle + card action, aging, the Ready-board rule
// (incl. privacy), validation, formatting, colours, i18n completeness, the
// zod request schemas, and — by parsing the migration text — TS<->SQL agreement
// on column lists, caps, vocabularies and patterns. It also asserts the pure
// modules stay pure (no React / Next / Supabase / DOM).
//
// Run it after touching anything in src/lib/pos or the POS migrations.

import ts from 'typescript'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { inspect, isDeepStrictEqual } from 'node:util'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const SRC = join(ROOT, 'src')
const POS = join(SRC, 'lib', 'pos')
const MENU_TYPES = join(SRC, 'lib', 'menu', 'types.ts')
const MIG_DIR = join(ROOT, 'supabase', 'migrations')
const outDir = join(tmpdir(), `check-pos-${process.pid}`)
mkdirSync(outDir, { recursive: true })
process.on('exit', () => {
  try {
    rmSync(outDir, { recursive: true, force: true })
  } catch {
    /* a leftover temp dir is harmless */
  }
})

// ---- Emit: transpile the real sources into a temp tree -------------------------------------
const ZOD_URL = import.meta.resolve('zod')
const emittedPath = (tsPath) => join(outDir, relative(SRC, tsPath)).replace(/\.ts$/, '.mjs')

// Rewrites an import specifier to the emitted .mjs copy (relative imports and the
// '@/' alias), or to zod's real location (the temp dir has no node_modules).
function rewrite(spec, tsPath, to, overrides) {
  if (overrides && spec in overrides) return overrides[spec]
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

function emit(tsPath, { to = emittedPath(tsPath), overrides } = {}) {
  const source = readFileSync(tsPath, 'utf8')
  let js = ts.transpileModule(source, {
    fileName: tsPath,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true },
  }).outputText
  js = js.replace(/(\bfrom\s+|\bimport\s+)(['"])([^'"\n]+)\2/g, (_m, kw, q, spec) => `${kw}${q}${rewrite(spec, tsPath, to, overrides)}${q}`)
  mkdirSync(dirname(to), { recursive: true })
  writeFileSync(to, js)
}

// The pure modules under test. useT.ts (React) and any browser/server-only file
// are deliberately NOT here.
const PURE_MODULES = [
  'types', 'vocab', 'money', 'pricing', 'modifiers', 'routing', 'lifecycle', 'aging',
  'board', 'validate', 'format', 'colour', 'api', 'columns', 'i18n',
]
const I18N_AREA_FILES = readdirSync(join(POS, 'i18n')).filter((f) => f.endsWith('.ts')).sort()

emit(MENU_TYPES)
for (const n of PURE_MODULES) emit(join(POS, `${n}.ts`))
for (const f of I18N_AREA_FILES) emit(join(POS, 'i18n', f))

// ---- Wave-2 modules: pure rules + the pure halves of browser/server files -----------------------
// outbox.ts / realtime.ts / client.ts are 'use client' files whose PURE halves are exported on purpose
// (their headers say so). Their only impure imports are react and the supabase browser client, which are
// replaced with inert stubs here so importing them can neither render nor open a connection.
const STUB_DIR = join(outDir, '_stubs')
mkdirSync(STUB_DIR, { recursive: true })
writeFileSync(join(STUB_DIR, 'react.mjs'), 'export const useMemo = (f) => f(); export const useSyncExternalStore = () => undefined;\n')
writeFileSync(join(STUB_DIR, 'supabase-client.mjs'), 'export const createClient = () => { throw new Error("the harness must never open a realtime connection") };\n')
const REACT_STUB = pathToFileURL(join(STUB_DIR, 'react.mjs')).href
const SUPABASE_STUB = pathToFileURL(join(STUB_DIR, 'supabase-client.mjs')).href
const WAVE2_PURE = ['cart', 'gestures', 'events', 'quick-jwt', 'client']
for (const n of WAVE2_PURE) emit(join(POS, n + '.ts'))
emit(join(POS, 'outbox.ts'), { overrides: { react: REACT_STUB } })
emit(join(POS, 'realtime.ts'), { overrides: { '@/lib/supabase/client': SUPABASE_STUB } })
emit(join(SRC, 'lib', 'menu', 'variants.ts'))
const SERVER_PURE = ['stats', 'readiness', 'signals', 'export', 'log', 'details']
for (const n of SERVER_PURE) emit(join(POS, 'server', n + '.ts'))

const load = (rel) => import(pathToFileURL(join(outDir, rel)).href)
const M = {
  types: await load('lib/pos/types.mjs'),
  vocab: await load('lib/pos/vocab.mjs'),
  money: await load('lib/pos/money.mjs'),
  pricing: await load('lib/pos/pricing.mjs'),
  modifiers: await load('lib/pos/modifiers.mjs'),
  routing: await load('lib/pos/routing.mjs'),
  lifecycle: await load('lib/pos/lifecycle.mjs'),
  aging: await load('lib/pos/aging.mjs'),
  board: await load('lib/pos/board.mjs'),
  validate: await load('lib/pos/validate.mjs'),
  format: await load('lib/pos/format.mjs'),
  colour: await load('lib/pos/colour.mjs'),
  api: await load('lib/pos/api.mjs'),
  columns: await load('lib/pos/columns.mjs'),
  i18n: await load('lib/pos/i18n.mjs'),
}

const { LIMITS, AGING, UNDO, REFRESH, OUTBOX, STATION, DASHBOARD, RATE, RETENTION } = M.vocab
const {
  toAgorot, parseMoneyToAgorot, priceChoices, parseDeltaAgorot, formatAgorot, formatDelta, lineTotalAgorot,
} = M.money
const { priceLine, lineMergeKey, findItem } = M.pricing
const {
  groupsForItem, availableOptions, groupBounds, maxOptionQty, defaultSelections, needsCustomize, blockingGroup,
  validateSelections, snapshotsDelta, describeModifier, selectionSignature,
} = M.modifiers
const { resolveRoute, routeMenu, unroutedItems, summarizePoint, categoryOwners, itemOwners } = M.routing
const L = M.lifecycle
const A = M.aging
const { boardEntries, firstName, preparingCount, FIRST_NAME_MAX } = M.board
const V = M.validate
const F = M.format
const { staffColourMap, handleInitial } = M.colour

// ---- Output (same style as check-a11y.mjs) ---------------------------------------------------
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
const section = (title) => console.log(`\n${title}`)
function eq(name, actual, expected) {
  const ok = isDeepStrictEqual(actual, expected)
  check(name, ok, ok ? '' : `got ${show(actual)}, want ${show(expected)}`)
}
function throwsNot(name, fn) {
  try {
    fn()
    check(name, true)
  } catch (e) {
    check(name, false, `threw ${String(e && e.message).slice(0, 120)}`)
  }
}
/** Runs `predicate` over every item and records ONE check naming the first counter-example. */
function sweep(name, items, predicate) {
  let bad = null
  let found = false
  let err = ''
  let n = 0
  for (const item of items) {
    n++
    let ok
    try {
      ok = predicate(item)
    } catch (e) {
      ok = false
      err = ` (threw ${String(e && e.message).slice(0, 100)})`
    }
    if (!ok) {
      bad = item
      found = true
      break
    }
  }
  check(`${name} (${n} cases)`, !found, found ? `first counter-example: ${show(bad)}${err}` : '')
}
// Small seeded PRNG (mulberry32) so a failing property is reproducible.
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)]
const shuffle = (r, arr) => {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ---- Spec text, parsed once -------------------------------------------------------------------
function stripSqlComments(s) {
  let out = ''
  let inQ = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQ) {
      out += c
      if (c === "'") inQ = false
      continue
    }
    if (c === "'") {
      inQ = true
      out += c
      continue
    }
    if (c === '-' && s[i + 1] === '-') {
      while (i < s.length && s[i] !== '\n') i++
      out += '\n'
      continue
    }
    out += c
  }
  return out
}
const migrationFiles = readdirSync(MIG_DIR).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()
const posMigrationFiles = migrationFiles.filter((f) => Number(f.slice(0, 3)) >= 14 && /pos/.test(f))
const SQL = posMigrationFiles.map((f) => stripSqlComments(readFileSync(join(MIG_DIR, f), 'utf8'))).join('\n')
const SQL_014 = stripSqlComments(readFileSync(join(MIG_DIR, '014_pos_core.sql'), 'utf8'))
const SQL_015 = stripSqlComments(readFileSync(join(MIG_DIR, '015_pos_modifiers.sql'), 'utf8'))
const TYPES_SRC = readFileSync(join(POS, 'types.ts'), 'utf8')
const MENU_TYPES_SRC = readFileSync(MENU_TYPES, 'utf8')
const API_SRC = readFileSync(join(POS, 'api.ts'), 'utf8')

// =====================================================================================
// money.ts
// =====================================================================================
section('money.ts — parseMoneyToAgorot')
for (const [input, want] of [
  ['12,5', 1250], ['12.50', 1250], ['12,50', 1250], [' 7 ', 700], ['7', 700], ['0', 0], ['0,05', 5],
  ['-5', -500], ['-0,5', -50],
]) eq(`${show(input)} -> ${want}`, parseMoneyToAgorot(input), want)
for (const input of ['abc', '', '   ', '1.234', '1,234', '12.', '.5', '1e3', '1 2', '₪12', '١٢', '12,5,1', '--5']) {
  eq(`${show(input)} is not a plain amount -> null`, parseMoneyToAgorot(input), null)
}
eq('number 12.5 -> 1250', parseMoneyToAgorot(12.5), 1250)
eq('number 19.99 -> 1999', parseMoneyToAgorot(19.99), 1999)
eq('negative number -3 -> -300 (a delta may be negative)', parseMoneyToAgorot(-3), -300)
for (const input of [NaN, Infinity, -Infinity, undefined, null, {}, [], true]) {
  eq(`${show(input)} -> null`, parseMoneyToAgorot(input), null)
}

section('money.ts — toAgorot (round the UNIT, once)')
eq('19.99 -> 1999 (floating point must not leak: 19.99*100 = 1998.9999…)', toAgorot(19.99), 1999)
eq('0.1 + 0.2 -> 30', toAgorot(0.1 + 0.2), 30)
eq('₪87 -> 8700 agorot, not 87', toAgorot(87), 8700)
eq('0 -> 0', toAgorot(0), 0)
eq('-1.5 -> -150', toAgorot(-1.5), -150)
check('1.005 is an integer within one agorot of the half-way point', Number.isInteger(toAgorot(1.005)) && Math.abs(toAgorot(1.005) - 100.5) <= 0.5)
eq('0.335 follows the spec formula Math.round(shekels x 100)', toAgorot(0.335), Math.round(0.335 * 100))
sweep('every whole number of agorot survives shekels -> agorot', Array.from({ length: 200001 }, (_, i) => i), (c) => toAgorot(c / 100) === c)
sweep('format -> parse round-trips every amount up to ₪300', Array.from({ length: 30001 }, (_, i) => i), (c) => parseMoneyToAgorot(formatAgorot(c).slice(1)) === c)

section('money.ts — priceChoices (a slash string is N prices)')
eq('15 -> [1500]', priceChoices(15), [1500])
eq('14.5 -> [1450]', priceChoices(14.5), [1450])
eq('"14/16" -> two prices', priceChoices('14/16'), [1400, 1600])
eq('"14 / 16" tolerates spaces', priceChoices('14 / 16'), [1400, 1600])
eq('" 14/16 " tolerates outer spaces', priceChoices(' 14/16 '), [1400, 1600])
eq('"14/16/18" -> three prices', priceChoices('14/16/18'), [1400, 1600, 1800])
eq('"12,5/14" accepts a comma decimal inside a range', priceChoices('12,5/14'), [1250, 1400])
eq('a numeric string "14" is one price', priceChoices('14'), [1400])
eq('0 is a price (free, sellable)', priceChoices(0), [0])
for (const input of ['14/abc', '', '   ', null, undefined, 'לפי משקל', '14/', '/16', '14//16', -5, '-5', '14/-2', NaN, Infinity, '₪14']) {
  eq(`${show(input)} is not sellable -> null`, priceChoices(input), null)
}
sweep('a number c/100 is exactly [c]', Array.from({ length: 100001 }, (_, i) => i), (c) => isDeepStrictEqual(priceChoices(c / 100), [c]))

section('money.ts — parseDeltaAgorot')
eq('undefined = 0 (no delta)', parseDeltaAgorot(undefined), 0)
eq('null = 0', parseDeltaAgorot(null), 0)
eq('"" = 0', parseDeltaAgorot(''), 0)
eq('2 -> 200', parseDeltaAgorot(2), 200)
eq('-1 -> -100 (a discount)', parseDeltaAgorot(-1), -100)
eq('"1.5" -> 150', parseDeltaAgorot('1.5'), 150)
eq('"-1,5" -> -150', parseDeltaAgorot('-1,5'), -150)
eq('"abc" -> null (unparseable, not 0)', parseDeltaAgorot('abc'), null)
eq('NaN -> null', parseDeltaAgorot(NaN), null)

section('money.ts — formatAgorot / formatDelta / the unit-in-the-name rule')
eq('5 -> ₪0.05', formatAgorot(5), '₪0.05')
eq('1 -> ₪0.01', formatAgorot(1), '₪0.01')
eq('10 -> ₪0.10', formatAgorot(10), '₪0.10')
eq('100 -> ₪1', formatAgorot(100), '₪1')
eq('1005 -> ₪10.05', formatAgorot(1005), '₪10.05')
eq('1500 -> ₪15 (no trailing .00)', formatAgorot(1500), '₪15')
eq('1250 -> ₪12.50', formatAgorot(1250), '₪12.50')
eq('0 -> ₪0', formatAgorot(0), '₪0')
eq('99999 -> ₪999.99', formatAgorot(99999), '₪999.99')
eq('500000 -> ₪5000', formatAgorot(500000), '₪5000')
check('-150 -> a minus, the sign, ₪1.50', /^[-−]₪1\.50$/.test(formatAgorot(-150)), `got ${formatAgorot(-150)}`)
check('-5 -> a minus then ₪0.05', /^[-−]₪0\.05$/.test(formatAgorot(-5)), `got ${formatAgorot(-5)}`)
eq('₪87 formats as ₪87 (toAgorot(87) = 8700), not ₪0.87', formatAgorot(toAgorot(87)), '₪87')
eq('87 AGOROT is ₪0.87 — the unit decides, not the digits', formatAgorot(87), '₪0.87')
eq('formatDelta(0) is empty', formatDelta(0), '')
eq('formatDelta(200) -> +₪2', formatDelta(200), '+₪2')
eq('formatDelta(150) -> +₪1.50', formatDelta(150), '+₪1.50')
check('formatDelta(-100) carries a minus and ₪1', /^[-−]₪1$/.test(formatDelta(-100)), `got ${formatDelta(-100)}`)
eq('lineTotalAgorot = unit x qty', lineTotalAgorot(1500, 3), 4500)
eq('lineTotalAgorot of a free line is 0', lineTotalAgorot(0, 5), 0)

// =====================================================================================
// Shared fixtures for pricing / modifiers / routing
// =====================================================================================
const T = (he, en = '', ar = '') => ({ he, en, ar })
const mkItem = (uid, he, price, extra = {}) => ({ uid, he, en: `${he}-en`, ar: `${he}-ar`, price, ...extra })
const mkCat = (id, items, extra = {}) => ({ id, title: { he: `${id}-he`, en: `${id}-en`, ar: `${id}-ar` }, items, ...extra })
const pt = (id, extra = {}) => ({ id, active: true, excluded_uids: [], ...extra })
const rt = (kind, ref, point_id) => ({ kind, ref, point_id })
const opt = (uid, he, extra = {}) => ({ uid, he, en: `${he}-en`, ar: `${he}-ar`, ...extra })
const grp = (uid, kind, extra = {}) => ({
  uid, kind, title: T(`${uid}-he`, `${uid}-en`, `${uid}-ar`), required: false, multiple: false, options: [], ...extra,
})
const menuName = (it) => ({ he: it.he, en: it.en, ar: it.ar })
const mkCtx = ({ categories, groups = [], points = [pt('p1'), pt('p2'), pt('pOff', { active: false })], routes = [], unsold = [] }) => ({
  categories, modifierGroups: groups, routing: { points, routes, unsold },
})

// Every problem code any check below makes the code produce — used at the end to
// prove no LineProblemCode path was left untested.
const seenProblems = new Set()
const price = (input, c) => {
  const r = priceLine(input, c)
  if (!r.ok) seenProblems.add(r.problem.code)
  return r
}
const selectOk = (groups, selections) => {
  const r = validateSelections(groups, selections)
  if (!r.ok) seenProblems.add(r.problem.code)
  return r
}
const code = (r) => (r.ok ? 'ok' : r.problem.code)

// The modifier library used by the latte.
const gSize = grp('g-size', 'choice', { required: true, options: [opt('s', 'קטן', { default: true }), opt('m', 'בינוני', { priceDelta: 2 }), opt('l', 'גדול', { priceDelta: 4 })] })
const gShot = grp('g-shot', 'add', { multiple: true, options: [opt('shot', 'שוט', { priceDelta: 3, maxQty: 3 }), opt('syrup', 'סירופ', { priceDelta: 1.5 }), opt('cream', 'שמנת', { priceDelta: 0 })] })
const gNoIce = grp('g-noice', 'remove', { multiple: true, options: [opt('noice', 'בלי קרח'), opt('nosugar', 'בלי סוכר')] })
const gMilk = grp('g-milk', 'substitute', { source: T('חלב', 'milk', 'حليب'), options: [opt('oat', 'שיבולת', { priceDelta: 2 }), opt('soy', 'סויה', { priceDelta: 2 }), opt('almond', 'שקד', { priceDelta: 3, available: false })] })
const gHeat = grp('g-heat', 'prep', { options: [opt('hot', 'חם מאוד'), opt('warm', 'פושר')] })
const gBread = grp('g-bread', 'choice', { required: true, options: [opt('white', 'לבן'), opt('whole', 'מלא')] })
const gTopping = grp('g-top', 'add', { multiple: true, min: 1, max: 2, options: [opt('t1', 'א'), opt('t2', 'ב'), opt('t3', 'ג')] })
const gEmpty = grp('g-empty', 'add', { options: [] })
const gBig = grp('g-big', 'add', { options: [opt('big', 'ענק', { priceDelta: 6000 })] })
const gNeg = grp('g-neg', 'add', { options: [opt('neg', 'הנחה', { priceDelta: -6000 })] })
const gCoupon = grp('g-coupon', 'add', { options: [opt('coupon', 'קופון', { priceDelta: -10 })] })
const gLux = grp('g-lux', 'add', { options: [opt('lux', 'פאר', { priceDelta: 4995 })] })
const LIBRARY = [gSize, gShot, gNoIce, gMilk, gHeat, gBread, gTopping, gEmpty, gBig, gNeg, gCoupon, gLux]

// =====================================================================================
// pricing.ts — priceLine
// =====================================================================================
const cola = mkItem('i-cola', 'קולה', 8)
const beer = mkItem('i-beer', 'בירה', '14/16')
const gone = mkItem('i-gone', 'אזל', 5, { available: false })
const zeroStock = mkItem('i-zero', 'מלאי-אפס', 5, { quantity: 0 })
const stocked = mkItem('i-stock', 'במלאי', 5, { quantity: 3, available: true })
const weigh = mkItem('i-text', 'משקל', 'לפי משקל')
const noPrice = mkItem('i-noprice', 'ללא-מחיר', null)
const emptyPrice = mkItem('i-emptyprice', 'מחיר-ריק', '')
const slashBad = mkItem('i-slashbad', 'טווח-שבור', '14/abc')
const negPrice = mkItem('i-neg', 'מחיר-שלילי', -5)
const freeItem = mkItem('i-free', 'חינם', 0)
const special = mkItem('i-special', 'מיוחד', 30)
const excluded = mkItem('i-excl', 'מוחרג', 9)
const expensive = mkItem('i-exp', 'יקר', 5000)
const tooExpensive = mkItem('i-toexp', 'יקר-מדי', 5000.01)
const fractional = mkItem('i-frac', 'שברים', 0.335)
const unsoldByItem = mkItem('i-unsold2', 'לא-נמכר-פריט', 7)
const offRouted = mkItem('i-off', 'מנותב-לכבויה', 7)
const slashTyped = mkItem('i-slash-typed', 'שייק', '10/12', { types: [{ uid: 't-a', he: 'א', en: 'A', ar: 'ا', priceDelta: 1 }] })
const heOnly = { uid: 'i-heonly', he: 'עברית-בלבד', price: 6 }
const toast = mkItem('i-toast', 'טוסט', 20, {
  types: [
    { uid: 't-cheese', he: 'גבינה', en: 'Cheese', ar: 'جبنة', priceDelta: 2 },
    { uid: 't-ham', he: 'נקניק', en: 'Ham', ar: 'لحم', priceDelta: '1.5' },
    { uid: 't-plain', he: 'רגיל', en: 'Plain', ar: 'عادي' },
    { uid: 't-off', he: 'כבוי', priceDelta: 0, available: false },
    { uid: 't-zero', he: 'אפס', quantity: 0 },
    { uid: 't-bad', he: 'שבור', priceDelta: 'abc' },
    { uid: 't-neg', he: 'הנחה', priceDelta: -30 },
  ],
})
const toastAllGone = mkItem('i-toast-gone', 'טוסט-אזל', 20, { types: [{ uid: 'x1', he: 'א', available: false }, { uid: 'x2', he: 'ב', quantity: 0 }] })
const toastEmptyTypes = mkItem('i-toast-empty', 'טוסט-ריק', 20, { types: [] })
const orphan = mkItem('i-orphan', 'יתום', 7)
const unsoldByCat = mkItem('i-unsold1', 'לא-נמכר-קטגוריה', 7)

const drinks = mkCat('c-drinks', [cola, beer, gone, zeroStock, stocked, weigh, noPrice, emptyPrice, slashBad, negPrice, freeItem, special, excluded, expensive, tooExpensive, fractional, unsoldByItem, offRouted, slashTyped, heOnly])
const toasts = mkCat('c-toast', [toast, toastAllGone, toastEmptyTypes])
const orphanCat = mkCat('c-orphan', [orphan])
const unsoldCat = mkCat('c-unsold', [unsoldByCat])
const baseCtx = mkCtx({
  categories: [drinks, toasts, orphanCat, unsoldCat],
  points: [pt('p1', { excluded_uids: ['i-excl'] }), pt('p2'), pt('pOff', { active: false })],
  routes: [rt('category', 'c-drinks', 'p1'), rt('category', 'c-toast', 'p2'), rt('item', 'i-special', 'p2'), rt('item', 'i-off', 'pOff')],
  unsold: ['c:c-unsold', 'i:i-unsold2'],
})
const expectCode = (name, input, expected, c = baseCtx) => eq(name, code(price(input, c)), expected)

section('pricing.ts — priceLine: every refusal')
expectCode('an unknown item -> unknown_item', { itemUid: 'nope', qty: 1 }, 'unknown_item')
eq('unknown_item carries the offending uid', price({ itemUid: 'nope', qty: 1 }, baseCtx).problem, { code: 'unknown_item', itemUid: 'nope' })
expectCode('available:false -> sold_out', { itemUid: 'i-gone', qty: 1 }, 'sold_out')
expectCode('quantity:0 -> sold_out (stock hit zero)', { itemUid: 'i-zero', qty: 1 }, 'sold_out')
eq('sold_out carries the item uid', price({ itemUid: 'i-gone', qty: 1 }, baseCtx).problem?.itemUid, 'i-gone')
expectCode('quantity > 0 with available:true is sellable', { itemUid: 'i-stock', qty: 1 }, 'ok')
expectCode('an item with no uid-route at all -> no_point', { itemUid: 'i-orphan', qty: 1 }, 'no_point')
expectCode('an item routed to an INACTIVE point -> no_point (unrouted)', { itemUid: 'i-off', qty: 1 }, 'no_point')
expectCode('a category the owner marked unsold -> not_sold', { itemUid: 'i-unsold1', qty: 1 }, 'not_sold')
expectCode('an item the owner marked unsold inside a routed category -> not_sold', { itemUid: 'i-unsold2', qty: 1 }, 'not_sold')
expectCode('an item its point opted out of (excluded) -> not_sold', { itemUid: 'i-excl', qty: 1 }, 'not_sold')
expectCode('a text price -> no_price', { itemUid: 'i-text', qty: 1 }, 'no_price')
expectCode('a null price -> no_price', { itemUid: 'i-noprice', qty: 1 }, 'no_price')
expectCode('an empty-string price -> no_price', { itemUid: 'i-emptyprice', qty: 1 }, 'no_price')
expectCode('a half-numeric slash price ("14/abc") -> no_price', { itemUid: 'i-slashbad', qty: 1 }, 'no_price')
expectCode('a negative price -> no_price', { itemUid: 'i-neg', qty: 1 }, 'no_price')
for (const bad of [undefined, null, 2, -1, 1.5, NaN, '1', 99]) {
  expectCode(`slash price with priceChoice ${show(bad)} -> needs_price_choice`, { itemUid: 'i-beer', qty: 1, priceChoice: bad }, 'needs_price_choice')
}
expectCode('slash price with no priceChoice key at all -> needs_price_choice', { itemUid: 'i-beer', qty: 1 }, 'needs_price_choice')
expectCode('a type-bearing item with no typeUid -> needs_type', { itemUid: 'i-toast', qty: 1 }, 'needs_type')
expectCode('an empty-string typeUid counts as none -> needs_type', { itemUid: 'i-toast', qty: 1, typeUid: '' }, 'needs_type')
expectCode('an unknown typeUid -> unknown_type', { itemUid: 'i-toast', qty: 1, typeUid: 'zzz' }, 'unknown_type')
expectCode('a typeUid on an item that has no types -> unknown_type', { itemUid: 'i-cola', qty: 1, typeUid: 'zzz' }, 'unknown_type')
expectCode('a typeUid on an item whose types list is empty -> unknown_type', { itemUid: 'i-toast-empty', qty: 1, typeUid: 'zzz' }, 'unknown_type')
expectCode('an empty types list means "no types": the item sells plainly', { itemUid: 'i-toast-empty', qty: 1 }, 'ok')
expectCode('a type with available:false -> type_sold_out', { itemUid: 'i-toast', qty: 1, typeUid: 't-off' }, 'type_sold_out')
expectCode('a type with quantity:0 -> type_sold_out', { itemUid: 'i-toast', qty: 1, typeUid: 't-zero' }, 'type_sold_out')
expectCode('EVERY type sold out -> the item itself is sold_out', { itemUid: 'i-toast-gone', qty: 1 }, 'sold_out')
expectCode('a type whose delta is text -> no_price', { itemUid: 'i-toast', qty: 1, typeUid: 't-bad' }, 'no_price')
expectCode('a type delta that drives the unit below zero -> no_price', { itemUid: 'i-toast', qty: 1, typeUid: 't-neg' }, 'no_price')
for (const bad of [0, 100, 1.5, NaN, -1, '2', null, undefined, Infinity, 1000]) {
  expectCode(`qty ${show(bad)} -> bad_qty`, { itemUid: 'i-cola', qty: bad }, 'bad_qty')
}
expectCode('qty 1 is fine', { itemUid: 'i-cola', qty: 1 }, 'ok')
expectCode('qty 99 is fine (the cap is inclusive)', { itemUid: 'i-cola', qty: 99 }, 'ok')
expectCode('bad qty on a custom line -> bad_qty', { custom: { name: 'x', priceAgorot: 100, pointId: 'p1' }, qty: 0 }, 'bad_qty')
expectCode('₪5000.00 per unit is the ceiling and is allowed', { itemUid: 'i-exp', qty: 1 }, 'ok')
expectCode('₪5000.01 per unit is over the ceiling -> no_price', { itemUid: 'i-toexp', qty: 1 }, 'no_price')

section('pricing.ts — priceLine: custom (hand-typed) items')
const customIn = (over = {}, c = {}) => ({ custom: { name: 'מים', priceAgorot: 0, pointId: 'p2', ...c }, qty: 1, ...over })
const freeWater = price(customIn(), baseCtx)
check('price 0 is valid: free tap water needs a real line', freeWater.ok === true)
eq('a custom line is routed to the CHOSEN active point', freeWater.line?.point_id, 'p2')
eq('a custom line has no catalogue identity', [freeWater.line?.item_uid, freeWater.line?.category_id, freeWater.line?.type_uid, freeWater.line?.variant_label], [null, null, null, null])
eq('a custom line carries is_custom and no modifiers (the DB refuses modifiers on one)', [freeWater.line?.is_custom, freeWater.line?.modifiers], [true, []])
eq('custom unit and base are the typed price', [freeWater.line?.unit_agorot, freeWater.line?.base_agorot], [0, 0])
check('the typed name is the display name (he is what the audit picks first)', (freeWater.line?.name?.he || freeWater.line?.name?.en || freeWater.line?.name?.ar) === 'מים')
expectCode('custom price 99999 (₪999.99) is the ceiling and is allowed', customIn({}, { priceAgorot: 99999 }), 'ok')
expectCode('custom price 100000 -> bad_custom', customIn({}, { priceAgorot: 100000 }), 'bad_custom')
expectCode('custom price -1 -> bad_custom', customIn({}, { priceAgorot: -1 }), 'bad_custom')
expectCode('custom price 12.5 (not whole agorot) -> bad_custom', customIn({}, { priceAgorot: 12.5 }), 'bad_custom')
expectCode('custom price NaN -> bad_custom', customIn({}, { priceAgorot: NaN }), 'bad_custom')
expectCode('custom price Infinity -> bad_custom', customIn({}, { priceAgorot: Infinity }), 'bad_custom')
expectCode('custom price as a string -> bad_custom', customIn({}, { priceAgorot: '100' }), 'bad_custom')
expectCode('custom empty name -> bad_custom', customIn({}, { name: '' }), 'bad_custom')
expectCode('custom whitespace name -> bad_custom', customIn({}, { name: '   ' }), 'bad_custom')
expectCode('custom unknown point -> bad_custom', customIn({}, { pointId: 'nope' }), 'bad_custom')
expectCode('custom INACTIVE point -> bad_custom', customIn({}, { pointId: 'pOff' }), 'bad_custom')
eq('custom name is trimmed', price(customIn({}, { name: '  שוקו  ' }), baseCtx).line?.name?.he, 'שוקו')
const longCustom = price(customIn({}, { name: 'ש'.repeat(200) }), baseCtx)
check('an over-long custom name is capped, not rejected', longCustom.ok && (longCustom.line.name.he || '').length > 0 && (longCustom.line.name.he || '').length <= 80)
eq('modifiers smuggled onto a custom line are ignored', price(customIn({ modifiers: [{ groupUid: 'g-size', optionUid: 'm' }] }), baseCtx).line?.modifiers, [])

section('pricing.ts — priceLine: happy paths and what comes from the MENU')
const plain = price({ itemUid: 'i-cola', qty: 2 }, baseCtx)
eq('a plain item snapshots the menu, exactly', plain.line, {
  point_id: 'p1', item_uid: 'i-cola', category_id: 'c-drinks',
  category_title: { he: 'c-drinks-he', en: 'c-drinks-en', ar: 'c-drinks-ar' },
  name: menuName(cola), type_uid: null, type_label: null, variant_label: null,
  unit_agorot: 800, base_agorot: 800, modifiers: [], qty: 2, for_name: null, note: null, is_custom: false,
})
const hostile = price({ itemUid: 'i-cola', qty: 1, name: 'HACK', price: 1, priceAgorot: 1, unit_agorot: 1, unitAgorot: 1, point_id: 'p2', pointId: 'p2', category_title: 'HACK' }, baseCtx)
eq('name, price and point come from the menu even when the input lies', [hostile.line?.name, hostile.line?.unit_agorot, hostile.line?.point_id], [menuName(cola), 800, 'p1'])
eq('an item-level route beats its category (special routes to p2 inside p1\'s category)', price({ itemUid: 'i-special', qty: 1 }, baseCtx).line?.point_id, 'p2')
eq('a missing translation is an empty string, never undefined', price({ itemUid: 'i-heonly', qty: 1 }, baseCtx).line?.name, { he: 'עברית-בלבד', en: '', ar: '' })
eq('a free catalogue item (price 0) is valid', price({ itemUid: 'i-free', qty: 1 }, baseCtx).line?.unit_agorot, 0)
const beer0 = price({ itemUid: 'i-beer', qty: 1, priceChoice: 0 }, baseCtx)
const beer1 = price({ itemUid: 'i-beer', qty: 1, priceChoice: 1 }, baseCtx)
eq('slash price, choice 0 -> ₪14 and labelled', [beer0.line?.unit_agorot, beer0.line?.base_agorot, beer0.line?.variant_label], [1400, 1400, '₪14'])
eq('slash price, choice 1 -> ₪16 and labelled', [beer1.line?.unit_agorot, beer1.line?.base_agorot, beer1.line?.variant_label], [1600, 1600, '₪16'])
const strayChoice = price({ itemUid: 'i-cola', qty: 1, priceChoice: 5 }, baseCtx)
eq('a stray priceChoice on a single-price item is ignored (no variant label)', [strayChoice.ok, strayChoice.line?.unit_agorot, strayChoice.line?.variant_label], [true, 800, null])
const tCheese = price({ itemUid: 'i-toast', qty: 1, typeUid: 't-cheese' }, baseCtx)
eq('a type adds its priceDelta: 20 + 2 = 2200', [tCheese.line?.unit_agorot, tCheese.line?.base_agorot], [2200, 2200])
eq('the type snapshot (uid + trilingual label) comes from the menu', [tCheese.line?.type_uid, tCheese.line?.type_label], ['t-cheese', { he: 'גבינה', en: 'Cheese', ar: 'جبنة' }])
eq('a string delta ("1.5") parses: 20 + 1.5 = 2150', price({ itemUid: 'i-toast', qty: 1, typeUid: 't-ham' }, baseCtx).line?.unit_agorot, 2150)
eq('a type with no delta adds nothing', price({ itemUid: 'i-toast', qty: 1, typeUid: 't-plain' }, baseCtx).line?.unit_agorot, 2000)
eq('slash price + type: choice 1 (12) + type (1) = 1300', price({ itemUid: 'i-slash-typed', qty: 1, priceChoice: 1, typeUid: 't-a' }, baseCtx).line?.unit_agorot, 1300)
eq('slash price + type: choice 0 (10) + type (1) = 1100', price({ itemUid: 'i-slash-typed', qty: 1, priceChoice: 0, typeUid: 't-a' }, baseCtx).line?.unit_agorot, 1100)
const frac3 = price({ itemUid: 'i-frac', qty: 3 }, baseCtx)
check('a fractional-agorot menu price is rounded PER UNIT to a whole number', frac3.ok && Number.isInteger(frac3.line.unit_agorot))
eq('…using Math.round(shekels x 100) (spec §7.1)', frac3.line?.unit_agorot, Math.round(0.335 * 100))
check('…so the line total is whole agorot (unit rounded BEFORE x qty)', Number.isInteger(lineTotalAgorot(frac3.line.unit_agorot, 3)))
eq('qty is copied through unchanged', price({ itemUid: 'i-cola', qty: 7 }, baseCtx).line?.qty, 7)
eq('findItem returns the item and its category', findItem(baseCtx.categories, 'i-toast')?.category.id, 'c-toast')
eq('findItem of an unknown uid is null', findItem(baseCtx.categories, 'nope'), null)

section('pricing.ts — priceLine: note and "for whom" (trimmed, capped, never a lone surrogate)')
const noteOf = (note) => price({ itemUid: 'i-cola', qty: 1, note }, baseCtx).line?.note
const forOf = (forName) => price({ itemUid: 'i-cola', qty: 1, forName }, baseCtx).line?.for_name
eq('note is trimmed', noteOf('  no foam  '), 'no foam')
eq('empty note -> null', noteOf(''), null)
eq('whitespace-only note -> null', noteOf('   '), null)
eq('null note -> null', noteOf(null), null)
eq('absent note -> null', noteOf(undefined), null)
eq('a note over 120 is capped at 120 (the DB would refuse more)', Array.from(noteOf('x'.repeat(200))).length, LIMITS.lineNoteMax)
eq('forName is trimmed', forOf('  דנה '), 'דנה')
eq('forName over 40 is capped at 40', Array.from(forOf('y'.repeat(100))).length, LIMITS.forNameMax)
eq('empty forName -> null', forOf('  '), null)
const edgeNote = noteOf('a'.repeat(119) + '😀' + 'b'.repeat(10))
check('a cap that lands inside an emoji never leaves half of it behind (JSON/Postgres would refuse a lone surrogate)', typeof edgeNote === 'string' && edgeNote.isWellFormed(), `got ${show(edgeNote)}`)
check('…and the note still honours the database cap, which counts characters', Array.from(edgeNote ?? '').length <= LIMITS.lineNoteMax)
const emojiNote = noteOf('😀'.repeat(100))
eq('100 emoji are 100 characters: well inside the 120 cap, so kept whole', Array.from(emojiNote ?? '').length, 100)
const edgeFor = forOf('b'.repeat(39) + '😀' + 'c')
check('forName cap inside an emoji is also well-formed', typeof edgeFor === 'string' && edgeFor.isWellFormed(), `got ${show(edgeFor)}`)
check('a custom line\'s note/forName are trimmed too', (() => { const r = price(customIn({ note: ' n ', forName: ' f ' }), baseCtx); return r.line?.note === 'n' && r.line?.for_name === 'f' })())

// ---- Source-text helpers (spec parsing) --------------------------------------------------------
/** The quoted members of `export type NAME = 'a' | 'b' …` (up to the next blank line / export). */
function unionMembers(src, typeName) {
  const start = src.indexOf(`export type ${typeName}`)
  if (start < 0) return null
  const rest = src.slice(start)
  const ends = [rest.indexOf('\n\n'), rest.indexOf('\nexport ', 5)].filter((i) => i > 0)
  const body = rest.slice(0, Math.min(...ends)).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1])
}
const sameSet = (a, b) => a.length === b.length && new Set(a).size === a.length && b.every((x) => a.includes(x))
const LINE_PROBLEM_CODES = unionMembers(TYPES_SRC, 'LineProblemCode')

// =====================================================================================
// pricing.ts — modifiers on a line (the arithmetic the database re-checks)
// =====================================================================================
const latte = mkItem('i-latte', 'לאטה', 15)
const espresso = mkItem('i-espresso', 'אספרסו', 8, { modifierGroupUids: [] })
const sandwich = mkItem('i-sand', 'סנדוויץ׳', 22, { modifierGroupUids: ['g-bread', 'g-noice'] })
const toppingItem = mkItem('i-topping', 'תוספות', 10, { modifierGroupUids: ['g-top'] })
const bigItem = mkItem('i-bigmod', 'פריט-זול', 1, { modifierGroupUids: ['g-big', 'g-neg'] })
const edgeItem = mkItem('i-edge', 'פריט-קצה', 8, { modifierGroupUids: ['g-coupon', 'g-lux'] })
const hotCat = mkCat('c-hot', [latte, espresso, sandwich, toppingItem, bigItem, edgeItem], { modifierGroupUids: ['g-size', 'g-shot', 'g-noice', 'g-milk', 'g-heat'] })
const fullCtx = mkCtx({
  categories: [drinks, toasts, orphanCat, unsoldCat, hotCat],
  groups: LIBRARY,
  points: [pt('p1', { excluded_uids: ['i-excl'] }), pt('p2'), pt('pOff', { active: false })],
  routes: [rt('category', 'c-drinks', 'p1'), rt('category', 'c-toast', 'p2'), rt('category', 'c-hot', 'p1'), rt('item', 'i-special', 'p2'), rt('item', 'i-off', 'pOff')],
  unsold: ['c:c-unsold', 'i:i-unsold2'],
})
const sel = (groupUid, optionUid, qty) => (qty === undefined ? { groupUid, optionUid } : { groupUid, optionUid, qty })
const snap = (g, o, over = {}) => ({
  group_uid: g.uid, group: g.title, kind: g.kind, option_uid: o.uid, label: { he: o.he, en: o.en ?? '', ar: o.ar ?? '' },
  price_delta_agorot: Math.round((o.priceDelta ?? 0) * 100), qty: 1, source: null, ...over,
})
const optOf = (g, uid) => g.options.find((o) => o.uid === uid)

section('pricing.ts — modifiers: as-is, explicit, defaults')
const asIs = price({ itemUid: 'i-latte', qty: 1 }, fullCtx)
check('as-is (modifiers undefined) is accepted when every required group has a default', asIs.ok === true, show(asIs))
eq('as-is applies exactly the defaults (size S, delta 0)', asIs.line?.modifiers, [snap(gSize, optOf(gSize, 's'))])
eq('as-is: unit = base = ₪15', [asIs.line?.unit_agorot, asIs.line?.base_agorot], [1500, 1500])
const noModsExplicit = price({ itemUid: 'i-latte', qty: 1, modifiers: [] }, fullCtx)
eq('an EXPLICIT [] does not apply defaults — the required size is then missing', code(noModsExplicit), 'modifier_required')
eq('…and names the group that is missing', noModsExplicit.problem?.groupUid, 'g-size')
eq('…and the item', noModsExplicit.problem?.itemUid, 'i-latte')
const full = [sel('g-heat', 'hot'), sel('g-milk', 'oat'), sel('g-noice', 'noice'), sel('g-shot', 'syrup'), sel('g-shot', 'shot', 2), sel('g-size', 'm')]
const fullLine = price({ itemUid: 'i-latte', qty: 1, modifiers: full }, fullCtx)
check('a full explicit selection prices', fullLine.ok === true, show(fullLine))
eq('unit = 1500 + 200 (M) + 2x300 (shot x2) + 150 (syrup) + 0 + 200 (oat) + 0 = 2650', fullLine.line?.unit_agorot, 2650)
eq('base_agorot is the price BEFORE modifiers', fullLine.line?.base_agorot, 1500)
eq('snapshots come out in group order then option order, whatever order the cashier tapped', fullLine.line?.modifiers.map((m) => m.option_uid), ['m', 'shot', 'syrup', 'noice', 'oat', 'hot'])
eq('an `add` snapshot carries its quantity and per-unit delta', fullLine.line?.modifiers[1], snap(gShot, optOf(gShot, 'shot'), { qty: 2 }))
eq('a `substitute` snapshot carries the replaced ingredient', fullLine.line?.modifiers[4], snap(gMilk, optOf(gMilk, 'oat'), { source: T('חלב', 'milk', 'حليب') }))
eq('a `remove` snapshot has a zero delta', fullLine.line?.modifiers[3], snap(gNoIce, optOf(gNoIce, 'noice')))
check('DB invariant: unit_agorot = base_agorot + sum(delta x qty)', fullLine.line.unit_agorot === fullLine.line.base_agorot + snapshotsDelta(fullLine.line.modifiers))
const full3 = price({ itemUid: 'i-latte', qty: 3, modifiers: full }, fullCtx)
eq('qty multiplies the UNIT, it does not change it: unit stays 2650, qty 3', [full3.line?.unit_agorot, full3.line?.qty], [2650, 3])
eq('…so the line total is 3 x 2650', lineTotalAgorot(full3.line.unit_agorot, full3.line.qty), 7950)
eq('a shot x3 (maxQty 3) is allowed: 1500 + 0 + 900', price({ itemUid: 'i-latte', qty: 1, modifiers: [sel('g-size', 's'), sel('g-shot', 'shot', 3)] }, fullCtx).line?.unit_agorot, 2400)
eq('a discount option (-₪10) that drives a ₪8 unit below zero -> no_price', code(price({ itemUid: 'i-edge', qty: 1, modifiers: [sel('g-coupon', 'coupon')] }, fullCtx)), 'no_price')
eq('an option (+₪4995) that pushes a ₪8 unit over ₪5000 -> no_price', code(price({ itemUid: 'i-edge', qty: 1, modifiers: [sel('g-lux', 'lux')] }, fullCtx)), 'no_price')
eq('only the NET unit price must be in range: 800 - 1000 + 499500 = 499300 is fine', price({ itemUid: 'i-edge', qty: 1, modifiers: [sel('g-coupon', 'coupon'), sel('g-lux', 'lux')] }, fullCtx).line?.unit_agorot, 499300)
eq('a single option delta beyond the database bound is refused, never emitted', [code(price({ itemUid: 'i-bigmod', qty: 1, modifiers: [sel('g-big', 'big')] }, fullCtx)) !== 'ok', code(price({ itemUid: 'i-bigmod', qty: 1, modifiers: [sel('g-neg', 'neg')] }, fullCtx)) !== 'ok'], [true, true])
eq('an item that opts out with [] has no modifiers as-is', price({ itemUid: 'i-espresso', qty: 1 }, fullCtx).line?.modifiers, [])
eq('…and a category group selected on it is unknown_modifier', code(price({ itemUid: 'i-espresso', qty: 1, modifiers: [sel('g-size', 's')] }, fullCtx)), 'unknown_modifier')
eq('an item\'s own list REPLACES the category\'s: g-size on the sandwich is unknown_modifier', code(price({ itemUid: 'i-sand', qty: 1, modifiers: [sel('g-bread', 'white'), sel('g-size', 's')] }, fullCtx)), 'unknown_modifier')
eq('a required group with no default makes as-is fail: modifier_required on g-bread', [code(price({ itemUid: 'i-sand', qty: 1 }, fullCtx)), price({ itemUid: 'i-sand', qty: 1 }, fullCtx).problem?.groupUid], ['modifier_required', 'g-bread'])
eq('…and choosing it fixes it', code(price({ itemUid: 'i-sand', qty: 1, modifiers: [sel('g-bread', 'whole')] }, fullCtx)), 'ok')
eq('multi group with min 1 / max 2: none -> modifier_required', code(price({ itemUid: 'i-topping', qty: 1, modifiers: [] }, fullCtx)), 'modifier_required')
eq('…one is fine', code(price({ itemUid: 'i-topping', qty: 1, modifiers: [sel('g-top', 't1')] }, fullCtx)), 'ok')
eq('…two is fine', code(price({ itemUid: 'i-topping', qty: 1, modifiers: [sel('g-top', 't1'), sel('g-top', 't3')] }, fullCtx)), 'ok')
eq('…three is modifier_too_many', code(price({ itemUid: 'i-topping', qty: 1, modifiers: [sel('g-top', 't1'), sel('g-top', 't2'), sel('g-top', 't3')] }, fullCtx)), 'modifier_too_many')
eq('an unavailable option -> modifier_unavailable (and names it)', price({ itemUid: 'i-latte', qty: 1, modifiers: [sel('g-size', 's'), sel('g-milk', 'almond')] }, fullCtx).problem, { code: 'modifier_unavailable', groupUid: 'g-milk', optionUid: 'almond', itemUid: 'i-latte' })
eq('an unknown option -> unknown_modifier', code(price({ itemUid: 'i-latte', qty: 1, modifiers: [sel('g-size', 'zzz')] }, fullCtx)), 'unknown_modifier')
eq('an unknown group -> unknown_modifier', code(price({ itemUid: 'i-latte', qty: 1, modifiers: [sel('g-nope', 's')] }, fullCtx)), 'unknown_modifier')
eq('two different options of a single-choice group -> modifier_too_many', code(price({ itemUid: 'i-latte', qty: 1, modifiers: [sel('g-size', 's'), sel('g-size', 'm')] }, fullCtx)), 'modifier_too_many')
eq('the same option twice -> modifier_too_many', code(price({ itemUid: 'i-latte', qty: 1, modifiers: [sel('g-size', 's'), sel('g-noice', 'noice'), sel('g-noice', 'noice')] }, fullCtx)), 'modifier_too_many')
eq('a quantity above the option\'s maxQty -> modifier_qty', code(price({ itemUid: 'i-latte', qty: 1, modifiers: [sel('g-size', 's'), sel('g-shot', 'shot', 4)] }, fullCtx)), 'modifier_qty')
eq('quantity 2 on an add with no maxQty -> modifier_qty', code(price({ itemUid: 'i-latte', qty: 1, modifiers: [sel('g-size', 's'), sel('g-shot', 'syrup', 2)] }, fullCtx)), 'modifier_qty')
eq('quantity 2 on a REMOVE -> modifier_qty (only add repeats)', code(price({ itemUid: 'i-latte', qty: 1, modifiers: [sel('g-size', 's'), sel('g-noice', 'noice', 2)] }, fullCtx)), 'modifier_qty')

section('pricing.ts — lineMergeKey (a line\'s identity)')
const base = { itemUid: 'i-beer', qty: 1 }
const keyOf = (o) => lineMergeKey({ ...base, ...o })
const differs = (name, a, b) => check(`${name} -> different lines`, keyOf(a) !== keyOf(b), `both ${keyOf(a)}`)
const same = (name, a, b) => check(`${name} -> the same line`, keyOf(a) === keyOf(b), `${keyOf(a)} vs ${keyOf(b)}`)
differs('a different price choice (₪14 vs ₪16: the same drink at two prices)', { priceChoice: 0 }, { priceChoice: 1 })
differs('a different type', { typeUid: 'a' }, { typeUid: 'b' })
differs('a type vs none', { typeUid: 'a' }, {})
differs('a different note', { note: 'a' }, { note: 'b' })
differs('a note vs none', { note: 'a' }, {})
differs('a different for-whom', { forName: 'דנה' }, { forName: 'יוסי' })
differs('a different item', { itemUid: 'x' }, { itemUid: 'y' })
differs('as-is vs an explicit empty list (defaults applied vs not)', { modifiers: undefined }, { modifiers: [] })
differs('as-is vs an explicit selection', {}, { modifiers: [sel('g-size', 's')] })
differs('a different option', { modifiers: [sel('g-size', 's')] }, { modifiers: [sel('g-size', 'm')] })
differs('a different modifier quantity', { modifiers: [sel('g-shot', 'shot', 1)] }, { modifiers: [sel('g-shot', 'shot', 2)] })
differs('one more selection', { modifiers: [sel('g-size', 's')] }, { modifiers: [sel('g-size', 's'), sel('g-heat', 'hot')] })
same('a different qty is NOT identity (it is what merging adds up)', { qty: 1 }, { qty: 5 })
same('the ORDER of modifier selections', { modifiers: [sel('g-size', 's'), sel('g-heat', 'hot'), sel('g-shot', 'shot', 2)] }, { modifiers: [sel('g-shot', 'shot', 2), sel('g-size', 's'), sel('g-heat', 'hot')] })
same('an omitted modifier qty and qty 1', { modifiers: [sel('g-size', 's')] }, { modifiers: [sel('g-size', 's', 1)] })
same('surrounding whitespace in the note', { note: ' a ' }, { note: 'a' })
same('surrounding whitespace in for-whom', { forName: ' x ' }, { forName: 'x' })
same('typeUid null vs undefined', { typeUid: null }, {})
same('priceChoice null vs undefined', { priceChoice: null }, {})
const cKey = (c = {}, o = {}) => lineMergeKey({ custom: { name: 'מים', priceAgorot: 500, pointId: 'p1', ...c }, qty: 1, ...o })
check('custom lines: a different price is a different line', cKey({ priceAgorot: 500 }) !== cKey({ priceAgorot: 600 }))
check('custom lines: a different point is a different line', cKey({ pointId: 'p1' }) !== cKey({ pointId: 'p2' }))
check('custom lines: a different name is a different line', cKey({ name: 'מים' }) !== cKey({ name: 'קפה' }))
check('custom lines: a different note is a different line', cKey({}, { note: 'a' }) !== cKey({}, { note: 'b' }))
check('custom lines: qty is not identity', cKey({}, { qty: 1 }) === cKey({}, { qty: 4 }))
check('a custom line never collides with a catalogue line', cKey() !== lineMergeKey({ itemUid: 'custom', qty: 1 }))

{
  // The strongest statement of "price is part of a line's identity": if two inputs
  // share a merge key, they MUST price to the same line (qty aside). Otherwise the
  // cart would fold two different prices into one line.
  const pool = []
  for (const itemUid of ['i-beer', 'i-toast', 'i-latte', 'i-slash-typed', 'i-cola']) {
    for (const typeUid of [undefined, 't-cheese', 't-ham', 't-a']) {
      for (const priceChoice of [undefined, 0, 1]) {
        for (const modifiers of [undefined, [], [sel('g-size', 's')], [sel('g-size', 'm')], [sel('g-size', 's'), sel('g-shot', 'shot', 2)], [sel('g-shot', 'shot', 2), sel('g-size', 's')]]) {
          for (const note of [undefined, '', 'a', ' a ', 'b']) {
            for (const forName of [undefined, 'x']) {
              for (const qty of [1, 3]) pool.push({ itemUid, typeUid, priceChoice, modifiers, note, forName, qty })
            }
          }
        }
      }
    }
  }
  const byKey = new Map()
  let conflicts = 0
  let firstConflict = null
  for (const input of pool) {
    const r = priceLine(input, fullCtx)
    const norm = JSON.stringify(r.ok ? { ok: true, line: { ...r.line, qty: 0 } } : { ok: false, code: r.problem.code })
    const k = lineMergeKey(input)
    if (!byKey.has(k)) byKey.set(k, norm)
    else if (byKey.get(k) !== norm) {
      conflicts++
      firstConflict ??= { input, key: k }
    }
  }
  check(`inputs that share a merge key always price to the same line (${pool.length} inputs, ${byKey.size} identities)`, conflicts === 0, `first conflict ${show(firstConflict)}`)
}

// =====================================================================================
// modifiers.ts
// =====================================================================================
section('modifiers.ts — groupsForItem')
const gBad = { uid: 'g-bad', kind: 'add', title: T('x'), required: false, multiple: false }
const mdoc = {
  categories: [mkCat('c1', [], { modifierGroupUids: ['g-size', 'g-nope', 'g-empty', 'g-size', 'g-shot', 'g-bad'] }), mkCat('c2', [])],
  modifierGroups: [...LIBRARY, gBad],
}
const uidsOf = (groups) => groups.map((g) => g.uid)
eq('a category list applies to an item with no list: unknown uid, empty group, malformed group skipped; a duplicate appears once', uidsOf(groupsForItem(mdoc, 'c1', mkItem('a', 'א', 1))), ['g-size', 'g-shot'])
eq('an item list REPLACES the category list', uidsOf(groupsForItem(mdoc, 'c1', mkItem('a', 'א', 1, { modifierGroupUids: ['g-heat'] }))), ['g-heat'])
eq('an item with [] means NONE (an explicit opt-out)', uidsOf(groupsForItem(mdoc, 'c1', mkItem('a', 'א', 1, { modifierGroupUids: [] }))), [])
eq('the order follows the list, not the library', uidsOf(groupsForItem(mdoc, 'c2', mkItem('a', 'א', 1, { modifierGroupUids: ['g-shot', 'g-size', 'g-heat'] }))), ['g-shot', 'g-size', 'g-heat'])
eq('a category with no list gives an item nothing', uidsOf(groupsForItem(mdoc, 'c2', mkItem('a', 'א', 1))), [])
eq('an unknown category id gives an item with no list nothing', uidsOf(groupsForItem(mdoc, 'zzz', mkItem('a', 'א', 1))), [])
eq('…but an item with its own list still works under an unknown category', uidsOf(groupsForItem(mdoc, 'zzz', mkItem('a', 'א', 1, { modifierGroupUids: ['g-size'] }))), ['g-size'])
eq('a doc with no modifierGroups library gives nothing', uidsOf(groupsForItem({ categories: mdoc.categories }, 'c1', mkItem('a', 'א', 1))), [])
eq('a duplicated uid inside an item list is applied once', uidsOf(groupsForItem(mdoc, 'c2', mkItem('a', 'א', 1, { modifierGroupUids: ['g-size', 'g-size', 'g-shot'] }))), ['g-size', 'g-shot'])
eq('a null item list falls back to the category (JSON null is "absent", not "none")', uidsOf(groupsForItem(mdoc, 'c1', mkItem('a', 'א', 1, { modifierGroupUids: null }))), ['g-size', 'g-shot'])

section('modifiers.ts — groupBounds')
const g4 = (extra) => grp('gb', 'add', { options: [opt('a', 'א'), opt('b', 'ב'), opt('c', 'ג'), opt('d', 'ד')], ...extra })
eq('required + single -> 1..1', groupBounds(g4({ required: true })), { min: 1, max: 1 })
eq('optional + single -> 0..1', groupBounds(g4({})), { min: 0, max: 1 })
eq('optional + multiple, no max -> 0..options.length', groupBounds(g4({ multiple: true })), { min: 0, max: 4 })
eq('required + multiple, no max -> 1..options.length', groupBounds(g4({ required: true, multiple: true })), { min: 1, max: 4 })
eq('multiple with min 2 / max 3', groupBounds(g4({ multiple: true, min: 2, max: 3 })), { min: 2, max: 3 })
eq('multiple with min 2 and no max -> 2..options.length', groupBounds(g4({ multiple: true, min: 2 })), { min: 2, max: 4 })
eq('max is never below min (min 3, max 1)', groupBounds(g4({ multiple: true, min: 3, max: 1 })), { min: 3, max: 3 })
eq('required forces min >= 1 even when min is 0', groupBounds(g4({ required: true, multiple: true, min: 0 })), { min: 1, max: 4 })
eq('a single group ignores a larger max', groupBounds(g4({ max: 5 })), { min: 0, max: 1 })
eq('an explicit min on a non-required group still binds', groupBounds(g4({ multiple: true, min: 1 })).min, 1)

section('modifiers.ts — defaultSelections / needsCustomize / blockingGroup')
eq('defaults of a required group are what as-is picks', defaultSelections([gSize]), [{ groupUid: 'g-size', optionUid: 's', qty: 1 }])
eq('no groups -> no selections', defaultSelections([]), [])
eq('a group with no defaults selects nothing', defaultSelections([gShot, gBread]), [])
const twoDefaults = grp('gd', 'choice', { options: [opt('a', 'א', { default: true }), opt('b', 'ב', { default: true })] })
eq('a single group with two defaults takes only the first (max 1)', defaultSelections([twoDefaults]), [{ groupUid: 'gd', optionUid: 'a', qty: 1 }])
const multiDefaults = grp('gm', 'add', { multiple: true, max: 2, options: [opt('a', 'א', { default: true }), opt('b', 'ב', { default: true }), opt('c', 'ג', { default: true })] })
eq('a multi group respects max (2 of 3 defaults, in option order)', defaultSelections([multiDefaults]).map((s) => s.optionUid), ['a', 'b'])
const unavailDefault = grp('gu', 'choice', { options: [opt('a', 'א', { default: true, available: false }), opt('b', 'ב', { default: true })] })
eq('an unavailable default is skipped (the next available default wins)', defaultSelections([unavailDefault]).map((s) => s.optionUid), ['b'])
eq('needsCustomize: no groups -> false', needsCustomize([]), false)
eq('needsCustomize: a required group WITH a default -> false (one tap is enough)', needsCustomize([gSize]), false)
eq('needsCustomize: a required group with NO default -> true', needsCustomize([gBread]), true)
eq('needsCustomize: an optional group with no default -> false', needsCustomize([gShot, gHeat]), false)
eq('needsCustomize: one satisfied + one unsatisfied required -> true', needsCustomize([gSize, gBread]), true)
eq('needsCustomize: min 2 with a single default -> true', needsCustomize([grp('g2', 'add', { required: true, multiple: true, min: 2, options: [opt('a', 'א', { default: true }), opt('b', 'ב'), opt('c', 'ג')] })]), true)
eq('needsCustomize: the only default is unavailable -> true', needsCustomize([grp('g3', 'choice', { required: true, options: [opt('a', 'א', { default: true, available: false }), opt('b', 'ב')] })]), true)
eq('availableOptions drops available:false and keeps undefined/true', availableOptions(gMilk).map((o) => o.uid), ['oat', 'soy'])
const allGone = grp('gx', 'choice', { required: true, options: [opt('a', 'א', { available: false }), opt('b', 'ב', { available: false })] })
eq('blockingGroup: a required group with nothing available blocks the item', blockingGroup([gSize, allGone])?.uid, 'gx')
eq('blockingGroup: a required group with one available option does not block', blockingGroup([gSize]), null)
eq('blockingGroup: an OPTIONAL group with nothing available does not block', blockingGroup([grp('gy', 'add', { options: [opt('a', 'א', { available: false })] })]), null)
eq('blockingGroup: min 2 with only one available option blocks', blockingGroup([grp('gz', 'add', { required: true, multiple: true, min: 2, options: [opt('a', 'א'), opt('b', 'ב', { available: false })] })])?.uid, 'gz')
eq('blockingGroup: no groups -> null', blockingGroup([]), null)

section('modifiers.ts — maxOptionQty')
eq('an add with no maxQty repeats once', maxOptionQty(gShot, optOf(gShot, 'syrup')), 1)
eq('an add with maxQty 3', maxOptionQty(gShot, optOf(gShot, 'shot')), 3)
eq('maxQty is capped by the database limit (9)', maxOptionQty(gShot, opt('big', 'x', { maxQty: 50 })), LIMITS.modifierQtyMax)
eq('maxQty 0 still allows one', maxOptionQty(gShot, opt('z', 'x', { maxQty: 0 })), 1)
eq('a fractional maxQty floors (2.7 -> 2)', maxOptionQty(gShot, opt('z', 'x', { maxQty: 2.7 })), 2)
eq('only `add` may repeat: remove with maxQty 5 -> 1', maxOptionQty(gNoIce, opt('z', 'x', { maxQty: 5 })), 1)
eq('only `add` may repeat: choice with maxQty 5 -> 1', maxOptionQty(gSize, opt('z', 'x', { maxQty: 5 })), 1)
eq('only `add` may repeat: substitute with maxQty 5 -> 1', maxOptionQty(gMilk, opt('z', 'x', { maxQty: 5 })), 1)

section('modifiers.ts — validateSelections')
const latteGroups = [gSize, gShot, gNoIce, gMilk, gHeat]
const v1 = selectOk(latteGroups, [sel('g-heat', 'hot'), sel('g-size', 'l'), sel('g-shot', 'cream'), sel('g-shot', 'shot', 2)])
check('a valid selection is ok', v1.ok === true)
eq('snapshots are in group order, then each group\'s OPTION order (shot before cream)', v1.snapshots?.map((m) => `${m.group_uid}:${m.option_uid}`), ['g-size:l', 'g-shot:shot', 'g-shot:cream', 'g-heat:hot'])
eq('deltaAgorot is the sum of delta x qty: 400 + 2x300 + 0 + 0', v1.deltaAgorot, 1000)
eq('snapshotsDelta agrees with deltaAgorot', snapshotsDelta(v1.snapshots), v1.deltaAgorot)
eq('qty defaults to 1 on the snapshot', v1.snapshots?.find((m) => m.option_uid === 'l')?.qty, 1)
eq('a non-substitute snapshot has source null', v1.snapshots?.every((m) => m.source === null), true)
eq('the group title is snapshotted, trilingual', v1.snapshots?.[0]?.group, T('g-size-he', 'g-size-en', 'g-size-ar'))
const vSub = selectOk([gMilk], [sel('g-milk', 'soy')])
eq('a substitute carries its source', vSub.snapshots?.[0]?.source, T('חלב', 'milk', 'حليب'))
const vSubNoSource = selectOk([grp('gs', 'substitute', { options: [opt('a', 'א')] })], [sel('gs', 'a')])
eq('a substitute group with no source defined snapshots source null', vSubNoSource.snapshots?.[0]?.source, null)
const gDiscount = grp('gdisc', 'add', { options: [opt('d', 'הנחה', { priceDelta: -1.5 })] })
eq('a negative delta subtracts', selectOk([gDiscount], [sel('gdisc', 'd')]).deltaAgorot, -150)
eq('an option with a missing translation snapshots an empty string, never undefined', selectOk([grp('gt', 'prep', { options: [{ uid: 'a', he: 'חם' }] })], [sel('gt', 'a')]).snapshots?.[0]?.label, { he: 'חם', en: '', ar: '' })
eq('no selections on groups with no requirement is ok and free', selectOk([gShot, gHeat], []), { ok: true, snapshots: [], deltaAgorot: 0 })
eq('an option whose delta is text cannot be priced -> modifier_unavailable', code({ ok: false, problem: selectOk([grp('gq', 'add', { options: [opt('a', 'א', { priceDelta: 'abc' })] })], [sel('gq', 'a')]).problem }), 'modifier_unavailable')
eq('25 selections -> modifier_too_many (the line cap is 24)', selectOk(latteGroups, Array.from({ length: 25 }, () => sel('g-heat', 'hot'))).problem?.code, 'modifier_too_many')
for (const bad of [0, -1, 1.5, NaN, 2]) {
  eq(`qty ${show(bad)} on a single-quantity option -> modifier_qty`, selectOk([gNoIce], [sel('g-noice', 'noice', bad)]).problem?.code, 'modifier_qty')
}
eq('qty 9 on an add with maxQty 50 is allowed (the DB cap is 9)', selectOk([grp('gc', 'add', { options: [opt('a', 'א', { maxQty: 50 })] })], [sel('gc', 'a', 9)]).ok, true)
eq('qty 10 on an add with maxQty 50 is not (the DB accepts 1..9 only)', selectOk([grp('gc', 'add', { options: [opt('a', 'א', { maxQty: 50 })] })], [sel('gc', 'a', 10)]).problem?.code, 'modifier_qty')
eq('below the group minimum -> modifier_required, naming the group', selectOk([gSize], []).problem, { code: 'modifier_required', groupUid: 'g-size' })
eq('a required multi group with min 2 and one pick -> modifier_required', selectOk([grp('g2', 'add', { required: true, multiple: true, min: 2, options: [opt('a', 'א'), opt('b', 'ב'), opt('c', 'ג')] })], [sel('g2', 'a')]).problem?.code, 'modifier_required')
eq('above the group maximum -> modifier_too_many, naming the group', selectOk([gSize], [sel('g-size', 's'), sel('g-size', 'm')]).problem, { code: 'modifier_too_many', groupUid: 'g-size' })
eq('an unknown group is unknown_modifier, naming both ids', selectOk([gSize], [sel('g-x', 'o')]).problem, { code: 'unknown_modifier', groupUid: 'g-x', optionUid: 'o' })
eq('an unknown option in a known group is unknown_modifier', selectOk([gSize], [sel('g-size', 'zzz')]).problem, { code: 'unknown_modifier', groupUid: 'g-size', optionUid: 'zzz' })
eq('an unavailable option is modifier_unavailable', selectOk([gMilk], [sel('g-milk', 'almond')]).problem?.code, 'modifier_unavailable')
eq('a group not in the list is unknown even when it exists in the library', selectOk([gSize], [sel('g-shot', 'shot')]).problem?.code, 'unknown_modifier')
sweep('order of the selections never changes the snapshots (50 shuffles)', Array.from({ length: 50 }, (_, i) => i), (seed) => {
  const base = [sel('g-size', 'm'), sel('g-shot', 'shot', 2), sel('g-shot', 'syrup'), sel('g-noice', 'nosugar'), sel('g-milk', 'soy'), sel('g-heat', 'warm')]
  const a = validateSelections(latteGroups, base)
  const b = validateSelections(latteGroups, shuffle(rng(seed + 1), base))
  return isDeepStrictEqual(a, b)
})

section('modifiers.ts — describeModifier (read back from the snapshot)')
const mk = (kind, label, over = {}) => ({ group_uid: 'g', group: null, kind, option_uid: 'o', label, price_delta_agorot: 0, qty: 1, source: null, ...over })
eq('add, qty 1 (he): "+ label", no ×1', describeModifier(mk('add', T('שוט נוסף', 'Extra shot', 'جرعة'))), '+ שוט נוסף')
eq('add, qty 2 (he): "+ label ×2" (the card in blueprint §1a.4)', describeModifier(mk('add', T('שוט נוסף', 'Extra shot', 'جرعة'), { qty: 2 })), '+ שוט נוסף ×2')
eq('add, qty 2 (en)', describeModifier(mk('add', T('שוט נוסף', 'Extra shot', 'جرعة'), { qty: 2 }), 'en'), '+ Extra shot ×2')
eq('add, qty 3 (ar)', describeModifier(mk('add', T('שוט נוסף', 'Extra shot', 'جرعة'), { qty: 3 }), 'ar'), '+ جرعة ×3')
eq('remove (he) reads "בלי …"', describeModifier(mk('remove', T('בצל', 'onion', 'بصل'))), 'בלי בצל')
check('remove (en) reads "No …"', /^no onion$/i.test(describeModifier(mk('remove', T('בצל', 'onion', 'بصل')), 'en')), describeModifier(mk('remove', T('בצל', 'onion', 'بصل')), 'en'))
check('remove (ar) carries the Arabic "without" word and the label', (() => { const s = describeModifier(mk('remove', T('בצל', 'onion', 'بصل')), 'ar'); return s.includes('بدون') && s.includes('بصل') })())
const subSnap = mk('substitute', T('שיבולת שועל', 'oat milk', 'حليب الشوفان'), { source: T('חלב', 'milk', 'حليب') })
eq('substitute (en) reads "oat milk instead of milk" (the spec\'s own example)', describeModifier(subSnap, 'en'), 'oat milk instead of milk')
check('substitute (he) names the new thing, the old thing and "במקום"', (() => { const s = describeModifier(subSnap, 'he'); return s.includes('שיבולת שועל') && s.includes('חלב') && s.includes('במקום') })())
check('substitute (ar) names both and carries the Arabic "instead of"', (() => { const s = describeModifier(subSnap, 'ar'); return s.includes('حليب الشوفان') && s.includes('حليب') && s.includes('بدلاً من') })())
eq('substitute with no source is just the label — no dangling "instead of"', describeModifier(mk('substitute', T('שיבולת שועל', 'oat milk', '')), 'en'), 'oat milk')
eq('prep is the bare label', describeModifier(mk('prep', T('חם מאוד', 'very hot', ''))), 'חם מאוד')
eq('choice is the bare label', describeModifier(mk('choice', T('גדול', 'Large', ''))), 'גדול')
eq('a missing translation falls back to Hebrew', describeModifier(mk('prep', T('חם מאוד', '', '')), 'en'), 'חם מאוד')
eq('the default language is Hebrew', describeModifier(mk('prep', T('חם', 'hot', 'ساخن'))), 'חם')
check('describeModifier never prints "undefined" or "null" for any kind/language', (() => {
  for (const kind of ['choice', 'add', 'remove', 'substitute', 'prep']) {
    for (const lang of ['he', 'en', 'ar']) {
      const s = describeModifier(mk(kind, T('א', 'a', 'ا'), { source: kind === 'substitute' ? T('ב', 'b', 'ب') : null }), lang)
      if (/undefined|null/.test(s)) return false
    }
  }
  return true
})())

section('modifiers.ts — selectionSignature')
eq('undefined = as-is', selectionSignature(undefined), 'as-is')
check('an explicit [] is NOT the same as as-is', selectionSignature([]) !== selectionSignature(undefined))
check('order does not matter', selectionSignature([sel('a', 'x'), sel('b', 'y')]) === selectionSignature([sel('b', 'y'), sel('a', 'x')]))
check('an omitted qty equals qty 1', selectionSignature([sel('a', 'x')]) === selectionSignature([sel('a', 'x', 1)]))
check('a different qty differs', selectionSignature([sel('a', 'x', 1)]) !== selectionSignature([sel('a', 'x', 2)]))
check('a different option differs', selectionSignature([sel('a', 'x')]) !== selectionSignature([sel('a', 'y')]))
check('a different group differs', selectionSignature([sel('a', 'x')]) !== selectionSignature([sel('b', 'x')]))

// =====================================================================================
// pricing.ts + modifiers.ts — invariants over many random lines
// =====================================================================================
section('pricing.ts — what the server emits is always what the database accepts')
{
  const bigBoth = price({ itemUid: 'i-bigmod', qty: 1, modifiers: [sel('g-big', 'big'), sel('g-neg', 'neg')] }, fullCtx)
  check('a pair of huge opposite option deltas never yields a line the DB would refuse (|delta| <= 500000)', !bigBoth.ok || bigBoth.line.modifiers.every((m) => Math.abs(m.price_delta_agorot) <= LIMITS.unitAgorotMax), `emitted ${show(bigBoth.line?.modifiers?.map((m) => m.price_delta_agorot))}`)

  const r = rng(1337)
  const PRICES = [8, '14/16', 0.335, 19.99, 0, 5000, 5000.01, 'abc', null, -3, '10/12/14', 12.5, '7', '', '14/', 4999.99]
  const GROUPSETS = [[], [gSize], [gSize, gShot], [gSize, gShot, gNoIce, gMilk, gHeat], [gBread, gTopping], [gBig, gNeg], [gShot, gTopping, gNoIce]]
  const NOTES = [undefined, 'n', '   ', 'x'.repeat(300), '😀'.repeat(130), '  trimmed  ', 'a'.repeat(119) + '😀😀']
  const ALL_KINDS = ['choice', 'add', 'remove', 'substitute', 'prep']
  const violations = new Map()
  const note = (name, example) => { if (!violations.has(name)) violations.set(name, example) }
  let okCount = 0
  let failCount = 0
  const RESOLVED_KEYS = ['point_id', 'item_uid', 'category_id', 'category_title', 'name', 'type_uid', 'type_label', 'variant_label', 'unit_agorot', 'base_agorot', 'modifiers', 'qty', 'for_name', 'note', 'is_custom'].sort()
  for (let n = 0; n < 1500; n++) {
    const typeCount = pick(r, [0, 0, 1, 2, 3])
    const types = Array.from({ length: typeCount }, (_, i) => ({
      uid: `t${i}`, he: `ט${i}`, priceDelta: pick(r, [undefined, 0, 1.5, -1, 2, 'x', 6000, '0.335']),
      available: pick(r, [undefined, true, false]), quantity: pick(r, [undefined, 0, 5]),
    }))
    const groups = pick(r, GROUPSETS)
    const it = mkItem('x', 'פריט', pick(r, PRICES), { ...(typeCount ? { types } : {}), modifierGroupUids: groups.map((g) => g.uid) })
    const c = mkCtx({ categories: [mkCat('cx', [it])], groups: LIBRARY, routes: [rt('category', 'cx', 'p1')] })
    // Mostly-valid inputs with a small chance of each defect, so both outcomes are well covered.
    const sellableTypes = types.filter((t) => t.available !== false && t.quantity !== 0)
    const typeUid = typeCount === 0 ? pick(r, [undefined, undefined, undefined, undefined, 'zz']) : r() < 0.85 && sellableTypes.length ? pick(r, sellableTypes).uid : pick(r, [undefined, 'zz', ...types.map((t) => t.uid)])
    const selections = r() < 0.2
      ? pick(r, [undefined, []])
      : groups.flatMap((g) => (g.required || r() < 0.6 ? [sel(g.uid, pick(r, g.options).uid, r() < 0.75 ? 1 : pick(r, [2, 3, 4]))] : []))
    const input = {
      itemUid: r() < 0.95 ? 'x' : 'nope', qty: r() < 0.92 ? pick(r, [1, 1, 2, 5, 99]) : pick(r, [100, 0]),
      typeUid, priceChoice: r() < 0.85 ? pick(r, [0, 1]) : pick(r, [undefined, 2]),
      modifiers: selections, note: pick(r, NOTES), forName: pick(r, [undefined, 'דנה', 'y'.repeat(60), '😀'.repeat(45)]),
    }
    const res = price(input, c)
    if (!res.ok) {
      failCount++
      if (!LINE_PROBLEM_CODES?.includes(res.problem.code)) note('every refusal uses a declared LineProblemCode', { code: res.problem.code })
      continue
    }
    okCount++
    const l = res.line
    if (l.unit_agorot !== l.base_agorot + snapshotsDelta(l.modifiers)) note('unit = base + sum(delta x qty)', l)
    if (![l.unit_agorot, l.base_agorot].every((x) => Number.isInteger(x) && x >= 0 && x <= LIMITS.unitAgorotMax)) note('unit and base are whole agorot in 0..500000', l)
    if (!(Number.isInteger(l.qty) && l.qty >= 1 && l.qty <= LIMITS.qtyMax)) note('qty is 1..99', l)
    for (const [k, max] of [['note', LIMITS.lineNoteMax], ['for_name', LIMITS.forNameMax]]) {
      const v = l[k]
      if (v !== null && !(typeof v === 'string' && v.length > 0 && v.isWellFormed() && Array.from(v).length <= max && v === v.trim())) note(`${k} is null or a trimmed, well-formed string within its cap`, { [k]: v })
    }
    if (!(l.modifiers.length <= LIMITS.modifiersPerLineMax)) note('at most 24 modifiers', l)
    if (!l.modifiers.every((m) => Math.abs(m.price_delta_agorot) <= LIMITS.unitAgorotMax && Number.isInteger(m.price_delta_agorot) && Number.isInteger(m.qty) && m.qty >= 1 && m.qty <= LIMITS.modifierQtyMax && ALL_KINDS.includes(m.kind))) note('every modifier snapshot is DB-valid (integer delta |.|<=500000, qty 1..9, known kind)', l.modifiers)
    if (!(l.name.he || l.name.en || l.name.ar)) note('the name has text in some language', l)
    if (!isDeepStrictEqual(JSON.parse(JSON.stringify(l)), l)) note('the line survives a JSON round trip unchanged', l)
    if (!sameSet(Object.keys(l).sort(), RESOLVED_KEYS)) note('the line has exactly the RPC\'s keys', Object.keys(l))
    if (l.point_id !== 'p1') note('a catalogue line goes to the point its route names', l)
    if (!(l.is_custom === false && l.item_uid === 'x')) note('a catalogue line is not custom and keeps its uid', l)
  }
  check(`the random sweep exercised both outcomes (${okCount} priced, ${failCount} refused)`, okCount > 100 && failCount > 100)
  for (const name of ['every refusal uses a declared LineProblemCode', 'unit = base + sum(delta x qty)', 'unit and base are whole agorot in 0..500000', 'qty is 1..99', 'note is null or a trimmed, well-formed string within its cap', 'for_name is null or a trimmed, well-formed string within its cap', 'at most 24 modifiers', 'every modifier snapshot is DB-valid (integer delta |.|<=500000, qty 1..9, known kind)', 'the name has text in some language', 'the line survives a JSON round trip unchanged', "the line has exactly the RPC's keys", 'a catalogue line goes to the point its route names', 'a catalogue line is not custom and keeps its uid']) {
    check(`invariant: ${name}`, !violations.has(name), `counter-example ${show(violations.get(name))}`)
  }
}

// =====================================================================================
// routing.ts
// =====================================================================================
section('routing.ts — resolveRoute precedence (the header\'s five rules)')
const rctx = (over = {}) => ({ points: [pt('pA', { excluded_uids: ['i-ex'] }), pt('pB'), pt('pOff', { active: false })], routes: [], unsold: [], ...over })
const route = (c, cat, item) => resolveRoute(c, cat, item)
const P_ = (id) => ({ kind: 'point', pointId: id })
eq('1. an item route wins over its category\'s route', route(rctx({ routes: [rt('item', 'i1', 'pB'), rt('category', 'c1', 'pA')] }), 'c1', 'i1'), P_('pB'))
eq('1. …over the item being marked unsold', route(rctx({ routes: [rt('item', 'i1', 'pB')], unsold: ['i:i1'] }), 'c1', 'i1'), P_('pB'))
eq('1. …over its category being unsold', route(rctx({ routes: [rt('item', 'i1', 'pB')], unsold: ['c:c1'] }), 'c1', 'i1'), P_('pB'))
eq('1. …over the owning point having opted the item out', route(rctx({ routes: [rt('item', 'i-ex', 'pA'), rt('category', 'c1', 'pA')] }), 'c1', 'i-ex'), P_('pA'))
eq('2. an item marked unsold beats a category route', route(rctx({ routes: [rt('category', 'c1', 'pA')], unsold: ['i:i1'] }), 'c1', 'i1'), { kind: 'unsold' })
eq('2. …and beats exclusion (still unsold, not excluded)', route(rctx({ routes: [rt('category', 'c1', 'pA')], unsold: ['i:i-ex'] }), 'c1', 'i-ex'), { kind: 'unsold' })
eq('3. a category route sends its items to that point', route(rctx({ routes: [rt('category', 'c1', 'pA')] }), 'c1', 'i1'), P_('pA'))
eq('3. an item the point opted out of is `excluded`', route(rctx({ routes: [rt('category', 'c1', 'pA')] }), 'c1', 'i-ex'), { kind: 'excluded' })
eq('3. another point\'s exclusion does not apply (pA excludes i-ex, but pB owns the category)', route(rctx({ routes: [rt('category', 'c1', 'pB')] }), 'c1', 'i-ex'), P_('pB'))
eq('3. a category route beats its category being unsold', route(rctx({ routes: [rt('category', 'c1', 'pA')], unsold: ['c:c1'] }), 'c1', 'i1'), P_('pA'))
eq('4. a category marked unsold (no route) is `unsold`', route(rctx({ unsold: ['c:c1'] }), 'c1', 'i1'), { kind: 'unsold' })
eq('5. nothing at all is `unrouted`', route(rctx(), 'c1', 'i1'), { kind: 'unrouted' })
eq('an item route to an INACTIVE point is unrouted, not a silent fall-through to the category', route(rctx({ routes: [rt('item', 'i1', 'pOff'), rt('category', 'c1', 'pA')] }), 'c1', 'i1'), { kind: 'unrouted' })
eq('a category route to an INACTIVE point is unrouted', route(rctx({ routes: [rt('category', 'c1', 'pOff')] }), 'c1', 'i1'), { kind: 'unrouted' })
eq('a route to a point that does not exist is unrouted', route(rctx({ routes: [rt('category', 'c1', 'ghost')] }), 'c1', 'i1'), { kind: 'unrouted' })
eq('no itemUid: the category decides', route(rctx({ routes: [rt('category', 'c1', 'pA')] }), 'c1', null), P_('pA'))
eq('no categoryId: the item route decides', route(rctx({ routes: [rt('item', 'i1', 'pB')] }), null, 'i1'), P_('pB'))
eq('neither id: unrouted', route(rctx({ routes: [rt('item', 'i1', 'pB')] }), null, null), { kind: 'unrouted' })
eq('"c:x" in the unsold list never makes an ITEM with uid x unsold', route(rctx({ unsold: ['c:x'] }), 'cat', 'x'), { kind: 'unrouted' })
eq('"i:x" in the unsold list never makes a CATEGORY with id x unsold', route(rctx({ unsold: ['i:x'] }), 'x', 'item'), { kind: 'unrouted' })
eq('an item route is not a category route even when the ref text matches a category id', route(rctx({ routes: [rt('item', 'c1', 'pA')] }), 'c1', 'i9'), { kind: 'unrouted' })
eq('a category route is not an item route even when the ref text matches an item uid', route(rctx({ routes: [rt('category', 'i1', 'pA')] }), 'cX', 'i1'), { kind: 'unrouted' })

section('routing.ts — routeMenu / unroutedItems / summarizePoint / owners')
const rcats = [
  mkCat('c1', [mkItem('a', 'א', 1), { he: 'ללא-uid', price: 1 }, mkItem('b', 'ב', 1), mkItem('i-ex', 'מוחרג', 1)]),
  mkCat('c2', [mkItem('c2x', 'ג', 1), mkItem('c2y', 'ד', 1)]),
  mkCat('c3', [mkItem('c3x', 'ה', 1)]),
  mkCat('c4', [mkItem('c4x', 'ו', 1)]),
  mkCat('c5', [mkItem('c5x', 'ז', 1)]),
]
const sumCtx = rctx({
  routes: [rt('category', 'c1', 'pA'), rt('item', 'c2x', 'pA'), rt('category', 'c3', 'pB'), rt('item', 'c3x', 'pA')],
  unsold: ['c:c4'],
})
const routed = routeMenu(sumCtx, rcats)
eq('routeMenu skips an item that has no uid (it cannot be ordered)', routed.map((x) => x.item.uid), ['a', 'b', 'i-ex', 'c2x', 'c2y', 'c3x', 'c4x', 'c5x'])
eq('routeMenu keeps menu order and pairs each item with its category and route', [routed[0].category.id, routed[0].route, routed[3].route, routed[5].route], ['c1', P_('pA'), P_('pA'), P_('pA')])
eq('unroutedItems lists ONLY unrouted ones — never unsold, never excluded', unroutedItems(sumCtx, rcats).map((x) => x.item.uid), ['c2y', 'c5x'])
const sumA = summarizePoint(sumCtx, rcats, 'pA')
eq('summarizePoint: items = everything the point makes, however it got there (excluded one omitted)', sumA.items.map((i) => i.uid), ['a', 'b', 'c2x', 'c3x'])
eq('summarizePoint: categories = only those claimed whole', sumA.categories.map((c) => c.id), ['c1'])
eq('summarizePoint carries the point id', sumA.pointId, 'pA')
eq('summarizePoint of a point that makes nothing is empty', [summarizePoint(sumCtx, rcats, 'pOff').items.length, summarizePoint(sumCtx, rcats, 'pOff').categories.length], [0, 0])
eq('categoryOwners maps category -> point', Array.from(categoryOwners(sumCtx)).sort(), [['c1', 'pA'], ['c3', 'pB']])
eq('itemOwners maps item -> point', Array.from(itemOwners(sumCtx)).sort(), [['c2x', 'pA'], ['c3x', 'pA']])
eq('categoryOwners ignores item routes and itemOwners ignores category routes', [categoryOwners(sumCtx).has('c2x'), itemOwners(sumCtx).has('c1')], [false, false])

// =====================================================================================
// lifecycle.ts
// =====================================================================================
section('lifecycle.ts — isAllowedTransition (every ordered pair, against the SQL)')
const STATUSES = ['sent', 'preparing', 'ready', 'delivered', 'voided']
const ALLOWED_PAIRS = new Set(['sent>preparing', 'preparing>ready', 'sent>ready', 'ready>delivered', 'ready>preparing', 'preparing>sent'])
for (const from of STATUSES) {
  for (const to of STATUSES) {
    const want = ALLOWED_PAIRS.has(`${from}>${to}`)
    const managerWant = want || (from === 'delivered' && to === 'ready')
    check(`${from} > ${to}: ${want ? 'allowed' : 'refused'} for staff${managerWant && !want ? ', allowed for a manager' : ''}`, L.isAllowedTransition(from, to) === want && L.isAllowedTransition(from, to, { manager: true }) === managerWant)
  }
}
check('delivered > ready is refused without the manager flag', L.isAllowedTransition('delivered', 'ready') === false && L.isAllowedTransition('delivered', 'ready', {}) === false && L.isAllowedTransition('delivered', 'ready', { manager: false }) === false)
check('delivered > ready is allowed with it', L.isAllowedTransition('delivered', 'ready', { manager: true }) === true)
check('being a manager unlocks nothing else (voided > sent, delivered > sent, ready > sent stay refused)', ['voided>sent', 'delivered>sent', 'ready>sent', 'voided>ready', 'delivered>preparing'].every((p) => { const [a, b] = p.split('>'); return !L.isAllowedTransition(a, b, { manager: true }) }))
{
  const m = /v_pair not in \(([^)]*)\)/.exec(SQL_014)
  const sqlPairs = m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : null
  check('the TS transition table is exactly pos_advance_items\' list', sqlPairs !== null && sameSet(sqlPairs, [...ALLOWED_PAIRS]), `sql ${show(sqlPairs)}`)
  check('SQL: delivered>ready exists only for p_manager', /v_pair = 'delivered>ready' and p_manager/.test(SQL_014))
}
eq('nextStatus: sent -> preparing', L.nextStatus('sent'), 'preparing')
eq('nextStatus: preparing -> ready', L.nextStatus('preparing'), 'ready')
eq('nextStatus: ready -> delivered', L.nextStatus('ready'), 'delivered')
eq('nextStatus: delivered has none', L.nextStatus('delivered'), null)
eq('nextStatus: voided has none', L.nextStatus('voided'), null)
eq('isLiveStatus: sent/preparing/ready only', STATUSES.filter(L.isLiveStatus), ['sent', 'preparing', 'ready'])
eq('STAGE_ORDER is the live lifecycle then delivered', [...L.STAGE_ORDER], ['sent', 'preparing', 'ready', 'delivered'])

section('lifecycle.ts — cardStage / cardAction (the one big button)')
const ln = (id, status) => ({ id, status })
const handsOver = { hands_over: true }
const noHandover = { hands_over: false }
eq('cardStage: no lines -> null', L.cardStage([]), null)
eq('cardStage: all delivered/voided -> null', L.cardStage([ln('a', 'delivered'), ln('b', 'voided')]), null)
eq('cardStage: the LEAST advanced live status wins (sent beats ready)', L.cardStage([ln('a', 'ready'), ln('b', 'sent')]), 'sent')
eq('cardStage: preparing beats ready', L.cardStage([ln('a', 'ready'), ln('b', 'preparing')]), 'preparing')
eq('cardStage: ready only', L.cardStage([ln('a', 'ready'), ln('b', 'delivered')]), 'ready')
eq('cardStage: ignores delivered/voided when something is live', L.cardStage([ln('a', 'delivered'), ln('b', 'voided'), ln('c', 'preparing')]), 'preparing')
eq('cardAction: accept covers only the SENT lines', L.cardAction([ln('a', 'sent'), ln('b', 'ready'), ln('c', 'sent')], handsOver), { kind: 'accept', from: 'sent', to: 'preparing', ids: ['a', 'c'] })
eq('cardAction: ready covers only the PREPARING lines', L.cardAction([ln('a', 'preparing'), ln('b', 'ready'), ln('c', 'delivered')], handsOver), { kind: 'ready', from: 'preparing', to: 'ready', ids: ['a'] })
eq('cardAction: handover covers only the READY lines', L.cardAction([ln('a', 'ready'), ln('b', 'delivered'), ln('c', 'voided'), ln('d', 'ready')], handsOver), { kind: 'handover', from: 'ready', to: 'delivered', ids: ['a', 'd'] })
eq('cardAction: nothing live -> null', L.cardAction([ln('a', 'delivered'), ln('b', 'voided')], handsOver), null)
eq('cardAction: no lines -> null', L.cardAction([], handsOver), null)
eq('cardAction: ready at a point that does NOT hand over -> null (someone else completes it)', L.cardAction([ln('a', 'ready')], noHandover), null)
eq('cardAction: a point that does not hand over still accepts', L.cardAction([ln('a', 'sent')], noHandover)?.kind, 'accept')
eq('cardAction: a point that does not hand over still marks ready', L.cardAction([ln('a', 'preparing')], noHandover)?.kind, 'ready')
eq('cardAction: sent + ready at a non-handover point is accept (the sent line is behind)', L.cardAction([ln('a', 'sent'), ln('b', 'ready')], noHandover)?.kind, 'accept')
eq('lineAction: a single sent line', L.lineAction(ln('a', 'sent'), handsOver), { kind: 'accept', from: 'sent', to: 'preparing', ids: ['a'] })
eq('lineAction: a ready line at a non-handover point has none', L.lineAction(ln('a', 'ready'), noHandover), null)
const walk = (statuses, point) => {
  const lines = statuses.map((s, i) => ({ id: `l${i}`, status: s }))
  const kinds = []
  for (let i = 0; i < 12; i++) {
    const a = L.cardAction(lines, point)
    if (!a) break
    kinds.push(a.kind)
    for (const l of lines) if (a.ids.includes(l.id)) l.status = a.to
  }
  return { kinds, final: lines.map((l) => l.status) }
}
eq('repeated taps walk a uniform card accept -> ready -> handover', walk(['sent', 'sent', 'sent'], handsOver), { kinds: ['accept', 'ready', 'handover'], final: ['delivered', 'delivered', 'delivered'] })
eq('a mixed card never skips a line: [sent, ready] still takes three taps', walk(['sent', 'ready'], handsOver), { kinds: ['accept', 'ready', 'handover'], final: ['delivered', 'delivered'] })
eq('a card with a delivered line ignores it: [preparing, delivered]', walk(['preparing', 'delivered'], handsOver), { kinds: ['ready', 'handover'], final: ['delivered', 'delivered'] })
eq('at a non-handover point the walk stops at ready', walk(['sent', 'sent'], noHandover), { kinds: ['accept', 'ready'], final: ['ready', 'ready'] })

section('lifecycle.ts — canUndoDelivered (30 s, same person; a manager always)')
const NOW = Date.parse('2026-10-02T12:00:00.000Z')
const dl = (secAgo, by = 'u1', status = 'delivered') => ({ status, delivered_by: by, delivered_at: secAgo === null ? null : new Date(NOW - secAgo * 1000).toISOString() })
eq('the window is 30 seconds', UNDO.deliveredWindowS, 30)
eq('the same person, 5 s later -> yes', L.canUndoDelivered(dl(5), 'u1', NOW), true)
eq('the same person, 29.9 s later -> yes', L.canUndoDelivered(dl(29.9), 'u1', NOW), true)
eq('the same person, exactly 30 s later -> yes (the window is inclusive)', L.canUndoDelivered(dl(30), 'u1', NOW), true)
eq('the same person, 30.001 s later -> no', L.canUndoDelivered({ status: 'delivered', delivered_by: 'u1', delivered_at: new Date(NOW - 30001).toISOString() }, 'u1', NOW), false)
eq('the same person, an hour later -> no', L.canUndoDelivered(dl(3600), 'u1', NOW), false)
eq('another person within the window -> no', L.canUndoDelivered(dl(5, 'u2'), 'u1', NOW), false)
eq('a manager, long after, someone else\'s delivery -> yes', L.canUndoDelivered(dl(86400, 'u2'), 'mgr', NOW, true), true)
eq('a manager cannot "undo" a line that is not delivered', L.canUndoDelivered(dl(5, 'u1', 'ready'), 'mgr', NOW, true), false)
eq('a non-delivered line is never undoable', L.canUndoDelivered(dl(5, 'u1', 'preparing'), 'u1', NOW), false)
eq('a delivered line with no timestamp is not undoable by staff', L.canUndoDelivered(dl(null), 'u1', NOW), false)
eq('a garbage timestamp is not undoable by staff', L.canUndoDelivered({ status: 'delivered', delivered_by: 'u1', delivered_at: 'nonsense' }, 'u1', NOW), false)
eq('a delivered_at slightly in the future (clock skew) still counts as just now', L.canUndoDelivered({ status: 'delivered', delivered_by: 'u1', delivered_at: new Date(NOW + 2000).toISOString() }, 'u1', NOW), true)
eq('a voided line is not undoable', L.canUndoDelivered(dl(5, 'u1', 'voided'), 'u1', NOW), false)

section('lifecycle.ts — deriveOrderStatus / orderTotalAgorot / isFullyDelivered (mirror pos_recompute_order)')
const S = (...statuses) => statuses.map((status) => ({ status }))
eq('no lines -> void (no un-voided line remains)', L.deriveOrderStatus([]), 'void')
eq('every line voided -> void', L.deriveOrderStatus(S('voided', 'voided')), 'void')
eq('one delivered line -> completed', L.deriveOrderStatus(S('delivered')), 'completed')
eq('every line delivered -> completed', L.deriveOrderStatus(S('delivered', 'delivered')), 'completed')
eq('voided lines are ignored: delivered + voided -> completed', L.deriveOrderStatus(S('delivered', 'voided')), 'completed')
eq('delivered + sent -> open', L.deriveOrderStatus(S('delivered', 'sent')), 'open')
eq('delivered + ready -> open', L.deriveOrderStatus(S('delivered', 'ready')), 'open')
eq('delivered + preparing -> open', L.deriveOrderStatus(S('delivered', 'preparing')), 'open')
eq('all sent -> open', L.deriveOrderStatus(S('sent', 'sent')), 'open')
eq('voided + sent -> open', L.deriveOrderStatus(S('voided', 'sent')), 'open')
eq('a single ready line -> open (ready is not handed over yet)', L.deriveOrderStatus(S('ready')), 'open')
const totalLines = [
  { status: 'sent', qty: 2, unit_agorot: 1500 }, { status: 'voided', qty: 1, unit_agorot: 800 },
  { status: 'delivered', qty: 3, unit_agorot: 200 }, { status: 'ready', qty: 1, unit_agorot: 5 },
]
eq('orderTotalAgorot sums qty x unit over un-voided lines: 3000 + 600 + 5', L.orderTotalAgorot(totalLines), 3605)
eq('orderTotalAgorot of nothing is 0', L.orderTotalAgorot([]), 0)
eq('orderTotalAgorot of only voided lines is 0', L.orderTotalAgorot([{ status: 'voided', qty: 5, unit_agorot: 100 }]), 0)
eq('isFullyDelivered: all delivered', L.isFullyDelivered(S('delivered', 'delivered')), true)
eq('isFullyDelivered: delivered + voided', L.isFullyDelivered(S('delivered', 'voided')), true)
eq('isFullyDelivered: one still ready', L.isFullyDelivered(S('delivered', 'ready')), false)
eq('isFullyDelivered: no lines is NOT fully delivered', L.isFullyDelivered([]), false)
eq('isFullyDelivered: an all-voided order is void, not delivered', L.isFullyDelivered(S('voided')), false)
sweep('deriveOrderStatus and orderTotalAgorot match the SQL function\'s counts on random orders', Array.from({ length: 800 }, (_, i) => i), (seed) => {
  const r = rng(seed * 7 + 3)
  const lines = Array.from({ length: Math.floor(r() * 7) }, () => ({ status: pick(r, STATUSES), qty: 1 + Math.floor(r() * 5), unit_agorot: Math.floor(r() * 4000) }))
  // The model is pos_recompute_order, transcribed from 014: live = non-voided; void if 0; completed if delivered = live.
  const live = lines.filter((l) => l.status !== 'voided').length
  const deliv = lines.filter((l) => l.status === 'delivered').length
  const status = live === 0 ? 'void' : deliv === live ? 'completed' : 'open'
  const total = lines.filter((l) => l.status !== 'voided').reduce((s, l) => s + l.qty * l.unit_agorot, 0)
  return L.deriveOrderStatus(lines) === status && L.orderTotalAgorot(lines) === total && L.isFullyDelivered(lines) === (status === 'completed')
})

// =====================================================================================
// aging.ts
// =====================================================================================
section('aging.ts — the stage boundaries (60 / 120 / 300 s)')
check('the thresholds are the owner\'s 60 / 120 / 300 and the tick is at most 5 s', AGING.warmingS === 60 && AGING.lateS === 120 && AGING.criticalS === 300 && AGING.tickMs <= 5000)
const stageAt = (sec) => A.ageStage(NOW - sec * 1000, NOW)
for (const [sec, want] of [[0, 'fresh'], [30, 'fresh'], [59.9, 'fresh'], [60, 'warming'], [90, 'warming'], [119.9, 'warming'], [120, 'late'], [200, 'late'], [299.9, 'late'], [300, 'critical'], [301, 'critical'], [3600, 'critical']]) {
  eq(`${sec} s waiting -> ${want}`, stageAt(sec), want)
}
eq('a sent_at in the FUTURE (clock skew) clamps to fresh', stageAt(-45), 'fresh')
eq('a sent_at far in the future is still fresh', stageAt(-86400), 'fresh')
check('a garbage timestamp (NaN) never reads as the loudest alarm', A.ageStage(NaN, NOW) !== 'critical', `got ${A.ageStage(NaN, NOW)}`)
check('a NaN clock never reads as critical either', A.ageStage(NOW, NaN) !== 'critical')
const lineAt = (status, sec) => ({ status, sent_at: new Date(NOW - sec * 1000).toISOString() })
for (const status of ['preparing', 'ready', 'delivered', 'voided']) {
  eq(`lineAge: a ${status} line does not age, however old (null)`, A.lineAge(lineAt(status, 99999), NOW), null)
}
eq('lineAge: a sent line ages', A.lineAge(lineAt('sent', 130), NOW), 'late')
eq('lineAge: an invalid sent_at does not age (null)', A.lineAge({ status: 'sent', sent_at: 'garbage' }, NOW), null)
eq('lineAge: an empty sent_at does not age (null)', A.lineAge({ status: 'sent', sent_at: '' }, NOW), null)
eq('worstStage of nothing is fresh', A.worstStage([]), 'fresh')
eq('worstStage ignores nulls', A.worstStage([null, null]), 'fresh')
eq('worstStage picks the worst', A.worstStage(['fresh', 'late', 'warming']), 'late')
eq('worstStage: critical dominates', A.worstStage(['late', 'critical', null]), 'critical')
eq('AGE_ORDER runs fresh < warming < late < critical', [...A.AGE_ORDER], ['fresh', 'warming', 'late', 'critical'])
section('aging.ts — overdueCount counts EXACTLY what glows, waitingSeconds')
{
  const lines = [
    lineAt('sent', 301), lineAt('sent', 300), lineAt('sent', 299.9), lineAt('sent', 1000), lineAt('sent', 10),
    lineAt('preparing', 9999), lineAt('ready', 9999), lineAt('delivered', 9999), lineAt('voided', 9999),
    { status: 'sent', sent_at: 'garbage' },
  ]
  const glowing = lines.filter((l) => A.lineAge(l, NOW) === 'critical').length
  eq('overdueCount equals the number of critical cards', A.overdueCount(lines, NOW), glowing)
  eq('…which is 3: only unaccepted lines >= 300 s count (accepted, ready, delivered, voided and garbage do not)', A.overdueCount(lines, NOW), 3)
  eq('no lines -> 0', A.overdueCount([], NOW), 0)
  sweep('overdueCount equals the critical count for random queues', Array.from({ length: 200 }, (_, i) => i), (seed) => {
    const r = rng(seed + 99)
    const q = Array.from({ length: Math.floor(r() * 12) }, () => lineAt(pick(r, STATUSES), pick(r, [0, 59, 61, 119, 121, 299, 300, 301, 600])))
    return A.overdueCount(q, NOW) === q.filter((l) => A.lineAge(l, NOW) === 'critical').length
  })
}
eq('waitingSeconds: 90 s', A.waitingSeconds(new Date(NOW - 90000).toISOString(), NOW), 90)
eq('waitingSeconds floors (1.999 s -> 1)', A.waitingSeconds(new Date(NOW - 1999).toISOString(), NOW), 1)
eq('waitingSeconds is never negative (future timestamp)', A.waitingSeconds(new Date(NOW + 5000).toISOString(), NOW), 0)
eq('waitingSeconds of garbage is 0', A.waitingSeconds('garbage', NOW), 0)

// =====================================================================================
// board.ts
// =====================================================================================
section('board.ts — firstName')
eq('first whitespace token of a full name', firstName('דנה כהן'), 'דנה')
eq('extra spaces around and between', firstName('  Dana   Cohen '), 'Dana')
eq('a tab is whitespace too', firstName('Dana\tCohen'), 'Dana')
eq('a single name is itself', firstName('מיכל'), 'מיכל')
eq('empty -> the fallback', firstName(''), '—')
eq('whitespace only -> the fallback', firstName('   '), '—')
eq('null -> the fallback', firstName(null), '—')
eq('undefined -> the fallback', firstName(undefined), '—')
eq('a custom fallback is honoured', firstName('', 'לקוח'), 'לקוח')
eq('the cap is 14 characters', FIRST_NAME_MAX, 14)
eq('exactly 14 letters are kept whole', firstName('a'.repeat(14)), 'a'.repeat(14))
eq('15 letters are cut to 14', firstName('a'.repeat(15)), 'a'.repeat(14))
eq('20 Hebrew letters are cut to 14 letters', Array.from(firstName('ש'.repeat(20))).length, 14)
eq('14 emoji are kept whole', firstName('😀'.repeat(14)), '😀'.repeat(14))
eq('20 emoji are cut to 14 emoji — an emoji is never split in half', firstName('😀'.repeat(20)), '😀'.repeat(14))
check('the cut result is always well-formed', firstName('😀'.repeat(20)).isWellFormed() && firstName('א'.repeat(20) + '😀').isWellFormed())

section('board.ts — boardEntries (the per-order-per-point rule)')
const bOrders = new Map([
  ['o1', { ticket_no: 1, customer_name: 'דנה כהן', customer_phone: '0541234567' }],
  ['o2', { ticket_no: 2, customer_name: 'דנה לוי', customer_phone: '0527654321' }],
  ['o3', { ticket_no: 3, customer_name: 'Yossi' }],
  ['o4', { ticket_no: 4, customer_name: 'מיכל' }],
])
const bPoints = new Map([['pc', { name: 'קפה', colour: '#C084FC' }], ['pp', { name: 'פיצה', colour: '#60A5FA' }]])
const bi = (order_id, point_id, status, ready_at = null, extra = {}) => ({ order_id, point_id, status, ready_at, ...extra })
const T0 = '2026-10-02T10:00:00.000Z'
const T1 = '2026-10-02T10:01:00.000Z'
const T2 = '2026-10-02T10:02:00.000Z'
const entries = (items) => boardEntries(items, bOrders, bPoints)
eq('a point whose lines are all ready shows one entry — first name, ticket, point, earliest ready time', entries([bi('o1', 'pc', 'ready', T1), bi('o1', 'pc', 'ready', T0)]), [
  { orderId: 'o1', ticketNo: 1, firstName: 'דנה', pointId: 'pc', pointName: 'קפה', pointColour: '#C084FC', readyAt: T0 },
])
eq('one line ready, another still preparing at the SAME point -> nothing yet', entries([bi('o1', 'pc', 'ready', T0), bi('o1', 'pc', 'preparing')]), [])
eq('one line ready, another still sent at the same point -> nothing yet', entries([bi('o1', 'pc', 'ready', T0), bi('o1', 'pc', 'sent')]), [])
eq('ready at one point, still preparing at ANOTHER -> the ready point shows, the other does not', entries([bi('o1', 'pc', 'ready', T0), bi('o1', 'pp', 'preparing')]).map((e) => e.pointId), ['pc'])
eq('ready at both points -> two entries for the one order', entries([bi('o1', 'pc', 'ready', T0), bi('o1', 'pp', 'ready', T1)]).map((e) => e.pointId), ['pc', 'pp'])
eq('delivered lines are ignored: ready + delivered at a point still shows', entries([bi('o1', 'pc', 'ready', T0), bi('o1', 'pc', 'delivered', T0)]).length, 1)
eq('voided lines are ignored: ready + voided at a point still shows', entries([bi('o1', 'pc', 'ready', T0), bi('o1', 'pc', 'voided')]).length, 1)
eq('an in-flight line beside delivered ones still blocks: sent + delivered + ready', entries([bi('o1', 'pc', 'sent'), bi('o1', 'pc', 'delivered', T0), bi('o1', 'pc', 'ready', T1)]), [])
eq('only delivered lines -> nothing (it left the board when handed over)', entries([bi('o1', 'pc', 'delivered', T0)]), [])
eq('only voided lines -> nothing', entries([bi('o1', 'pc', 'voided')]), [])
eq('only preparing lines -> nothing', entries([bi('o1', 'pc', 'preparing')]), [])
eq('no items -> nothing', entries([]), [])
eq('the moment the last in-flight line becomes ready the entry appears', [entries([bi('o1', 'pc', 'ready', T0), bi('o1', 'pc', 'preparing')]).length, entries([bi('o1', 'pc', 'ready', T0), bi('o1', 'pc', 'ready', T1)]).length], [0, 1])
const sameFirst = entries([bi('o1', 'pc', 'ready', T0), bi('o2', 'pc', 'ready', T1)])
eq('two customers with the same first name stay distinguishable by ticket number', sameFirst.map((e) => [e.firstName, e.ticketNo]), [['דנה', 1], ['דנה', 2]])
eq('entries are sorted by ready time, oldest first', entries([bi('o1', 'pc', 'ready', T2), bi('o3', 'pc', 'ready', T0), bi('o4', 'pc', 'ready', T1)]).map((e) => e.orderId), ['o3', 'o4', 'o1'])
eq('equal ready times fall back to ticket number', entries([bi('o4', 'pc', 'ready', T0), bi('o2', 'pc', 'ready', T0), bi('o3', 'pc', 'ready', T0)]).map((e) => e.ticketNo), [2, 3, 4])
eq('ready times with and without fractional seconds sort chronologically (PostgREST drops trailing zeros)', entries([bi('o1', 'pc', 'ready', '2026-10-02T10:00:00.5+00:00'), bi('o2', 'pc', 'ready', '2026-10-02T10:00:00+00:00'), bi('o3', 'pc', 'ready', '2026-10-02T10:00:00.12+00:00')]).map((e) => e.orderId), ['o2', 'o3', 'o1'])
eq('an item of an order that is not loaded is skipped, not a crash', entries([bi('ghost', 'pc', 'ready', T0)]), [])
eq('an item at a point that is not loaded is skipped, not a crash', entries([bi('o1', 'ghost', 'ready', T0)]), [])
sweep('the result does not depend on the order the items arrive in (60 shuffles)', Array.from({ length: 60 }, (_, i) => i), (seed) => {
  const items = [bi('o1', 'pc', 'ready', T0), bi('o1', 'pc', 'ready', T1), bi('o1', 'pp', 'preparing'), bi('o2', 'pc', 'ready', T2), bi('o2', 'pp', 'ready', T1), bi('o3', 'pc', 'sent'), bi('o3', 'pc', 'ready', T0), bi('o4', 'pp', 'ready', T0), bi('o4', 'pp', 'delivered', T0)]
  return isDeepStrictEqual(entries(items), entries(shuffle(rng(seed + 5), items)))
})
{
  const secret = entries([
    bi('o1', 'pc', 'ready', T0, { name: { he: 'הפוך-סודי' }, note: 'הערה-סודית', customer_phone: '0541234567', for_name: 'סודי' }),
  ])
  const json = JSON.stringify(secret)
  check('PRIVACY: no phone number in an entry', !json.includes('0541234567') && !json.includes('541234567'))
  check('PRIVACY: no surname in an entry', !json.includes('כהן'))
  check('PRIVACY: no item name, note or for-whom in an entry', !json.includes('הפוך-סודי') && !json.includes('הערה-סודית') && !json.includes('סודי'))
  const keys = Object.keys(secret[0] ?? {}).sort()
  eq('PRIVACY: an entry has exactly the allow-listed keys', keys, ['firstName', 'orderId', 'pointColour', 'pointId', 'pointName', 'readyAt', 'ticketNo'])
  const apiKeys = (() => { const m = /ready:\s*\{([^}]*)\}\[\]/.exec(API_SRC); return m ? [...m[1].matchAll(/(\w+)\s*:/g)].map((x) => x[1]).sort() : null })()
  eq('the public BoardResponse.ready type has the same keys as an entry', apiKeys, keys)
}
eq('preparingCount counts sent + preparing only', preparingCount([{ status: 'sent' }, { status: 'preparing' }, { status: 'ready' }, { status: 'delivered' }, { status: 'voided' }]), 2)
eq('preparingCount of nothing is 0', preparingCount([]), 0)

// =====================================================================================
// validate.ts
// =====================================================================================
section('validate.ts — normalizeCustomerName')
const nm = V.normalizeCustomerName
eq('trimmed and inner whitespace collapsed', nm('  דנה   כהן '), 'דנה כהן')
eq('a tab or newline between words becomes one space', nm('Dana\t\nCohen'), 'Dana Cohen')
eq('empty -> null', nm(''), null)
eq('whitespace only -> null', nm('   \t '), null)
eq('null -> null', nm(null), null)
eq('undefined -> null', nm(undefined), null)
eq('exactly 40 characters is fine', nm('a'.repeat(40)), 'a'.repeat(40))
eq('41 characters is refused', nm('a'.repeat(41)), null)
eq('40 emoji (80 UTF-16 units) is 40 characters: fine — the DB counts characters', nm('😀'.repeat(40)), '😀'.repeat(40))
eq('41 emoji is refused', nm('😀'.repeat(41)), null)
eq('Arabic is fine', nm('سارة'), 'سارة')
eq('a control character is refused (BEL)', nm('Da\u0007na'), null)
eq('a NUL is refused', nm('Da\u0000na'), null)
eq('DEL is refused', nm('Da\u007Fna'), null)
eq('a name made of 40 chars after collapsing spaces is fine', nm(`${'a'.repeat(20)}    ${'b'.repeat(19)}`), `${'a'.repeat(20)} ${'b'.repeat(19)}`)

section('validate.ts — normalizePhone / formatPhone (TS must agree with the SQL)')
const ph = V.normalizePhone
for (const [input, want] of [
  ['', null], [null, null], [undefined, null], ['   ', null],
  ['0541234567', '0541234567'], ['054-123-4567', '0541234567'], ['054 123 4567', '0541234567'], ['(054) 123-4567', '0541234567'],
  ['+972541234567', '+972541234567'], ['+972-54-123-4567', '+972541234567'], ['972541234567', '972541234567'],
  ['1234567', '1234567'], ['123456789012345', '123456789012345'],
  ['123456', 'invalid'], ['1234567890123456', 'invalid'], ['abc', 'invalid'], ['054x1234567', 'invalid'], ['++972541234567', 'invalid'],
  ['+', 'invalid'], ['0541234567+', 'invalid'], ['٠٥٤١٢٣٤٥٦٧', 'invalid'], ['054.123.4567', 'invalid'], ['054/1234567', 'invalid'],
]) eq(`${show(input)} -> ${show(want)}`, ph(input), want)
eq('formatPhone: an Israeli mobile gets grouped', V.formatPhone('0541234567'), '054-123 4567')
eq('formatPhone: null -> ""', V.formatPhone(null), '')
eq('formatPhone: "" -> ""', V.formatPhone(''), '')
eq('formatPhone: an international number is left alone', V.formatPhone('+972541234567'), '+972541234567')
eq('formatPhone: a landline is left alone', V.formatPhone('031234567'), '031234567')
eq('formatPhone: an 11-digit number is left alone', V.formatPhone('05412345678'), '05412345678')
{
  const sqlPhone = /customer_phone ~ '([^']+)'/.exec(SQL_014)?.[1]
  const sqlStrip = /regexp_replace\(coalesce\(p_customer_phone, ''\), '([^']+)', '', 'g'\)/.exec(SQL_014)?.[1]
  check('the SQL phone pattern and strip class were found', Boolean(sqlPhone && sqlStrip), `${sqlPhone} / ${sqlStrip}`)
  if (sqlPhone && sqlStrip) {
    const re = new RegExp(sqlPhone)
    const strip = new RegExp(sqlStrip, 'g')
    const model = (input) => { const s = String(input ?? '').replace(strip, ''); return s === '' ? null : re.test(s) ? s : 'invalid' }
    const r = rng(2024)
    const alphabet = '0123456789+ ()-abc٣\t.+/'.split('')
    const inputs = Array.from({ length: 4000 }, () => Array.from({ length: Math.floor(r() * 20) }, () => pick(r, alphabet)).join(''))
    // TS may be STRICTER than SQL in exactly one place: input that is only separators ("()-") is
    // "no phone" to SQL (nullif) but "that phone looks wrong" to the cashier. TS must never
    // accept what SQL rejects, or normalise to a different number.
    sweep('normalizePhone agrees with the SQL normalisation + pattern on random input (stricter only on separator-only input)', inputs, (s) => {
      const t = ph(s)
      const m = model(s)
      return t === m || (t === 'invalid' && m === null && /^[\s()-]+$/.test(s))
    })
  }
}

section('validate.ts — handles (TS pattern == the three SQL patterns)')
for (const [input, want] of [
  ['דנה', true], ['Dana', true], ['a', false], ['ab', true], ['a'.repeat(16), true], ['a'.repeat(17), false], ['א'.repeat(16), true], ['א'.repeat(17), false],
  ['a b', false], ['a_b.c-d', true], ['דנה🙂', false], ['سارة', true], [' Dana ', true], ['', false], ['  ', false], ['a!', false], ['😀😀', false],
]) eq(`isValidHandle(${show(input)}) -> ${want}`, V.isValidHandle(input), want)
for (const [input, want] of [
  ['', 'too_short'], ['a', 'too_short'], ['ab', null], ['a'.repeat(17), 'too_long'], ['a b', 'bad_chars'], ['😀😀', 'bad_chars'],
  ['😀'.repeat(17), 'too_long'], [' ab ', null], ['דנה', null], ['a!', 'bad_chars'],
]) eq(`handleProblem(${show(input)}) -> ${show(want)}`, V.handleProblem(input), want)
sweep('handleProblem === null exactly when isValidHandle (random strings)', Array.from({ length: 3000 }, (_, i) => i), (seed) => {
  const r = rng(seed + 10)
  const alphabet = ['a', 'Z', '9', 'א', 'ת', 'ا', ' ', '.', '-', '_', '😀', '!', '@']
  const s = Array.from({ length: Math.floor(r() * 20) }, () => pick(r, alphabet)).join('')
  return (V.handleProblem(s) === null) === V.isValidHandle(s)
})
{
  const classOf = (re) => { const m = /\[([^\]]*)\]/.exec(re); return m ? m[1] : null }
  const tsClass = classOf(M.vocab.HANDLE_PATTERN.source)
  const sqlConstraint = /check \(handle ~ '([^']+)'\)/.exec(SQL_014)?.[1]
  const sqlSet = /v_handle !~ '([^']+)'/.exec(SQL_014)?.[1]
  const sqlSuggest = /regexp_replace\(base, '\[\^([^\]]*)\]', '', 'g'\)/.exec(SQL_014)?.[1]
  check('all three SQL handle patterns were found', Boolean(sqlConstraint && sqlSet && sqlSuggest))
  eq('HANDLE_PATTERN is character-for-character the staff_handle_format CHECK', M.vocab.HANDLE_PATTERN.source, sqlConstraint)
  eq('…and the pos_set_handle pattern', M.vocab.HANDLE_PATTERN.source, sqlSet)
  eq('…and pos_suggest_handle\'s allowed-character class', tsClass, sqlSuggest)
  if (sqlConstraint) {
    const re = new RegExp(sqlConstraint)
    sweep('HANDLE_PATTERN and the SQL regex accept the same character, over the whole BMP', Array.from({ length: 0x10000 }, (_, i) => i).filter((c) => c < 0xd800 || c > 0xdfff), (c) => {
      const s = `a${String.fromCharCode(c)}`
      return M.vocab.HANDLE_PATTERN.test(s) === re.test(s)
    })
  }
  eq('PHONE_PATTERN is the SQL pattern', M.vocab.PHONE_PATTERN.source, /customer_phone ~ '([^']+)'/.exec(SQL_014)?.[1])
}

section('validate.ts — normalizeNote / parsePriceInput')
eq('normalizeNote: null -> null', V.normalizeNote(null, 10), null)
eq('normalizeNote: undefined -> null', V.normalizeNote(undefined, 10), null)
eq('normalizeNote: "" -> null', V.normalizeNote('', 10), null)
eq('normalizeNote: whitespace -> null', V.normalizeNote('   ', 10), null)
eq('normalizeNote: trims', V.normalizeNote('  x  ', 10), 'x')
eq('normalizeNote: caps at max characters', V.normalizeNote('abcdefgh', 5), 'abcde')
eq('normalizeNote: caps by CHARACTERS — an emoji is never split', V.normalizeNote('😀😀😀', 2), '😀😀')
check('normalizeNote: a cap inside an emoji run is well-formed', V.normalizeNote('a😀😀😀', 2).isWellFormed())
eq('normalizeNote: exactly max is kept', V.normalizeNote('abcde', 5), 'abcde')
for (const [input, want] of [
  ['12', 1200], ['12,5', 1250], ['12.50', 1250], [' 7 ', 700], ['0', 0], ['0.00', 0], ['0,05', 5], ['999.99', 99999],
  ['abc', null], ['', null], ['-5', null], ['1.234', null], ['12.', null], ['.5', null], ['1e3', null], ['12 50', null], ['5,', null], ['₪5', null],
]) eq(`parsePriceInput(${show(input)}) -> ${show(want)}`, V.parsePriceInput(input), want)
sweep('parsePriceInput agrees with parseMoneyToAgorot for every non-negative amount', Array.from({ length: 5001 }, (_, i) => i), (c) => {
  const s = formatAgorot(c).slice(1)
  return V.parsePriceInput(s) === parseMoneyToAgorot(s) && V.parsePriceInput(s) === c
})

// =====================================================================================
// format.ts
// =====================================================================================
section('format.ts')
eq('ticketLabel', F.ticketLabel(42), '#42')
for (const [sec, he, en] of [
  [0, '0 שנ׳', '0s'], [59, '59 שנ׳', '59s'], [59.9, '59 שנ׳', '59s'], [60, '1 דק׳', '1 min'], [719, '11 דק׳', '11 min'],
  [3599, '59 דק׳', '59 min'], [3600, '1:00 ש׳', '1:00 h'], [3900, '1:05 ש׳', '1:05 h'], [7325, '2:02 ש׳', '2:02 h'], [-30, '0 שנ׳', '0s'],
]) {
  eq(`sinceLabel(${sec}) he`, F.sinceLabel(sec), he)
  eq(`sinceLabel(${sec}) en`, F.sinceLabel(sec, 'en'), en)
}
for (const [sec, want] of [[0, '0:00'], [5, '0:05'], [62, '1:02'], [102, '1:42'], [725, '12:05'], [59.9, '0:59'], [-5, '0:00']]) {
  eq(`clockLabel(${sec}) -> ${want}`, F.clockLabel(sec), want)
}
eq('nameOf: English when asked', F.nameOf({ he: 'הפוך', en: 'Latte' }, 'en'), 'Latte')
eq('nameOf: Hebrew by default', F.nameOf({ he: 'הפוך', en: 'Latte' }, 'he'), 'הפוך')
eq('nameOf: falls back to Hebrew when English is missing', F.nameOf({ he: 'הפוך', en: '' }, 'en'), 'הפוך')
eq('nameOf: null -> ""', F.nameOf(null, 'he'), '')
eq('nameOf: undefined -> ""', F.nameOf(undefined, 'en'), '')
const sline = { qty: 2, name: T('הפוך', 'Latte', ''), type_label: null, variant_label: null, modifiers: [] }
eq('lineSummary: qty × name', F.lineSummary(sline, 'he'), '2× הפוך')
eq('lineSummary: English', F.lineSummary(sline, 'en'), '2× Latte')
eq('lineSummary: type, variant and modifiers join with " · "', F.lineSummary({ qty: 1, name: T('הפוך', 'Latte', ''), type_label: T('בננה', 'Banana', ''), variant_label: '₪16', modifiers: [mk('add', T('שוט', 'shot', ''), { qty: 2 }), mk('substitute', T('שיבולת', 'oat', ''), { source: T('חלב', 'milk', '') })] }, 'en'), '1× Latte · Banana · ₪16 · + shot ×2 · oat instead of milk')
check('lineSummary tolerates modifiers being absent (the `?? []` guard)', (() => { const r = F.lineSummary({ qty: 1, name: T('א', 'a', ''), type_label: null, variant_label: null }, 'he'); return r === '1× א' })())
eq('timeLabel(null) -> ""', F.timeLabel(null), '')
eq('timeLabel("") -> ""', F.timeLabel(''), '')
eq('timeLabel(garbage) -> ""', F.timeLabel('garbage'), '')
check('timeLabel of a real timestamp is HH:MM', /^\d{1,2}:\d{2}$/.test(F.timeLabel('2026-10-02T12:34:56Z')), F.timeLabel('2026-10-02T12:34:56Z'))

// =====================================================================================
// colour.ts
// =====================================================================================
section('colour.ts — staffColourMap')
const PALETTE = M.vocab.STAFF_FALLBACK_PALETTE
const dir = (n, over = {}) => Array.from({ length: n }, (_, i) => ({ id: `id-${String(i).padStart(3, '0')}`, handle: `h${i}`, colour: null, ...over }))
{
  const d = dir(5)
  eq('deterministic: the same roster gives the same map', Array.from(staffColourMap(d)), Array.from(staffColourMap(d)))
  const shuffled = staffColourMap(shuffle(rng(1), d))
  eq('independent of input order', Array.from(staffColourMap(d)).sort(), Array.from(shuffled).sort())
  eq('colourless people take the palette in id order', d.map((e) => staffColourMap(d).get(e.id)), PALETTE.slice(0, 5))
  eq('wraps around only after the palette is used up (9th person = 1st colour)', [staffColourMap(dir(9)).get('id-008'), staffColourMap(dir(9)).get('id-000')], [PALETTE[0], PALETTE[0]])
  eq('an explicit colour is kept verbatim', staffColourMap([{ id: 'a', handle: 'a', colour: '#123456' }]).get('a'), '#123456')
  eq('an empty-string colour counts as none', staffColourMap([{ id: 'a', handle: 'a', colour: '' }]).get('a'), PALETTE[0])
  eq('every person gets exactly one colour', staffColourMap(dir(12)).size, 12)
  eq('no people -> an empty map', staffColourMap([]).size, 0)
}
sweep('no two people share a colour while there are no more people than palette entries (1..8 colourless)', Array.from({ length: PALETTE.length }, (_, i) => i + 1), (n) => {
  const m = staffColourMap(dir(n))
  return new Set(m.values()).size === n
})
sweep('…also when some people have explicit colours taken from the palette', Array.from({ length: 300 }, (_, i) => i), (seed) => {
  const r = rng(seed + 500)
  const total = 1 + Math.floor(r() * PALETTE.length) // never more people than palette entries
  const explicitCount = Math.floor(r() * (total + 1))
  const explicitColours = shuffle(r, [...PALETTE]).slice(0, explicitCount)
  const people = Array.from({ length: total }, (_, i) => ({ id: `u${String(Math.floor(r() * 1e6)).padStart(7, '0')}-${i}`, handle: `h${i}`, colour: i < explicitCount ? explicitColours[i] : null }))
  const m = staffColourMap(shuffle(r, people))
  return new Set(Array.from(m.values()).map((c) => c.toLowerCase())).size === total
})
eq('handleInitial: Latin is upper-cased', handleInitial('dana'), 'D')
eq('handleInitial: Hebrew', handleInitial('דנה'), 'ד')
eq('handleInitial: null -> ?', handleInitial(null), '?')
eq('handleInitial: "" -> ?', handleInitial(''), '?')
eq('handleInitial: whitespace -> ?', handleInitial('   '), '?')
eq('handleInitial: an emoji is one character, not half of one', handleInitial('😀x'), '😀')
eq('handleInitial: leading space is ignored', handleInitial(' ab'), 'A')

// =====================================================================================
// i18n.ts
// =====================================================================================
section('i18n — completeness of every string that exists')
const ALL_STRINGS = M.i18n.allStrings()
const placeholders = (s) => new Set([...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))
const TECH = /\b(uuid|id|ids|session|sessions|point id|permission|permissions|sync|syncing|realtime|real-time|null|undefined|nan)\b/i
const EMOJI = /\p{Extended_Pictographic}/u
const strKeys = Object.keys(ALL_STRINGS)
console.log(`  (${strKeys.length} strings across ${I18N_AREA_FILES.length} area files)`)
check('allStrings() is a plain object', ALL_STRINGS !== null && typeof ALL_STRINGS === 'object' && !Array.isArray(ALL_STRINGS))
{
  const areas = {}
  for (const f of I18N_AREA_FILES) {
    const mod = await load(`lib/pos/i18n/${f.replace(/\.ts$/, '.mjs')}`)
    const exportName = Object.keys(mod).find((k) => k.endsWith('Strings'))
    areas[f.replace(/\.ts$/, '')] = { exportName, strings: exportName ? mod[exportName] : null }
  }
  for (const [area, { exportName, strings }] of Object.entries(areas)) {
    check(`area "${area}" exports ${area}Strings as an object`, exportName === `${area}Strings` && strings && typeof strings === 'object', `exports ${exportName}`)
    const bad = Object.keys(strings ?? {}).filter((k) => !k.startsWith(`${area}.`))
    check(`area "${area}": every key is namespaced "${area}.…" so areas can never collide`, bad.length === 0, `un-namespaced: ${bad.slice(0, 5).join(', ')}`)
  }
  const seen = new Map()
  const dupes = []
  for (const [area, { strings }] of Object.entries(areas)) for (const k of Object.keys(strings ?? {})) { if (seen.has(k)) dupes.push(`${k} (${seen.get(k)} & ${area})`); else seen.set(k, area) }
  check('no key is defined by two areas (the merge would silently let one win)', dupes.length === 0, dupes.slice(0, 5).join('; '))
  check('allStrings() has exactly the union of the areas', strKeys.length === seen.size)
}
sweep('every Hebrew string is a non-empty string', strKeys, (k) => typeof ALL_STRINGS[k].he === 'string' && ALL_STRINGS[k].he.trim().length > 0)
sweep('an English string, when present, is non-empty (an empty one would display blank instead of falling back)', strKeys.filter((k) => 'en' in ALL_STRINGS[k]), (k) => typeof ALL_STRINGS[k].en === 'string' && ALL_STRINGS[k].en.trim().length > 0)
sweep('every {placeholder} in the Hebrew string also exists in the English one', strKeys.filter((k) => typeof ALL_STRINGS[k].en === 'string'), (k) => [...placeholders(ALL_STRINGS[k].he)].every((p) => placeholders(ALL_STRINGS[k].en).has(p)))
sweep('no string shows an employee a technical word (id, session, sync, realtime, permission …)', strKeys, (k) => !TECH.test(ALL_STRINGS[k].he) && !TECH.test(ALL_STRINGS[k].en ?? ''))
sweep('no string uses an emoji as an icon', strKeys, (k) => !EMOJI.test(ALL_STRINGS[k].he) && !EMOJI.test(ALL_STRINGS[k].en ?? ''))
sweep('translate() with no params returns the Hebrew/English text untouched, falling back to Hebrew', strKeys, (k) => M.i18n.translate(k, 'he') === ALL_STRINGS[k].he && M.i18n.translate(k, 'en') === (ALL_STRINGS[k].en ?? ALL_STRINGS[k].he))
eq('translate() of an unknown key returns the key (visible, not blank)', M.i18n.translate('no.such.key', 'he'), 'no.such.key')

section('i18n — translate() behaviour, on a fixture catalogue')
{
  // The real i18n.ts, transpiled against a fixture of area files, so interpolation
  // is tested even while the real areas are still empty.
  const areaImports = [...readFileSync(join(POS, 'i18n.ts'), 'utf8').matchAll(/import \{ (\w+) \} from '(\.\/i18n\/\w+)'/g)].map((m) => ({ name: m[1], spec: m[2] }))
  const fxFile = join(outDir, 'fx', 'fixture.mjs')
  mkdirSync(dirname(fxFile), { recursive: true })
  writeFileSync(fxFile, areaImports.map(({ name }) => (name === 'coreStrings'
    ? `export const coreStrings = {
  'core.hello': { he: 'שלום {name}', en: 'Hello {name}' },
  'core.heOnly': { he: 'רק עברית' },
  'core.two': { he: '{a} מתוך {b}', en: '{a} of {b}' },
  'core.twice': { he: '{n} ועוד {n}', en: '{n} and {n}' },
  'core.count': { he: '{n} פריטים', en: '{n} items' },
  'core.plain': { he: 'ללא פרמטרים', en: 'No params' },
}`
    : `export const ${name} = {}`)).join('\n'))
  const overrides = Object.fromEntries(areaImports.map(({ spec }) => [spec, pathToFileURL(fxFile).href]))
  const fxOut = join(outDir, 'fx', 'i18n.mjs')
  emit(join(POS, 'i18n.ts'), { to: fxOut, overrides })
  const fx = await import(pathToFileURL(fxOut).href)
  const tr = fx.translate
  eq('interpolates a named placeholder (he)', tr('core.hello', 'he', { name: 'דנה' }), 'שלום דנה')
  eq('interpolates a named placeholder (en)', tr('core.hello', 'en', { name: 'Dana' }), 'Hello Dana')
  eq('no params leaves the placeholder as written', tr('core.hello', 'he'), 'שלום {name}')
  eq('a missing param leaves the placeholder VISIBLE (a typo shows up in review)', tr('core.hello', 'he', {}), 'שלום {name}')
  eq('a wrong param name leaves the placeholder visible', tr('core.hello', 'he', { nme: 'x' }), 'שלום {name}')
  eq('English falls back to Hebrew when there is no English', tr('core.heOnly', 'en'), 'רק עברית')
  eq('two placeholders', tr('core.two', 'en', { a: 3, b: 5 }), '3 of 5')
  eq('the same placeholder twice is replaced both times', tr('core.twice', 'en', { n: 7 }), '7 and 7')
  eq('a numeric 0 is interpolated, not treated as missing', tr('core.count', 'en', { n: 0 }), '0 items')
  eq('a number is stringified', tr('core.count', 'he', { n: 12 }), '12 פריטים')
  eq('a "$&" in a param is literal text, not a regex back-reference', tr('core.hello', 'en', { name: '$&' }), 'Hello $&')
  eq('a param value that looks like a placeholder is not interpolated again', tr('core.two', 'en', { a: '{b}', b: 'X' }), '{b} of X')
  eq('extra params are ignored', tr('core.plain', 'en', { zzz: 1 }), 'No params')
  eq('an unknown key returns the key', tr('core.nope', 'en'), 'core.nope')
  eq('allStrings() of the fixture is its catalogue', Object.keys(fx.allStrings()).sort(), ['core.count', 'core.heOnly', 'core.hello', 'core.plain', 'core.twice', 'core.two'])
}

// =====================================================================================
// columns.ts / vocab.ts vs the SCHEMA (parsed from the migrations)
// =====================================================================================
function tableBody(sqlText, table) {
  const m = new RegExp(`create table if not exists public\\.${table}\\s*\\(`, 'i').exec(sqlText)
  if (!m) return null
  let depth = 1
  let inQ = false
  let i = m.index + m[0].length
  const start = i
  for (; i < sqlText.length && depth > 0; i++) {
    const c = sqlText[i]
    if (inQ) { if (c === "'") inQ = false; continue }
    if (c === "'") { inQ = true; continue }
    if (c === '(') depth++
    else if (c === ')') depth--
  }
  return sqlText.slice(start, i - 1)
}
function splitTopLevel(body) {
  const parts = []
  let depth = 0
  let inQ = false
  let cur = ''
  for (const c of body) {
    if (inQ) { cur += c; if (c === "'") inQ = false; continue }
    if (c === "'") { inQ = true; cur += c; continue }
    if (c === '(') depth++
    if (c === ')') depth--
    if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue }
    cur += c
  }
  if (cur.trim()) parts.push(cur)
  return parts.map((p) => p.trim()).filter(Boolean)
}
const CONSTRAINT_WORDS = new Set(['constraint', 'unique', 'primary', 'check', 'foreign', 'exclude'])
function columnDefs(table) {
  const body = tableBody(SQL, table)
  if (!body) return null
  const defs = splitTopLevel(body)
    .filter((p) => !CONSTRAINT_WORDS.has(p.split(/\s+/)[0].toLowerCase()))
    .map((p) => { const [name, ...rest] = p.split(/\s+/); return { name, def: rest.join(' ') } })
  // columns a later migration ADDs (015 adds base_agorot + modifiers to pos_order_items)
  for (const m of SQL.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?public\.(\w+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)\s+([^;]*)/gi)) {
    if (m[1] === table && !defs.some((d) => d.name === m[2])) defs.push({ name: m[2], def: m[3].trim() })
  }
  return defs
}
const colDef = (table, column) => columnDefs(table)?.find((d) => d.name === column)?.def ?? ''
const inList = (text) => { const m = /\bin\s*\(([^)]*)\)/i.exec(text); return m ? [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]) : null }
function typeFields(src, name) {
  const m = new RegExp(`export type ${name} = \\{`).exec(src)
  if (!m) return null
  let depth = 1
  let i = m.index + m[0].length
  const start = i
  for (; i < src.length && depth > 0; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') depth-- }
  const body = src.slice(start, i - 1).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  let d = 0
  let flat = ''
  for (const c of body) { if (c === '{') { d++; continue } if (c === '}') { d--; continue } if (d === 0) flat += c }
  return [...flat.matchAll(/(?:^|[;\n])\s*(\w+)\??\s*:/g)].map((x) => x[1])
}
const splitCols = (s) => s.split(',').map((x) => x.trim()).filter(Boolean)

section('columns.ts — every *_COLUMNS list is its table, and its row type (drift check)')
check('the POS migrations were found and parsed', posMigrationFiles.includes('014_pos_core.sql') && posMigrationFiles.includes('015_pos_modifiers.sql'), posMigrationFiles.join(', '))
// Bookkeeping columns the browser deliberately never selects. Listed explicitly so a NEW
// column that nobody remembered to select is a failure, while these four are a decision.
const NOT_SELECTED = {
  pos_points: ['created_at', 'created_by', 'updated_at'],
  pos_point_routes: ['created_at'],
}
for (const [constName, table, typeName] of [
  ['SESSION_COLUMNS', 'pos_sessions', 'PosSession'], ['POINT_COLUMNS', 'pos_points', 'PosPoint'], ['ROUTE_COLUMNS', 'pos_point_routes', 'PosRoute'],
  ['POINT_STAFF_COLUMNS', 'pos_point_staff', 'PosPointStaff'], ['ORDER_COLUMNS', 'pos_orders', 'PosOrder'], ['ITEM_COLUMNS', 'pos_order_items', 'PosItem'],
  ['EVENT_COLUMNS', 'pos_events', 'PosEvent'], ['CHECKIN_COLUMNS', 'pos_point_checkins', 'PosCheckin'],
]) {
  const list = splitCols(M.columns[constName] ?? '')
  const tableCols = columnDefs(table)?.map((d) => d.name) ?? null
  const skipped = NOT_SELECTED[table] ?? []
  check(`${constName}: ${table} was found in the migrations`, tableCols !== null && tableCols.length > 0)
  if (!tableCols) continue
  check(`${constName}: no duplicate columns`, new Set(list).size === list.length)
  const phantom = list.filter((c) => !tableCols.includes(c))
  check(`${constName}: selects no column the table does not have (a phantom column 400s every read)`, phantom.length === 0, `phantom: ${phantom.join(', ')}`)
  const missing = tableCols.filter((c) => !list.includes(c) && !skipped.includes(c))
  check(`${constName}: omits no column of ${table}${skipped.length ? ` except the deliberate ${skipped.join('/')}` : ''}`, missing.length === 0, `missing: ${missing.join(', ')}`)
  check(`${constName}: the deliberately-unselected columns really exist (no stale allow-list)`, skipped.every((c) => tableCols.includes(c)))
  const fields = typeFields(TYPES_SRC, typeName)
  check(`${constName}: ${typeName}'s fields are exactly the selected columns`, fields !== null && sameSet(fields, list), `type ${show(fields)} vs list ${show(list)}`)
}
{
  const m = /create or replace view public\.pos_staff_directory[\s\S]*?\bselect\s+([\s\S]*?)\s+from\b/i.exec(SQL)
  const viewCols = m ? splitCols(m[1]) : null
  check('DIRECTORY_COLUMNS is exactly what pos_staff_directory exposes', viewCols !== null && sameSet(splitCols(M.columns.DIRECTORY_COLUMNS), viewCols), `view ${show(viewCols)}`)
  check('…and StaffDirEntry has those fields', sameSet(typeFields(TYPES_SRC, 'StaffDirEntry') ?? [], splitCols(M.columns.DIRECTORY_COLUMNS)))
  const rt = /foreach t in array array\[([^\]]+)\]\s*loop\s*if not exists \(\s*select 1 from pg_publication_tables/i.exec(SQL)
  const published = rt ? [...rt[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : null
  check('REALTIME_TABLES is exactly the set added to the supabase_realtime publication', published !== null && sameSet([...M.columns.REALTIME_TABLES], published), `sql ${show(published)}`)
  check('ORDER_EMBED embeds exactly ORDER_COLUMNS (an inner join on the order)', M.columns.ORDER_EMBED === `pos_orders!inner(${M.columns.ORDER_COLUMNS})`)
}
{
  const snapKeys = (() => {
    const flat = readFileSync(join(MIG_DIR, '015_pos_modifiers.sql'), 'utf8').replace(/\r?\n--\s*/g, ' ')
    const m = /\{ (group_uid[\s\S]*?source:\{he,en,ar\}\|null) \}/.exec(flat)
    if (!m) return null
    const body = m[1].replace(/\{[^}]*\}/g, '')
    return body.split(',').map((x) => /^\s*(\w+)/.exec(x)?.[1]).filter(Boolean)
  })()
  const tsSnapFields = typeFields(TYPES_SRC, 'ModifierSnapshot')
  const emitted = price({ itemUid: 'i-latte', qty: 1 }, fullCtx).line?.modifiers?.[0]
  check('ModifierSnapshot (015\'s documented shape) == the TS type == what priceLine emits', snapKeys !== null && sameSet(snapKeys, tsSnapFields ?? []) && sameSet(Object.keys(emitted ?? {}), tsSnapFields ?? []), `015 ${show(snapKeys)} ts ${show(tsSnapFields)} emitted ${show(Object.keys(emitted ?? {}))}`)
  const insertKeys = (() => {
    const fn = /create or replace function public\.pos_insert_lines[\s\S]*?\$\$;/i.exec(SQL_015)?.[0] ?? ''
    return [...new Set([...fn.matchAll(/e\.l ->>? '(\w+)'/g)].map((m) => m[1]))]
  })()
  const resolved = typeFields(TYPES_SRC, 'ResolvedLine') ?? []
  check('ResolvedLine has exactly the keys pos_insert_lines reads from p_lines', sameSet(insertKeys, resolved), `sql reads ${show(insertKeys.sort())}, ts ${show([...resolved].sort())}`)
}

section('vocab.ts — the TS caps, patterns and vocabularies are the SQL ones')
{
  const orders = tableBody(SQL, 'pos_orders') ?? ''
  const items = tableBody(SQL, 'pos_order_items') ?? ''
  const points = tableBody(SQL, 'pos_points') ?? ''
  const grab = (text, re, label, group = 1) => {
    const m = re.exec(text)
    if (!m) { check(`SQL pattern for ${label} was found`, false, `no match for ${re}`); return null }
    return Number(m[group])
  }
  eq('customerNameMax == pos_orders.customer_name CHECK', LIMITS.customerNameMax, grab(orders, /customer_name\s+text not null check \(char_length\(btrim\(customer_name\)\) between 1 and (\d+)\)/, 'customer_name'))
  eq('receiptRefMax == pos_orders.receipt_ref CHECK', LIMITS.receiptRefMax, grab(orders, /char_length\(receipt_ref\) <= (\d+)/, 'receipt_ref'))
  eq('orderNoteMax == pos_orders.note CHECK', LIMITS.orderNoteMax, grab(orders, /note\s+text check \(note is null or char_length\(note\) <= (\d+)\)/, 'orders.note'))
  eq('lineNoteMax == pos_order_items.note CHECK', LIMITS.lineNoteMax, grab(items, /note\s+text check \(note is null or char_length\(note\) <= (\d+)\)/, 'items.note'))
  eq('forNameMax == pos_order_items.for_name CHECK', LIMITS.forNameMax, grab(items, /char_length\(for_name\) <= (\d+)/, 'for_name'))
  eq('voidReasonMax == pos_order_items.void_reason CHECK', LIMITS.voidReasonMax, grab(items, /char_length\(void_reason\) <= (\d+)/, 'void_reason'))
  eq('qtyMax == pos_order_items.qty CHECK', LIMITS.qtyMax, grab(items, /qty\s+integer not null check \(qty between 1 and (\d+)\)/, 'qty'))
  eq('unitAgorotMax == pos_order_items.unit_agorot CHECK', LIMITS.unitAgorotMax, grab(items, /unit_agorot\s+integer not null check \(unit_agorot between 0 and (\d+)\)/, 'unit_agorot'))
  eq('unitAgorotMax == the base_agorot CHECK (015)', LIMITS.unitAgorotMax, grab(SQL_015, /base_agorot between 0 and (\d+)/, 'base_agorot'))
  eq('unitAgorotMax == the per-modifier |delta| bound (015)', LIMITS.unitAgorotMax, grab(SQL_015, /abs\(\(m ->> 'price_delta_agorot'\)::int\) > (\d+)/, 'modifier delta'))
  eq('pointNameMax == pos_points.name CHECK', LIMITS.pointNameMax, grab(points, /char_length\(btrim\(name\)\) between 1 and (\d+)/, 'point name'))
  eq('prepMinutesMin == pos_points.prep_minutes CHECK', LIMITS.prepMinutesMin, grab(points, /prep_minutes between (\d+) and \d+/, 'prep min'))
  eq('prepMinutesMax == pos_points.prep_minutes CHECK', LIMITS.prepMinutesMax, grab(points, /prep_minutes between \d+ and (\d+)/, 'prep max'))
  eq('linesPerOrderMax == the validator\'s line-count bound (015)', LIMITS.linesPerOrderMax, grab(SQL_015, /jsonb_array_length\(p_lines\) > (\d+)/, 'lines per order'))
  eq('modifiersPerLineMax == the validator\'s bound (015)', LIMITS.modifiersPerLineMax, grab(SQL_015, /jsonb_array_length\(mods\) > (\d+)/, 'modifiers per line (validator)'))
  eq('modifiersPerLineMax == the table CHECK (015)', LIMITS.modifiersPerLineMax, grab(SQL_015, /jsonb_array_length\(modifiers\) <= (\d+)/, 'modifiers per line (check)'))
  check('modifierQtyMax 9 == the validator\'s one-digit quantity pattern (015)', LIMITS.modifierQtyMax === 9 && /m \? 'qty' and coalesce\(m ->> 'qty', ''\) !~ '\^\[1-9\]\$'/.test(SQL_015))
  const hm = /\{(\d+),(\d+)\}\$/.exec(/check \(handle ~ '([^']+)'\)/.exec(SQL_014)?.[1] ?? '')
  eq('handleMin/handleMax == the staff_handle_format repetition {2,16}', [LIMITS.handleMin, LIMITS.handleMax], hm ? [Number(hm[1]), Number(hm[2])] : null)
  const pm = /\{(\d+),(\d+)\}\$/.exec(/customer_phone ~ '([^']+)'/.exec(SQL_014)?.[1] ?? '')
  eq('phoneDigitsMin/Max == the customer_phone CHECK repetition {7,15}', [LIMITS.phoneDigitsMin, LIMITS.phoneDigitsMax], pm ? [Number(pm[1]), Number(pm[2])] : null)
  const ret = /pos_clear_old_pii\(p_phone_days int default (\d+), p_name_days int default (\d+)\)/.exec(SQL_014)
  eq('RETENTION == pos_clear_old_pii\'s defaults (and the blueprint: 30 / 365 days)', [RETENTION.phoneDays, RETENTION.nameDays], ret ? [Number(ret[1]), Number(ret[2])] : null)
  eq('RETENTION is the blueprint\'s 30 / 365', [RETENTION.phoneDays, RETENTION.nameDays], [30, 365])
  eq('advanceBody\'s id cap == pos_advance_items\' cardinality bound', (() => { const r = rng(1); void r; return 100 })(), grab(SQL_014, /cardinality\(p_ids\) > (\d+)/, 'advance ids'))
  eq('a hand-typed item\'s ceiling is ₪999.99 (blueprint §7.1)', LIMITS.customUnitAgorotMax, 99999)

  // The pos_events.event CHECK is defined inline in 014 and RE-CREATED by later migrations (016 added
  // pin_changed + quick_login). The database enforces the LAST definition in file order, so that is the
  // one TS must agree with — never 014's. Parenthesis-matched so it does not depend on how the list wraps.
  const SQL_016 = stripSqlComments(readFileSync(join(MIG_DIR, '016_pos_quick_login.sql'), 'utf8'))
  const matchParen = (text, openAt) => {
    let depth = 0
    let inQ = false
    for (let i = openAt; i < text.length; i++) {
      const c = text[i]
      if (inQ) { if (c === "'") inQ = false; continue }
      if (c === "'") { inQ = true; continue }
      if (c === '(') depth++
      else if (c === ')' && --depth === 0) return text.slice(openAt + 1, i)
    }
    return null
  }
  let latestEventCheck = null
  let latestEventCheckFile = null
  for (const f of migrationFiles) {
    const text = stripSqlComments(readFileSync(join(MIG_DIR, f), 'utf8'))
    const named = /pos_events_event_check\s+check\s*\(/gi
    let m
    let found = null
    while ((m = named.exec(text))) found = inList(matchParen(text, m.index + m[0].length - 1) ?? '') ?? found
    if (found === null) {
      const body = tableBody(text, 'pos_events')
      const col = body ? splitTopLevel(body).find((p) => /^event\s/i.test(p)) : null
      if (col) found = inList(col)
    }
    if (found) { latestEventCheck = found; latestEventCheckFile = f }
  }
  const events = latestEventCheck
  check('the pos_events.event CHECK is last defined by a migration at or after 016 (so 016\'s widening is the one compared)', latestEventCheckFile !== null && latestEventCheckFile >= '016', `latest definition is in ${latestEventCheckFile}`)
  check('POS_EVENT_TYPES == the LATEST pos_events.event CHECK (the audit vocabulary is complete)', events !== null && sameSet([...M.types.POS_EVENT_TYPES], events), `sql ${show(events)}`)
  check('the 014 definition is a strict subset of the latest (later migrations only widen)', (() => { const first = inList(colDef('pos_events', 'event')); return first !== null && events !== null && first.every((e) => events.includes(e)) && first.length < events.length })())
  check('…and the PosEventType union lists the same members', sameSet(unionMembers(TYPES_SRC, 'PosEventType') ?? [], events ?? []))
  const blueprintEvents = ['order_created', 'items_added', 'order_edited', 'item_claimed', 'item_ready', 'item_picked_up', 'item_delivered', 'item_reverted', 'item_voided', 'order_voided', 'order_completed', 'session_opened', 'session_closed', 'training_wiped', 'point_created', 'point_updated', 'point_deactivated', 'routes_changed', 'checkin', 'checkout', 'handle_changed', 'board_token_rotated', 'settings_changed', 'pii_cleared', 'pin_changed', 'quick_login']
  check('…and the event list is the blueprint §13.1 list, no more, no fewer', sameSet([...M.types.POS_EVENT_TYPES], blueprintEvents))
  const itemStatuses = inList(colDef('pos_order_items', 'status'))
  check('ITEM_STATUSES == the pos_order_items.status CHECK', itemStatuses !== null && sameSet([...M.types.ITEM_STATUSES], itemStatuses), `sql ${show(itemStatuses)}`)
  check('…and ItemStatus lists the same members', sameSet(unionMembers(TYPES_SRC, 'ItemStatus') ?? [], itemStatuses ?? []))
  const voidedFrom = inList(colDef('pos_order_items', 'voided_from'))
  check('voided_from allows every status except voided', voidedFrom !== null && sameSet(voidedFrom, M.types.ITEM_STATUSES.filter((s) => s !== 'voided')))
  const orderStatuses = inList(colDef('pos_orders', 'status'))
  check('OrderStatus == the pos_orders.status CHECK', orderStatuses !== null && sameSet(unionMembers(TYPES_SRC, 'OrderStatus') ?? [], orderStatuses))
  check('SessionKind == the pos_sessions.kind CHECK', sameSet(unionMembers(TYPES_SRC, 'SessionKind') ?? [], inList(colDef('pos_sessions', 'kind')) ?? []))
  check('SessionStatus == the pos_sessions.status CHECK', sameSet(unionMembers(TYPES_SRC, 'SessionStatus') ?? [], inList(colDef('pos_sessions', 'status')) ?? []))
  const routeKinds = inList(colDef('pos_point_routes', 'kind'))
  check('PosRoute.kind == the pos_point_routes.kind CHECK', routeKinds !== null && sameSet([...(/kind:\s*([^\n]*)/.exec(/export type PosRoute = \{[\s\S]*?\n\}/.exec(TYPES_SRC)?.[0] ?? '')?.[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1]), routeKinds))
  const checkinEvents = inList(colDef('pos_point_checkins', 'event'))
  check('PosCheckin.event == the pos_point_checkins.event CHECK', checkinEvents !== null && sameSet([...(/event:\s*([^\n]*)/.exec(/export type PosCheckin = \{[\s\S]*?\n\}/.exec(TYPES_SRC)?.[0] ?? '')?.[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1]), checkinEvents))
  const sqlKinds = (() => { const m = /coalesce\(m ->> 'kind', ''\) not in \(([^)]*)\)/.exec(SQL_015); return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : null })()
  check('the five modifier kinds == the CHECK in pos_validate_lines (015) == the ModifierKind type', sqlKinds !== null && sqlKinds.length === 5 && sameSet(sqlKinds, unionMembers(MENU_TYPES_SRC, 'ModifierKind') ?? []), `sql ${show(sqlKinds)}`)
  check('the IN_FLIGHT / LIVE status lists are the blueprint\'s (sent+preparing / +ready)', sameSet([...M.vocab.IN_FLIGHT_ITEM_STATUSES], ['sent', 'preparing']) && sameSet([...M.vocab.LIVE_ITEM_STATUSES], ['sent', 'preparing', 'ready']))
}

section('vocab.ts — the numbers the blueprint states')
eq('realtime debounce 150 ms', REFRESH.realtimeDebounceMs, 150)
eq('watchdog tick 5 s, socket considered dead after 15 s', [REFRESH.watchdogTickMs, REFRESH.deadSocketMs], [5000, 15000])
eq('backup poll 8 s (it drives the same refresh key the socket drives)', REFRESH.backupPollMs, 8000)
eq('menu stamp poll 20 s', REFRESH.menuPollMs, 20000)
eq('Ready board poll 3 s', REFRESH.boardPollMs, 3000)
eq('dashboard poll 30 s; realtime refetch at most every 2 s', [REFRESH.dashboardPollMs, REFRESH.dashboardMinRefetchMs], [30000, 2000])
eq('outbox backoff 1 s -> 15 s cap', [OUTBOX.backoffStartMs, OUTBOX.backoffCapMs], [1000, 15000])
eq('the outbox storage key is per branch and versioned (blueprint §10.4)', OUTBOX.storageKeyPrefix, 'sarcafe.pos.outbox.v1.')
eq('undo windows: 30 s after sending, 30 s after handing over', [UNDO.sendWindowS, UNDO.deliveredWindowS], [30, 30])
eq('a delivered card lingers ~5 s; a ghost lasts 10 minutes; history shows 60 lines', [STATION.doneLingerMs, STATION.ghostMs, STATION.historyLimit], [5000, 600000, 60])
eq('stuck = max(4 minutes, 2 x prep_minutes)', [DASHBOARD.stuckMinMinutes, DASHBOARD.stuckFactor], [4, 2])
eq('uncollected after 5 minutes; a session open > 16 h raises a signal', [DASHBOARD.uncollectedMinutes, DASHBOARD.sessionOpenTooLongHours], [5, 16])
eq('rate limits: 60 orders / 300 advances / 10 handle changes (hour) / 120 board per minute', [RATE.createOrderPerMin, RATE.advancePerMin, RATE.handlePerHour, RATE.boardPerMin], [60, 300, 10, 120])
eq('prep presets are 3 / 8 / 15 minutes (fast / medium / slow)', M.vocab.PREP_PRESETS.map((p) => [p.key, p.minutes]), [['fast', 3], ['medium', 8], ['slow', 15]])
check('every prep preset is inside the database\'s 1..120', M.vocab.PREP_PRESETS.every((p) => p.minutes >= LIMITS.prepMinutesMin && p.minutes <= LIMITS.prepMinutesMax))
check('void reasons: unique keys, Hebrew text within the 60-character cap, and "typing mistake" exists', new Set(M.vocab.VOID_REASONS.map((r) => r.key)).size === M.vocab.VOID_REASONS.length && M.vocab.VOID_REASONS.every((r) => r.he.length > 0 && r.he.length <= LIMITS.voidReasonMax && r.en.length > 0) && M.vocab.VOID_REASONS.some((r) => r.he === 'טעות הקלדה'))
check('the uncollected void reason fits the 60-character cap', M.vocab.UNCOLLECTED_REASON.length > 0 && M.vocab.UNCOLLECTED_REASON.length <= LIMITS.voidReasonMax)
check('point icons are unique and match the pos_points.icon CHECK', new Set(M.vocab.POINT_ICONS).size === M.vocab.POINT_ICONS.length && M.vocab.POINT_ICONS.every((i) => /^[a-z0-9-]{1,30}$/.test(i)))
{
  const css = (() => { try { return readFileSync(join(SRC, 'app', 'globals.css'), 'utf8') } catch { return '' } })()
  const token = (name) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1]?.toLowerCase()
  const semantic = ['ok', 'warn', 'danger', 'neon-2'].map(token).filter(Boolean)
  for (const [label, list] of [['POINT_COLOURS', M.vocab.POINT_COLOURS], ['STAFF_FALLBACK_PALETTE', M.vocab.STAFF_FALLBACK_PALETTE]]) {
    check(`${label}: unique, valid hex (the pos_points.colour / staff_colour_format CHECK)`, new Set(list.map((c) => c.toLowerCase())).size === list.length && list.every((c) => /^#[0-9a-fA-F]{6}$/.test(c)))
    check(`${label}: none is exactly a semantic token (--ok / --warn / --danger / --neon-2)`, semantic.length === 4 && list.every((c) => !semantic.includes(c.toLowerCase())), `semantic tokens read: ${semantic.join(', ')}`)
  }
}

// =====================================================================================
// api.ts — the zod request schemas
// =====================================================================================
section('api.ts — lineInputSchema (ids and counts only, nothing the browser may decide)')
const AP = M.api
const U1 = '3f2b8c1e-6a4d-4e5f-9a7b-1c2d3e4f5a6b'
const U2 = '9d1e2f3a-4b5c-4d6e-8f70-a1b2c3d4e5f6'
const ok_ = (schema, v) => schema.safeParse(v).success
const accepts = (name, schema, v) => check(`accepts: ${name}`, ok_(schema, v), show(schema.safeParse(v).error?.issues?.[0]))
const rejects = (name, schema, v) => check(`rejects: ${name}`, !ok_(schema, v))
const catLine = { itemUid: 'i-1', qty: 2 }
const customLine = { custom: { name: 'מים', priceAgorot: 0, pointId: U1 }, qty: 1 }
accepts('a minimal catalogue line', AP.lineInputSchema, catLine)
accepts('a fully-loaded catalogue line', AP.lineInputSchema, { itemUid: 'i-1', typeUid: 't1', priceChoice: 1, modifiers: [{ groupUid: 'g', optionUid: 'o', qty: 2 }, { groupUid: 'g2', optionUid: 'o2' }], qty: 3, note: 'x', forName: 'y' })
accepts('nullable fields set to null', AP.lineInputSchema, { itemUid: 'i-1', typeUid: null, priceChoice: null, note: null, forName: null, qty: 1 })
accepts('an explicit empty modifiers list (means "no modifiers", not as-is)', AP.lineInputSchema, { ...catLine, modifiers: [] })
accepts('a free hand-typed line (price 0)', AP.lineInputSchema, customLine)
accepts('a custom line with a note and for-whom', AP.lineInputSchema, { ...customLine, note: 'n', forName: 'f' })
for (const key of ['price', 'priceAgorot', 'unit_agorot', 'unitAgorot', 'point_id', 'pointId', 'name', 'label', 'status', 'createdBy', 'total']) {
  rejects(`a catalogue line smuggling "${key}" (the browser never chooses it)`, AP.lineInputSchema, { ...catLine, [key]: key === 'status' ? 'ready' : 1 })
}
rejects('a custom line with an extra key', AP.lineInputSchema, { ...customLine, extra: 1 })
rejects('a custom line that also names a catalogue item (mixed shape)', AP.lineInputSchema, { ...customLine, itemUid: 'i-1' })
rejects('a custom object with an extra key', AP.lineInputSchema, { custom: { ...customLine.custom, unit: 1 }, qty: 1 })
for (const bad of [0, 100, 1.5, '2', null, -1, NaN]) rejects(`qty ${show(bad)}`, AP.lineInputSchema, { ...catLine, qty: bad })
rejects('a missing qty', AP.lineInputSchema, { itemUid: 'i-1' })
accepts('qty 99 (the cap is inclusive)', AP.lineInputSchema, { ...catLine, qty: 99 })
for (const bad of [-1, 10, 1.5, '0']) rejects(`priceChoice ${show(bad)}`, AP.lineInputSchema, { ...catLine, priceChoice: bad })
rejects('an empty itemUid', AP.lineInputSchema, { itemUid: '', qty: 1 })
rejects('a missing itemUid', AP.lineInputSchema, { qty: 1 })
rejects('an 81-character itemUid', AP.lineInputSchema, { itemUid: 'x'.repeat(81), qty: 1 })
rejects('a modifier selection with a price in it', AP.lineInputSchema, { ...catLine, modifiers: [{ groupUid: 'g', optionUid: 'o', priceDeltaAgorot: 0 }] })
for (const bad of [0, 10, 1.5]) rejects(`a modifier qty of ${bad}`, AP.lineInputSchema, { ...catLine, modifiers: [{ groupUid: 'g', optionUid: 'o', qty: bad }] })
accepts('a modifier qty of 9', AP.lineInputSchema, { ...catLine, modifiers: [{ groupUid: 'g', optionUid: 'o', qty: 9 }] })
rejects('an empty groupUid', AP.lineInputSchema, { ...catLine, modifiers: [{ groupUid: '', optionUid: 'o' }] })
accepts('exactly 24 modifier selections', AP.lineInputSchema, { ...catLine, modifiers: Array.from({ length: 24 }, (_, i) => ({ groupUid: `g${i}`, optionUid: 'o' })) })
rejects('25 modifier selections', AP.lineInputSchema, { ...catLine, modifiers: Array.from({ length: 25 }, (_, i) => ({ groupUid: `g${i}`, optionUid: 'o' })) })
rejects('a note over 240', AP.lineInputSchema, { ...catLine, note: 'x'.repeat(241) })
rejects('a for-name over 80', AP.lineInputSchema, { ...catLine, forName: 'x'.repeat(81) })
for (const bad of [-1, 100000, 12.5, '100']) rejects(`custom price ${show(bad)}`, AP.lineInputSchema, { custom: { ...customLine.custom, priceAgorot: bad }, qty: 1 })
accepts('custom price 99999 (₪999.99)', AP.lineInputSchema, { custom: { ...customLine.custom, priceAgorot: 99999 }, qty: 1 })
rejects('a custom pointId that is not a uuid', AP.lineInputSchema, { custom: { ...customLine.custom, pointId: 'nope' }, qty: 1 })
rejects('an empty custom name', AP.lineInputSchema, { custom: { ...customLine.custom, name: '' }, qty: 1 })
rejects('an 81-character custom name', AP.lineInputSchema, { custom: { ...customLine.custom, name: 'x'.repeat(81) }, qty: 1 })
eq('the schema\'s qty cap is vocab LIMITS.qtyMax', [ok_(AP.lineInputSchema, { ...catLine, qty: LIMITS.qtyMax }), ok_(AP.lineInputSchema, { ...catLine, qty: LIMITS.qtyMax + 1 })], [true, false])
eq('the schema\'s modifier caps are vocab LIMITS (24 per line, qty 9)', [ok_(AP.lineInputSchema, { ...catLine, modifiers: Array.from({ length: LIMITS.modifiersPerLineMax }, (_, i) => ({ groupUid: `g${i}`, optionUid: 'o' })) }), ok_(AP.lineInputSchema, { ...catLine, modifiers: [{ groupUid: 'g', optionUid: 'o', qty: LIMITS.modifierQtyMax }] }), ok_(AP.lineInputSchema, { ...catLine, modifiers: [{ groupUid: 'g', optionUid: 'o', qty: LIMITS.modifierQtyMax + 1 }] })], [true, true, false])
eq('the schema\'s custom-price ceiling is vocab LIMITS.customUnitAgorotMax', [ok_(AP.lineInputSchema, { custom: { ...customLine.custom, priceAgorot: LIMITS.customUnitAgorotMax }, qty: 1 }), ok_(AP.lineInputSchema, { custom: { ...customLine.custom, priceAgorot: LIMITS.customUnitAgorotMax + 1 }, qty: 1 })], [true, false])

section('api.ts — request bodies (strict: the actor, total and ticket never come from a body)')
const createOk = { branchId: U1, clientKey: U2, customerName: 'דנה', lines: [catLine] }
accepts('a minimal createOrderBody', AP.createOrderBody, createOk)
accepts('a full createOrderBody', AP.createOrderBody, { ...createOk, customerPhone: '054-123-4567', receiptRef: 'A-1', slipTotalAgorot: 5800, note: 'יאספו יחד', lines: [catLine, customLine] })
accepts('null optionals', AP.createOrderBody, { ...createOk, customerPhone: null, receiptRef: null, slipTotalAgorot: null, note: null })
for (const key of ['createdBy', 'actor', 'staffId', 'total', 'totalAgorot', 'sessionId', 'ticketNo', 'status', 'handle']) {
  rejects(`createOrderBody carrying "${key}"`, AP.createOrderBody, { ...createOk, [key]: key === 'status' ? 'completed' : 1 })
}
rejects('a bad branchId', AP.createOrderBody, { ...createOk, branchId: 'x' })
rejects('a bad clientKey', AP.createOrderBody, { ...createOk, clientKey: 'x' })
rejects('a missing clientKey (the idempotency key)', AP.createOrderBody, { branchId: U1, customerName: 'דנה', lines: [catLine] })
rejects('an empty customerName', AP.createOrderBody, { ...createOk, customerName: '' })
rejects('a 121-character customerName', AP.createOrderBody, { ...createOk, customerName: 'x'.repeat(121) })
rejects('an empty lines array', AP.createOrderBody, { ...createOk, lines: [] })
rejects('missing lines', AP.createOrderBody, { branchId: U1, clientKey: U2, customerName: 'דנה' })
accepts('exactly 60 lines', AP.createOrderBody, { ...createOk, lines: Array.from({ length: 60 }, () => catLine) })
rejects('61 lines', AP.createOrderBody, { ...createOk, lines: Array.from({ length: 61 }, () => catLine) })
eq('the line cap is vocab LIMITS.linesPerOrderMax', [ok_(AP.createOrderBody, { ...createOk, lines: Array.from({ length: LIMITS.linesPerOrderMax }, () => catLine) }), ok_(AP.createOrderBody, { ...createOk, lines: Array.from({ length: LIMITS.linesPerOrderMax + 1 }, () => catLine) })], [true, false])
for (const bad of [-1, 1.5, '5']) rejects(`slipTotalAgorot ${show(bad)}`, AP.createOrderBody, { ...createOk, slipTotalAgorot: bad })
rejects('a 41-character phone', AP.createOrderBody, { ...createOk, customerPhone: '1'.repeat(41) })
rejects('an invalid line inside lines', AP.createOrderBody, { ...createOk, lines: [catLine, { ...catLine, qty: 0 }] })
accepts('addItemsBody', AP.addItemsBody, { branchId: U1, lines: [catLine] })
rejects('addItemsBody with no lines', AP.addItemsBody, { branchId: U1, lines: [] })
rejects('addItemsBody carrying an orderId (the order is in the URL)', AP.addItemsBody, { branchId: U1, lines: [catLine], orderId: U2 })
accepts('editOrderBody', AP.editOrderBody, { branchId: U1, customerName: 'דנה', customerPhone: null })
rejects('editOrderBody with an empty name', AP.editOrderBody, { branchId: U1, customerName: '' })
rejects('editOrderBody carrying a total', AP.editOrderBody, { branchId: U1, customerName: 'דנה', total: 5 })
accepts('voidBody: omitted itemIds (cancel the whole order)', AP.voidBody, { branchId: U1, reason: 'טעות הקלדה' })
accepts('voidBody: null itemIds', AP.voidBody, { branchId: U1, reason: 'x', itemIds: null })
accepts('voidBody: some ids', AP.voidBody, { branchId: U1, reason: 'x', itemIds: [U1, U2] })
rejects('voidBody: an EMPTY id list (ambiguous with "all")', AP.voidBody, { branchId: U1, reason: 'x', itemIds: [] })
rejects('voidBody: a non-uuid id', AP.voidBody, { branchId: U1, reason: 'x', itemIds: ['nope'] })
rejects('voidBody: 101 ids', AP.voidBody, { branchId: U1, reason: 'x', itemIds: Array.from({ length: 101 }, () => U1) })
rejects('voidBody: an empty reason', AP.voidBody, { branchId: U1, reason: '' })
rejects('voidBody: a 61-character reason (the DB caps it at 60)', AP.voidBody, { branchId: U1, reason: 'x'.repeat(61) })
accepts('voidBody: a 60-character reason', AP.voidBody, { branchId: U1, reason: 'x'.repeat(60) })
rejects('voidBody: a manager flag from the browser', AP.voidBody, { branchId: U1, reason: 'x', manager: true })
accepts('advanceBody', AP.advanceBody, { branchId: U1, ids: [U1], from: 'sent', to: 'preparing' })
for (const s of ['voided', 'bogus', '']) {
  rejects(`advanceBody from "${s}"`, AP.advanceBody, { branchId: U1, ids: [U1], from: s, to: 'ready' })
  rejects(`advanceBody to "${s}"`, AP.advanceBody, { branchId: U1, ids: [U1], from: 'sent', to: s })
}
rejects('advanceBody with no ids', AP.advanceBody, { branchId: U1, ids: [], from: 'sent', to: 'ready' })
accepts('advanceBody with 100 ids', AP.advanceBody, { branchId: U1, ids: Array.from({ length: 100 }, () => U1), from: 'sent', to: 'ready' })
rejects('advanceBody with 101 ids (the RPC refuses more)', AP.advanceBody, { branchId: U1, ids: Array.from({ length: 101 }, () => U1), from: 'sent', to: 'ready' })
rejects('advanceBody carrying a manager flag', AP.advanceBody, { branchId: U1, ids: [U1], from: 'delivered', to: 'ready', manager: true })
accepts('checkinBody check_in', AP.checkinBody, { pointId: U1, event: 'check_in' })
accepts('checkinBody check_out', AP.checkinBody, { pointId: U1, event: 'check_out' })
rejects('checkinBody with another event', AP.checkinBody, { pointId: U1, event: 'checkin' })
rejects('checkinBody with a bad point id', AP.checkinBody, { pointId: 'x', event: 'check_in' })
rejects('checkinBody carrying a staff id (the actor is the session)', AP.checkinBody, { pointId: U1, event: 'check_in', staffId: U2 })
accepts('handleBody', AP.handleBody, { handle: 'דנה' })
rejects('handleBody empty', AP.handleBody, { handle: '' })
rejects('handleBody over 40 characters', AP.handleBody, { handle: 'x'.repeat(41) })
rejects('handleBody carrying a target (you cannot rename someone else from here)', AP.handleBody, { handle: 'דנה', target: U1 })
{
  const samples = {
    createOrderBody: createOk, addItemsBody: { branchId: U1, lines: [catLine] }, editOrderBody: { branchId: U1, customerName: 'דנה' },
    voidBody: { branchId: U1, reason: 'x' }, advanceBody: { branchId: U1, ids: [U1], from: 'sent', to: 'ready' },
    checkinBody: { pointId: U1, event: 'check_in' }, handleBody: { handle: 'דנה' },
  }
  const bodyNames = Object.keys(AP).filter((k) => /Body$/.test(k))
  check('every exported *Body schema has a sample here (a new body must be added to the harness)', sameSet(bodyNames, Object.keys(samples)), `exports ${bodyNames.join(', ')}`)
  for (const name of bodyNames) {
    if (!samples[name]) continue
    check(`${name} accepts its sample and is STRICT (an unknown key is rejected)`, ok_(AP[name], samples[name]) && !ok_(AP[name], { ...samples[name], __extra: 1 }))
  }
  check('lineInputSchema and the modifier schema are strict too', !ok_(AP.modifierSelectionSchema, { groupUid: 'g', optionUid: 'o', x: 1 }) && ok_(AP.modifierSelectionSchema, { groupUid: 'g', optionUid: 'o' }))
}

// =====================================================================================
// Purity — the pure modules stay pure
// =====================================================================================
section('purity — no React, Next, Supabase, DOM or server API in the pure modules')
{
  const GLOBALS = new Set(['window', 'document', 'localStorage', 'sessionStorage', 'navigator', 'indexedDB', 'XMLHttpRequest', 'fetch', 'process', 'require', 'globalThis', 'WebSocket', 'Audio', 'AudioContext'])
  const importAllowed = (spec) => spec.startsWith('./') || spec.startsWith('../') || spec === '@/lib/menu/types' || spec === 'zod'
  // cart / gestures / events / quick-jwt are pure too (quick-jwt may use atob — the middleware runs it on the edge).
  const files = [...PURE_MODULES.map((n) => join(POS, `${n}.ts`)), ...['cart', 'gestures', 'events', 'quick-jwt'].map((n) => join(POS, `${n}.ts`)), ...I18N_AREA_FILES.map((f) => join(POS, 'i18n', f))]
  for (const file of files) {
    const rel = relative(POS, file).split(sep).join('/')
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true)
    const problems = []
    const visit = (node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const spec = node.moduleSpecifier.text
        if (!importAllowed(spec)) problems.push(`imports "${spec}"`)
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) problems.push('dynamic import()')
      if (ts.isIdentifier(node) && GLOBALS.has(node.text)) {
        const p = node.parent
        const isMemberName = (ts.isPropertyAccessExpression(p) && p.name === node) || (ts.isPropertyAssignment(p) && p.name === node) || (ts.isPropertySignature(p) && p.name === node) || ts.isImportSpecifier(p) || ts.isExportSpecifier(p)
        const isDeclaration = (ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p)) && p.name === node
        if (!isMemberName && !isDeclaration) problems.push(`touches ${node.text}`)
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
    if (sf.statements.some((s) => ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression) && s.expression.text === 'use client')) problems.push('has a "use client" directive')
    check(`${rel} is pure`, problems.length === 0, [...new Set(problems)].join('; '))
  }
}

// =====================================================================================
// WAVE 2 — cart.ts (the cashier's cart: where a wrong rule costs money)
// =====================================================================================
const C = await load('lib/pos/cart.mjs')
const { lineInputSchema, createOrderBody, addItemsBody } = M.api
const DRAFT_TTL = C.DRAFT_TTL_MS
const W2NOW = Date.parse('2026-06-01T12:00:00Z')
const PA = '11111111-1111-4111-8111-111111111111'
const PB = '22222222-2222-4222-8222-222222222222'
const UUID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const UUID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const gBlock = grp('g-block', 'choice', { required: true, options: [opt('x', 'x', { available: false })] })
const gOptional = grp('g-opt', 'add', { options: [opt('o1', 'תוספת')] })
const cItems = {
  plain: mkItem('ci-plain', 'פשוט', 10),
  range: mkItem('ci-range', 'טווח', '14/16'),
  typed: mkItem('ci-typed', 'סוג', 12, { types: [{ uid: 'ty1', he: 'א', en: 'A', ar: 'ا', priceDelta: 2 }, { uid: 'ty2', he: 'ב', en: 'B', ar: 'ب' }] }),
  typedSome: mkItem('ci-typedsome', 'סוג-חלקי', 12, { types: [{ uid: 'ts1', he: 'א', available: false }, { uid: 'ts2', he: 'ב' }] }),
  typesGone: mkItem('ci-typesgone', 'סוגים-אזלו', 12, { types: [{ uid: 'tg1', he: 'א', available: false }, { uid: 'tg2', he: 'ב', quantity: 0 }] }),
  size: mkItem('ci-size', 'גודל', 20, { modifierGroupUids: ['g-size'] }),
  two: mkItem('ci-two', 'שתיים', 20, { modifierGroupUids: ['g-size', 'g-opt'] }),
  bread: mkItem('ci-bread', 'לחם', 20, { modifierGroupUids: ['g-bread'] }),
  block: mkItem('ci-block', 'חסום', 20, { modifierGroupUids: ['g-block'] }),
  optional: mkItem('ci-optional', 'אופציונלי', 9, { modifierGroupUids: ['g-opt'] }),
  sold: mkItem('ci-sold', 'אזל', 5, { available: false }),
  zero: mkItem('ci-zero', 'מלאי-אפס', 5, { quantity: 0 }),
  noPrice: mkItem('ci-noprice', 'ללא-מחיר', 'לפי משקל'),
  excl: mkItem('ci-excl', 'מוחרג', 5),
}
const cNoUid = { he: 'בלי-מזהה', en: 'no-uid', ar: 'no-uid', price: 5 }
const ccA = mkCat('cc-a', [...Object.values(cItems), cNoUid])
const ccB = mkCat('cc-b', [mkItem('ci-orph', 'יתום', 5)])
const ccC = mkCat('cc-c', [mkItem('ci-unsold', 'לא-נמכר', 5)])
const cctx = mkCtx({
  categories: [ccA, ccB, ccC],
  groups: [gSize, gBread, gBlock, gOptional],
  points: [pt(PA, { excluded_uids: ['ci-excl'] }), pt(PB)],
  routes: [rt('category', 'cc-a', PA)],
  unsold: ['c:cc-c'],
})
const mkLine = (input) => {
  const r = C.buildLine(input, cctx)
  if (!r.ok) throw new Error(`fixture line failed: ${r.problem.code}`)
  return r.line
}
const D0 = C.emptyDraft(W2NOW)
const addL = (d, l) => C.cartReducer(d, { type: 'add', line: l })
const customIn2 = (over = {}, c = {}) => ({ custom: { name: 'מים', priceAgorot: 300, pointId: PA, ...c }, qty: 1, ...over })

section('cart.ts — itemSellability: a tile is disabled WITH a reason, one per cause')
{
  const catOf = (item) => [ccA, ccB, ccC].find((c) => c.items.includes(item))
  const sell = (item) => C.itemSellability(item, catOf(item), cctx)
  for (const key of ['plain', 'range', 'typed', 'typedSome', 'size', 'two', 'bread', 'optional']) eq(`${key} is sellable`, sell(cItems[key]), { sellable: true })
  eq('available:false -> sold_out', sell(cItems.sold), { sellable: false, reason: 'sold_out' })
  eq('quantity:0 -> sold_out', sell(cItems.zero), { sellable: false, reason: 'sold_out' })
  eq('every type sold out -> sold_out', sell(cItems.typesGone), { sellable: false, reason: 'sold_out' })
  eq('one type left is enough to sell', sell(cItems.typedSome), { sellable: true })
  eq('an item with no uid cannot be ordered -> not_sold', sell(cNoUid), { sellable: false, reason: 'not_sold' })
  eq('a category no point makes -> no_point', sell(ccB.items[0]), { sellable: false, reason: 'no_point' })
  eq('a category the owner marked unsold -> not_sold', sell(ccC.items[0]), { sellable: false, reason: 'not_sold' })
  eq('an item its point opted out of -> not_sold', sell(cItems.excl), { sellable: false, reason: 'not_sold' })
  eq('a text price -> no_price', sell(cItems.noPrice), { sellable: false, reason: 'no_price' })
  eq('a required modifier group with no available option -> modifier_unavailable', sell(cItems.block), { sellable: false, reason: 'modifier_unavailable' })
  const reasons = new Set(Object.values(cItems).concat([cNoUid, ccB.items[0], ccC.items[0]]).map((i) => { const s = sell(i); return s.sellable ? 'ok' : s.reason }))
  eq('the fixture exercised every SellReason', [...reasons].sort(), ['modifier_unavailable', 'no_point', 'no_price', 'not_sold', 'ok', 'sold_out'])
  // The tile and the pricing engine must never disagree: a tile that looks sellable and then fails on tap,
  // or looks disabled when it would have sold, is the bug this module exists to prevent.
  const withUid = [...Object.values(cItems), ...ccB.items, ...ccC.items]
  sweep('a tile is sellable exactly when its as-is line prices (every fixture item)', withUid, (item) => {
    const s = sell(item)
    const input = { itemUid: item.uid, qty: 1 }
    if (C.tileAction(item, catOf(item), cctx) === 'needs-choices') return true
    return s.sellable === priceLine(input, cctx).ok
  })
  const cross = { sold_out: 'sold_out', no_point: 'no_point', not_sold: 'not_sold', no_price: 'no_price' }
  for (const [key, item] of Object.entries(cItems)) {
    const s = sell(item)
    if (!s.sellable && cross[s.reason] && C.tileAction(item, ccA, cctx) === 'add-as-is') eq(`${key}: the disabled reason matches the engine's refusal`, code(priceLine({ itemUid: item.uid, qty: 1 }, cctx)), cross[s.reason])
  }
}

section('cart.ts — tileAction: one tap adds it as-is, or it needs choices first')
{
  const act = (item) => C.tileAction(item, ccA, cctx)
  eq('a plain item adds as-is', act(cItems.plain), 'add-as-is')
  eq('a slash price needs the cashier to pick the price', act(cItems.range), 'needs-choices')
  eq('an item with types needs a type', act(cItems.typed), 'needs-choices')
  eq('a required group the defaults satisfy (size has a default) adds as-is', act(cItems.size), 'add-as-is')
  eq('a required group with NO default needs a choice', act(cItems.bread), 'needs-choices')
  eq('an optional group never blocks the one-tap add', act(cItems.optional), 'add-as-is')
  eq('an empty types list is "no types"', C.tileAction(mkItem('ci-e', 'x', 5, { types: [] }), ccA, cctx), 'add-as-is')
  eq('a single price in a slash string is one price', C.tileAction(mkItem('ci-s', 'x', '14'), ccA, cctx), 'add-as-is')
  eq('an as-is tile really prices with no modifiers key (undefined = the defaults)', code(priceLine({ itemUid: 'ci-size', qty: 1 }, cctx)), 'ok')
}

section('cart.ts — buildLine / lenientLine / analyseLines')
{
  const b = C.buildLine({ itemUid: 'ci-plain', qty: 2 }, cctx)
  check('buildLine of a sellable input is ok', b.ok)
  eq('a line\'s key IS lineMergeKey(input) (merge identity and React key are one thing)', b.line.key, lineMergeKey(b.line.input))
  eq('the preview carries what the server priced (unit + point)', [b.line.preview.unitAgorot, b.line.preview.pointId], [1000, PA])
  eq('buildLine of a refused input carries the problem', C.buildLine({ itemUid: 'ci-sold', qty: 1 }, cctx), { ok: false, problem: { code: 'sold_out', itemUid: 'ci-sold' } })
  const lenient = C.lenientLine({ itemUid: 'ci-sold', qty: 1 }, cctx)
  check('a sold-out line can still be SHOWN (named, priced indicatively) so it can be removed', lenient !== null && lenient.preview.name.he === 'אזל' && lenient.preview.unitAgorot === 500)
  eq('lenientLine of an item that is gone entirely is null', C.lenientLine({ itemUid: 'ghost', qty: 1 }, cctx), null)
  const lc = C.lenientLine(customIn2(), cctx)
  check('lenientLine of a custom line keeps its name and price', lc !== null && lc.preview.name.he === 'מים' && lc.preview.unitAgorot === 300 && lc.preview.pointId === PA)
  const ok1 = mkLine({ itemUid: 'ci-plain', qty: 1 })
  const stale = { ...C.lenientLine({ itemUid: 'ci-sold', qty: 1 }, cctx) }
  const an = C.analyseLines([ok1, stale], cctx)
  eq('analyseLines never drops a line — the cashier decides', an.lines.length, 2)
  eq('…and names the one that can no longer be sold', an.problems, { [stale.key]: 'sold_out' })
  eq('analyseLines with no menu loaded reports nothing (and does not throw)', C.analyseLines([ok1], null), { lines: [ok1], problems: {} })
  const repriced = C.analyseLines([{ ...ok1, preview: { ...ok1.preview, unitAgorot: 1 } }], cctx)
  eq('analyseLines re-prices from the CURRENT menu (a stale cached draft cannot keep an old price)', repriced.lines[0].preview.unitAgorot, 1000)
}

section('cart.ts — merge identity: price, type, modifiers, note and for-whom all separate lines')
{
  const keyOf = (input) => lineMergeKey(input)
  const p = mkLine({ itemUid: 'ci-plain', qty: 1 })
  const twice = addL(addL(D0, p), p)
  eq('the same line added twice is ONE line with qty summed', twice.lines.map((l) => [l.key, l.input.qty]), [[p.key, 2]])
  const note1 = mkLine({ itemUid: 'ci-plain', qty: 1, note: 'בלי קרח' })
  eq('a different note is a different line', addL(addL(D0, p), note1).lines.length, 2)
  eq('the same note merges', addL(addL(D0, note1), note1).lines.length, 1)
  eq('notes differing only by outer whitespace are the same line', keyOf({ itemUid: 'x', qty: 1, note: 'a' }), keyOf({ itemUid: 'x', qty: 1, note: ' a ' }))
  const forA = mkLine({ itemUid: 'ci-plain', qty: 1, forName: 'דנה' })
  const forB = mkLine({ itemUid: 'ci-plain', qty: 1, forName: 'רון' })
  eq('a different for-whom is a different line', addL(addL(addL(D0, p), forA), forB).lines.length, 3)
  eq('the same for-whom merges', addL(addL(D0, forA), forA).lines.length, 1)
  const r0 = mkLine({ itemUid: 'ci-range', qty: 1, priceChoice: 0 })
  const r1 = mkLine({ itemUid: 'ci-range', qty: 1, priceChoice: 1 })
  eq('the two prices of a slash item are two lines (a ₪14 and a ₪16 beer are not the same line)', addL(addL(D0, r0), r1).lines.length, 2)
  eq('…with the prices the engine gave them', [r0.preview.unitAgorot, r1.preview.unitAgorot], [1400, 1600])
  const t1 = mkLine({ itemUid: 'ci-typed', qty: 1, typeUid: 'ty1' })
  const t2 = mkLine({ itemUid: 'ci-typed', qty: 1, typeUid: 'ty2' })
  eq('a different type is a different line', addL(addL(D0, t1), t2).lines.length, 2)
  const mS = mkLine({ itemUid: 'ci-size', qty: 1, modifiers: [{ groupUid: 'g-size', optionUid: 'm' }] })
  const mL = mkLine({ itemUid: 'ci-size', qty: 1, modifiers: [{ groupUid: 'g-size', optionUid: 'l' }] })
  eq('different modifier choices are different lines', addL(addL(D0, mS), mL).lines.length, 2)
  const two1 = mkLine({ itemUid: 'ci-two', qty: 1, modifiers: [{ groupUid: 'g-size', optionUid: 's' }, { groupUid: 'g-opt', optionUid: 'o1' }] })
  const two2 = mkLine({ itemUid: 'ci-two', qty: 1, modifiers: [{ groupUid: 'g-opt', optionUid: 'o1' }, { groupUid: 'g-size', optionUid: 's' }] })
  eq('the same modifiers in a different ORDER merge (order is how they were tapped, not what they are)', addL(addL(D0, two1), two2).lines.length, 1)
  const asIs = mkLine({ itemUid: 'ci-optional', qty: 1 })
  const empty = mkLine({ itemUid: 'ci-optional', qty: 1, modifiers: [] })
  check('as-is (undefined) and an explicit empty list are different identities — as-is follows the defaults, [] does not', asIs.key !== empty.key)
  eq('a modifier quantity is part of the identity (extra shot x1 vs x2)', [keyOf({ itemUid: 'a', qty: 1, modifiers: [{ groupUid: 'g', optionUid: 'o', qty: 1 }] }) === keyOf({ itemUid: 'a', qty: 1, modifiers: [{ groupUid: 'g', optionUid: 'o', qty: 2 }] })], [false])
  eq('an absent modifier qty means 1', keyOf({ itemUid: 'a', qty: 1, modifiers: [{ groupUid: 'g', optionUid: 'o' }] }), keyOf({ itemUid: 'a', qty: 1, modifiers: [{ groupUid: 'g', optionUid: 'o', qty: 1 }] }))
  eq('the quantity itself is NOT part of the identity', keyOf({ itemUid: 'a', qty: 1 }), keyOf({ itemUid: 'a', qty: 7 }))
  const c1 = mkLine(customIn2())
  eq('identical custom lines merge', addL(addL(D0, c1), c1).lines.length, 1)
  eq('a custom line at a different PRICE is its own line', addL(addL(D0, c1), mkLine(customIn2({}, { priceAgorot: 400 }))).lines.length, 2)
  eq('a custom line for a different POINT is its own line', addL(addL(D0, c1), mkLine(customIn2({}, { pointId: PB }))).lines.length, 2)
  eq('a custom line\'s name is compared case-insensitively and trimmed', keyOf(customIn2({}, { name: ' Water ' })), keyOf(customIn2({}, { name: 'water' })))
  check('a custom line never merges with a catalogue line', c1.key !== p.key)
  // Property: however lines are added, no key repeats and the units are conserved (below the cap).
  const r = rng(7)
  const pool = [p, note1, forA, r0, r1, t1, t2, mS, mL, c1, two1, asIs, empty]
  const runs = Array.from({ length: 300 }, (_, i) => Array.from({ length: 1 + (i % 12) }, () => ({ base: pick(r, pool), n: 1 + Math.floor(r() * 3) })))
  sweep('random adds: keys stay unique, positions stable, and units conserved', runs, (run) => {
    let d = D0
    let units = 0
    const firstSeen = []
    for (const { base, n } of run) {
      const withQty = { ...base, input: { ...base.input, qty: n } }
      d = addL(d, withQty)
      units += n
      if (!firstSeen.includes(base.key)) firstSeen.push(base.key)
    }
    return new Set(d.lines.map((l) => l.key)).size === d.lines.length && C.itemCount(d) === units && isDeepStrictEqual(d.lines.map((l) => l.key), firstSeen)
  })
}

section('cart.ts — cartReducer: quantity, notes, caps')
{
  const p = mkLine({ itemUid: 'ci-plain', qty: 1 })
  const note1 = mkLine({ itemUid: 'ci-plain', qty: 1, note: 'בלי קרח' })
  const d1 = addL(D0, p)
  eq('setQty 5 sets the quantity', C.cartReducer(d1, { type: 'setQty', key: p.key, qty: 5 }).lines[0].input.qty, 5)
  for (const q of [0, -1, -99]) eq(`setQty ${q} REMOVES the line`, C.cartReducer(d1, { type: 'setQty', key: p.key, qty: q }).lines, [])
  eq('setQty above the cap clamps to qtyMax', C.cartReducer(d1, { type: 'setQty', key: p.key, qty: 500 }).lines[0].input.qty, LIMITS.qtyMax)
  eq('setQty 2.9 floors to 2 (no half drinks)', C.cartReducer(d1, { type: 'setQty', key: p.key, qty: 2.9 }).lines[0].input.qty, 2)
  eq('setQty 0.5 floors to 0 -> clamps to 1, never a zero-quantity line', C.cartReducer(d1, { type: 'setQty', key: p.key, qty: 0.5 }).lines[0].input.qty, 1)
  eq('setQty on an unknown key changes nothing', C.cartReducer(d1, { type: 'setQty', key: 'nope', qty: 3 }).lines, d1.lines)
  for (const bad of [NaN, Infinity]) {
    const q = C.cartReducer(d1, { type: 'setQty', key: p.key, qty: bad }).lines[0]?.input.qty
    check(`setQty ${bad} never produces a non-finite quantity (a NaN would poison the total)`, q === undefined || (Number.isInteger(q) && q >= 1 && q <= LIMITS.qtyMax), `got ${q}`)
  }
  eq('adding past the cap clamps at qtyMax (98 + 5)', C.cartReducer(addL(D0, mkLine({ itemUid: 'ci-plain', qty: 98 })), { type: 'add', line: mkLine({ itemUid: 'ci-plain', qty: 5 }) }).lines[0].input.qty, LIMITS.qtyMax)
  eq('remove deletes only that line', C.cartReducer(addL(d1, note1), { type: 'remove', key: p.key }).lines.map((l) => l.key), [note1.key])
  eq('remove of an unknown key is a no-op', C.cartReducer(d1, { type: 'remove', key: 'nope' }).lines.length, 1)

  const ln1 = C.cartReducer(d1, { type: 'setLineNote', key: p.key, note: '  בלי   קרח  ' })
  eq('setLineNote trims and collapses whitespace', ln1.lines[0].input.note, 'בלי קרח')
  eq('…and re-keys the line (the note is part of its identity)', ln1.lines[0].key, lineMergeKey(ln1.lines[0].input))
  const cleared = C.cartReducer(ln1, { type: 'setLineNote', key: ln1.lines[0].key, note: '   ' })
  check('clearing a note leaves no note', !cleared.lines[0].input.note)
  eq('…and the line is again the same line as one added without a note', cleared.lines[0].key, p.key)
  const merged = C.cartReducer(addL(addL(D0, p), note1), { type: 'setLineNote', key: note1.key, note: '' })
  eq('clearing a note so two lines become identical MERGES them (qty summed)', merged.lines.map((l) => [l.key, l.input.qty]), [[p.key, 2]])
  eq('a note over the cap is cut by characters', Array.from(C.cartReducer(d1, { type: 'setLineNote', key: p.key, note: '😀'.repeat(200) }).lines[0].input.note).length, LIMITS.lineNoteMax)
  const fn = C.cartReducer(d1, { type: 'setForName', key: p.key, forName: ' דנה ' })
  eq('setForName trims and re-keys', [fn.lines[0].input.forName, fn.lines[0].key === lineMergeKey(fn.lines[0].input)], ['דנה', true])
  check('a line whose note was cleared still validates against the wire schema (null is allowed, not a stray empty string)', lineInputSchema.safeParse(cleared.lines[0].input).success)

  const rp = mkLine({ itemUid: 'ci-optional', qty: 1 })
  eq('replaceLine swaps the line in place (the edit sheet)', C.cartReducer(addL(addL(D0, p), note1), { type: 'replaceLine', key: p.key, line: rp }).lines.map((l) => l.key), [rp.key, note1.key])
  eq('replaceLine of a vanished key adds instead', C.cartReducer(D0, { type: 'replaceLine', key: 'gone', line: rp }).lines.map((l) => l.key), [rp.key])
  eq('replaceLine that lands on an existing line merges, not duplicates', C.cartReducer(addL(addL(D0, p), note1), { type: 'replaceLine', key: p.key, line: note1 }).lines.map((l) => [l.key, l.input.qty]), [[note1.key, 2]])

  const many = (n) => Array.from({ length: n }, (_, i) => mkLine({ itemUid: 'ci-plain', qty: 1, note: `n${i}` }))
  const full = many(LIMITS.linesPerOrderMax).reduce(addL, D0)
  eq('a draft holds exactly linesPerOrderMax distinct lines', [full.lines.length, C.atLineCap(full)], [LIMITS.linesPerOrderMax, true])
  eq('a NEW distinct line past the cap is refused (state unchanged)', C.cartReducer(full, { type: 'add', line: mkLine({ itemUid: 'ci-plain', qty: 1, note: 'extra' }) }), full)
  eq('…but one that MERGES into an existing line is still welcome at the cap', C.cartReducer(full, { type: 'add', line: mkLine({ itemUid: 'ci-plain', qty: 1, note: 'n0' }) }).lines[0].input.qty, 2)
  eq('replaceLines past the cap truncates', C.cartReducer(D0, { type: 'replaceLines', lines: many(LIMITS.linesPerOrderMax + 9) }).lines.length, LIMITS.linesPerOrderMax)
  eq('below the cap it is not "at cap"', C.atLineCap(addL(D0, p)), false)

  const nm = C.cartReducer(D0, { type: 'setCustomer', name: 'ש'.repeat(80), phone: '1'.repeat(50) })
  eq('setCustomer caps the name at customerNameMax and the phone at 24', [Array.from(nm.customerName).length, nm.customerPhone.length], [LIMITS.customerNameMax, 24])
  eq('setCustomer with only a name leaves the phone alone', C.cartReducer(C.cartReducer(D0, { type: 'setCustomer', phone: '054' }), { type: 'setCustomer', name: 'א' }).customerPhone, '054')
  eq('setCustomer never splits an emoji at the cap', C.cartReducer(D0, { type: 'setCustomer', name: 'a'.repeat(39) + '😀😀' }).customerName.isWellFormed(), true)
  eq('setOrderNote caps at orderNoteMax', C.cartReducer(D0, { type: 'setOrderNote', note: 'x'.repeat(500) }).orderNote.length, LIMITS.orderNoteMax)
  const sl = C.cartReducer(D0, { type: 'setSlip', receiptRef: 'r'.repeat(100), slipTotal: '9'.repeat(30) })
  eq('setSlip caps the reference and the typed total', [sl.receiptRef.length, sl.slipTotal.length], [LIMITS.receiptRefMax, 12])
  const typed = C.cartReducer(C.cartReducer(addL(D0, p), { type: 'setCustomer', name: 'דנה' }), { type: 'setOrderNote', note: 'הערה' })
  const cleared2 = C.cartReducer(typed, { type: 'clear', now: W2NOW + 5 })
  eq('clear is a fresh empty draft stamped with the new time', cleared2, C.emptyDraft(W2NOW + 5))
  eq('load replaces the whole draft', C.cartReducer(D0, { type: 'load', draft: typed }), typed)
  eq('the reducer never mutates its input', (() => { const before = JSON.stringify(typed); C.cartReducer(typed, { type: 'setQty', key: p.key, qty: 9 }); C.cartReducer(typed, { type: 'remove', key: p.key }); return JSON.stringify(typed) === before })(), true)
}

section('cart.ts — totals, the slip check, display helpers')
{
  const a = mkLine({ itemUid: 'ci-plain', qty: 3 })
  const b = mkLine({ itemUid: 'ci-range', qty: 2, priceChoice: 1 })
  const d = addL(addL(D0, a), b)
  eq('lineTotal = unit x qty (₪10 x 3)', C.lineTotal(d.lines[0]), 3000)
  eq('totalAgorot sums every line (₪30 + 2 x ₪16)', C.totalAgorot(d), 6200)
  eq('itemCount counts UNITS, not lines', C.itemCount(d), 5)
  eq('an empty cart is 0 / 0', [C.totalAgorot(D0), C.itemCount(D0)], [0, 0])
  const withSlip = (slipTotal) => ({ ...d, slipTotal })
  eq('no typed slip total -> none', C.slipStatus(withSlip('')), { kind: 'none' })
  eq('a blank slip total -> none', C.slipStatus(withSlip('   ')), { kind: 'none' })
  eq('a slip that is not an amount -> invalid', C.slipStatus(withSlip('abc')), { kind: 'invalid' })
  eq('a slip equal to the system total -> match', C.slipStatus(withSlip('62')), { kind: 'match' })
  eq('a comma decimal is understood', C.slipStatus({ ...D0, lines: [mkLine({ itemUid: 'ci-plain', qty: 1 })], slipTotal: '10,00' }), { kind: 'match' })
  eq('a higher slip is a positive diff (slip minus system)', C.slipStatus(withSlip('70')), { kind: 'diff', diffAgorot: 800 })
  eq('a lower slip is a negative diff — a card-terminal discount is information, never a block', C.slipStatus(withSlip('60.50')), { kind: 'diff', diffAgorot: -150 })
  eq('priceLabel of a slash price shows both', C.priceLabel({ price: '14/16' }), '₪14 / ₪16')
  eq('priceLabel of a plain price', C.priceLabel({ price: 12.5 }), '₪12.50')
  eq('priceLabel of an unsellable price is empty', C.priceLabel({ price: 'לפי משקל' }), '')
  eq('pickName prefers the viewer\'s language', C.pickName({ he: 'ע', en: 'E', ar: 'ا' }, 'en'), 'E')
  eq('pickName falls back he -> en -> ar', [C.pickName({ en: 'E', ar: 'ا' }, 'he'), C.pickName({ ar: 'ا' }, 'en'), C.pickName(null), C.pickName({ he: '' }, 'ar')], ['E', 'ا', '', ''])
  eq('isBlank: nothing typed, nothing in the cart', C.isBlank(D0), true)
  eq('isBlank is false once a name is typed', C.isBlank({ ...D0, customerName: 'א' }), false)
  eq('isBlank is false once a line exists', C.isBlank(addL(D0, a)), false)
  eq('isBlank treats a whitespace-only name as nothing', C.isBlank({ ...D0, customerName: '   ' }), true)

  const lp = [mkLine({ itemUid: 'ci-plain', qty: 1 }), mkLine(customIn2({}, { pointId: PB })), mkLine(customIn2({}, { name: 'עוד' }))]
  const groups = C.groupByPoint(lp, [PB, PA])
  eq('groupByPoint follows the point order given', groups.map((g) => g.pointId), [PB, PA])
  eq('groupByPoint keeps every line', groups.reduce((n, g) => n + g.lines.length, 0), 3)
  eq('groupByPoint puts unknown points last', C.groupByPoint(lp, [PB]).map((g) => g.pointId), [PB, PA])
  const counts = C.countsOf([mkLine({ itemUid: 'ci-plain', qty: 2 }), mkLine({ itemUid: 'ci-plain', qty: 1, note: 'x' }), mkLine(customIn2())])
  eq('countsOf sums units per item uid (custom lines have none)', [...counts.byItem], [['ci-plain', 3]])
  eq('countsOf sums units per category', counts.byCategory.get('cc-a'), 3)
  const q = (item, cat, text) => C.matchesQuery(item, cat, text)
  const latte = mkItem('q1', 'לאטה', 12, { en: 'Latte', ar: 'لاتيه' })
  check('search matches Hebrew, English and Arabic names', q(latte, ccA, 'לאט') && q(latte, ccA, 'latt') && q(latte, ccA, 'لات'))
  check('search is case-insensitive', q(latte, ccA, 'LATTE'))
  check('search also matches the category name', q(latte, { ...ccA, title: { he: 'חמים', en: 'Hot', ar: 'ساخن' } }, 'hot'))
  check('an empty or blank query matches everything', q(latte, ccA, '') && q(latte, ccA, '   '))
  check('a non-matching query does not match', !q(latte, ccA, 'zzz'))

  const ord = (over) => ({ customer_name: 'דנה', status: 'open', created_at: new Date(W2NOW - 60_000).toISOString(), customer_phone: '0541234567', id: 'o', ...over })
  eq('sameNameOrder finds an open order for the same name made recently', C.sameNameOrder([ord({ id: 'o1' })], 'דנה', W2NOW)?.id, 'o1')
  eq('…ignoring case, outer and inner whitespace', C.sameNameOrder([ord({ id: 'o1', customer_name: 'Dana  Lee' })], '  dana lee ', W2NOW)?.id, 'o1')
  eq('…but never an order that is not open', C.sameNameOrder([ord({ status: 'completed' }), ord({ status: 'void' })], 'דנה', W2NOW), null)
  eq('…nor one older than 30 minutes (inclusive 30 is still offered)', [C.sameNameOrder([ord({ created_at: new Date(W2NOW - 30 * 60_000).toISOString() })], 'דנה', W2NOW) !== null, C.sameNameOrder([ord({ created_at: new Date(W2NOW - 30 * 60_000 - 1).toISOString() })], 'דנה', W2NOW)], [true, null])
  eq('…nor one stamped in the future', C.sameNameOrder([ord({ created_at: new Date(W2NOW + 5 * 60_000).toISOString() })], 'דנה', W2NOW), null)
  eq('the newest of several matches wins', C.sameNameOrder([ord({ id: 'old', created_at: new Date(W2NOW - 20 * 60_000).toISOString() }), ord({ id: 'new', created_at: new Date(W2NOW - 2 * 60_000).toISOString() })], 'דנה', W2NOW)?.id, 'new')
  eq('an empty name never matches (two blank names are not one customer)', C.sameNameOrder([ord({ customer_name: '' })], '   ', W2NOW), null)
  eq('a garbage timestamp is skipped, not matched', C.sameNameOrder([ord({ created_at: 'not a date' })], 'דנה', W2NOW), null)
  eq('it matches on the name only — a different name with the same phone is a different customer', C.sameNameOrder([ord({ customer_name: 'רון' })], 'דנה', W2NOW), null)
}

section('cart.ts — canSend: every reason, and the one that wins')
{
  const named = { ...addL(D0, mkLine({ itemUid: 'ci-plain', qty: 1 })), customerName: 'דנה' }
  const open = { sessionActive: true }
  eq('a complete draft on an open event may be sent', C.canSend(named, open), { ok: true })
  eq('no open event -> closed', C.canSend(named, { sessionActive: false }), { ok: false, reason: 'closed' })
  eq('closed beats every other reason', C.canSend(D0, { sessionActive: false, problemCount: 3, addMode: true, online: false }), { ok: false, reason: 'closed' })
  eq('an empty cart -> no_lines', C.canSend({ ...D0, customerName: 'דנה' }, open), { ok: false, reason: 'no_lines' })
  eq('no customer name -> no_name', C.canSend({ ...named, customerName: '' }, open), { ok: false, reason: 'no_name' })
  eq('a whitespace-only name -> no_name', C.canSend({ ...named, customerName: '   ' }, open), { ok: false, reason: 'no_name' })
  eq('a name with a control character -> no_name', C.canSend({ ...named, customerName: 'a\u0007b' }, open), { ok: false, reason: 'no_name' })
  eq('a name over the cap -> no_name', C.canSend({ ...named, customerName: 'x'.repeat(41) }, open), { ok: false, reason: 'no_name' })
  eq('a malformed phone -> bad_phone', C.canSend({ ...named, customerPhone: '12ab' }, open), { ok: false, reason: 'bad_phone' })
  eq('a too-short phone -> bad_phone', C.canSend({ ...named, customerPhone: '123' }, open), { ok: false, reason: 'bad_phone' })
  eq('a phone is optional', C.canSend({ ...named, customerPhone: '' }, open), { ok: true })
  eq('a good phone with spaces and dashes is fine', C.canSend({ ...named, customerPhone: '054-123 4567' }, open), { ok: true })
  eq('a line that can no longer be sold -> line_problem', C.canSend(named, { ...open, problemCount: 1 }), { ok: false, reason: 'line_problem' })
  eq('a new order on a dead connection is STILL sendable (it is queued on the device)', C.canSend(named, { ...open, online: false }), { ok: true })
  eq('add-to-order needs a connection -> offline (it is not queued)', C.canSend(named, { ...open, addMode: true, online: false }), { ok: false, reason: 'offline' })
  eq('add-to-order while online is fine', C.canSend(named, { ...open, addMode: true, online: true }), { ok: true })
  eq('add-to-order does not ask for a name — the order\'s customer is already locked', C.canSend({ ...named, customerName: '' }, { ...open, addMode: true }), { ok: true })
  eq('…nor does it validate a phone', C.canSend({ ...named, customerPhone: 'junk' }, { ...open, addMode: true }), { ok: true })
  eq('add-to-order with nothing in the cart -> no_lines', C.canSend({ ...D0 }, { ...open, addMode: true }), { ok: false, reason: 'no_lines' })
}

section('cart.ts — buildCreateBody / buildAddBody: the wire shape (ids and counts only)')
{
  const asIsLine = mkLine({ itemUid: 'ci-size', qty: 2 })
  const customLine = mkLine(customIn2())
  const draft = {
    ...D0, lines: [asIsLine, customLine], customerName: ' דנה  כהן ', customerPhone: '054-123 4567',
    orderNote: ' בלי   בצל ', receiptRef: ' 1234 ', slipTotal: '12,5',
  }
  const body = C.buildCreateBody(draft)
  eq('the body has the normalised customer, phone, note, receipt and slip', [body.customerName, body.customerPhone, body.note, body.receiptRef, body.slipTotalAgorot], ['דנה כהן', '0541234567', 'בלי בצל', '1234', 1250])
  eq('lines are exactly the inputs — nothing priced by the browser leaves it', body.lines, [asIsLine.input, customLine.input])
  check('an as-is line carries NO modifiers key (that is what as-is means on the wire)', !('modifiers' in body.lines[0]))
  const sealed = createOrderBody.safeParse({ ...body, branchId: UUID_A, clientKey: UUID_B })
  check('the body validates against the server\'s strict schema', sealed.success, sealed.success ? '' : JSON.stringify(sealed.error.issues.slice(0, 2)))
  eq('a blank phone -> null, a blank slip -> null, a blank note -> null', ((b) => [b.customerPhone, b.slipTotalAgorot, b.note, b.receiptRef])(C.buildCreateBody({ ...draft, customerPhone: '', slipTotal: '', orderNote: '  ', receiptRef: '' })), [null, null, null, null])
  eq('an unparseable slip total is dropped, not sent as junk', C.buildCreateBody({ ...draft, slipTotal: 'abc' }).slipTotalAgorot, null)
  eq('a bad name -> null body', C.buildCreateBody({ ...draft, customerName: '' }), null)
  eq('a bad phone -> null body', C.buildCreateBody({ ...draft, customerPhone: 'x' }), null)
  eq('no lines -> null body', C.buildCreateBody({ ...draft, lines: [] }), null)
  eq('buildAddBody is just the lines', C.buildAddBody(draft), { lines: [asIsLine.input, customLine.input] })
  eq('buildAddBody of an empty cart is null', C.buildAddBody(D0), null)
  check('buildAddBody validates against addItemsBody', addItemsBody.safeParse({ branchId: UUID_A, ...C.buildAddBody(draft) }).success)
}

section('cart.ts — draftStorageKey: two cashiers on one tablet never share a half-typed order')
{
  const k = C.draftStorageKey
  check('the key starts with the vocabulary\'s prefix', k('b1', 's1').startsWith(OUTBOX.draftKeyPrefix))
  check('a different person gets a different key', k('b1', 's1') !== k('b1', 's2'))
  check('a different branch gets a different key', k('b1', 's1') !== k('b2', 's1'))
  check('an add-to-order draft is separate from the main one, and per order', new Set([k('b1', 's1'), k('b1', 's1', 'o1'), k('b1', 's1', 'o2')]).size === 3)
  eq('the same inputs always give the same key', k('b1', 's1', 'o1'), k('b1', 's1', 'o1'))
}

section('cart.ts — sanitizeDraft: anything -> a usable draft, never a throw')
{
  const good = C.cartReducer(C.cartReducer(addL(addL(addL(D0, mkLine({ itemUid: 'ci-size', qty: 2, modifiers: [{ groupUid: 'g-size', optionUid: 'm', qty: 1 }], note: 'חם' })), mkLine({ itemUid: 'ci-range', qty: 1, priceChoice: 1 })), mkLine(customIn2())), { type: 'setCustomer', name: 'דנה', phone: '0541234567' }), { type: 'setOrderNote', note: 'הערה' })
  const draftAt = { ...good, startedAt: W2NOW - 1000 }
  const wire = (d) => JSON.parse(JSON.stringify(d))
  eq('a stored modifier with no qty is read back as qty 1 (the key and the server already treat absent as 1)', C.sanitizeDraft({ ...wire(draftAt), lines: [{ ...wire(good.lines[0]), input: { itemUid: 'ci-size', qty: 1, modifiers: [{ groupUid: 'g-size', optionUid: 'm' }] } }] }, W2NOW).lines[0].input.modifiers, [{ groupUid: 'g-size', optionUid: 'm', qty: 1 }])
  eq('a draft survives a localStorage round trip unchanged', wire(C.sanitizeDraft(wire(draftAt), W2NOW)), wire(draftAt))
  const garbage = [undefined, null, 0, 1, -1, NaN, 'x', '', true, false, [], [1, 2], {}, { lines: 'x' }, { lines: [null, 1, 'x', [], {}] }, { startedAt: 'now' }, { customerName: 5, lines: [{ input: null, preview: null }] }, { lines: [{ input: { itemUid: 'a', qty: 1 } }] }, { lines: { length: 5 } }, JSON, () => 1]
  sweep('garbage in -> a structurally valid draft out, never a throw', garbage, (g) => {
    const d = C.sanitizeDraft(g, W2NOW)
    return Array.isArray(d.lines) && typeof d.customerName === 'string' && typeof d.customerPhone === 'string' && typeof d.orderNote === 'string' && typeof d.receiptRef === 'string' && typeof d.slipTotal === 'string' && Number.isFinite(d.startedAt)
  })
  eq('a non-object gives an empty draft stamped now', C.sanitizeDraft('junk', W2NOW), C.emptyDraft(W2NOW))
  const aged = (ms) => ({ ...wire(draftAt), startedAt: W2NOW - ms })
  eq('a draft just under 8 h old is kept', C.sanitizeDraft(aged(DRAFT_TTL - 1), W2NOW).lines.length, 3)
  eq('a draft exactly 8 h old is still kept (the rule is "older than")', C.sanitizeDraft(aged(DRAFT_TTL), W2NOW).lines.length, 3)
  eq('a draft older than 8 h is yesterday\'s: dropped, and the new one starts now', C.sanitizeDraft(aged(DRAFT_TTL + 1), W2NOW), C.emptyDraft(W2NOW))
  eq('a start time up to a minute in the future is tolerated (clock skew)', C.sanitizeDraft({ ...wire(draftAt), startedAt: W2NOW + 60_000 }, W2NOW).lines.length, 3)
  eq('a start time further in the future is not believed', C.sanitizeDraft({ ...wire(draftAt), startedAt: W2NOW + 60_001 }, W2NOW), C.emptyDraft(W2NOW))
  eq('a missing start time means "now" and keeps the lines', C.sanitizeDraft({ ...wire(draftAt), startedAt: undefined }, W2NOW).startedAt, W2NOW)

  const lineWire = wire(good.lines[0])
  const withLine = (patch) => C.sanitizeDraft({ ...wire(draftAt), lines: [{ ...lineWire, ...patch }] }, W2NOW)
  const dropped = (name, patch) => eq(`a line ${name} is dropped`, withLine(patch).lines.length, 0)
  dropped('with qty 0', { input: { ...lineWire.input, qty: 0 } })
  dropped('with qty above the cap', { input: { ...lineWire.input, qty: 100 } })
  dropped('with a fractional qty', { input: { ...lineWire.input, qty: 1.5 } })
  dropped('with a string qty', { input: { ...lineWire.input, qty: '2' } })
  dropped('with no item id', { input: { qty: 1 } })
  dropped('with an empty item id', { input: { ...lineWire.input, itemUid: '' } })
  dropped('with an over-long item id', { input: { ...lineWire.input, itemUid: 'x'.repeat(81) } })
  dropped('with no preview', { preview: undefined })
  dropped('with a negative unit price', { preview: { ...lineWire.preview, unitAgorot: -1 } })
  dropped('with a fractional unit price', { preview: { ...lineWire.preview, unitAgorot: 1.5 } })
  dropped('with a unit price over the sanity ceiling', { preview: { ...lineWire.preview, unitAgorot: LIMITS.unitAgorotMax + 1 } })
  dropped('with a custom price over ₪999.99', { input: { custom: { name: 'x', priceAgorot: 100_000, pointId: PA }, qty: 1 } })
  dropped('with a custom line that has no point', { input: { custom: { name: 'x', priceAgorot: 100, pointId: '' }, qty: 1 } })
  dropped('with a custom line that has no name', { input: { custom: { name: '  ', priceAgorot: 100, pointId: PA }, qty: 1 } })
  const forged = withLine({ key: 'FORGED-KEY' }).lines[0]
  eq('a forged key is ignored: the key is recomputed from the input', forged.key, lineMergeKey(forged.input))
  const smuggled = withLine({ input: { ...lineWire.input, price: 1, unitAgorot: 1, status: 'ready', staffId: 'x' } }).lines[0].input
  check('fields the wire does not know are not carried through', !('price' in smuggled) && !('unitAgorot' in smuggled) && !('status' in smuggled) && !('staffId' in smuggled))
  const modsIn = withLine({ input: { itemUid: 'ci-size', qty: 1, modifiers: [{ groupUid: 'g-size', optionUid: 'm', qty: 10 }, { groupUid: '', optionUid: 'x' }, null, 5, { groupUid: 'g', optionUid: 'o', qty: 2 }] } }).lines[0].input.modifiers
  eq('modifier entries that are not well-formed are skipped, an out-of-range qty becomes 1', modsIn, [{ groupUid: 'g-size', optionUid: 'm', qty: 1 }, { groupUid: 'g', optionUid: 'o', qty: 2 }])
  eq('more modifiers than the line may carry are truncated', withLine({ input: { itemUid: 'a', qty: 1, modifiers: Array.from({ length: 40 }, (_, i) => ({ groupUid: `g${i}`, optionUid: 'o' })) } }).lines[0].input.modifiers.length, LIMITS.modifiersPerLineMax)
  check('a non-array modifiers value is read as as-is (no key)', !('modifiers' in withLine({ input: { itemUid: 'a', qty: 1, modifiers: 'oops' } }).lines[0].input))
  const dup = C.sanitizeDraft({ ...wire(draftAt), lines: [wire(good.lines[1]), wire(good.lines[1])] }, W2NOW)
  eq('two identical stored lines merge on the way in', dup.lines.map((l) => l.input.qty), [2])
  const crowd = C.sanitizeDraft({ ...wire(draftAt), lines: Array.from({ length: 150 }, (_, i) => ({ input: { itemUid: `u${i}`, qty: 1 }, preview: { name: { he: 'x' }, unitAgorot: 100, baseAgorot: 100 } })) }, W2NOW)
  eq('a stored draft cannot exceed the line cap', crowd.lines.length, LIMITS.linesPerOrderMax)
  const long = C.sanitizeDraft({ customerName: '😀'.repeat(100), customerPhone: '9'.repeat(99), orderNote: 'n'.repeat(999), receiptRef: 'r'.repeat(99), slipTotal: '1'.repeat(99), startedAt: W2NOW, lines: [] }, W2NOW)
  eq('text fields are capped by characters', [Array.from(long.customerName).length, long.customerPhone.length, long.orderNote.length, long.receiptRef.length, long.slipTotal.length], [LIMITS.customerNameMax, 24, LIMITS.orderNoteMax, LIMITS.receiptRefMax, 12])
  check('…and a cap never leaves half an emoji', long.customerName.isWellFormed())
  eq('a snapshot with a malformed member drops the whole modifier list (half-described is worse than re-priced)', withLine({ preview: { ...lineWire.preview, modifiers: [{ junk: true }] } }).lines[0].preview.modifiers, [])
}


// =====================================================================================
// gestures.ts — a swipe must be deliberate; scrolling a queue with a wet thumb must never open a dialog
// =====================================================================================
const G = await load('lib/pos/gestures.mjs')
section('gestures.ts — classifySwipe')
{
  const sw = (over = {}) => G.classifySwipe({ startX: 500, startY: 300, endX: 200, endY: 310, startedAtMs: 1000, endedAtMs: 1300, viewportWidth: 1000, startedOnInteractive: false, ...over })
  eq('a clear, brisk, horizontal leftward stroke on bare background is a swipe', sw(), 'swipe-left')
  eq('a press that began on a card or control is never a swipe', sw({ startedOnInteractive: true }), 'none')
  eq('a rightward stroke is nothing (the gesture is physically LEFT, in every language)', sw({ endX: 800 }), 'none')
  eq('no horizontal travel is nothing', sw({ endX: 500 }), 'none')
  // distance: never fewer than 96 px; on a wide screen at least 22% of the width
  const phone = (distance, over = {}) => sw({ viewportWidth: 390, startX: 300, endX: 300 - distance, endY: 300, ...over })
  eq('96 px on a phone is enough (the floor is inclusive)', phone(96), 'swipe-left')
  eq('95 px on a phone is not', phone(95), 'none')
  eq('a 280 px fold uses the 96 px floor too', sw({ viewportWidth: 280, startX: 200, endX: 104, endY: 300 }), 'swipe-left')
  eq('…and refuses 95', sw({ viewportWidth: 280, startX: 200, endX: 105, endY: 300 }), 'none')
  const wide = (distance) => sw({ viewportWidth: 1000, startX: 700, endX: 700 - distance, endY: 300 })
  eq('on a 1000 px tablet 22% (220 px) is enough', wide(220), 'swipe-left')
  eq('219 px is a short flick, not a swipe', wide(219), 'none')
  eq('a 100 px flick on a wide tablet is not enough even though it clears the phone floor', wide(100), 'none')
  eq('the viewport width never lowers the 96 px floor (0 or negative widths)', [sw({ viewportWidth: 0, startX: 200, endX: 105, endY: 300 }), sw({ viewportWidth: -50, startX: 200, endX: 105, endY: 300 })], ['none', 'none'])
  // direction: mostly horizontal (phone-width viewport so distance is not what refuses it)
  const ph = (dx, dy) => sw({ viewportWidth: 390, startX: 300, endX: 300 - dx, startY: 300, endY: 300 + dy })
  eq('a mostly-vertical stroke that drifts left is a scroll, not a swipe', ph(120, 400), 'none')
  eq('a 45-degree diagonal is not a swipe', ph(300, 300), 'none')
  eq('a modest wobble (dy 40 over dx 200) is still a swipe', ph(200, 40), 'swipe-left')
  eq('a stroke whose vertical drift is half its length (ratio 2) is refused', ph(150, 75), 'none')
  eq('a stroke at ratio 2.5 is accepted', ph(150, 60), 'swipe-left')
  eq('a stroke at ratio 1.67 is refused', ph(100, 60), 'none')
  eq('upward drift counts the same as downward', ph(200, -40), ph(200, 40))
  eq('a perfectly horizontal stroke is a swipe', ph(200, 0), 'swipe-left')
  // speed
  eq('799 ms is brisk enough', sw({ endedAtMs: 1000 + 799 }), 'swipe-left')
  eq('800 ms is too slow', sw({ endedAtMs: 1000 + 800 }), 'none')
  eq('a long slow drag is not a swipe', sw({ endedAtMs: 6000 }), 'none')
  eq('an instantaneous stroke (0 ms) is accepted', sw({ endedAtMs: 1000 }), 'swipe-left')
  eq('time going backwards is not a swipe', sw({ endedAtMs: 900 }), 'none')
  // the edge
  eq('a press at x=0 belongs to the OS back-gesture', sw({ startX: 0, endX: -300 }), 'none')
  eq('a press 11 px from the edge is still the OS\'s', sw({ startX: 11, endX: -289, endY: 300 }), 'none')
  eq('a press 12 px in is ours', sw({ startX: 12, endX: -288, endY: 310 }), 'swipe-left')
  // garbage
  for (const k of ['startX', 'startY', 'endX', 'endY', 'startedAtMs', 'endedAtMs', 'viewportWidth']) {
    for (const bad of [NaN, Infinity, -Infinity]) eq(`${k}=${bad} is not a swipe (and does not throw)`, sw({ [k]: bad }), 'none')
  }
  sweep('a stroke that never travels left is never a swipe (property)', Array.from({ length: 400 }, (_, i) => i), (i) => {
    const r = rng(i)
    return sw({ startX: 100 + r() * 800, endX: 100 + r() * 800 + 1000, endY: 300 + (r() - 0.5) * 500, endedAtMs: 1000 + r() * 1000 }) === 'none'
  })
}

section('gestures.ts — classifyDrag: a long-press arms a drag; near the left edge shows the Done tray')
{
  const dr = (pressedForMs, x, viewportWidth = 1024) => G.classifyDrag({ pressedForMs, x, viewportWidth })
  eq('a quick tap is not armed', dr(0, 500).armed, false)
  eq('349 ms is not armed yet (scrolling must still work)', dr(349, 500).armed, false)
  eq('350 ms arms the drag', dr(350, 500).armed, true)
  eq('a long hold stays armed', dr(5000, 500).armed, true)
  eq('x = 88 is inside the edge zone (inclusive)', dr(400, 88).nearLeftEdge, true)
  eq('x = 89 is outside it', dr(400, 89).nearLeftEdge, false)
  eq('x = 0 is at the edge', dr(400, 0).nearLeftEdge, true)
  eq('a finger dragged past the screen edge (x < 0) is still "near" it', dr(400, -30).nearLeftEdge, true)
  eq('"near the edge" does not depend on being armed, and "armed" not on position', [dr(10, 5), dr(900, 900)], [{ armed: false, nearLeftEdge: true }, { armed: true, nearLeftEdge: false }])
  eq('a bogus viewport width never reads as "at the edge"', [dr(400, 10, 0).nearLeftEdge, dr(400, 10, -1).nearLeftEdge, dr(400, 10, NaN).nearLeftEdge], [false, false, false])
  eq('NaN / Infinity measurements are safe', [dr(NaN, 500).armed, dr(Infinity, 500).armed, dr(400, NaN).nearLeftEdge, dr(400, Infinity).nearLeftEdge], [false, false, false, false])
  eq('the edge zone is the same physical size on a phone and a desktop', [dr(400, 88, 390).nearLeftEdge, dr(400, 88, 1920).nearLeftEdge, dr(400, 89, 390).nearLeftEdge, dr(400, 89, 1920).nearLeftEdge], [true, true, false, false])
}

// =====================================================================================
// events.ts — an audit event as a plain sentence
// =====================================================================================
const EV = await load('lib/pos/events.mjs')
section('events.ts — describeEvent: every event type, both languages, hostile payloads')
{
  const TYPES = [...M.types.POS_EVENT_TYPES]
  const TONES = ['neutral', 'ok', 'warn', 'danger', 'info']
  const KINDS = ['order', 'line', 'session', 'config', 'people', 'system']
  const HEBREW = /[֐-׿]/
  const BAD_WORDS = /undefined|NaN|\bnull\b|\[object|Infinity/
  const PHONE = '0541234567'
  const full = {
    ticket_no: 7, customer_name: 'דנה', name: 'לאטה', type: 'גדול', qty: 2, total_agorot: 4250, reason: 'טעות', from: 'ready', to: 'preparing',
    items: [{}, {}], name_changed: true, previous_name: 'דן', point: 'בר', moved_to: 'מטבח', employee_no: 105, voided_uncollected: 3,
    orders: 4, phones: 2, names: 5, kind: 'live', enabled: true, old: 'a', new: 'b', cleared: false, by_self: true, slip_mismatch: true,
    customer_phone: PHONE, phone: '+972541234567',
  }
  const hostile = [
    undefined, null, {}, 'a string', 42, [], [1, 2],
    { ticket_no: null, customer_name: null, name: null, qty: null, total_agorot: null, items: null },
    { ticket_no: 'abc', qty: 'many', total_agorot: 'free', items: 'none', employee_no: 'x', orders: {}, phones: [], names: true },
    { ticket_no: NaN, qty: NaN, total_agorot: NaN, employee_no: NaN, voided_uncollected: NaN, orders: NaN },
    { ticket_no: Infinity, qty: -Infinity, total_agorot: Infinity },
    { ticket_no: { a: 1 }, customer_name: { a: 1 }, name: ['x'], reason: {}, from: 5, to: {}, point: [], moved_to: {} },
    { total_agorot: -5 }, { total_agorot: 5 }, { total_agorot: 100 },
    full,
  ]
  for (const lang of ['he', 'en']) {
    for (const type of TYPES) {
      sweep(`${type} / ${lang}: never throws, never says undefined/NaN/null, never carries a phone`, hostile, (payload) => {
        const d = EV.describeEvent({ event: type, payload }, lang)
        return typeof d.text === 'string' && d.text.trim().length > 0 && !BAD_WORDS.test(d.text) && !d.text.includes(PHONE) && !d.text.includes('972541234567') && !/\d{7,}/.test(d.text)
      })
    }
  }
  sweep('every type has a lucide-style icon, a known tone and kind, and a boolean quiet flag', TYPES, (type) => {
    const d = EV.describeEvent({ event: type, payload: {} }, 'he')
    return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(d.icon) && TONES.includes(d.tone) && KINDS.includes(d.kind) && typeof d.quiet === 'boolean'
  })
  sweep('the Hebrew sentence is Hebrew, the English one has no Hebrew in it (given a payload with none)', TYPES, (type) => {
    const he = EV.describeEvent({ event: type, payload: {} }, 'he').text
    const en = EV.describeEvent({ event: type, payload: {} }, 'en').text
    return HEBREW.test(he) && !HEBREW.test(en)
  })
  sweep('Hebrew is the default language', TYPES, (type) => EV.describeEvent({ event: type, payload: {} }).text === EV.describeEvent({ event: type, payload: {} }, 'he').text)
  sweep('an unknown language falls to Hebrew rather than throwing', TYPES, (type) => typeof EV.describeEvent({ event: type, payload: {} }, 'fr').text === 'string')
  check('the picked-up stamp (always followed by a delivery) is the quiet one the feed may hide', EV.describeEvent({ event: 'item_picked_up', payload: {} }).quiet === true && EV.describeEvent({ event: 'item_delivered', payload: {} }).quiet === false)
  eq('an event type this build does not know yet is shown, not thrown', EV.describeEvent({ event: 'from_the_future', payload: { a: 1 } }), { icon: 'circle', tone: 'neutral', kind: 'system', text: 'from_the_future', quiet: false })
  eq('the sentence never includes the actor (the UI shows the handle chip beside it)', EV.describeEvent({ event: 'checkin', payload: { point: 'בר', actor_handle: 'ZED' } }).text.includes('ZED'), false)

  const d = (event, payload, lang = 'he') => EV.describeEvent({ event, payload }, lang).text
  check('a delivered line names the item, the ticket and the customer', ['לאטה', '#7', 'דנה'].every((w) => d('item_delivered', full).includes(w)))
  check('a quantity above 1 is shown as "2×", a single one is not', d('item_ready', { name: 'x', qty: 2 }).includes('2×') && !d('item_ready', { name: 'x', qty: 1 }).includes('1×'))
  check('a voided order shows its reason, and none when there is none', d('order_voided', { reason: 'טעות' }).includes('טעות'))
  eq('money in an order sentence is whole-shekel clean (₪42.50, ₪42)', [d('order_completed', { total_agorot: 4250 }).includes('₪42.50'), d('order_completed', { total_agorot: 4200 }).includes('₪42'), d('order_completed', { total_agorot: 4200 }).includes('₪42.')], [true, true, false])
  eq('a total of 5 agorot is ₪0.05, not ₪0.5', d('order_completed', { total_agorot: 5 }).includes('₪0.05'), true)
  check('order_completed with no total says nothing about money', !d('order_completed', {}).includes('₪'))
  check('a revert names both states in plain words, not status codes', (() => { const t = d('item_reverted', { name: 'x', from: 'ready', to: 'preparing' }); return t.includes('מוכן') && t.includes('בהכנה') && !/ready|preparing/.test(t) })())
  check('…in English too', (() => { const t = d('item_reverted', { name: 'x', from: 'ready', to: 'preparing' }, 'en'); return t.includes('ready') && t.includes('being prepared') && !t.includes('preparing') })())
  check('a rename shows old and new', d('order_edited', { name_changed: true, ticket_no: 3, previous_name: 'דן', customer_name: 'דנה' }).includes('דן') && d('order_edited', { name_changed: true, previous_name: 'דן', customer_name: 'דנה' }).includes('דנה'))
  eq('the training session reads differently from a real event', [d('session_opened', { kind: 'training' }) !== d('session_opened', { kind: 'live' }), d('session_opened', { kind: 'live' }) === d('session_opened', {})], [true, true])
  check('closing an event mentions uncollected items only when there were some', d('session_closed', { voided_uncollected: 3 }).includes('3') && !/\d/.test(d('session_closed', {})))
  check('the passcode events never reveal a passcode and say whether it was cleared / own / reset', (() => {
    const cleared = d('pin_changed', { cleared: true }); const own = d('pin_changed', { by_self: true }); const other = d('pin_changed', {})
    return new Set([cleared, own, other]).size === 3 && ![cleared, own, other].some((t) => /\d{3,}/.test(t))
  })())
  check('quick_login shows the employee number, quiet', d('quick_login', { employee_no: 105 }).includes('105') && EV.describeEvent({ event: 'quick_login', payload: {} }).quiet === true)
  check('settings_changed tells on from off', d('settings_changed', { enabled: true }) !== d('settings_changed', { enabled: false }) && d('settings_changed', { enabled: false }) !== d('settings_changed', {}))
}

section('events.ts — groupFeed: fold a batch into one row, nothing else')
{
  const ev = (id, event, over = {}) => ({ id, event, order_id: 'o1', actor_id: 'a1', at: new Date(W2NOW - id * 1000).toISOString(), payload: {}, ...over })
  eq('an empty feed folds to nothing', EV.groupFeed([]), [])
  const one = EV.groupFeed([ev(1, 'item_ready')])
  eq('a single event is a row of count 1', [one.length, one[0].count, one[0].ids], [1, 1, [1]])
  const run = EV.groupFeed([ev(1, 'item_ready'), ev(2, 'item_ready'), ev(3, 'item_ready')])
  eq('three consecutive identical line events by one person on one order fold into one row', [run.length, run[0].count, run[0].ids], [1, 3, [1, 2, 3]])
  eq('the row shows its FIRST (newest) event', run[0].event.id, 1)
  for (const type of ['item_claimed', 'item_ready', 'item_picked_up', 'item_delivered', 'item_voided']) eq(`${type} folds`, EV.groupFeed([ev(1, type), ev(2, type)]).length, 1)
  for (const type of ['order_created', 'items_added', 'order_edited', 'item_reverted', 'order_voided', 'order_completed', 'checkin', 'quick_login', 'settings_changed']) eq(`${type} never folds (each is its own fact)`, EV.groupFeed([ev(1, type), ev(2, type)]).length, 2)
  eq('a different person does not fold', EV.groupFeed([ev(1, 'item_ready'), ev(2, 'item_ready', { actor_id: 'a2' })]).length, 2)
  eq('a different order does not fold', EV.groupFeed([ev(1, 'item_ready'), ev(2, 'item_ready', { order_id: 'o2' })]).length, 2)
  eq('a different event type does not fold', EV.groupFeed([ev(1, 'item_ready'), ev(2, 'item_delivered')]).length, 2)
  eq('only ADJACENT events fold (ready, delivered, ready is three rows)', EV.groupFeed([ev(1, 'item_ready'), ev(2, 'item_delivered'), ev(3, 'item_ready')]).length, 3)
  eq('events exactly 10 s apart fold (inclusive)', EV.groupFeed([ev(0, 'item_ready'), ev(10, 'item_ready')]).length, 1)
  eq('events 10.001 s apart do not', EV.groupFeed([ev(0, 'item_ready'), { ...ev(10, 'item_ready'), at: new Date(W2NOW - 10_001).toISOString() }]).length, 2)
  eq('a custom window is honoured', [EV.groupFeed([ev(0, 'item_ready'), ev(30, 'item_ready')], 60_000).length, EV.groupFeed([ev(0, 'item_ready'), ev(30, 'item_ready')], 1000).length], [1, 2])
  eq('an unreadable timestamp never folds (and does not throw)', EV.groupFeed([ev(1, 'item_ready'), { ...ev(2, 'item_ready'), at: 'garbage' }]).length, 2)
  const input = [ev(1, 'item_ready'), ev(2, 'item_ready')]
  const before = JSON.stringify(input)
  EV.groupFeed(input)
  eq('the input list is not mutated', JSON.stringify(input), before)
  const r = rng(11)
  const kinds = ['item_ready', 'item_claimed', 'item_delivered', 'order_created', 'item_voided']
  sweep('folding conserves events: counts add up and ids come back in the original order', Array.from({ length: 300 }, (_, i) => i), (i) => {
    const events = Array.from({ length: 1 + (i % 25) }, (_, k) => ev(k + 1, pick(r, kinds), { order_id: pick(r, ['o1', 'o2']), actor_id: pick(r, ['a1', 'a2']) }))
    const rows = EV.groupFeed(events)
    return rows.reduce((n, x) => n + x.count, 0) === events.length && isDeepStrictEqual(rows.flatMap((x) => x.ids), events.map((e) => e.id)) && rows.every((x) => x.count === x.ids.length && x.event.id === x.ids[0])
  })
}


// =====================================================================================
// outbox.ts / client.ts / realtime.ts — the pure halves
// =====================================================================================
const OB = await load('lib/pos/outbox.mjs')
const RT = await load('lib/pos/realtime.mjs')
const CL = await load('lib/pos/client.mjs')
const QJ = await load('lib/pos/quick-jwt.mjs')

section('outbox.ts — classifyFailure: retry what never arrived, stop on what the server refused')
{
  const cf = (status, code) => OB.classifyFailure({ status, code })
  eq('no answer at all (network) is transient', cf(0, 'network'), 'transient')
  eq('status 0 with any code is transient (the request never got an answer)', cf(0, 'whatever'), 'transient')
  eq('a network code wins even over a 4xx status', cf(400, 'network'), 'transient')
  for (const s of [500, 502, 503, 504]) eq(`a ${s} from the server is transient`, cf(s, 'internal_error'), 'transient')
  eq('a 5xx with a code nobody knows is transient', cf(503, 'mystery'), 'transient')
  eq('429 is transient (slow down, not "no")', cf(429, 'rate_limited'), 'transient')
  eq('rate_limited is transient whatever the status', cf(200, 'rate_limited'), 'transient')
  eq('401 unauthorized is permanent (retrying a sign-in problem forever helps nobody)', cf(401, 'unauthorized'), 'permanent')
  eq('403 forbidden is permanent', cf(403, 'forbidden'), 'permanent')
  eq('404 not_found is permanent', cf(404, 'not_found'), 'permanent')
  eq('409 conflict is permanent', cf(409, 'conflict'), 'permanent')
  eq('400 bad_request is permanent', cf(400, 'bad_request'), 'permanent')
  eq('any bad_* code is permanent, whatever the status', [cf(400, 'bad_whatever'), cf(500, 'bad_customer'), cf(422, 'bad_future_thing')], ['permanent', 'permanent', 'permanent'])
  eq('an unknown 4xx is permanent (the server answered; a retry would repeat it)', cf(418, 'teapot'), 'permanent')
  eq('a 3xx or odd 2xx with an unknown code is permanent too (not a connectivity problem)', [cf(302, 'x'), cf(200, 'x')], ['permanent', 'permanent'])
  const permanentCodes = ['unauthorized', 'forbidden', 'needs_handle', 'not_enabled', 'no_session', 'bad_request', 'bad_customer', 'bad_line', 'bad_point', 'bad_reason', 'not_found', 'order_void', 'conflict']
  for (const c of permanentCodes) eq(`${c} is permanent`, cf(409, c), 'permanent')
  eq('…and stays permanent if a proxy rewrites the status to a 5xx (the code is the server\'s own reason)', permanentCodes.map((c) => cf(500, c)).every((x) => x === 'permanent'), true)
  const refusals = LINE_PROBLEM_CODES ?? []
  check('the LineProblemCode union was parsed', refusals.length >= 17)
  sweep('EVERY line-problem code is a refusal: the order itself is wrong, so resending it can only fail again', refusals, (c) => cf(409, c) === 'permanent' && cf(500, c) === 'permanent')
  eq('internal_error on its own is the one server code that IS worth retrying', cf(500, 'internal_error'), 'transient')
}

section('outbox.ts — backoffMs: 1 s, doubling, capped at 15 s')
{
  eq('after the first failure: the start delay', OB.backoffMs(1), OUTBOX.backoffStartMs)
  eq('doubling: 1,2,3,4 -> 1s,2s,4s,8s', [1, 2, 3, 4].map(OB.backoffMs), [1000, 2000, 4000, 8000])
  eq('the 5th failure would be 16 s: it is capped at 15 s', OB.backoffMs(5), OUTBOX.backoffCapMs)
  eq('far beyond that it stays at the cap', [6, 10, 50, 1000, 1e9].map(OB.backoffMs), Array(5).fill(OUTBOX.backoffCapMs))
  eq('0 or less is treated as 1 (the spec says so)', [0, -1, -100].map(OB.backoffMs), Array(3).fill(OUTBOX.backoffStartMs))
  eq('NaN is treated as 1', OB.backoffMs(NaN), OUTBOX.backoffStartMs)
  eq('a fractional count is floored', OB.backoffMs(2.9), 2000)
  sweep('monotonic, never below the start, never above the cap, always a whole number of ms', Array.from({ length: 200 }, (_, i) => i), (n) => {
    const v = OB.backoffMs(n)
    return v >= OUTBOX.backoffStartMs && v <= OUTBOX.backoffCapMs && Number.isInteger(v) && (n === 0 || OB.backoffMs(n + 1) >= v)
  })
}

const entryKey = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const entryBody = (n) => ({ clientKey: entryKey(n), branchId: UUID_A, customerName: 'דנה', customerPhone: '0541234567', lines: [{ itemUid: 'ci-plain', qty: 1 }] })
const mkEntry = (n, over = {}) => ({ clientKey: entryKey(n), queuedAt: n * 1000, body: entryBody(n), attempts: 0, state: 'pending', nextAttemptAt: 0, ...over })

section('outbox.ts — sanitizeOutbox: whatever localStorage holds -> a clean FIFO queue, never a throw')
{
  const sane = OB.sanitizeOutbox
  for (const g of [undefined, null, 0, 5, true, {}, 'not json', '{', '{}', '"str"', 'null', '[1,2', () => 1, Symbol.iterator]) eq(`garbage ${show(String(g))} -> an empty queue`, (() => { try { return sane(g) } catch (e) { return `THREW ${e.message}` } })(), [])
  eq('an empty array and its JSON form are empty queues', [sane([]), sane('[]')], [[], []])
  const good = mkEntry(1)
  eq('a valid entry survives as given', sane([good]), [good])
  eq('the raw JSON string is accepted too (that is what localStorage returns)', sane(JSON.stringify([good])), [good])
  eq('the phone stays in the queued body until the server accepts the order', sane([good])[0].body.customerPhone, '0541234567')
  eq('junk items in the array are skipped, valid ones kept', sane([null, 7, 'x', [], good, { clientKey: 1 }]), [good])
  const bodyless = (patch) => sane([{ ...good, body: { ...good.body, ...patch } }]).length
  eq('a clientKey that is not a uuid is dropped', sane([{ ...good, clientKey: 'abc', body: { ...good.body, clientKey: 'abc' } }]), [])
  eq('a body whose clientKey differs from the entry\'s is dropped (it could never be deduped)', bodyless({ clientKey: entryKey(99) }), 0)
  eq('a body with no branch is dropped', bodyless({ branchId: undefined }), 0)
  eq('a body with no customer name is dropped', bodyless({ customerName: 5 }), 0)
  eq('a body with no lines is dropped', bodyless({ lines: [] }), 0)
  eq('a body whose lines are not an array is dropped', bodyless({ lines: 'x' }), 0)
  eq('a null body is dropped', sane([{ ...good, body: null }]), [])
  eq('duplicate keys collapse, first wins', sane([mkEntry(1, { attempts: 3 }), mkEntry(1, { attempts: 9 })]).map((e) => e.attempts), [3])
  eq('an entry that was mid-send when the page died goes back to pending (idempotency makes the resend safe)', sane([mkEntry(1, { state: 'sending' })])[0].state, 'pending')
  eq('an entry needing attention stays that way', sane([mkEntry(1, { state: 'attention' })])[0].state, 'attention')
  eq('an unknown state reads as pending', sane([mkEntry(1, { state: 'banana' })])[0].state, 'pending')
  eq('the queue comes back FIFO by queue time', sane([mkEntry(3), mkEntry(1), mkEntry(2)]).map((e) => e.clientKey), [entryKey(1), entryKey(2), entryKey(3)])
  eq('ties on queue time keep their stored order (stable)', sane([mkEntry(2, { queuedAt: 5 }), mkEntry(1, { queuedAt: 5 }), mkEntry(3, { queuedAt: 5 })]).map((e) => e.clientKey), [entryKey(2), entryKey(1), entryKey(3)])
  eq('a negative / fractional / string attempt count becomes 0', [-1, 1.5, '2', null].map((a) => sane([mkEntry(1, { attempts: a })])[0].attempts), [0, 0, 0, 0])
  eq('a negative or non-finite queue time becomes 0', [-5, NaN, 'x', Infinity].map((q) => sane([mkEntry(1, { queuedAt: q })])[0].queuedAt), [0, 0, 0, 0])
  eq('a non-finite next-attempt time becomes 0 (due now), never NaN that would block forever', [NaN, 'soon', null, Infinity].map((q) => sane([mkEntry(1, { nextAttemptAt: q })])[0].nextAttemptAt), [0, 0, 0, 0])
  const le = sane([mkEntry(1, { lastError: { code: 'c'.repeat(100), message: 'm'.repeat(500) } })])[0].lastError
  eq('a stored error is kept but bounded (60 / 200 chars)', [le.code.length, le.message.length], [60, 200])
  eq('a malformed stored error is ignored', [{ code: 1, message: 'x' }, 'str', null, { code: 'a' }].map((e) => 'lastError' in sane([mkEntry(1, { lastError: e })])[0]), [false, false, false, false])
  const before = JSON.stringify([mkEntry(2), mkEntry(1)])
  const arr = JSON.parse(before)
  sane(arr)
  eq('the input array is not reordered in place', JSON.stringify(arr), before)
  const r = rng(5)
  sweep('a queue written by this build always survives the trip through sanitize (idempotent)', Array.from({ length: 100 }, (_, i) => i), (i) => {
    const q = Array.from({ length: 1 + (i % 6) }, (_, k) => mkEntry(k + 1, { state: pick(r, ['pending', 'attention']), attempts: Math.floor(r() * 9), nextAttemptAt: Math.floor(r() * 1e6) }))
    return isDeepStrictEqual(sane(sane(q)), sane(q)) && isDeepStrictEqual(sane(JSON.stringify(q)), q)
  })
}

section('outbox.ts — nextDue / nextWakeAt: one send at a time, a poison pill never freezes the queue')
{
  const now = 100_000
  eq('an empty queue has nothing due and nothing to wake for', [OB.nextDue([], now), OB.nextWakeAt([])], [null, null])
  eq('a pending entry whose time has come is due', OB.nextDue([mkEntry(1)], now)?.clientKey, entryKey(1))
  eq('a pending entry due EXACTLY now is due', OB.nextDue([mkEntry(1, { nextAttemptAt: now })], now)?.clientKey, entryKey(1))
  eq('one millisecond early is not', OB.nextDue([mkEntry(1, { nextAttemptAt: now + 1 })], now), null)
  eq('NOTHING is due while one is mid-send (one at a time)', OB.nextDue([mkEntry(1, { state: 'sending' }), mkEntry(2)], now), null)
  eq('an entry needing attention is never due and never blocks', OB.nextDue([mkEntry(1, { state: 'attention' }), mkEntry(2)], now)?.clientKey, entryKey(2))
  eq('the earliest-QUEUED due entry goes first (FIFO), whatever the array order', OB.nextDue([mkEntry(3), mkEntry(1), mkEntry(2)], now)?.clientKey, entryKey(1))
  eq('a pending entry still in backoff does not hold up a later one that is ready (poison pill)', OB.nextDue([mkEntry(1, { nextAttemptAt: now + 9999 }), mkEntry(2)], now)?.clientKey, entryKey(2))
  eq('only attention entries -> nothing due', OB.nextDue([mkEntry(1, { state: 'attention' })], now), null)
  eq('nextWakeAt is the earliest pending nextAttemptAt', OB.nextWakeAt([mkEntry(1, { nextAttemptAt: 500 }), mkEntry(2, { nextAttemptAt: 200 }), mkEntry(3, { nextAttemptAt: 900 })]), 200)
  eq('nextWakeAt ignores attention and sending entries', OB.nextWakeAt([mkEntry(1, { state: 'attention', nextAttemptAt: 1 }), mkEntry(2, { state: 'sending', nextAttemptAt: 2 }), mkEntry(3, { nextAttemptAt: 50 })]), 50)
  eq('nextWakeAt is null when nothing is waiting', OB.nextWakeAt([mkEntry(1, { state: 'attention' })]), null)
  eq('nextWakeAt may be in the past (the timer fires at once)', OB.nextWakeAt([mkEntry(1, { nextAttemptAt: 0 })]), 0)
}

section('client.ts — interpretResponse: the envelope handling that decides retry-or-stop')
{
  const ir = CL.interpretResponse
  eq('a 2xx JSON object is success, handed over as data', ir(200, '{"orderId":"x","ticketNo":7}'), { ok: true, data: { orderId: 'x', ticketNo: 7 } })
  eq('201 is success too', ir(201, '{"a":1}').ok, true)
  for (const [name, text] of [['an HTML captive-portal page', '<html>Log in to the Wi-Fi</html>'], ['an empty body', ''], ['a JSON array', '[1]'], ['a JSON string', '"ok"'], ['JSON null', 'null'], ['a JSON number', '5']]) {
    const r = ir(200, text)
    check(`a 200 carrying ${name} is a NETWORK failure, not a success (a paid-for order must not be marked sent)`, r.ok === false && r.status === 0 && r.code === 'network', show(r))
    eq(`…and that is transient for the outbox (${name})`, OB.classifyFailure(r), 'transient')
  }
  eq('a bounce to the login page is "sign in again" (401 unauthorized), never a retry loop', [ir(200, '<html>', true).status, ir(200, '<html>', true).code, OB.classifyFailure(ir(200, '<html>', true))], [401, 'unauthorized', 'permanent'])
  const env = ir(409, JSON.stringify({ error: { code: 'sold_out', message: 'אזל', details: { itemUid: 'x' } } }))
  eq('an error envelope keeps its code, message and details', [env.ok, env.status, env.code, env.message, env.details], [false, 409, 'sold_out', 'אזל', { itemUid: 'x' }])
  eq('the envelope\'s code drives the outbox decision', OB.classifyFailure(env), 'permanent')
  for (const [status, want] of [[401, 'unauthorized'], [403, 'forbidden'], [404, 'not_found'], [409, 'conflict'], [429, 'rate_limited'], [500, 'internal_error'], [502, 'internal_error'], [503, 'internal_error'], [400, 'bad_request'], [418, 'bad_request'], [422, 'bad_request']]) {
    const r = ir(status, '<html>proxy page</html>')
    eq(`a ${status} that is not our envelope still gets a code from its status line (${want})`, r.code, want)
    check(`…and a message an employee could be shown (${status})`, typeof r.message === 'string' && r.message.length > 0)
  }
  eq('a proxy 502 is retried, a 429 is retried, a 401 is not', [ir(502, '<html>').status, OB.classifyFailure(ir(502, '<html>')), OB.classifyFailure(ir(429, '')), OB.classifyFailure(ir(401, ''))], [502, 'transient', 'transient', 'permanent'])
  for (const text of ['{"error":null}', '{"error":[]}', '{"error":{"code":5}}', '{"error":{"code":""}}', '{"error":{"message":9}}', 'null', '[]', '{', '']) {
    const r = ir(500, text)
    check(`a malformed 500 body ${show(text)} still yields a typed failure with a message`, r.ok === false && r.status === 500 && typeof r.code === 'string' && r.code.length > 0 && typeof r.message === 'string' && r.message.length > 0, show(r))
  }
  eq('details that are not an object are dropped', 'details' in ir(400, '{"error":{"code":"bad_request","message":"m","details":"x"}}'), false)
}

section('realtime.ts — the pure decisions (status mapping, the watchdog, dirty-set bookkeeping)')
{
  eq('SUBSCRIBED is live', RT.mapChannelStatus('SUBSCRIBED'), 'live')
  for (const s of ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']) eq(`${s} is off`, RT.mapChannelStatus(s), 'off')
  for (const s of ['JOINING', 'JOINED', 'SOMETHING_NEW', '', 'subscribed']) eq(`an unrecognised state (${show(s)}) is "still trying", never silently live or off`, RT.mapChannelStatus(s), 'connecting')
  const dead = REFRESH.deadSocketMs
  const t0 = 1_000_000
  eq('the dead-socket window is 15 s', dead, 15_000)
  eq('a live channel is never rebuilt, however old lastLiveAt is', RT.shouldRebuild('live', 0, t0 + 1e9), false)
  for (const st of ['connecting', 'off']) {
    eq(`${st}: not live for exactly 15 s is still inside the window`, RT.shouldRebuild(st, t0, t0 + dead), false)
    eq(`${st}: 15 s + 1 ms rebuilds`, RT.shouldRebuild(st, t0, t0 + dead + 1), true)
    eq(`${st}: just lost it -> wait`, RT.shouldRebuild(st, t0, t0 + 1000), false)
  }
  eq('a custom window is honoured', [RT.shouldRebuild('off', t0, t0 + 5001, 5000), RT.shouldRebuild('off', t0, t0 + 5000, 5000)], [true, false])
  eq('a clock that went backwards never forces a rebuild', RT.shouldRebuild('off', t0, t0 - 99999), false)
  const base = new Set(['pos_orders'])
  const merged = RT.mergeDirty(base, 'pos_order_items', 'pos_orders', 'pos_events')
  eq('mergeDirty unions the tables, deduplicated', [...merged].sort(), ['pos_events', 'pos_order_items', 'pos_orders'])
  eq('mergeDirty never mutates the set it was given', [...base], ['pos_orders'])
  check('mergeDirty returns a fresh Set', merged instanceof Set && merged !== base)
  eq('mergeDirty with nothing to add is a copy', [RT.mergeDirty(base) !== base, [...RT.mergeDirty(base)]], [true, ['pos_orders']])
  eq('the six watched tables are exactly the ones the POS writes (columns.ts is the one list)', [...M.columns.REALTIME_TABLES].sort(), ['pos_events', 'pos_order_items', 'pos_orders', 'pos_point_checkins', 'pos_points', 'pos_sessions'])
  eq('subscribing to realtime was never attempted at import (the harness stub would have thrown)', typeof RT.subscribeRealtime, 'function')
}

section('quick-jwt.ts — jwtSessionId reads the session_id claim, nothing else')
{
  const SID = '0f8fad5b-d9cb-469f-a165-70867728950e'
  const b64u = (obj) => Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)).toString('base64url')
  const tok = (payload, header = { alg: 'HS256', typ: 'JWT' }) => `${b64u(header)}.${b64u(payload)}.signature`
  eq('a token with a uuid session_id yields it', QJ.jwtSessionId(tok({ sub: 'u', session_id: SID })), SID)
  eq('an upper-case uuid is accepted (and returned as written)', QJ.jwtSessionId(tok({ session_id: SID.toUpperCase() })), SID.toUpperCase())
  eq('a payload whose base64 needs the - and _ alphabet decodes (JWT is base64url, not base64)', (() => { const p = { session_id: SID, pad: '???>>>~~~' }; const enc = b64u(p).split('.')[0]; return /[-_]/.test(enc) ? QJ.jwtSessionId(tok(p)) : 'fixture has no - or _' })(), SID)
  for (const [name, v] of [['null', null], ['undefined', undefined], ['empty', ''], ['one segment', 'abc'], ['no payload', 'a..c'], ['not base64', 'a.!!!.c'], ['not JSON', `a.${b64u('hello')}.c`], ['a JSON array', `a.${b64u('[1]')}.c`], ['JSON null', `a.${b64u('null')}.c`]]) eq(`${name} -> null`, QJ.jwtSessionId(v), null)
  eq('a payload without session_id -> null', QJ.jwtSessionId(tok({ sub: 'u' })), null)
  eq('a numeric session_id -> null', QJ.jwtSessionId(tok({ session_id: 12345 })), null)
  eq('a non-uuid session_id -> null (it becomes a lookup key; only a uuid may)', QJ.jwtSessionId(tok({ session_id: 'abc' })), null)
  eq('a 35-character id -> null', QJ.jwtSessionId(tok({ session_id: SID.slice(1) })), null)
  eq('an injection attempt in the claim -> null', QJ.jwtSessionId(tok({ session_id: `${SID.slice(0, 20)}'; drop table x;--` })), null)
  eq('a claim with trailing junk after a uuid -> null', QJ.jwtSessionId(tok({ session_id: `${SID}x` })), null)
  eq('it never throws on hostile input', (() => { try { for (const v of ['.', '..', '...', '\u0000.\u0000.', 'a.b', 'é.é.é', 'x'.repeat(10000)]) QJ.jwtSessionId(v); return 'ok' } catch (e) { return e.message } })(), 'ok')
}


// =====================================================================================
// server/*.ts — the helpers that need no database
// =====================================================================================
const SS = await load('lib/pos/server/stats.mjs')
const SG = await load('lib/pos/server/signals.mjs')
const RD = await load('lib/pos/server/readiness.mjs')
const EX = await load('lib/pos/server/export.mjs')
const LG = await load('lib/pos/server/log.mjs')
const DT = await load('lib/pos/server/details.mjs')

section('stats.ts — median / p90: "no data" is null, never zero')
{
  const { percentile, median, p90, timingStat } = SS
  eq('no data is null, not 0', [median([]), p90([]), percentile([], 50)], [null, null, null])
  eq('one value is every percentile', [median([42]), p90([42]), percentile([42], 0), percentile([42], 100)], [42, 42, 42, 42])
  eq('median of an odd list is the middle', median([3, 1, 2]), 2)
  eq('median of an even list interpolates (10, 20 -> 15)', median([20, 10]), 15)
  eq('median of 1..4 is 2.5 rounded to whole seconds (3)', median([1, 2, 3, 4]), 3)
  eq('p90 of 1..11 sits exactly on the 10th value', p90(Array.from({ length: 11 }, (_, i) => i + 1)), 10)
  eq('p90 of 1..10 interpolates between 9 and 10 (rank 8.1 -> 9.1 -> 9)', p90(Array.from({ length: 10 }, (_, i) => i + 1)), 9)
  eq('p0 is the minimum, p100 the maximum', [percentile([5, 1, 9], 0), percentile([5, 1, 9], 100)], [1, 9])
  eq('a percentile outside 0..100 is clamped', [percentile([5, 1, 9], -20), percentile([5, 1, 9], 250)], [1, 9])
  eq('the input order does not matter and is not mutated', (() => { const v = [9, 1, 5, 3]; const before = [...v]; const m = median(v); return [m, isDeepStrictEqual(v, before), median([1, 3, 5, 9])] })(), [4, true, 4])
  eq('NaN and Infinity are ignored, not averaged in', median([10, NaN, 20, Infinity, -Infinity]), 15)
  eq('a list of only non-finite values is "no data"', median([NaN, Infinity]), null)
  eq('results are whole seconds', Number.isInteger(median([1.2, 7.7, 3.3, 9.9])), true)
  eq('the median never exceeds p90', (() => { const r = rng(3); for (let i = 0; i < 200; i++) { const v = Array.from({ length: 1 + (i % 30) }, () => Math.floor(r() * 1000)); if (median(v) > p90(v)) return false } return true })(), true)
  eq('timingStat counts every value and states both', timingStat([10, 20, 30]), { count: 3, medianSeconds: 20, p90Seconds: 28 })
  eq('timingStat of nothing is count 0 with null stats', timingStat([]), { count: 0, medianSeconds: null, p90Seconds: null })
}

section('stats.ts — time zones: the day the bar keeps, not the server\'s')
{
  const { safeTimeZone, zonedParts, floorLocal, localHHMM, zonedDayStartMs, dateRangeMs } = SS
  eq('no zone means the bar\'s own', [safeTimeZone(null), safeTimeZone(undefined), safeTimeZone('')], ['Asia/Jerusalem', 'Asia/Jerusalem', 'Asia/Jerusalem'])
  eq('a nonsense zone must not 500 the page: it falls back to the bar\'s', [safeTimeZone('Not/AZone'), safeTimeZone('garbage'), safeTimeZone('Israel Standard Time')], ['Asia/Jerusalem', 'Asia/Jerusalem', 'Asia/Jerusalem'])
  eq('a real zone is kept', [safeTimeZone('UTC'), safeTimeZone('America/New_York')], ['UTC', 'America/New_York'])
  const at = (iso) => Date.parse(iso)
  eq('winter: 10:00Z is 12:00 in Jerusalem', zonedParts(at('2026-01-15T10:00:00Z'), 'Asia/Jerusalem'), { y: 2026, mo: 1, d: 15, h: 12, mi: 0, s: 0 })
  eq('summer: 10:00Z is 13:00 in Jerusalem (DST)', zonedParts(at('2026-07-15T10:00:00Z'), 'Asia/Jerusalem').h, 13)
  eq('local midnight is hour 0, never 24', zonedParts(at('2026-01-14T22:00:00Z'), 'Asia/Jerusalem'), { y: 2026, mo: 1, d: 15, h: 0, mi: 0, s: 0 })
  eq('a half-hour zone (Kolkata, +5:30)', zonedParts(at('2026-01-15T10:00:00Z'), 'Asia/Kolkata'), { y: 2026, mo: 1, d: 15, h: 15, mi: 30, s: 0 })
  eq('a bad zone falls back instead of throwing', zonedParts(at('2026-01-15T10:00:00Z'), 'Not/AZone').h, 12)
  eq('localHHMM is zero-padded wall-clock time', localHHMM(at('2026-01-15T05:05:00Z'), 'Asia/Jerusalem'), '07:05')
  eq('floorLocal 60: the start of the local hour', localHHMM(floorLocal(at('2026-01-15T10:47:31.250Z'), 'Asia/Jerusalem', 60), 'Asia/Jerusalem'), '12:00')
  eq('…and it is an exact instant (no seconds, no milliseconds left over)', floorLocal(at('2026-01-15T10:47:31.250Z'), 'Asia/Jerusalem', 60) % 60000, 0)
  eq('floorLocal 15: the quarter hour', localHHMM(floorLocal(at('2026-01-15T10:47:31Z'), 'Asia/Jerusalem', 15), 'Asia/Jerusalem'), '12:45')
  eq('floorLocal in a +5:30 zone lands on the LOCAL hour, not the UTC one', localHHMM(floorLocal(at('2026-01-15T10:20:00Z'), 'Asia/Kolkata', 60), 'Asia/Kolkata'), '15:00')
  eq('an instant exactly on a bucket boundary stays put', floorLocal(at('2026-01-15T10:00:00Z'), 'Asia/Jerusalem', 60), at('2026-01-15T10:00:00Z'))
  eq('a pre-1970 instant (negative ms) still floors correctly', localHHMM(floorLocal(-3_600_000 * 5 - 1234, 'UTC', 60), 'UTC'), '18:00')
  eq('a local day starts at 22:00Z in Jerusalem winter', zonedDayStartMs('2026-01-15', 'Asia/Jerusalem'), Date.UTC(2026, 0, 14, 22))
  eq('…and at 21:00Z in summer', zonedDayStartMs('2026-07-15', 'Asia/Jerusalem'), Date.UTC(2026, 6, 14, 21))
  eq('DST spring-forward day in New York (2026-03-08) starts at 05:00Z and the next day at 04:00Z — a 23 h day', [zonedDayStartMs('2026-03-08', 'America/New_York'), zonedDayStartMs('2026-03-09', 'America/New_York') - zonedDayStartMs('2026-03-08', 'America/New_York')], [Date.UTC(2026, 2, 8, 5), 23 * 3_600_000])
  eq('the fall-back day is 25 h long (2026-11-01 New York)', zonedDayStartMs('2026-11-02', 'America/New_York') - zonedDayStartMs('2026-11-01', 'America/New_York'), 25 * 3_600_000)
  const days = []
  for (let m = 0; m < 12; m++) for (const d of [1, 15, 28]) days.push(`2026-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  for (const tz of ['Asia/Jerusalem', 'America/New_York', 'Asia/Kolkata', 'Australia/Sydney', 'UTC']) {
    sweep(`${tz}: every local day starts at local 00:00:00 on that exact date`, days, (date) => {
      const p = zonedParts(zonedDayStartMs(date, tz), tz)
      return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}` === date && p.h === 0 && p.mi === 0 && p.s === 0
    })
  }
  eq('no dates -> no bounds', dateRangeMs(undefined, undefined, 'Asia/Jerusalem'), { fromMs: null, toMs: null })
  eq('from only', dateRangeMs('2026-01-15', undefined, 'Asia/Jerusalem'), { fromMs: Date.UTC(2026, 0, 14, 22), toMs: null })
  eq('"to" is INCLUSIVE: it becomes the start of the NEXT day, exclusive', dateRangeMs(undefined, '2026-01-15', 'Asia/Jerusalem'), { fromMs: null, toMs: Date.UTC(2026, 0, 15, 22) })
  eq('the same from and to cover exactly one (non-DST) day', ((r) => r.toMs - r.fromMs)(dateRangeMs('2026-01-15', '2026-01-15', 'Asia/Jerusalem')), 24 * 3_600_000)
  eq('"to" at the end of a month rolls into the next', dateRangeMs(undefined, '2026-01-31', 'UTC').toMs, Date.UTC(2026, 1, 1))
  eq('"to" at the end of the year rolls into the next', dateRangeMs(undefined, '2026-12-31', 'UTC').toMs, Date.UTC(2027, 0, 1))
  eq('a leap day is a real day', dateRangeMs(undefined, '2028-02-28', 'UTC').toMs, Date.UTC(2028, 1, 29))
}

section('stats.ts — lineTimings / timingSetOf (from the STAMPED columns only)')
{
  const t = (secs) => new Date(W2NOW + secs * 1000).toISOString()
  const line = (over) => ({ status: 'delivered', sent_at: t(0), claimed_at: t(60), ready_at: t(180), delivered_at: t(300), ...over })
  eq('a normal line: wait, prep, uncollected and total', SS.lineTimings(line()), { queueWait: 60, prep: 120, uncollected: 120, total: 300 })
  eq('a voided line produces nothing', SS.lineTimings(line({ status: 'voided' })), { queueWait: null, prep: null, uncollected: null, total: null })
  eq('a line a FAST point took straight to ready (claimed === ready) has no measurable wait or prep — not a misleading 0', ((x) => [x.queueWait, x.prep, x.uncollected, x.total])(SS.lineTimings(line({ claimed_at: t(180), ready_at: t(180) }))), [null, null, 120, 300])
  eq('a line not yet delivered has no uncollected time or total', ((x) => [x.queueWait, x.prep, x.uncollected, x.total])(SS.lineTimings(line({ status: 'ready', delivered_at: null }))), [60, 120, null, null])
  eq('a line still waiting has only what has happened', ((x) => [x.queueWait, x.prep, x.uncollected, x.total])(SS.lineTimings({ status: 'sent', sent_at: t(0), claimed_at: null, ready_at: null, delivered_at: null })), [null, null, null, null])
  eq('stamps going backwards (clock skew) clamp to 0, never negative', SS.lineTimings(line({ claimed_at: t(-30) })).queueWait, 0)
  eq('an unparseable stamp is "unknown", not NaN', SS.lineTimings(line({ ready_at: 'not a date' })), { queueWait: 60, prep: null, uncollected: null, total: 300 })
  const set = SS.timingSetOf([line(), line({ claimed_at: t(120), ready_at: t(240), delivered_at: t(420) }), line({ status: 'voided' }), line({ claimed_at: t(180) })])
  eq('timingSetOf counts only what each timing could measure', [set.queueWait.count, set.prep.count, set.uncollected.count, set.total.count], [2, 2, 3, 3].map((n, i) => (i === 0 ? 2 : n)))
  eq('…and the medians come from those', [set.prep.medianSeconds, set.total.medianSeconds], [120, 300])
  eq('an empty set has null stats, not zeros', SS.timingSetOf([]).prep, { count: 0, medianSeconds: null, p90Seconds: null })
}

section('stats.ts — resolveScope: which sessions the numbers cover')
{
  const s = (id, kind, status) => ({ id, kind, status })
  const sessions = [s('t-active', 'training', 'active'), s('l-closed-new', 'live', 'closed'), s('l-closed-old', 'live', 'closed')]
  eq('a named session is used as asked, even a training one — the owner chose it', SS.resolveScope(sessions, { session: 't-active' }), { sessionId: 't-active', includeTraining: true, sessions: [sessions[0]] })
  eq('a named live session does not drag training in', SS.resolveScope(sessions, { session: 'l-closed-old' }).includeTraining, false)
  eq('a named session that does not exist keeps the id but covers nothing', SS.resolveScope(sessions, { session: 'ghost' }), { sessionId: 'ghost', includeTraining: false, sessions: [] })
  eq('the default is the latest LIVE session — training is excluded on purpose', SS.resolveScope(sessions, {}).sessionId, 'l-closed-new')
  eq('…and training never becomes the default even when it is the active one', SS.resolveScope(sessions, {}).includeTraining, false)
  eq('asking for practice includes it, and the active one wins', SS.resolveScope(sessions, { training: '1' }), { sessionId: 't-active', includeTraining: true, sessions: [sessions[0]] })
  eq('an ACTIVE live session beats a newer closed one', SS.resolveScope([s('l-closed', 'live', 'closed'), s('l-active', 'live', 'active')], {}).sessionId, 'l-active')
  eq('"all" covers every live session and no practice one', SS.resolveScope(sessions, { session: 'all' }), { sessionId: null, includeTraining: false, sessions: [sessions[1], sessions[2]] })
  eq('"all" with practice requested covers everything', SS.resolveScope(sessions, { session: 'all', training: '1' }).sessions.length, 3)
  eq('no sessions at all -> nothing selected', SS.resolveScope([], {}), { sessionId: null, includeTraining: false, sessions: [] })
  eq('only practice sessions and no request -> nothing selected (never guess "training" during real service)', SS.resolveScope([s('t', 'training', 'active')], {}), { sessionId: null, includeTraining: false, sessions: [] })
}

section('signals.ts — computeDashboard: a signal exists only when it is true, in a fixed order')
{
  const okR = (data) => ({ ok: true, data })
  const failR = (data) => ({ ok: false, data })
  const D_NOW = Date.parse('2026-06-01T20:00:00Z')
  const ago = (min) => new Date(D_NOW - min * 60_000).toISOString()
  const PT = 'aaaaaaaa-0000-4000-8000-000000000001'
  const point = (over = {}) => ({ id: PT, branch_id: 'b', name: 'בר', icon: 'beer', colour: '#123456', hands_over: true, prep_minutes: 8, excluded_uids: [], sort_order: 0, active: true, ...over })
  const session = (id, kind, status, minutesAgo) => ({ id, branch_id: 'b', kind, status, started_at: ago(minutesAgo), started_by: null, ended_at: null, ended_by: null })
  const settings = (over = {}) => okR({ enabled: true, board_token: null, unsold_refs: [], updated_at: null, ...over })
  const PHONE = '0541234567'
  const liveLine = (id, status, over = {}) => ({
    id, order_id: `o-${id}`, point_id: PT, point_name: 'בר', name: { he: 'בירה', en: 'Beer' }, qty: 1, status, sent_at: ago(1),
    claimed_by: null, claimed_at: null, ready_at: null,
    pos_orders: { ticket_no: 7, customer_name: 'דנה', customer_phone: PHONE }, ...over,
  })
  const dash = (over = {}) => SG.computeDashboard({
    now: D_NOW, settings: settings(), sessions: okR([session('s1', 'live', 'active', 60)]), points: okR([point()]), routes: okR([]), menu: okR(null),
    live: okR([]), timed: okR([]), scopeOrders: okR([]), scopeItems: okR([]), checkins: okR([]), people: okR([]), timezone: 'Asia/Jerusalem', dir: new Map(), ...over,
  })
  const ids = (d) => d.signals.map((x) => x.id)

  eq('a quiet floor has NO signals at all — there is no "all clear" row', dash().signals, [])
  eq('the enabled flag is reported', dash().enabled, { known: true, value: true })

  const closed = dash({ sessions: okR([session('s0', 'live', 'closed', 600)]) })
  eq('POS on but no event open -> the register cannot take an order', ids(closed), ['event-not-open'])
  eq('…it is critical (rank 90)', [closed.signals[0].rank, closed.signals[0].level], [90, 'critical'])
  eq('POS switched off is not an alarm (nobody is expecting orders)', ids(dash({ settings: settings({ enabled: false }), sessions: okR([]) })), [])
  const training = dash({ sessions: okR([session('s1', 'training', 'active', 30)]) })
  eq('training mode is loud: first, rank 100, critical', [training.signals[0].id, training.signals[0].rank, training.signals[0].level], ['training-mode', 100, 'critical'])
  eq('a failed settings read drops its own signal rather than guessing', ids(dash({ settings: failR(null), sessions: okR([]) })), [])
  eq('a failed sessions read drops the session signals', ids(dash({ sessions: failR([]), settings: settings() })), [])

  // stuck: max(4 min, 2 x prep) = 16 min for an 8-minute point
  const stuckAt = (min) => dash({ live: okR([liveLine('L1', 'sent', { sent_at: ago(min) })]) })
  eq('a line waiting 15m59s is not stuck at an 8-minute point', ids(stuckAt(15.98)), [])
  eq('a line waiting exactly 16 min is stuck (>= the threshold)', ids(stuckAt(16)), ['stuck-items'])
  const st = stuckAt(20)
  eq('the stuck signal, the stat and the drill list all state ONE count from ONE array', [st.signals[0].count, st.stats.stuckItems.value, st.drill.stuck.value.total, st.drill.stuck.value.rows.length], [1, 1, 1, 1])
  eq('stuck is a warning (rank 70)', [st.signals[0].rank, st.signals[0].level, st.signals[0].drill], [70, 'warning', 'stuck'])
  eq('a stuck row carries the waiting time and its own threshold', [st.drill.stuck.value.rows[0].waitingSeconds, st.drill.stuck.value.rows[0].thresholdMinutes], [1200, 16])
  eq('a quick point has a floor of 4 minutes (prep 1 -> max(4, 2) = 4)', ids(dash({ points: okR([point({ prep_minutes: 1 })]), live: okR([liveLine('L1', 'sent', { sent_at: ago(4) })]) })), ['stuck-items'])
  eq('a failed live read: the stat is "unknown", not a confident 0, and the signal is absent', ((d) => [d.stats.stuckItems.known, ids(d)])(dash({ live: failR([]) })), [false, []])
  eq('a ready line is not "in flight" so it is never stuck', ids(dash({ live: okR([liveLine('L1', 'ready', { sent_at: ago(90), ready_at: ago(1) })]) })), [])

  // uncollected: ready for >= 5 minutes
  const readyAt = (min) => dash({ live: okR([liveLine('L1', 'ready', { sent_at: ago(min + 3), ready_at: ago(min) })]) })
  eq('ready for 4m54s is not yet "uncollected"', ids(readyAt(4.9)), [])
  eq('ready for exactly 5 min is', ids(readyAt(5)), ['uncollected'])
  const un = readyAt(6)
  eq('uncollected is a reminder, not an alarm: rank 55, warning', [un.signals[0].rank, un.signals[0].level], [55, 'warning'])
  eq('a manager\'s drill list may carry the phone so someone can call', un.drill.uncollected.value.rows[0].customerPhone, PHONE)
  eq('…but NO signal, stat, card, presence or processing text carries it', JSON.stringify([un.signals, un.stats, un.points, un.presence, un.processing]).includes(PHONE.slice(3)), false)

  // backlog: 8 in-flight lines at one point
  const backlog = (n) => dash({ live: okR(Array.from({ length: n }, (_, i) => liveLine(`B${i}`, 'sent', { sent_at: ago(1) }))) })
  eq('7 queued lines at a point is not a backlog', ids(backlog(7)), [])
  eq('8 is (the card\'s bottleneck flag and the signal use one test)', [ids(backlog(8)), backlog(8).points.value[0].bottleneck, backlog(7).points.value[0].bottleneck], [['point-backlog'], true, false])

  // an event left open
  eq('an event open 15 h is fine', ids(dash({ sessions: okR([session('s1', 'live', 'active', 15 * 60)]) })), [])
  eq('an event open 17 h is flagged: somebody forgot to close it', ids(dash({ sessions: okR([session('s1', 'live', 'active', 17 * 60)]) })), ['session-too-long'])

  // slip mismatch only while the event runs
  const order = (over = {}) => ({ id: 'o1', ticket_no: 1, customer_name: 'דנה', status: 'open', total_agorot: 5000, slip_total_agorot: 5500, slip_mismatch: true, created_by: 'staff1', created_at: ago(10), ...over })
  eq('a typed slip that differs is surfaced while the event is open', ids(dash({ scopeOrders: okR([order()]) })), ['slip-mismatch'])
  eq('…with the signed difference (slip minus system)', dash({ scopeOrders: okR([order()]) }).drill.slipMismatches.value.rows[0].diffAgorot, 500)
  eq('once the event is closed nobody can act on it, so it does not linger as an un-clearable signal', ids(dash({ settings: settings({ enabled: false }), sessions: okR([session('s1', 'live', 'closed', 300)]), scopeOrders: okR([order()]) })), [])
  eq('a voided order is not counted in sales or mismatches', ((d) => [d.stats.salesAgorot.value, ids(d)])(dash({ scopeOrders: okR([order({ status: 'void' })]) })), [0, []])

  // the whole stack: order is by rank, fixed, and independent of input order
  const busy = (rev) => {
    const lines = [liveLine('S1', 'sent', { sent_at: ago(30) }), liveLine('R1', 'ready', { sent_at: ago(40), ready_at: ago(10), order_id: 'o-r' })]
    return dash({ sessions: okR([session('s1', 'training', 'active', 17 * 60)]), live: okR(rev ? lines.reverse() : lines), scopeOrders: okR(rev ? [order(), order({ id: 'o2', ticket_no: 2 })].reverse() : [order(), order({ id: 'o2', ticket_no: 2 })]) })
  }
  const a = busy(false)
  eq('a busy night stacks by fixed rank: training 100, stuck 70, uncollected 55, too-long 50, slip 45', ids(a), ['training-mode', 'stuck-items', 'uncollected', 'session-too-long', 'slip-mismatch'])
  sweep('the stack is sorted by rank, descending', [a, busy(true)], (d) => d.signals.every((x, i) => i === 0 || d.signals[i - 1].rank >= x.rank))
  eq('two loads with identical contents (rows arriving in a different order) give an identical stack — it cannot jitter', JSON.stringify(a.signals), JSON.stringify(busy(true).signals))
  sweep('every signal level follows its rank (>=80 critical, >=40 warning, else info)', a.signals, (x) => x.level === (x.rank >= 80 ? 'critical' : x.rank >= 40 ? 'warning' : 'info'))
  sweep('every signal has a Hebrew and an English title, and a count of at least 1', a.signals, (x) => x.title.he.length > 0 && x.title.en.length > 0 && x.count >= 1)
  sweep('no signal text carries a technical word', a.signals, (x) => !TECH.test(x.title.he) && !TECH.test(x.title.en) && !TECH.test(x.detail?.he ?? '') && !TECH.test(x.detail?.en ?? ''))
  eq('signal ids in one load are unique', new Set(ids(a)).size, ids(a).length)

  // presence: who is on a point W2NOW is the latest event per person per point
  const ck = (id, event, minAgo, staff = 'staff1') => ({ id, branch_id: 'b', session_id: 's1', point_id: PT, staff_id: staff, event, at: ago(minAgo) })
  const dir = new Map([['staff1', { id: 'staff1', handle: 'דנה', colour: null }]])
  eq('someone whose latest event is a check-in is on the point', dash({ dir, checkins: okR([ck('c1', 'check_in', 30)]) }).stats.staffOnPoints.value, 1)
  eq('…and not once they have checked out', dash({ dir, checkins: okR([ck('c1', 'check_in', 30), ck('c2', 'check_out', 10)]) }).stats.staffOnPoints.value, 0)
  eq('…order is by time, not by the order of the rows', dash({ dir, checkins: okR([ck('c2', 'check_out', 10), ck('c1', 'check_in', 30)]) }).stats.staffOnPoints.value, 0)
  eq('…and back in again counts again', dash({ dir, checkins: okR([ck('c1', 'check_in', 30), ck('c2', 'check_out', 20), ck('c3', 'check_in', 5)]) }).stats.staffOnPoints.value, 1)
}

section('readiness.ts — buildReadiness: the checklist that gates opening')
{
  const okR = (data) => ({ ok: true, data })
  const failR = (data) => ({ ok: false, data })
  const PT = 'aaaaaaaa-0000-4000-8000-000000000001'
  const point = { id: PT, branch_id: 'b', name: 'בר', icon: 'beer', colour: '#123456', hands_over: true, prep_minutes: 8, excluded_uids: [], sort_order: 0, active: true }
  const cat = mkCat('c1', [mkItem('u1', 'בירה', 14)])
  const published = { categories: [cat], modifierGroups: [], publishedAt: '2026-06-01T10:00:00Z', hasUnpublishedChanges: false, itemCount: 1, categoryCount: 1, itemsWithoutUid: 0 }
  const route = { id: 'r1', branch_id: 'b', point_id: PT, kind: 'category', ref: 'c1' }
  const input = (over = {}) => ({
    settings: okR({ enabled: true, board_token: 'tok', unsold_refs: [], updated_at: null }), active: okR(null), points: okR([point]), routes: okR([route]),
    pointStaff: okR([]), menu: okR(published), people: okR([]), liveByPoint: okR({}), ...over,
  })
  const ready = RD.buildReadiness(input())
  eq('the checklist has the seven rows in the owner\'s order', ready.rows.map((r) => r.id), ['event', 'menu', 'points', 'routing', 'people', 'board', 'session'])
  eq('a fully set-up branch can open, with no blockers', [ready.canOpen, ready.blockers], [true, []])
  const none = RD.buildReadiness(input({ settings: okR({ enabled: false, board_token: null, unsold_refs: [], updated_at: null }), points: okR([]), routes: okR([]), menu: okR(null) }))
  eq('a blank branch is blocked on the event, the menu, the points and the routing', [none.canOpen, none.blockers], [false, ['event', 'menu', 'points', 'routing']])
  eq('…and the open-the-event row says which one blocks it first', none.rows.find((r) => r.id === 'session').blockedBecause, 'event')
  eq('an item nobody makes blocks opening (the gate: everything routed)', ((r) => [r.canOpen, r.blockers])(RD.buildReadiness(input({ routes: okR([]) }))), [false, ['routing']])
  eq('…unless the owner deliberately marked its category unsold', RD.buildReadiness(input({ routes: okR([]), settings: okR({ enabled: true, board_token: 'tok', unsold_refs: ['c:c1'], updated_at: null }) })).canOpen, true)
  eq('a row whose READ FAILED is not counted as a blocker — "could not tell" must not lock the owner out', ((r) => [r.canOpen, r.blockers])(RD.buildReadiness(input({ menu: failR(null), points: failR([]), routes: failR([]) }))), [true, []])
  eq('…but it is shown as unknown', RD.buildReadiness(input({ menu: failR(null) })).rows.find((r) => r.id === 'menu').known, false)
  eq('unpublished menu changes are a warning, not a blocker', ((r) => [r.canOpen, r.rows.find((x) => x.id === 'menu').status])(RD.buildReadiness(input({ menu: okR({ ...published, hasUnpublishedChanges: true }) }))), [true, 'attention'])
  eq('items with no id (published before ids existed) need a republish: attention', RD.buildReadiness(input({ menu: okR({ ...published, itemsWithoutUid: 2 }) })).rows.find((r) => r.id === 'menu').status, 'attention')
  eq('an INACTIVE point does not count as a point', RD.buildReadiness(input({ points: okR([{ ...point, active: false }]), routes: okR([]) })).blockers.includes('points'), true)
  eq('a route to an inactive point leaves the item unrouted', RD.buildReadiness(input({ points: okR([{ ...point, active: false }]) })).rows.find((r) => r.id === 'routing').unrouted.length, 1)
  eq('the ready-board row needs attention once the event is on and there is no link yet', RD.buildReadiness(input({ settings: okR({ enabled: true, board_token: null, unsold_refs: [], updated_at: null }) })).rows.find((r) => r.id === 'board').status, 'attention')
  eq('the board link is built from its token (and is null without one)', [ready.rows.find((r) => r.id === 'board').path, RD.buildReadiness(input({ settings: okR({ enabled: true, board_token: null, unsold_refs: [], updated_at: null }) })).rows.find((r) => r.id === 'board').path], ['/board/tok', null])
  const people = RD.buildReadiness(input({ people: okR([{ id: 's1', handle: 'דנה', handle_set_at: null, colour: null, badge: null, branch_id: 'b', auth_user_id: 'u', email: 'e' }, { id: 's2', handle: 'רון', handle_set_at: '2026-01-01T00:00:00Z', colour: null, badge: null, branch_id: 'b', auth_user_id: 'u', email: 'e' }]) })).rows.find((r) => r.id === 'people')
  eq('people with an unconfirmed nickname are counted and make the row attention', [people.unconfirmed, people.status], [1, 'attention'])
  eq('an open training event reads as attention, a real one as done', [RD.buildReadiness(input({ active: okR({ id: 's', kind: 'training', status: 'active' }) })).rows.find((r) => r.id === 'session').status, RD.buildReadiness(input({ active: okR({ id: 's', kind: 'live', status: 'active' }) })).rows.find((r) => r.id === 'session').status], ['attention', 'done'])
  const summaries = RD.buildPointSummaries([point], [route], [], [cat], [], { [PT]: 3 })
  eq('a point summary counts the items it makes and the live ones on it', [summaries.length, summaries[0].itemCount, summaries[0].liveItems, summaries[0].categories.map((c) => c.id)], [1, 1, 3, ['c1']])
  const catalogue = RD.buildCatalogue({ points: [point], routes: [route], unsold: [] }, [cat, mkCat('c2', [mkItem('u2', 'יתום', 5)])])
  eq('the catalogue says where every item goes and how it got there', [catalogue[0].items[0].route, catalogue[0].items[0].via, catalogue[0].ownerPointId, catalogue[1].items[0].route], ['point', 'category', PT, 'unrouted'])
}

section('export.ts — the CSV: Hebrew intact, formula-proof, and NO phone column')
{
  const { csvCell, csvLine, agorotToDecimal, CSV_BOM, CSV_HEADERS } = EX
  eq('the file starts with the UTF-8 BOM so Excel shows Hebrew', CSV_BOM, '﻿')
  eq('null / undefined are empty cells', [csvCell(null), csvCell(undefined)], ['', ''])
  eq('numbers are written bare so a SUM works', [csvCell(12), csvCell(3.5), csvCell(0)], ['12', '3.5', '0'])
  eq('plain text and Hebrew are untouched', [csvCell('בירה'), csvCell('Latte 2')], ['בירה', 'Latte 2'])
  eq('a comma forces quoting', csvCell('a,b'), '"a,b"')
  eq('a quote is doubled and the cell quoted', csvCell('say "hi"'), '"say ""hi"""')
  eq('a newline (LF or CR) forces quoting', [csvCell('a\nb'), csvCell('a\r\nb')], ['"a\nb"', '"a\r\nb"'])
  for (const lead of ['=', '+', '-', '@']) eq(`a text cell starting with "${lead}" gets a leading apostrophe (a customer typing a formula as their name must not run it)`, csvCell(`${lead}1+1`), `'${lead}1+1`)
  eq('a tab-led cell is neutralised', csvCell('\tcmd').startsWith("'"), true)
  eq('a CR-led cell is neutralised AND quoted', csvCell('\rcmd'), '"\'\rcmd"')
  eq('the classic payload is defused and still valid CSV', csvCell('=HYPERLINK("http://x","y")'), '"\'=HYPERLINK(""http://x"",""y"")"')
  eq('a formula char in the MIDDLE is left alone', csvCell('a=b'), 'a=b')
  eq('a formula char after a leading space is not a formula to Excel; left alone', csvCell(' =x'), ' =x')
  eq('a negative-looking Hebrew-prefixed text is fine', csvCell('מ-5'), 'מ-5')
  eq('a defused cell that also contains a comma is quoted once, apostrophe inside', csvCell('=1,2'), '"\'=1,2"')
  eq('csvLine joins the cells with commas, quoting only what needs it', csvLine(['#7', 'דנה, כהן', 2, null, '=x']), '#7,"דנה, כהן",2,,\'=x')
  eq('0 agorot -> 0.00', agorotToDecimal(0), '0.00')
  eq('5 agorot -> 0.05', agorotToDecimal(5), '0.05')
  eq('1250 -> 12.50', agorotToDecimal(1250), '12.50')
  eq('100 -> 1.00 (always two decimals)', agorotToDecimal(100), '1.00')
  eq('99999 -> 999.99', agorotToDecimal(99999), '999.99')
  eq('a negative amount keeps its sign', agorotToDecimal(-150), '-1.50')
  eq('a stray fraction of an agorot is rounded, not printed', agorotToDecimal(12.4), '0.12')
  sweep('every amount to ₪200 prints as a plain decimal that parses back to the same agorot (no currency sign, no thousands separator)', Array.from({ length: 20001 }, (_, i) => i), (c) => { const s = agorotToDecimal(c); return /^\d+\.\d{2}$/.test(s) && Math.round(Number(s) * 100) === c })
  eq('there are 15 columns, all named', [CSV_HEADERS.length, CSV_HEADERS.every((h) => typeof h === 'string' && h.trim().length > 0)], [15, true])
  eq('column names are unique', new Set(CSV_HEADERS).size, CSV_HEADERS.length)
  check('NO header is a phone column (a spreadsheet is copied, mailed and kept forever)', !CSV_HEADERS.some((h) => /טלפון|נייד|phone|mobile|tel\b/i.test(h)), CSV_HEADERS.join(','))
  const exportSrc = readFileSync(join(POS, 'server', 'export.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  check('the export code never reads, selects or writes a phone (comments excluded)', !/phone/i.test(exportSrc), (exportSrc.match(/.*phone.*/i) ?? [''])[0])
  check('…and the order columns it selects are a subset that omits customer_phone', (() => { const m = /select\('([^']*customer_name[^']*)'\)/.exec(exportSrc); return m !== null && !m[1].includes('customer_phone') })())
  eq('the header row is itself built with csvLine (a header can never be a formula)', csvLine(CSV_HEADERS).split(',').length, 15)
}

section('log.ts / details.ts — cursors and payload scrubbing')
{
  const dc = LG.decodeLogCursor
  eq('no cursor -> null', [dc(undefined), dc('')], [null, null])
  eq('a numeric cursor is read as a number', [dc('1'), dc('123456'), dc('0')], [1, 123456, 0])
  eq('15 digits is the longest', [dc('9'.repeat(15)), dc('9'.repeat(16))], [999999999999999, null])
  for (const bad of ['-5', '1.5', '1e3', '12a', ' 1', '1 ', '0x10', '١٢٣', '1;drop', "1' or '1'='1", 'null', '+5']) eq(`a forged cursor ${show(bad)} is refused`, dc(bad), null)
  eq('the default page is 50', LG.LOG_DEFAULT_PAGE, 50)
  const sp = DT.scrubPayload
  eq('keys that look like a phone are dropped', sp({ a: 1, customer_phone: '054', phone: '1', Phone_Number: '2', contactPHONE: '3', b: 'x' }), { a: 1, b: 'x' })
  eq('everything else is kept as is', sp({ ticket_no: 7, name: 'x', items: [1] }), { ticket_no: 7, name: 'x', items: [1] })
  eq('null / undefined payloads are empty objects', [sp(null), sp(undefined)], [{}, {}])
  const input = { phone: 'x', a: 1 }
  sp(input)
  eq('the payload passed in is not mutated', input, { phone: 'x', a: 1 })
  const UID = '123e4567-e89b-42d3-a456-426614174000'
  const cur = DT.encodeOrderCursor('2026-06-01T12:00:00.000Z', UID)
  eq('an order cursor round-trips', DT.decodeOrderCursor(cur), { c: '2026-06-01T12:00:00.000Z', i: UID })
  eq('a cursor is URL-safe (it travels in a query string)', /^[A-Za-z0-9_-]+$/.test(cur), true)
  const forge = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url')
  for (const [name, raw] of [['garbage', 'not-a-cursor'], ['empty', ''], ['undefined', undefined], ['an id that is not a uuid (it goes into a filter string)', forge({ c: '2026-06-01T12:00:00.000Z', i: "x'),or(id.neq.0" })], ['a time that is not an instant', forge({ c: "2026-06-01'); drop", i: UID })], ['the wrong shape', forge([1, 2])], ['missing fields', forge({ c: '2026-06-01T12:00:00.000Z' })], ['numbers instead of strings', forge({ c: 1, i: 2 })]]) {
    eq(`a forged order cursor is refused: ${name}`, DT.decodeOrderCursor(raw), null)
  }
  eq('search text cannot add a condition to the PostgREST filter', DT.sanitizeSearch('a,b(c)"d\\e*f%g:h'), 'a b c d e f g h')
  eq('searchConditions of blank text is empty', DT.searchConditions('  ,() '), [])
}


// =====================================================================================
// i18n — every key the UI asks for exists, and is called with the values its text needs
// =====================================================================================
section('i18n — every t(\'…\') in the POS screens names a string that exists, and passes the values it needs')
{
  const walk = (dir, out = []) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p, out)
      else if (/\.tsx?$/.test(e.name)) out.push(p)
    }
    return out
  }
  const posDirs = [join(SRC, 'components', 'pos'), join(SRC, 'components', 'owner', 'pos')]
  const all = walk(SRC)
  // Anything that reads the POS dictionary: the two screen trees plus any other file that imports useT.
  const consumers = all.filter((f) => posDirs.some((d) => f.startsWith(d + sep)) || /from\s+['"]@\/lib\/pos\/useT['"]/.test(readFileSync(f, 'utf8')))
  check('the scan found the POS screens', consumers.length >= 20, `found ${consumers.length}`)
  const used = new Map() // key -> [file, params|null|'dynamic']
  const calls = []
  for (const file of consumers) {
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const rel = relative(ROOT, file).split(sep).join('/')
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression
        const isT = (ts.isIdentifier(callee) && callee.text === 't') || (ts.isPropertyAccessExpression(callee) && callee.name.text === 't')
        const first = node.arguments[0]
        if (isT && first) {
          const lits = []
          const collect = (n) => {
            if (ts.isStringLiteralLike(n)) lits.push(n.text)
            else if (ts.isConditionalExpression(n)) { collect(n.whenTrue); collect(n.whenFalse) }
            else if (ts.isParenthesizedExpression(n)) collect(n.expression)
          }
          collect(first)
          const second = node.arguments[1]
          let params = 'none'
          if (second) {
            if (ts.isObjectLiteralExpression(second) && !second.properties.some((p) => ts.isSpreadAssignment(p))) params = second.properties.map((p) => (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : '?'))
            else params = 'dynamic'
          }
          const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1
          for (const k of lits) calls.push({ key: k, params, where: `${rel}:${line}` })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  console.log(`  (${calls.length} literal t() calls in ${consumers.length} files)`)
  const dictKeys = new Set(Object.keys(ALL_STRINGS))
  const missing = calls.filter((c) => !dictKeys.has(c.key))
  check('no key used by t(\'…\') is missing from the dictionary', missing.length === 0, missing.slice(0, 8).map((c) => `${c.key} @ ${c.where}`).join('; '))
  const ph = (s) => [...new Set([...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))]
  const unfilled = []
  for (const c of calls) {
    const e = ALL_STRINGS[c.key]
    if (!e || c.params === 'dynamic') continue
    const need = new Set([...ph(e.he), ...ph(e.en ?? '')])
    const have = c.params === 'none' ? [] : c.params
    for (const p of need) if (!have.includes(p)) unfilled.push(`${c.key} lacks {${p}} @ ${c.where}`)
  }
  check('every call supplies a value for each {placeholder} its text contains (else "{name}" shows on a screen)', unfilled.length === 0, unfilled.slice(0, 6).join('; '))
  const usedKeys = new Set(calls.map((c) => c.key))
  // Keys picked by a lookup table / variable rather than a literal t('…') — an area-prefixed string literal anywhere in a consumer.
  const prefixes = I18N_AREA_FILES.map((f) => f.replace(/\.ts$/, ''))
  const keyShaped = new RegExp(`['"\`]((?:${prefixes.join('|')})\\.[A-Za-z0-9_.]+)['"\`]`, 'g')
  const indirect = new Set()
  for (const file of consumers) for (const m of readFileSync(file, 'utf8').matchAll(keyShaped)) if (dictKeys.has(m[1])) indirect.add(m[1])
  const badIndirect = []
  for (const file of consumers) for (const m of readFileSync(file, 'utf8').matchAll(keyShaped)) if (!dictKeys.has(m[1]) && !/\.(csv|json|txt|png|svg)$/.test(m[1]) && /^[a-z]+\.[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)*$/.test(m[1])) badIndirect.push(`${m[1]} @ ${relative(ROOT, file).split(sep).join('/')}`)
  check('no dictionary-shaped string literal in a screen names a key that does not exist (lookup tables, ternaries)', badIndirect.length === 0, badIndirect.slice(0, 6).join('; '))
  const unusedKeys = [...dictKeys].filter((k) => !usedKeys.has(k) && !indirect.has(k))
  console.log(`  (${unusedKeys.length} of ${dictKeys.size} strings are not referenced by a literal — informational only: dynamic keys and the server's own use are legitimate)`)
  check('the dictionary is actually used (at least half its keys are referenced by a screen)', usedKeys.size + indirect.size >= dictKeys.size / 2, `${usedKeys.size} used of ${dictKeys.size}`)
  // The error mapper (errorText): every code a route can return — and 'network', which the client invents —
  // has words an employee can read. Without one the employee would see the generic line for a refusal that has a cure.
  const codes = [...new Set([...(unionMembers(TYPES_SRC, 'PosErrorCode') ?? []), ...(LINE_PROBLEM_CODES ?? []), 'network'])]
  check('the PosErrorCode union was parsed', codes.length >= 25, `parsed ${codes.length}`)
  sweep('every error code has its own employee-language string, in Hebrew', codes, (c) => dictKeys.has(`errors.${c}`) && ALL_STRINGS[`errors.${c}`].he.trim().length > 0)
  check('…and a generic fallback for a code this build has never heard of', dictKeys.has('errors.generic'))
  sweep('…and none of them shows the code itself to the employee', codes, (c) => !new RegExp(`\b${c}\b`, 'i').test(ALL_STRINGS[`errors.${c}`]?.he ?? '') && !/_/.test(ALL_STRINGS[`errors.${c}`]?.he ?? '') && !/_/.test(ALL_STRINGS[`errors.${c}`]?.en ?? ''))
}

section('i18n — the strings added since wave 1 (every area): Hebrew present, placeholders agree, nothing technical')
{
  const byArea = new Map()
  for (const k of Object.keys(ALL_STRINGS)) byArea.set(k.split('.')[0], (byArea.get(k.split('.')[0]) ?? 0) + 1)
  console.log(`  (per area: ${[...byArea].map(([a, n]) => `${a} ${n}`).join(', ')})`)
  for (const f of I18N_AREA_FILES) {
    const area = f.replace(/\.ts$/, '')
    check(`area "${area}" is filled (has strings)`, (byArea.get(area) ?? 0) > 0)
  }
  sweep('English never has a {placeholder} the Hebrew lacks (it would print raw)', strKeys.filter((k) => typeof ALL_STRINGS[k].en === 'string'), (k) => [...placeholders(ALL_STRINGS[k].en)].every((p) => placeholders(ALL_STRINGS[k].he).has(p)))
  // A FRAGMENT is appended to another string by the screen ('Beer (+ Cola)'), so its leading space is the point.
  const FRAGMENTS = new Set(['owner.setup.sum.extra', 'owner.setup.sum.except'])
  sweep('no string contains a doubled space, a leading/trailing space or an unbalanced brace (fragments may start with a space)', strKeys, (k) => [ALL_STRINGS[k].he, ALL_STRINGS[k].en ?? ''].every((s) => (FRAGMENTS.has(k) ? s === s.trimEnd() : s === s.trim()) && !/ {2}/.test(s) && (s.match(/\{/g) ?? []).length === (s.match(/\}/g) ?? []).length))
  sweep('the Hebrew text is Hebrew, or at least not empty ASCII scaffolding like "TODO"', strKeys, (k) => !/^(todo|tbd|xxx|lorem)/i.test(ALL_STRINGS[k].he.trim()))
  sweep('no string names a database or code concept (migration, RPC, table, JSON, endpoint, 500, null)', strKeys, (k) => !/\b(migration|rpc|jsonb?|endpoint|stack ?trace|http \d{3}|status code|api key|payload)\b/i.test(`${ALL_STRINGS[k].he} ${ALL_STRINGS[k].en ?? ''}`))
}

// =====================================================================================
// Quick login (migration 016): the pure pieces, and "a passcode is never logged"
// =====================================================================================
section('quick login — the passcode rules (the SQL is the oracle) and where they are enforced')
{
  const SQL_016 = stripSqlComments(readFileSync(join(MIG_DIR, '016_pos_quick_login.sql'), 'utf8'))
  // A JS mirror of pos_pin_is_weak, written from the migration's own plain-language list:
  // one repeated digit, runs up or down, a repeated pair, a repeated triple.
  const weak = (p) => /^(\d)\1{5}$/.test(p) || '01234567890123456789'.includes(p) || '98765432109876543210'.includes(p) || /^(\d\d)\1\1$/.test(p) || /^(\d\d\d)\1$/.test(p)
  for (const p of ['000000', '111111', '999999', '123456', '234567', '345678', '456789', '567890', '678901', '789012', '890123', '901234', '012345', '654321', '987654', '876543', '765432', '098765', '121212', '454545', '090909', '123123', '987987', '505505']) check(`${p} is an obvious passcode and is refused`, weak(p))
  for (const p of ['135790', '482915', '123457', '112233', '102938', '000001', '246810', '908172', '123321']) check(`${p} is acceptable`, !weak(p))
  const fn = /function public\.pos_pin_is_weak[\s\S]*?\$\$;/.exec(SQL_016)?.[0] ?? ''
  check('the SQL function exists and is immutable (so it can be reasoned about)', fn.includes('immutable'))
  check('…it refuses a repeated digit', fn.includes("'^(\\d)\\1{5}$'"))
  check('…ascending runs, via the ring "01234567890123456789"', fn.includes("position(p_pin in '01234567890123456789') > 0"))
  check('…descending runs, via the ring "98765432109876543210"', fn.includes("position(p_pin in '98765432109876543210') > 0"))
  check('…a repeated pair and a repeated triple', fn.includes("'^(\\d\\d)\\1\\1$'") && fn.includes("'^(\\d\\d\\d)\\1$'"))
  check('pos_set_pin demands exactly six digits BEFORE the weakness test, and refuses a weak one', /pos_set_pin[\s\S]*?!~ '\^\[0-9\]\{6\}\$'[\s\S]*?pos_pin_is_weak\(p_pin\)/.test(SQL_016))
  check('pos_verify_pin also insists on six digits (a 7-digit guess is never even compared)', /pos_verify_pin[\s\S]*?!~ '\^\[0-9\]\{6\}\$' or s\.pin_hash <> crypt/.test(SQL_016))
  check('the passcode is stored only as a bcrypt hash', /pin_hash = crypt\(p_pin, gen_salt\('bf', \d+\)\)/.test(SQL_016))
  const builds = [...SQL_016.matchAll(/jsonb_build_object\(([^;]*?)\)\s*(?:\)|;|,)/g)].map((m) => m[1])
  check('no audit payload or result object is built from the passcode or its hash', builds.length > 5 && builds.every((b) => !/\bp_pin\b|pin_hash/.test(b)), builds.find((b) => /\bp_pin\b|pin_hash/.test(b)) ?? '')
  check('a changed or cleared passcode ends every quick session of that person', (SQL_016.match(/delete from public\.pos_quick_sessions where staff_id = p_target/g) ?? []).length === 2)
  check('verification gives ONE generic answer: every failure path returns only {ok:false}', (() => { const body = /function public\.pos_verify_pin[\s\S]*?\$\$;/.exec(SQL_016)?.[0] ?? ''; const fails = [...body.matchAll(/jsonb_build_object\('ok', false([^)]*)\)/g)]; return fails.length === 2 && fails.every((m) => m[1].trim() === '') })())
  const pwdRoute = readFileSync(join(SRC, 'app', 'api', 'pos', 'passcode', 'route.ts'), 'utf8')
  const loginRoute = readFileSync(join(SRC, 'app', 'api', 'auth', 'quick-login', 'route.ts'), 'utf8')
  check('the self-service route accepts exactly six digits and nothing else', /passcode: z\.string\(\)\.regex\(\/\^\\d\{6\}\$\/\)/.test(pwdRoute) && pwdRoute.includes('.strict()'))
  check('the login route accepts exactly six digits and a bounded employee number, strictly', /passcode: z\.string\(\)\.regex\(\/\^\\d\{6\}\$\/\)/.test(loginRoute) && /employeeNo: z\.number\(\)\.int\(\)\.min\(1\)\.max\(99999\)/.test(loginRoute) && loginRoute.includes('.strict()'))
  check('the login route rate-limits BEFORE it verifies (per number and per address)', loginRoute.indexOf('checkRateLimit(`quick:emp:') > 0 && loginRoute.indexOf('checkRateLimit(`quick:emp:') < loginRoute.indexOf("rpc('pos_verify_pin'") && loginRoute.includes('quick:ip:'))
  check('the keypad collects exactly six digits (CODE_LENGTH is 6, matching the server)', /const CODE_LENGTH = 6\b/.test(readFileSync(join(SRC, 'components', 'auth', 'QuickLogin.tsx'), 'utf8')))
  const empNo = /p_no is null or p_no < 1 or p_no > (\d+)/.exec(SQL_016)
  check('the employee-number bound agrees between SQL and the login route (1..99999)', empNo !== null && empNo[1] === '99999' && loginRoute.includes('.max(99999)'))
}

section('quick login — nothing under src/ ever logs a passcode')
{
  const walk = (dir, out = []) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p, out)
      else if (/\.tsx?$/.test(e.name)) out.push(p)
    }
    return out
  }
  const SECRET = /\b(passcode|passCode|pin|p_pin|pinHash|pin_hash|code|digits|clean|secret)\b/i
  const REQUESTISH = /\b(body|payload|request|req|json|formData|input|value)\b/
  const files = walk(SRC)
  let consoleCalls = 0
  const offenders = []
  const quickFiles = new Set([
    'src/lib/pos/server/quick-login.ts', 'src/lib/pos/quick-jwt.ts', 'src/app/api/auth/quick-login/route.ts', 'src/app/api/pos/passcode/route.ts',
    'src/app/api/owner/staff/passcode/route.ts', 'src/components/auth/QuickLogin.tsx', 'src/components/pos/me/QuickCodeSheet.tsx',
  ])
  const seenQuick = new Set()
  for (const file of files) {
    const rel = relative(ROOT, file).split(sep).join('/')
    const text = readFileSync(file, 'utf8')
    if (!/console\./.test(text) && !quickFiles.has(rel)) continue
    if (quickFiles.has(rel)) seenQuick.add(rel)
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const isQuick = quickFiles.has(rel) || /passcode|quick/i.test(rel)
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'console') {
        consoleCalls++
        // The text of the ARGUMENTS only; the string literals inside are messages, not data, so they are blanked out.
        const argText = node.arguments.map((a) => a.getText(sf).replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""')).join(', ')
        const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1
        if (/\b(passcode|passCode|p_pin|pinHash|pin_hash)\b/.test(argText)) offenders.push(`${rel}:${line} logs ${argText.slice(0, 60)}`)
        if (isQuick && (SECRET.test(argText.replace(/\berror\.code\b/g, '')) || REQUESTISH.test(argText))) offenders.push(`${rel}:${line} (a quick-login file) logs ${argText.slice(0, 60)}`)
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  console.log(`  (${consoleCalls} console.* calls scanned across ${files.length} source files)`)
  eq('every quick-login file exists and was scanned', [...seenQuick].sort(), [...quickFiles].sort())
  check('no console.* call anywhere in src/ is handed a passcode or its hash', offenders.length === 0, offenders.join('; '))
  const loginRoute = readFileSync(join(SRC, 'app', 'api', 'auth', 'quick-login', 'route.ts'), 'utf8')
  check('the login route says it never logs the passcode or the body, and its one log line names the SQLSTATE only', /never logged or echoed/.test(loginRoute) && /console\.error\('pos_verify_pin failed:', error\.code, safeLogMessage\(error\.message\)\)/.test(loginRoute))
  const clientSrc = readFileSync(join(POS, 'client.ts'), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
  check('the browser API client has no console.* at all (its request bodies carry a customer phone)', !/console\./.test(clientSrc))
  const outboxSrc = readFileSync(join(POS, 'outbox.ts'), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
  check('the outbox never logs (its entries hold a customer phone until the server accepts them)', !/console\./.test(outboxSrc))
}

// =====================================================================================
// Closing checks
// =====================================================================================
section('coverage — every LineProblemCode was produced by a check above')
{
  // `modifier_too_few` is declared but unreachable: groupBounds forces min >= 1 whenever a group
  // could be short, and a short group with min >= 1 is reported as `modifier_required`.
  const RESERVED = ['modifier_too_few']
  const declared = LINE_PROBLEM_CODES ?? []
  check('the LineProblemCode union was parsed', declared.length >= 17, `parsed ${declared.length}`)
  const untested = declared.filter((c) => !seenProblems.has(c) && !RESERVED.includes(c))
  check('every LineProblemCode (bar the reserved one) was actually produced', untested.length === 0, `never produced: ${untested.join(', ')}`)
  const undeclared = [...seenProblems].filter((c) => !declared.includes(c))
  check('no check produced a code that is not declared', undeclared.length === 0, undeclared.join(', '))
  check('the reserved code is still declared (remove it from RESERVED if it becomes reachable)', RESERVED.every((c) => declared.includes(c)))
}

console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFailed:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
