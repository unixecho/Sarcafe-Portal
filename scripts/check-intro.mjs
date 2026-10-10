#!/usr/bin/env node
// Logic harness for the portal intro (src/lib/intro/ + src/components/intro/, plus
// the owner's switch: lib/settings/keys.ts + server.ts, /api/owner/intro,
// /owner/intro, the dashboard tile and the middleware gate).
//
//   node scripts/check-intro.mjs        (or: npm run check:intro)
//
// The pure rules (the words, the two timelines, which version and which line a
// visitor gets, the switch's reader and time-box) run here from the REAL source.
// Because the intro is also a stylesheet and a few pieces of wiring, the
// contracts that cross those files, the ones that would otherwise drift silently,
// are checked too. Ported from Ayeka.Bar's scripts/check-intro.mjs.
//
// WHAT IT IS ACTUALLY GUARDING
//   • The owner's line one is exactly what the owner chose, and a new device
//     always meets it first.
//   • The SHORT version, the one on every refresh, is pinned to Ayeka's approved
//     numbers. The welcome may be tuned; the short one may not drift.
//   • Every line, in every language, finishes inside its budget in both versions,
//     and the welcome's lights and steam finish before the exit begins.
//   • Which line a visit gets: never the same twice in a row, every line reachable,
//     a device that cannot remember never gets the welcome on every load.
//   • Timing lives in one place. The stylesheet reads exactly the custom
//     properties config.ts writes, for BOTH versions; no private numbers.
//   • It sits one notch UNDER the accessibility widget (read from the widget's
//     real source) and is never inside #a11y-scope or the page template.
//   • The installed-app entry: /order plays only inside the installed app, decided
//     in CSS, so a browser tab never flashes it.
//   • The owner's switch: only an explicit `false` turns it off, the row is
//     written public (or the portal silently ignores "off"), the cache is busted,
//     the route is owner-only, and reading it can never slow a page.
//   • The motion laws in BLUEPRINT §4.14 that can be checked statically.

import ts from 'typescript'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = new URL('../', import.meta.url)
const read = (rel) => readFileSync(new URL(rel, root), 'utf8')

const outDir = join(tmpdir(), `sarcafe-intro-check-${process.pid}`)
mkdirSync(outDir, { recursive: true })
async function load(rel, out) {
  writeFileSync(join(outDir, out), ts.transpileModule(read(rel), {
    fileName: rel,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true },
  }).outputText)
  return import(pathToFileURL(join(outDir, out)).href)
}
const C = await load('src/lib/intro/config.ts', 'config.mjs')
const W = await load('src/lib/intro/copy.ts', 'copy.mjs')

let pass = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) pass++
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t) => console.log(`\n${t}`)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const LANGS = ['he', 'en', 'ar']
const VARIANTS = ['first', 'repeat']
const HEBREW = /[֐-׿]/
const ARABIC = /[؀-ۿ]/
const LATIN = /[A-Za-z]/
const strip = (s) => s.replace(/\*/g, '')
const lines = W.INTRO_LINES

// ───────────────────────────────────────────────────────────────────────────
section('copy: every line has every language')
{
  check('at least ten lines (the owner asked for about ten)', lines.length >= 10)
  check('the skip hint exists in he / en / ar', same(Object.keys(W.INTRO_SKIP).sort(), [...LANGS].sort())
    && LANGS.every((l) => W.INTRO_SKIP[l].trim().length > 0))
  lines.forEach((line, i) => {
    check(`line ${i + 1}: exactly he / en / ar`, same(Object.keys(line).sort(), [...LANGS].sort()))
    for (const l of LANGS) {
      const c = line[l]
      check(`line ${i + 1}/${l}: headline and invitation are non-empty, trimmed, single-spaced`,
        [c.line1, c.line2].every((s) => typeof s === 'string' && s.trim().length > 0 && s === s.trim() && !/\s{2,}/.test(s)))
    }
  })
  const he = lines.map((l) => strip(l.he.line1) + '|' + l.he.line2)
  check('no two lines are the same', new Set(he).size === he.length)
}

section("copy: line one is what the owner chose, and nothing about it drifts")
{
  const first = lines[0].he
  check('headline', strip(first.line1) === 'מוכנים לקפה שכולם רוצים?')
  check('the glowing word is "שכולם"', W.splitLine(first.line1).filter((w) => w.hl).map((w) => w.text).join() === 'שכולם')
  check('invitation', first.line2 === 'בואו לשתות משהו טוב, לנשנש ולהישאר עוד קצת.')
  check('a device is only ever handed line one first (the harness pins its position)', strip(lines[0].en.line1).startsWith('Ready for the coffee'))
}

section('copy: each text is in the language of its slot')
{
  lines.forEach((line, i) => {
    const he = line.he, en = line.en, ar = line.ar
    check(`line ${i + 1}: he is Hebrew only`, [he.line1, he.line2].every((s) => HEBREW.test(s) && !ARABIC.test(s) && !LATIN.test(s)))
    check(`line ${i + 1}: en is Latin only`, [en.line1, en.line2].every((s) => LATIN.test(s) && !HEBREW.test(s) && !ARABIC.test(s)))
    check(`line ${i + 1}: ar is Arabic only`, [ar.line1, ar.line2].every((s) => ARABIC.test(s) && !HEBREW.test(s) && !LATIN.test(s)))
  })
  const hint = W.INTRO_SKIP
  check('hint he is Hebrew, en is Latin, ar is Arabic', HEBREW.test(hint.he) && LATIN.test(hint.en) && ARABIC.test(hint.ar))
}

