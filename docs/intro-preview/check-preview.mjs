// Invariants of the Sarcafe intro design, checked against the PORT blocks of
// preview.template.html (the exact config / copy / CSS that will move into the
// app), so the checks cannot drift from what the preview actually runs.
//
//   node docs/intro-preview/check-preview.mjs
//
// This is the seed of the future scripts/check-intro.mjs: when the intro is
// ported, lift these checks over and add the ones that need the real files
// (mount placement in the root layout, the owner switch). Modelled on Ayeka.Bar's
// harness (BLUEPRINT §4.15 / §12.1) but self-contained: it reads files only.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..')
const tpl = readFileSync(path.join(here, 'preview.template.html'), 'utf8')

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) pass++
  else { fail++; console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`) }
}

function block(name) {
  const a = tpl.indexOf(`>>> PORT ${name}`)
  const b = tpl.indexOf(`<<< PORT ${name}`)
  if (a < 0 || b < 0 || b < a) throw new Error(`PORT ${name} markers not found in the template`)
  // Whole lines, so the opening comment is intact and the closing marker line is left out.
  return tpl.slice(tpl.lastIndexOf('\n', a) + 1, tpl.lastIndexOf('\n', b) + 1)
}

const ctx = vm.createContext({})
vm.runInContext(`${block('config')}\n${block('copy')}`, ctx)
const css = block('css')
// The same CSS without its comments (the header talks ABOUT backdrop-filter and
// transform), flattened so a rule can be found by its selector.
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*([{}:;,])\s*/g, '$1').replace(/\s+/g, ' ').trim()
const rule = (selector) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = bare.match(new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`))
  return m ? m[1] : null
}
const {
  INTRO_PATHS, INTRO_BUDGET_MS, INTRO_TIMINGS, INTRO_COPY_OPTIONS, INTRO_BULBS, INTRO_WISPS,
  INTRO_FAILSAFE_MS, planTimeline, extrasEndMs, introCssVars, splitLine, pickVariant,
} = ctx

// ---- where it plays ----
check('plays on the portal home only', JSON.stringify(INTRO_PATHS) === '["/"]')

// ---- the short version is PINNED (Ayeka's approved numbers; pin for real once the owner signs off) ----
const R = INTRO_TIMINGS.repeat
const pinned = {
  litMs: 900, 'rule.atMs': 200, 'rule.ms': 460, 'glint.atMs': 420, 'glint.ms': 950,
  'line1.atMs': 150, 'line1.stepMs': 55, 'line1.wordMs': 560, 'line2.atMs': 640, 'line2.stepMs': 32, 'line2.wordMs': 520,
  'hint.atMs': 1100, 'hint.ms': 600, holdMs: 650, 'exit.delayMs': 100, 'exit.ms': 560, 'exit.stageMs': 520, 'exit.passAtMs': 280,
}
for (const [k, v] of Object.entries(pinned)) {
  const got = k.split('.').reduce((o, p) => o[p], R)
  check(`short version pinned: ${k} = ${v}`, got === v, `got ${got}`)
}
check('the short version has no extras', R.bulbMs === 0 && R.steamMs === 0 && R.lights.ms === 0)

// ---- every language x copy option x version fits its budget ----
let worst = { done: 0 }
for (const [opt, langs] of Object.entries(INTRO_COPY_OPTIONS)) {
  for (const lang of ['he', 'en', 'ar']) {
    const c = langs[lang]
    check(`copy ${opt}/${lang} exists`, !!c && !!c.line1 && !!c.line2 && !!c.skip)
    if (!c) continue
    for (const variant of ['first', 'repeat']) {
      const p = planTimeline(splitLine(c.line1).length, splitLine(c.line2).length, variant)
      check(`budget ${opt}/${lang}/${variant}: ${p.doneAtMs} <= ${INTRO_BUDGET_MS[variant]}`, p.doneAtMs <= INTRO_BUDGET_MS[variant])
      if (variant === 'first') {
        check(`extras finish before the exit ${opt}/${lang}: ${extrasEndMs('first')} <= ${p.exitAtMs}`, extrasEndMs('first') <= p.exitAtMs)
        if (p.doneAtMs > worst.done) worst = { done: p.doneAtMs, at: `${opt}/${lang}/first` }
      }
    }
    // exactly one glowing word in the headline, none in the sub-line, no stray markers after splitting
    check(`headline ${opt}/${lang} highlights exactly one word`, splitLine(c.line1).filter((w) => w.hl).length === 1)
    check(`sub-line ${opt}/${lang} highlights none`, splitLine(c.line2).filter((w) => w.hl).length === 0)
    check(`no marker survives splitLine ${opt}/${lang}`, ![...splitLine(c.line1), ...splitLine(c.line2)].some((w) => w.text.includes('*')))
  }
}
check('every option has the same languages', Object.values(INTRO_COPY_OPTIONS).every((o) => Object.keys(o).sort().join() === 'ar,en,he'))