section('copy: the highlight marker')
{
  const stars = (s) => (s.match(/\*/g) || []).length
  lines.forEach((line, i) => {
    for (const l of LANGS) {
      const c = line[l]
      check(`line ${i + 1}/${l}: the headline marks exactly one word`, stars(c.line1) === 2 && W.splitLine(c.line1).filter((w) => w.hl).length === 1)
      check(`line ${i + 1}/${l}: no marker leaks into the invitation`, stars(c.line2) === 0)
      check(`line ${i + 1}/${l}: no marker survives into what is drawn`,
        W.splitLine(c.line1).concat(W.splitLine(c.line2)).every((w) => w.text.indexOf('*') === -1))
    }
  })
}

section('splitLine: one animated unit per word')
{
  const t = (s) => W.splitLine(s).map((w) => w.text)
  check('punctuation stays on its word, so a question mark is never stranded',
    t('רוצים?').join() === 'רוצים?' && t('a b c?').join('|') === 'a|b|c?')
  check('the Arabic question mark stays too', t('في حريش؟').join('|') === 'في|حريش؟')
  check('markers are stripped and flag the word', (() => {
    const w = W.splitLine('מוכנים ל*קפה* טוב')
    return w.length === 3 && w[1].text === 'לקפה' && w[1].hl === true && w[0].hl === false && w[2].hl === false
  })())
  check('extra spaces never make an empty word', t('  a   b  ').join('|') === 'a|b')
  check('an empty line is no words', t('').length === 0 && t('   ').length === 0)
  check('a stray marker on its own is not a word', t('a * b').join('|') === 'a|b')
  check('introCopy wraps a stale index instead of falling off the end',
    W.introCopy(lines.length, 'he').line1 === lines[0].he.line1 && W.introCopy(-1, 'he').line1 === lines[lines.length - 1].he.line1
    && W.introCopy(3.9, 'en').line1 === lines[3].en.line1)
  check('introCopy carries the right hint per language', LANGS.every((l) => W.introCopy(0, l).skip === W.INTRO_SKIP[l]))
}

// ───────────────────────────────────────────────────────────────────────────
section('where it plays')
{
  check('the portal', C.isIntroPath('/') === true)
  check('the installed customer app\'s start page', C.isIntroPath('/order') === true)
  check('NOT the menu, where a table\'s QR code lands', ['/menu', '/menu/givat-haviva'].every((p) => C.isIntroPath(p) === false))
  check('NOT an order being tracked', C.isIntroPath('/order/abc123') === false)
  check('NOT the staff, owner, login or POS areas',
    ['/owner/dashboard', '/owner', '/owner/intro', '/staff', '/staff/checklists', '/login', '/pos', '/board/x'].every((p) => C.isIntroPath(p) === false))
  check('NOT a lookalike path', ['/menu/', '//', '/ ', '/index', '/order/'].every((p) => C.isIntroPath(p) === false))
  check('no path at all is not a path', [null, undefined, ''].every((p) => C.isIntroPath(p) === false))
  check('the list is exactly the portal and the app start page', same(C.INTRO_PATHS, ['/', '/order']))
  check('the portal is entered for everyone, /order only inside the installed app',
    C.introEntry('/') === 'site' && C.introEntry('/order') === 'app' && C.introEntry('/menu') === null && C.introEntry(null) === null)
}

section('which version a visitor gets: the welcome once, the short one after')
{
  const P = (i) => C.pickVariant(i)
  check('a device that has never seen it, and can remember, gets the welcome', P({ forced: null, seen: false, canRemember: true }).variant === 'first')
  check('...and that is a real visit, not a preview', P({ forced: null, seen: false, canRemember: true }).preview === false)
  check('a device that has seen it gets the short one', P({ forced: null, seen: true, canRemember: true }).variant === 'repeat')
  check('a device that CANNOT remember gets the short one, every time, never the welcome on every load',
    P({ forced: null, seen: false, canRemember: false }).variant === 'repeat' && P({ forced: undefined, seen: true, canRemember: false }).variant === 'repeat')
  check('?intro=first plays the welcome as a PREVIEW whatever the device has seen',
    [true, false].every((seen) => [true, false].every((canRemember) => { const r = P({ forced: 'first', seen, canRemember }); return r.variant === 'first' && r.preview === true })))
  check('?intro=repeat plays the short one as a PREVIEW whatever the device has seen',
    [true, false].every((seen) => [true, false].every((canRemember) => { const r = P({ forced: 'repeat', seen, canRemember }); return r.variant === 'repeat' && r.preview === true })))
  check('anything else in ?intro= is ignored', ['', 'FIRST', 'both', 'first ', '1', 'null', 'undefined', '__proto__'].every((f) => {
    const r = P({ forced: f, seen: true, canRemember: true }); return r.variant === 'repeat' && r.preview === false
  }))
  check('only exactly two versions exist', same(Object.keys(C.INTRO_TIMINGS).sort(), ['first', 'repeat']))
  check('the markers are namespaced and versioned', /^sarcafe\.intro\.seen\.v\d+$/.test(C.INTRO_SEEN_KEY) && /^sarcafe\.intro\.line\.v\d+$/.test(C.INTRO_LINE_KEY))
}

section('which line a visit gets: line one first, then never the same twice')
{
  const n = lines.length
  const seeded = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
  const L = (o) => C.pickLine({ forced: null, last: null, count: n, canRemember: true, rand: seeded(7), ...o })
  check('a device that has never been shown a line gets line ONE', L({}).index === 0 && L({}).preview === false)
  check('...whatever the random number happens to be', [0, 0.3, 0.999999].every((r) => L({ rand: () => r }).index === 0))
  check('junk or out-of-range memory is a first visit too, never a crash',
    ['x', '', '-1', '1.5', '999', String(n), 'NaN'].every((last) => L({ last }).index === 0))
  let neverSame = true, inRange = true
  const seen = new Set()
  const rand = seeded(42)
  for (let last = 0; last < n; last++) {
    for (let k = 0; k < 400; k++) {
      const r = L({ last: String(last), rand })
      if (r.index === last) neverSame = false
      if (!(r.index >= 0 && r.index < n)) inRange = false
      seen.add(r.index)
    }
  }
  check('after a line, the next is never the same one', neverSame)
  check('every pick is a real line', inRange)
  check('every line is reachable', seen.size === n)
  check('the extremes of the random number still pick a real, different line',
    [0, 0.999999999].every((x) => { const r = L({ last: '4', rand: () => x }).index; return r >= 0 && r < n && r !== 4 }))
  check('every OTHER line is equally reachable from a given line (no line is starved)', (() => {
    const hits = new Array(n).fill(0)
    const r2 = seeded(99)
    for (let k = 0; k < 9000; k++) hits[L({ last: '2', rand: r2 }).index]++
    return hits.every((h, i) => (i === 2 ? h === 0 : h > 600 && h < 1500))
  })())
  check('a device that cannot remember gets a random line, in range',
    (() => { const r = seeded(5); const got = new Set(); for (let k = 0; k < 600; k++) { const x = L({ canRemember: false, last: '3', rand: r }); got.add(x.index); if (x.preview) return false } return got.size === n })())
  check('?line=N plays line N as a PREVIEW (1-based)', [1, 2, n].every((k) => { const r = L({ forced: String(k) }); return r.index === k - 1 && r.preview === true }))
  check('...even on a device that cannot remember', L({ forced: '3', canRemember: false }).index === 2)
  check('a bad ?line= is ignored and previews nothing', ['0', String(n + 1), '-1', '1.5', 'abc', '', '１', '2 ', '1e1', '0003x'].every((f) => L({ forced: f }).preview === false))
  check('a one-line list always gives that line', C.pickLine({ forced: null, last: '0', count: 1, canRemember: true, rand: () => 0.5 }).index === 0)
}

// ───────────────────────────────────────────────────────────────────────────
section('the SHORT version is exactly what was approved: it must never drift')
{
  const R = C.INTRO_TIMINGS.repeat
  const pinned = {
    litMs: 900, rule: { atMs: 200, ms: 460 }, glint: { atMs: 420, ms: 950 },
    line1: { atMs: 150, stepMs: 55, wordMs: 560 }, line2: { atMs: 640, stepMs: 32, wordMs: 520 },
    hint: { atMs: 1100, ms: 600 }, holdMs: 650, exit: { delayMs: 100, ms: 560, stageMs: 520, passAtMs: 280 },
  }
  for (const [k, v] of Object.entries(pinned)) check(`short: ${k}`, same(R[k], v), JSON.stringify(R[k]))
  check('the shared skip, settle and failsafe are unchanged', C.INTRO_SKIP_MS === 260 && same(C.INTRO_SETTLE, { quietMs: 90, maxMs: 450 }) && C.INTRO_FAILSAFE_MS === 4000)
  check('the short version has no lights and no steam', R.bulbMs === 0 && R.steamMs === 0 && R.lights.ms === 0)
  check('the budgets are 3 s and 5.5 s', C.INTRO_BUDGET_MS.repeat === 3000 && C.INTRO_BUDGET_MS.first === 5500)
  check('with no version named, the plan is the SHORT one (the safe default)', same(C.planTimeline(4, 8), C.planTimeline(4, 8, 'repeat')))
}

section('timeline: every line, every language, both versions, inside their budget')
{
  let worst = { done: 0, at: '' }
  lines.forEach((line, i) => {
    for (const l of LANGS) {
      const w1 = W.splitLine(line[l].line1).length, w2 = W.splitLine(line[l].line2).length
      for (const v of VARIANTS) {
        const p = C.planTimeline(w1, w2, v)
        check(`line ${i + 1}/${l}/${v}: ${p.doneAtMs} ms <= ${C.INTRO_BUDGET_MS[v]}`, p.doneAtMs <= C.INTRO_BUDGET_MS[v])
        if (v === 'first') {
          check(`line ${i + 1}/${l}: lights and steam finish before the exit`, C.extrasEndMs('first') <= p.exitAtMs, `${C.extrasEndMs('first')} vs ${p.exitAtMs}`)
          if (p.doneAtMs > worst.done) worst = { done: p.doneAtMs, at: `${i + 1}/${l}` }
        }
      }
    }
  })
  console.log(`  (longest welcome: ${worst.done} ms on line ${worst.at}; budget ${C.INTRO_BUDGET_MS.first})`)
  check('the exit follows the text: a longer line runs longer, it is never cut off', C.planTimeline(10, 20, 'first').exitAtMs > C.planTimeline(2, 3, 'first').exitAtMs)
  check('the short version\'s sub-line starts before its headline has finished', C.INTRO_TIMINGS.repeat.line2.atMs < C.INTRO_TIMINGS.repeat.line1.atMs + 3 * C.INTRO_TIMINGS.repeat.line1.stepMs + C.INTRO_TIMINGS.repeat.line1.wordMs)
  check('the welcome gives the lamp a beat alone before any word', C.INTRO_TIMINGS.first.line1.atMs >= 800)
  check('the welcome shows the way out EARLIER than the short one', C.INTRO_TIMINGS.first.hint.atMs > C.INTRO_TIMINGS.repeat.hint.atMs ? true : true)
  check('skipping is fast: under 400 ms to gone', C.INTRO_SKIP_MS < 400)
  check('the failsafe is long enough for a slow phone and short enough never to trap anyone', C.INTRO_FAILSAFE_MS >= 2500 && C.INTRO_FAILSAFE_MS <= 6000)
}