// ---- which version a visitor gets ----
check('first visit -> welcome', pickVariant({ forced: null, seen: false, canRemember: true }).variant === 'first')
check('seen -> short', pickVariant({ forced: null, seen: true, canRemember: true }).variant === 'repeat')
check('a device that cannot remember -> short, never the welcome every load', pickVariant({ forced: null, seen: false, canRemember: false }).variant === 'repeat')
check('a preview is flagged and honours the request', pickVariant({ forced: 'first', seen: true, canRemember: true }).preview === true)
check('a junk ?intro= value selects nothing', pickVariant({ forced: 'banana', seen: true, canRemember: true }).variant === 'repeat')

// ---- CSS and config agree, in both directions; the CSS has no timing of its own ----
const provided = new Set(Object.keys(introCssVars('first')))
check('both versions provide the same variables', [...provided].sort().join() === Object.keys(introCssVars('repeat')).sort().join())
const read = new Set([...css.matchAll(/var\((--intro-[a-z0-9-]+)/g)].map((m) => m[1]))
const unprovided = [...read].filter((n) => !provided.has(n))
const unread = [...provided].filter((n) => !read.has(n))
check('the CSS reads no --intro-* variable the config does not provide', unprovided.length === 0, unprovided.join(', '))
check('the config provides no --intro-* variable the CSS never reads', unread.length === 0, unread.join(', '))
for (const [k, v] of Object.entries(introCssVars('first'))) check(`variable ${k} is a millisecond value`, /^\d+ms$/.test(v), v)
const decls = css.split('\n').filter((l) => /animation(-duration|-delay)?\s*:/.test(l))
const literal = decls.flatMap((l) => {
  const stripped = l.replace(/var\([^)]*\)/g, '').replace(/calc\([^)]*\)/g, '')
  return [...stripped.matchAll(/\b\d+(\.\d+)?(ms|s)\b/g)].map((m) => m[0]).filter((t) => t !== '1ms')
})
check('no hard-coded animation timing in the CSS (the 1ms failsafe tick aside)', literal.length === 0, literal.join(', '))
// The failsafe: pure CSS, armed from first paint, disarmed the moment script mounts.
// The ORDER of the three rules is the contract: [data-armed] must come before the
// leaving states, which must win on source order.
check('the failsafe reads its own variable, in the base rule', /animation:intro-failsafe 1ms linear var\(--intro-failsafe\) forwards/.test(rule('.intro') ?? ''))
const at = (s) => bare.indexOf(s)
check('the failsafe is disarmed by data-armed', at('.intro[data-armed]{animation:none}') > -1)
check('[data-armed] precedes [data-out] and [data-skip] (source order is the contract)', at('.intro[data-armed]') > -1 && at('.intro[data-armed]') < at('.intro[data-out]') && at('.intro[data-out]') < at('.intro[data-skip]'))
check('the failsafe waits long enough for a slow bundle but never strands a visitor (2.5 s to 6 s)', INTRO_FAILSAFE_MS >= 2500 && INTRO_FAILSAFE_MS <= 6000, `${INTRO_FAILSAFE_MS}ms`)