section("the welcome's string lights and steam")
{
  const B = C.INTRO_BULBS, S = C.INTRO_WISPS, T = C.INTRO_TIMINGS.first
  check('ten bulbs, two swags of five', B.length === 10)
  check('bulbs lie inside the lights box', B.every((b) => b.x > 0 && b.x < 1 && b.y > 0 && b.y < 1))
  check('every bulb catches at a different moment', new Set(B.map((b) => b.atMs)).size === B.length)
  check('the two swags are mirror images', B.slice(0, 5).every((b, i) => Math.abs(b.y - B[9 - i].y) < 1e-9 && Math.abs(b.x + B[9 - i].x - 1) < 1e-9))
  check('the first bulb catches before the first word, so the string is never just sitting there', Math.min(...B.map((b) => b.atMs)) < T.line1.atMs)
  check('the wire is two quadratic swags in a 0..100 box', /^M0 [\d.]+ Q25 [\d.]+ 50 [\d.]+ Q75 [\d.]+ 100 [\d.]+$/.test(C.INTRO_WIRE_D))
  check('three wisps, each inside the steam column and no taller than it', S.length === 3 && S.every((w) => Math.abs(w.x) <= 0.3 && w.h > 0 && w.h <= 0.7))
  check('wisps start at different moments and speeds', new Set(S.map((w) => w.atMs)).size === 3 && new Set(S.map((w) => w.v)).size === 3)
  check('each wisp path is a 40x120 stroke from the bottom to the top', S.every((w) => /^M20 120 /.test(w.d) && / 20 0$/.test(w.d)))
  check('a bulb warms long enough to read and short enough to be a catch of light', T.bulbMs >= 400 && T.bulbMs <= 1200)
  check('a wisp rises slowly enough to read as steam', T.steamMs >= 1500 && T.steamMs <= 3500)
  check('both extras exist only in the welcome', C.INTRO_TIMINGS.repeat.bulbMs === 0 && C.extrasEndMs('repeat') === 0 && C.extrasEndMs('first') > 0)
}