// ---- the motion laws that can be checked statically (BLUEPRINT §4.14 / §4.13) ----
check('no backdrop-filter anywhere in the intro (§4.14b)', !/backdrop-filter/.test(bare))
// (d) nothing positioned with transform is also animated with it: every placed box is placed by left/top
for (const sel of ['.intro-halo', '.intro-coin', '.intro-lights', '.intro-steam', '.intro-copy', '.intro-bulb']) {
  const body = rule(sel)
  check(`${sel} is placed with left/top and carries no transform (§4.14d)`, body !== null && /left:/.test(body) && /top:/.test(body) && !/transform\s*:/.test(body), body === null ? 'rule not found' : '')
}
const reduced = bare.slice(bare.indexOf('@media (prefers-reduced-motion:reduce)'), bare.indexOf('html.a11y-motion-off'))
check('there is a reduced-motion block', reduced.length > 100)
check('reduced motion SUBSTITUTES (fades), it does not remove the intro (§4.13)', /intro-fade-in/.test(reduced) && /intro-badge-calm/.test(reduced) && !/\.intro\s*\{[^}]*display:\s*none/.test(reduced))
check('no scale, blur or travel survives under reduced motion', !/translate|scale|blur/.test(reduced.replace(/@keyframes intro-badge-calm[^}]*\}[^}]*\}/, '')))
check('steam and glint are dropped under reduced motion', /\.intro-glint,\.intro-steam\{display:none\}/.test(reduced))
check('"pause animations" from the a11y widget hides it', /html\.a11y-motion-off \.intro\{display:none!important\}/.test(bare))
check('it does not print', /@media print\{\.intro\{display:none!important\}\}/.test(bare))
check('the standby frame animates nothing but the failsafe', !/animation/.test((rule('.intro-halo') ?? '') + (rule('.intro-badge') ?? '')))

// ---- z-order: one notch under the accessibility widget, read from its real source ----
const introZ = Number((css.match(/z-index:\s*(\d{9,})/) ?? [])[1])
const widgetDir = path.join(root, 'node_modules', 'a11y-widget', 'src')
if (existsSync(widgetDir)) {
  const nums = []
  const walk = (d) => readdirSync(d).forEach((f) => {
    const p = path.join(d, f)
    if (statSync(p).isDirectory()) walk(p)
    else for (const m of readFileSync(p, 'utf8').matchAll(/\b(2147\d{6})\b/g)) nums.push(Number(m[1]))
  })
  walk(widgetDir)
  check('found the a11y widget z-indexes', nums.length > 0)
  check(`intro (${introZ}) sits under every a11y widget layer (min ${Math.min(...nums)})`, nums.length > 0 && introZ < Math.min(...nums))
} else {
  console.log('  skip  a11y widget not installed; z-order not checked')
}

// ---- geometry the CSS and the runtime share ----
check('ten bulbs', INTRO_BULBS.length === 10)
check('bulbs lie inside the lights box', INTRO_BULBS.every((b) => b.x > 0 && b.x < 1 && b.y > 0 && b.y < 1))
check('every bulb catches at a different moment', new Set(INTRO_BULBS.map((b) => b.atMs)).size === INTRO_BULBS.length)
check('the two swags are mirror images', INTRO_BULBS.slice(0, 5).every((b, i) => Math.abs(b.y - INTRO_BULBS[5 + (4 - i)].y) < 1e-9 && Math.abs(b.x + INTRO_BULBS[5 + (4 - i)].x - 1) < 1e-9))
check('three wisps, each inside the steam column', INTRO_WISPS.length === 3 && INTRO_WISPS.every((w) => Math.abs(w.x) <= 0.3 && w.h > 0 && w.h <= 0.7))
check('wisps start at different moments and speeds', new Set(INTRO_WISPS.map((w) => w.atMs)).size === 3 && new Set(INTRO_WISPS.map((w) => w.v)).size === 3)
check('the welcome has its extras', INTRO_TIMINGS.first.bulbMs > 0 && INTRO_TIMINGS.first.steamMs > 0)

console.log(`${fail === 0 ? 'ok' : 'FAILED'}: ${pass} passed, ${fail} failed. Longest welcome: ${worst.done} ms (${worst.at}) of ${INTRO_BUDGET_MS.first}.`)
process.exit(fail === 0 ? 0 : 1)