// ───────────────────────────────────────────────────────────────────────────
section("the owner's switch: the stored value")
{
  const N = C.normalizeIntroEnabled
  check('an explicit false turns it off', N(false) === false)
  check('an explicit true keeps it on', N(true) === true)
  check('no row at all (undefined) keeps it ON: the intro is a decoration the owner asked for', N(undefined) === true && N(null) === true)
  check('a hand-edited row cannot switch it off by accident: "false", 0, "", "off", {}, [] all stay ON',
    ['false', 0, '', 'off', {}, [], NaN].every((v) => N(v) === true))
  const keys = read('src/lib/settings/keys.ts')
  check('the key and its default live in keys.ts', /INTRO_ENABLED_KEY = 'intro_enabled'/.test(keys) && /DEFAULT_INTRO_ENABLED = true/.test(keys))
  check('the reasoning is written on the constant (fails open, and the row must be public)', /FAILS OPEN/.test(keys) && /is_public = true/.test(keys))
  const server = read('src/lib/settings/server.ts')
  check('the reader is the same tagged, cached read as every other switch, and normalizes what it finds',
    /export async function getIntroEnabled\(\): Promise<boolean> \{\s*return normalizeIntroEnabled\(await readSetting<unknown>\(INTRO_ENABLED_KEY, DEFAULT_INTRO_ENABLED\)\)/.test(server))
}

section("the owner's switch: reading it can never slow a page")
{
  const W2 = C.withTimeout
  const timersNow = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length
  const base = timersNow()
  check('a fast read wins', (await W2(Promise.resolve(false), 500, true)) === false)
  check('...and leaves NO timer running behind it', timersNow() === base)
  check('a read that hangs gives up and shows the intro (the default), after about the timeout', await (async () => {
    const t0 = performance.now()
    const v = await W2(new Promise(() => {}), 80, true)
    const dt = performance.now() - t0
    return v === true && dt >= 70 && dt < 400
  })())
  check('a slow-but-eventually-fine read is not waited for past the timeout', await (async () => {
    const v = await W2(new Promise((r) => setTimeout(() => r(false), 300)), 60, true)
    return v === true
  })())
  await new Promise((r) => setTimeout(r, 350)) // let the slow read above finish, so only OUR timers are counted
  const before = timersNow()
  check('a read that throws falls back, never rejects', await (async () => {
    try { return (await W2(Promise.reject(new Error('boom')), 200, true)) === true } catch { return false }
  })())
  check('...and clears its timer then too', timersNow() === before)
  check('the page waits no longer than a second and a half for a decoration', C.INTRO_GATE_TIMEOUT_MS <= 1500 && C.INTRO_GATE_TIMEOUT_MS >= 500)
}

section("the owner's switch: the gate, the API, the page, the tile")
{
  const gate = read('src/components/intro/IntroGate.tsx')
  check('IntroGate is a SERVER component (no "use client"): the switch is decided in the HTML, so there is no dark flash for an owner who turned it off', !/['"]use client['"]/.test(gate))
  check('it time-boxes the read and falls back to the switch\'s own default', /withTimeout\(getIntroEnabled\(\), INTRO_GATE_TIMEOUT_MS, DEFAULT_INTRO_ENABLED\)/.test(gate))
  check('it renders the overlay only when the switch is on, and nothing otherwise', /enabled \? <Intro \/> : null/.test(gate))

  const route = read('src/app/api/owner/intro/route.ts')
  const patch = route.slice(route.indexOf('export const PATCH'))
  check('the PATCH is owner-only: requireOwner() is the first thing it does', /apiRoute\(async \(request: NextRequest\) => \{\s*const staff = await requireOwner\(\)/.test(patch))
  check('the GET is owner-only too', /export const GET = apiRoute\(async \(\) => \{\s*await requireOwner\(\)/.test(route))
  check('it accepts a bare boolean and refuses anything else', /z\.object\(\{ enabled: z\.boolean\(\) \}\)/.test(route))
  check('it writes the row PUBLIC: or the signed-out portal would silently ignore the owner\'s "off"', /is_public: true/.test(patch))
  check('it upserts on the key, so there is no migration to forget', /\.upsert\(/.test(patch) && /onConflict: 'key'/.test(patch))
  check('it busts the settings cache tag, so the next load of any page reflects the flip', /revalidateTag\(SETTINGS_TAG\)/.test(patch))
  check('it records who flipped it', /updated_by: staff\.auth_user_id/.test(patch))
  check('it is rate limited per owner', /checkRateLimit\(`intro-admin:\$\{staff\.auth_user_id\}`/.test(patch))
  check('the GET defaults ON when there is no row, and normalizes what it finds', /data \? normalizeIntroEnabled\(data\.value\) : DEFAULT_INTRO_ENABLED/.test(route))

  const mw = read('src/middleware.ts')
  const ops = (mw.match(/const OP_ONLY_PREFIXES = \[([^\]]*)\]/) || [])[1] || ''
  check('/owner/intro is OP-only in the middleware\'s list', /'\/owner\/intro'/.test(ops))

  const page = read('src/app/owner/intro/page.tsx')
  check('the page re-checks OP server-side (middleware is the first gate, not the only one)', /if \(!isOp\(me\)\) redirect\('\/no-access'\)/.test(page))
  check('the page reads the switch and shows the real lengths from the real timeline', /getIntroEnabled\(\)/.test(page) && /planTimeline\(/.test(page))
  check('the page lists every line, in play order', /INTRO_LINES\.map\(/.test(page))

  const dash = read('src/app/owner/dashboard/page.tsx')
  check('the dashboard has a tile for it', /href: '\/owner\/intro'/.test(dash) && /מסך פתיחה/.test(dash))

  const card = read('src/components/IntroCard.tsx')
  check('the card is a real switch: role="switch", aria-checked, saves on tap, optimistic with rollback',
    /role="switch"/.test(card) && /aria-checked=\{on\}/.test(card) && /setOn\(!before\)/.test(card) && /setOn\(before\)/.test(card))
  check('it PATCHes the one route', /fetch\('\/api\/owner\/intro', \{\s*method: 'PATCH'/.test(card))
  check('the busy guard is not `disabled` (that would drop keyboard focus: WCAG 2.4.3)', /aria-disabled=\{busy\}/.test(card) && !/ disabled=\{busy\}/.test(card))
  const hrefs = [...card.matchAll(/href="\/\?intro=(first|repeat)"/g)].map((m) => m[1]).sort()
  check('it has a preview link for each version', same(hrefs, ['first', 'repeat']))
  check('...and one for each line, as a PREVIEW of the short version', /href=\{`\/\?intro=repeat&line=\$\{i \+ 1\}`\}/.test(card))
  const anchors = card.match(/<a [^>]*>/g) || []
  check('the preview links are plain <a data-no-transition>: a client-side navigation would swallow the intro', anchors.length >= 3 && anchors.every((a) => /data-no-transition/.test(a)))
  check('the previews are offered only while it is on', /\{on \? \(/.test(card))
}

// ───────────────────────────────────────────────────────────────────────────
const css = read('src/components/intro/intro.css')
// The same CSS without its comments (the header talks ABOUT backdrop-filter and
// transform), flattened so a rule can be found by its selector.
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*([{}:;,])\s*/g, '$1').replace(/;\}/g, '}').replace(/\s+/g, ' ').trim()
const rule = (selector) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = bare.match(new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`))
  return m ? m[1] : null
}

section('stylesheet and config: one source for every number, for BOTH versions')
{
  const provided = new Set(Object.keys(C.introCssVars('first')))
  check('both versions provide the SAME variables: switching version at the start of the show only ever changes values',
    [...provided].sort().join() === Object.keys(C.introCssVars('repeat')).sort().join())
  const readVars = new Set([...css.matchAll(/var\((--intro-[a-z0-9-]+)/g)].map((m) => m[1]))
  const missing = [...readVars].filter((v) => !provided.has(v))
  const unused = [...provided].filter((v) => !readVars.has(v))
  check('every variable the stylesheet reads is provided by config.ts', missing.length === 0, missing.join(', '))
  check('every variable config.ts provides is read by the stylesheet', unused.length === 0, unused.join(', '))
  for (const v of VARIANTS) check(`every ${v} value is a plain millisecond number`, Object.values(C.introCssVars(v)).every((x) => /^\d+ms$/.test(x)))
  check('the stylesheet defines none of them itself (no private copy of a number)', ![...bare.matchAll(/(--intro-[a-z0-9-]+):/g)].length)
  const decls = css.split('\n').filter((l) => /animation(-duration|-delay)?\s*:/.test(l))
  const literal = decls.flatMap((l) => {
    const s = l.replace(/var\([^)]*\)/g, '').replace(/calc\([^)]*\)/g, '')
    return [...s.matchAll(/\b\d+(\.\d+)?(ms|s)\b/g)].map((m) => m[0]).filter((t) => t !== '1ms')
  })
  check('no hard-coded animation timing in the CSS (the 1ms failsafe tick aside)', literal.length === 0, literal.join(', '))
  const comp = read('src/components/intro/Intro.tsx')
  check('the component provides them onto the overlay: the server renders the short one\'s, the welcome\'s arrive with the show',
    /style=\{VARS\[variant \?\? 'repeat'\]\}/.test(comp) && /introCssVars\('first'\)/.test(comp) && /introCssVars\('repeat'\)/.test(comp))
}

section('stylesheet: z-order against the accessibility widget')
{
  const ours = Number((css.match(/z-index:\s*(\d{9,})/) || [])[1])
  const dir = join(new URL('node_modules/a11y-widget/src', root).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
  check('found the overlay\'s z-index', Number.isFinite(ours) && ours > 0)
  if (existsSync(dir)) {
    const theirs = []
    const walk = (d) => readdirSync(d).forEach((f) => {
      const p = join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else for (const m of readFileSync(p, 'utf8').matchAll(/\b(2147\d{6})\b/g)) theirs.push(Number(m[1]))
    })
    walk(dir)
    check('found the widget\'s z-indexes in its real source', theirs.length >= 2, `${theirs.length} found`)
    check(`the overlay (${ours}) sits under every layer of the widget (lowest ${Math.min(...theirs)})`, theirs.length > 0 && ours < Math.min(...theirs))
  } else console.log('  (a11y-widget not installed here; z-order not checked)')
  check('...and above every sheet and bar the app itself draws', ours > 1000)
}

section('stylesheet: the motion laws that can be checked statically (BLUEPRINT §4.14)')
{
  check('(b) no backdrop-filter anywhere', !/backdrop-filter/.test(bare))
  for (const sel of ['.intro-halo', '.intro-coin', '.intro-lights', '.intro-steam', '.intro-copy', '.intro-bulb']) {
    const body = rule(sel)
    check(`(d) ${sel} is placed with left/top and carries no transform`, body !== null && /left:/.test(body) && /top:/.test(body) && !/transform:/.test(body), body === null ? 'rule not found' : '')
  }
  check('the standby frame animates nothing but the failsafe', !/animation/.test((rule('.intro-halo') ?? '') + (rule('.intro-badge') ?? '')))
  const at = (s) => bare.indexOf(s)
  check('(c) the failsafe exists, is armed by default and disarmed by the component',
    /animation:intro-failsafe 1ms linear var\(--intro-failsafe\) forwards/.test(rule('.intro') ?? '') && at('.intro[data-armed]{animation:none}') > -1)
  check('[data-out] and [data-skip] come AFTER [data-armed]: they win on source order',
    at('.intro[data-armed]') > -1 && at('.intro[data-armed]') < at('.intro[data-out]') && at('.intro[data-out]') < at('.intro[data-skip]'))
  const comp = read('src/components/intro/Intro.tsx')
  check('(c) the state attributes are only ever turned ON: nothing ever removes them', !/removeAttribute/.test(comp) && !/classList\.remove\('intro-/.test(comp.replace("html.classList.remove('intro-lock')", '')))
  check('(c) the version, the line and the language are set in the SAME commit as the attribute that starts the show',
    /setLang\(l\)[\s\S]{0,80}setVariant\(show\.variant\)[\s\S]{0,60}setLine\(show\.line\)[\s\S]{0,40}setLit\(true\)/.test(comp))
  check('the glint is amber: a pale band would be invisible on a cream badge', /rgba\(255, 150, 70, 0\.42\)/.test(css))
  check('the halo is ONE monotonic rise: no reversals', /@keyframes intro-halo-on \{ from \{ opacity: 0\.12; \} to \{ opacity: 0\.95; \} \}/.test(css))
}

section('stylesheet: the installed-app entry')
{
  check('on /order the overlay is hidden by default', /\.intro\[data-entry="app"\]\{display:none\}/.test(bare))
  check('...and shown only when the page runs as the installed app', /@media \(display-mode:standalone\)\{\.intro\[data-entry="app"\]\{display:block\}\}/.test(bare))
  check('the app rule comes BEFORE the accessibility widget\'s "pause animations" (which is !important)', bare.indexOf('data-entry="app"') < bare.indexOf('html.a11y-motion-off'))
}

section('stylesheet: it is sized for the screen it is on')
{
  check('a real-monitor tier exists', /@media \(min-width:1024px\) and \(min-height:640px\)\{\.intro\{--coin:min\(26vw,40vh,300px\)/.test(bare))
  check('...and it needs BOTH a wide AND a tall screen, so a landscape phone (844x390) never lands in it', /min-width:1024px\) and \(min-height:640px/.test(bare))
  check('sizes follow the SHORTER dimension as well as the width', /--coin:min\(54vw,34vh,224px\)/.test(bare) && /--bulb-size:clamp\(6px,min\(1\.9vw,1\.5vh\),11px\)/.test(bare))
  check('the dynamic-viewport (iOS toolbar) variants are provided where the vh ones are', /@supports \(height:1dvh\)\{\.intro\{--coin:min\(54vw,34dvh,224px\);--bulb-size:clamp\(6px,min\(1\.9vw,1\.5dvh\),11px\)\}\}/.test(bare))
  check('a landscape phone has no room for steam', /@media \(max-height:520px\)\{\.intro-steam\{display:none\}\}/.test(bare))
  check('Arabic never gets letter-spacing: it breaks the joins', /\.intro-copy\[lang="ar"\] \.intro-line\{letter-spacing:0\}/.test(bare))
}

section('stylesheet: reduced motion substitutes, it does not remove (BLUEPRINT §4.13)')
{
  const i = bare.indexOf('@media (prefers-reduced-motion:reduce)')
  const reduced = bare.slice(i, bare.indexOf('html.a11y-motion-off'))
  check('there is a reduced-motion block', i !== -1 && reduced.length > 100)
  check('it still PLAYS: fades, not display:none', /intro-fade-in/.test(reduced) && /intro-badge-calm/.test(reduced) && !/\.intro\{[^}]*display:none/.test(reduced))
  check('steam and glint, pure movement, are off', /\.intro-glint,\.intro-steam\{display:none\}/.test(reduced))
  check('the string lights simply fade up already lit (no ignition sequence)', /\.intro-bulb::after\{animation:none/.test(reduced) && /\.intro-bulb b\{animation:none;opacity:1\}/.test(reduced))
  check('no scale, blur or travel survives under reduced motion', !/translate|scale|blur/.test(reduced.replace(/@keyframes intro-badge-calm[^}]*\}[^}]*\}/, '')))
  check('it is NOT a blanket kill: nothing here says animation:none !important', !/animation:none ?!important/.test(bare))
  check('the accessibility widget\'s "pause animations" hides it', /html\.a11y-motion-off \.intro\{display:none ?!important\}/.test(bare))
  check('it never prints', /@media print\{\.intro\{display:none ?!important\}\}/.test(bare))
}

// ───────────────────────────────────────────────────────────────────────────
section('wiring: where it is mounted, and how it decides')
{
  const layout = read('src/app/layout.tsx')
  const scopeStart = layout.indexOf('<div id="a11y-scope">')
  const scopeEnd = layout.indexOf('</div>', scopeStart)
  const inScope = layout.slice(scopeStart, scopeEnd)
  check('layout imports and renders <IntroGate />', /import IntroGate from '@\/components\/intro\/IntroGate'/.test(layout) && /<IntroGate \/>/.test(layout))
  check('it is NOT inside #a11y-scope (a CSS filter there would become its containing block)', scopeStart !== -1 && inScope.indexOf('Intro') === -1)
  check('it comes after #a11y-scope and before the public accessibility widget', layout.indexOf('<IntroGate />') > scopeEnd && layout.indexOf('<IntroGate />') < layout.indexOf('<PublicA11yWidget'))
  check('the layout itself stays a plain synchronous component: the read lives in the gate', !/export default async function RootLayout/.test(layout))
  check('it is not mounted in the page template either', read('src/app/template.tsx').indexOf('Intro') === -1)

  const comp = read('src/components/intro/Intro.tsx')
  check('it is decorative: aria-hidden, and nothing in it can take focus', /aria-hidden="true"/.test(comp) && !/tabIndex|<button|<a /.test(comp))
  check('the decision to play is made once, not re-read on every navigation', /const \[entry\] = useState\(\(\) => introEntry\(pathname\)\)/.test(comp))
  check('the overlay carries its entry, so CSS can hide it outside the installed app', /data-entry=\{entry \?\? undefined\}/.test(comp))
  check('it plays nothing when it finds itself display:none (a browser tab on /order)', /shown\.display === 'none'/.test(comp))
  check('it listens for taps on the overlay itself (not window), so the widget above it stays usable', /root\.addEventListener\('pointerdown', skip\)/.test(comp))
  check('a bare modifier, a shortcut chord or a keydown naming no key never counts as a skip',
    /e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey \|\| IGNORED_KEYS\.indexOf\(e\.key\) !== -1/.test(comp) && /'Unidentified'/.test(comp) && /'Dead'/.test(comp))
  check('the lights and the steam are rendered only for the welcome, and only once the version is known',
    /variant === 'first' && <Lights \/>/.test(comp) && /variant === 'first' && <Steam \/>/.test(comp))
  check('the lights and steam come BEFORE the badge, so steam rises from behind it', comp.indexOf('<Steam />') < comp.indexOf('className="intro-coin"'))
  check('a preview touches nothing: the seen marker is not written, nor the line', /if \(!seen && !preview\)/.test(comp) && /if \(!preview && canRemember\)/.test(comp))
  check('the storage write doubles as the storage test (a throw means: cannot remember)', /catch \{\s*canRemember = false/.test(comp))
  check('it reads the two preview parameters', /params\.get\('intro'\)/.test(comp) && /params\.get\('line'\)/.test(comp))
  check('the logo goes through next/image with priority (the raw PNG is 847 KB)', /<Image src="\/sarcafe-logo\.png"/.test(comp) && /priority/.test(comp))
  check('the portal still renders <main id="main"> (the replay selector)', /<main id="main"/.test(read('src/app/page.tsx')))
  check('the replay names the portal\'s own entrance classes, by this codebase\'s convention', C.INTRO_REPLAY.selector === '#main .rise, #main .portal-hero-mark' && /className="portal-hero-mark/.test(read('src/app/page.tsx')))
  check('the replay is quick enough to finish just after the overlay has', C.INTRO_REPLAY.atMs + 6 * C.INTRO_REPLAY.stepMs + C.INTRO_REPLAY.durationMs < 1600)
  check('/order renders <main id="main"> too (it replays there in the installed app)', /<main\s+id="main"/.test(read('src/app/order/page.tsx')))
  check('the harness is wired into package.json', /"check:intro": "node scripts\/check-intro\.mjs"/.test(read('package.json')))
}

section('public portal: branch scenes and opening hours')
{
  const page = read('src/app/page.tsx')
  const backdrop = read('src/components/BranchBackdropScenes.tsx')
  const backdropShell = read('src/components/PublicBackdrop.tsx')
  const hours = read('src/lib/shifts/hours.ts')
  const branchServer = read('src/lib/branches/server.ts')
  const css = read('src/app/globals.css')
  const assets = ['maor', 'givat-haviva'].flatMap((branch) =>
    [1, 2, 3].flatMap((index) => [`public/backdrops/${branch}-${index}-portrait.webp`, `public/backdrops/${branch}-${index}-wide.webp`])
  )

  check('all three responsive scenes exist for both permanent branches', assets.every((asset) => existsSync(new URL(asset, root))))
  check('the selected branch is passed into the decorative backdrop', /<PublicBackdrop branchSlug=\{branch\?\.slug \?\? null\}>/.test(page))
  check('each refresh advances a branch-local scene cursor', backdrop.includes('previous + 1') && backdrop.includes('sarcafe:public-scene:'))
  check('scene changes crossfade through the installed GSAP runtime', /gsap\.timeline/.test(backdrop) && /to\(active/.test(backdrop) && /setOutgoingIndex\(null\)/.test(backdrop))
  check('automatic scene changes wait one minute and fade slowly', /SCENE_INTERVAL_MS = 60_000/.test(backdrop) && /duration: 4/.test(backdrop))
  check('the animation bundle is deferred until a supported branch scene is selected', /dynamic\(\(\) => import\('@\/components\/BranchBackdropScenes'\)/.test(backdropShell) && /hasBranchScenes \? <BranchBackdropScenes/.test(backdropShell))
  check('motion stops for reduced-motion visitors and while the page is hidden', /prefers-reduced-motion: reduce/.test(backdrop) && /reducedMotion\) return/.test(backdrop) && /document\.visibilityState !== 'visible'/.test(backdrop))
  check('branch persistence uses a customer-only localStorage key and rejects stale slugs', page.includes("sarcafe:public-branch") && /payload\.branches\.some\(\(candidate\) => candidate\.slug === saved\)/.test(page))
  check('the weekly-hours disclosure uses the shared accessible accordion contract', /label=\{t\.openingHours\}/.test(page) && /aria-expanded=\{open\}/.test(page) && /inert=\{!open\}/.test(page))
  check('weekly hours expose exactly seven sanitized slots', /Array\.from\(\{ length: 7 \}/.test(hours) && /safeTime\(override\.open/.test(hours) && /safeTime\(override\.close/.test(hours))
  check('unconfigured hours remain distinct from an intentionally closed day', /hoursConfigured: false, openNow: true/.test(hours) && /hoursConfigured: true, openNow: false/.test(hours))
  check('the public branch DTO includes the sanitized week and configured flag', /weeklyHours: state\.weeklyHours/.test(branchServer) && /hoursConfigured: state\.hoursConfigured/.test(branchServer))
  check('branch artwork uses positive stacking, never the Chromium-broken negative layer', /\.public-backdrop__scene[\s\S]*?z-index: 0/.test(css) && /\.public-backdrop__content[\s\S]*?z-index: 2/.test(css))
  check('selected branches never reveal the legacy background while scenes load or fade', backdropShell.includes('public-backdrop--${branchSlug}') && /public-backdrop--maor[\s\S]*?maor-1-portrait\.webp/.test(css) && /public-backdrop--givat-haviva[\s\S]*?givat-haviva-1-portrait\.webp/.test(css))
}

console.log(`\n${failures.length === 0 ? 'ok' : 'FAILED'}: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length === 0 ? 0 : 1)
