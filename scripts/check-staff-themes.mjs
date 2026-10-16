// Checks for the staff app's five looks (owner, 2026-10-17): the pure registry, the saving (cookie + tolerant database column), the
// wiring (layout, scope, picker, wizard step, profile, home row), and the CONTRAST of every colour pair each look draws text on.
// The pure file is transpiled and run; the CSS tokens are parsed out of staff-themes.css and measured, so a look that is made
// too pale or too dim fails here, not on someone's phone in the sun.
//
//   node scripts/check-staff-themes.mjs

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

const dir = mkdtempSync(join(tmpdir(), 'check-themes-'))
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* temp dir */ } })
writeFileSync(join(dir, 'theme.mjs'), ts.transpileModule(read('src/lib/staff/theme.ts'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText)
const T = await import(pathToFileURL(join(dir, 'theme.mjs')).href)

section('the registry')
eq('five looks, neon first (the default)', [...T.STAFF_THEMES], ['neon', 'glass', 'pass', 'crema', 'latte'])
eq('the default is the look the app already had', T.DEFAULT_THEME, 'neon')
check('every look has a Hebrew name, a one-line blurb and a mode', T.THEMES.length === 5 && T.THEMES.every((t) => t.name.length > 1 && t.blurb.length > 10 && (t.mode === 'dark' || t.mode === 'light') && /[֐-׿]/.test(t.name)))
eq('the registry lists exactly the looks the type allows, in order', T.THEMES.map((t) => t.id), [...T.STAFF_THEMES])
eq('two light looks (sun), three dark', T.THEMES.filter((t) => t.mode === 'light').map((t) => t.id), ['crema', 'latte'])
check('parseTheme accepts only the five names', T.parseTheme('latte') === 'latte' && T.parseTheme('Latte') === null && T.parseTheme('') === null && T.parseTheme(null) === null && T.parseTheme(7) === null && T.parseTheme('dark; drop table') === null)
eq('the database choice wins over the device cookie', T.resolveTheme('pass', 'crema'), { theme: 'pass', chosen: true })
eq('no database value: the cookie decides', T.resolveTheme(null, 'crema'), { theme: 'crema', chosen: true })
eq('a damaged cookie and no value: the default, not chosen (the home asks)', T.resolveTheme(undefined, 'blue'), { theme: 'neon', chosen: false })
eq('a damaged database value falls back to the cookie', T.resolveTheme('blue', 'glass'), { theme: 'glass', chosen: true })
check('only the light looks need the dark status-bar band', T.isLightTheme('crema') && T.isLightTheme('latte') && !T.isLightTheme('neon') && !T.isLightTheme('glass') && !T.isLightTheme('pass'))

section('saving: the account row when it can, the device cookie always')
const mig = read('supabase/migrations/20261017120000_staff_ui_theme.sql')
check('the migration adds one nullable column, idempotently, with a check on the five names', /add column if not exists ui_theme text;/.test(mig) && /ui_theme is null or ui_theme in \('neon', 'glass', 'pass', 'crema', 'latte'\)/.test(mig) && /if not exists \(select 1 from pg_constraint/.test(mig))
check('the migration creates no function and no grant (nothing to overload, nothing browser-readable)', !/create (or replace )?function/i.test(mig) && !/grant /i.test(mig))
const srv = read('src/lib/staff/theme-server.ts')
check('reading is tolerant: a missing column or a failed read never stops a page', /try \{[\s\S]*select\('ui_theme'\)[\s\S]*\} catch/.test(srv) && /if \(!error && data\)/.test(srv))
check('writing reports failure instead of throwing (the cookie still changes the look on this device)', /return !error/.test(srv) && /catch \{\s*return false/.test(srv))
const api = read('src/app/api/staff/theme/route.ts')
check('the API is a private staff route, takes the person from the session only and validates the name', /privateStaffRoute/.test(api) && /resolveStaffIdentity\(\)/.test(api) && /parseTheme\(body\?\.theme\)/.test(api) && /BadRequest/.test(api))
check('the API writes only the theme (saveStaffTheme) and sets the plain cookie for a year', /saveStaffTheme\(staff\.id, theme\)/.test(api) && /response\.cookies\.set\(THEME_COOKIE, theme/.test(api) && !/role|badge|branch_id|active/.test(api.replace(/\/\/.*$/gm, '')))
check('a code sign-in may choose too (the wizard runs before any Google link)', /resolveStaffIdentity/.test(api) && !/via === 'google'/.test(api))

section('wiring')
const themed = read('src/components/app/ThemedApp.tsx')
check('ThemedApp reads the look on the server, draws it on the wrapper (no flash), loads the stylesheet and mirrors it onto <html>', /loadStaffTheme\(staffId\)/.test(themed) && /<AppMotion className=\{className\} theme=\{theme\}>/.test(themed) && /staff-themes\.css/.test(themed) && /<ThemeScope theme=\{theme\} \/>/.test(themed))
check('the shift-pass look loads its monospace face only when it is the active look', /theme === 'pass' && <link[^>]*Space\+Mono/.test(themed))
check('THE WHOLE PANEL: the staff app, the owner pages and the cart sign-in all render inside ThemedApp', ['src/app/staff/layout.tsx', 'src/app/owner/layout.tsx', 'src/app/crew/layout.tsx'].every((f) => /<ThemedApp staffId=\{me\?\.id\}/.test(read(f))))
check('the cart sign-in works signed out (the device look) and the owner layout needs no extra permission', /resolveStaffIdentity\(\)\.catch\(\(\) => null\)/.test(read('src/app/crew/layout.tsx')) && /resolveStaffIdentity\(\)\.catch\(\(\) => null\)/.test(read('src/app/owner/layout.tsx')))
check('AppMotion puts the attribute on the wrapper', /data-staff-theme=\{theme\}/.test(read('src/components/app/AppMotion.tsx')))
const scope = read('src/components/staff/ThemeScope.tsx')
check('the scope applies the look on mount and removes it from <html> on leaving', /applyTheme\(theme\)/.test(scope) && /delete document\.documentElement\.dataset\.staffTheme/.test(scope))
const tr = read('src/lib/staff/theme-transition.ts')
check('applyTheme sets <html> (sheets portal to <body>) and the wrapper, and only for a valid look', /documentElement\.dataset\.staffTheme = theme/.test(tr) && /setAttribute\('data-staff-theme', theme\)/.test(tr) && /if \(!isStaffTheme\(theme\)\) return/.test(tr))
const picker = read('src/components/staff/ThemePicker.tsx')
check('the picker is a radio group: one radio per look, aria-checked, each drawn in its own look', /role="radiogroup"/.test(picker) && /role="radio"/.test(picker) && /aria-checked=\{on\}/.test(picker) && /data-staff-theme=\{id\}/.test(picker) && /THEMES\.map/.test(picker))
check('choosing changes the whole screen from where the card was tapped, before anything is saved', /transitionTheme\(id, \{ x: box\.left \+ box\.width \/ 2, y: box\.top \+ box\.height \/ 2 \}\)/.test(picker))
const step = read('src/components/staff/StaffStyleStep.tsx')
check('the wizard step can always be skipped, and a failed save does not trap the person (they can skip)', /onClick=\{onDone\}>דילוג/.test(step) && /saveTheme\(theme\)/.test(step) && /setBusy\(false\)/.test(step))
const wiz = read('src/components/staff/StaffOnboarding.tsx')
check('the wizard shows the step after the details and skips it when this device already has a look', /step === 'style' && <StaffStyleStep/.test(wiz) && /styleDone/.test(wiz) && /THEME_COOKIE/.test(wiz))
check('the profile has the picker (anchor #style) and saves on every tap', /<ProfileStyle initial=/.test(read('src/app/staff/profile/page.tsx')) && /id="style"/.test(read('src/components/staff/ProfileStyle.tsx')) && /saveTheme\(next\)/.test(read('src/components/staff/ProfileStyle.tsx')))
const home = read('src/components/dashboard/EmployeeDashboardView.tsx')
check('the home has a "מראה האפליקציה" row that says which look is on, and asks once when none was chosen', /href="\/staff\/profile#style"/.test(home) && /מראה האפליקציה/.test(home) && /look\.chosen \?/.test(home))
check('the owner dashboard also has the "מראה האפליקציה" row (one look for the whole panel)', /href="\/staff\/profile#style"/.test(read('src/components/dashboard/OwnerDashboardView.tsx')) && /loadStaffTheme\(me\.id\)/.test(read('src/components/dashboard/OwnerDashboardView.tsx')))
check('the accent-fill text colour has a fallback everywhere it is used (the dark looks keep using --bg)', ['src/components/app/app.css', 'src/components/shifts/schedule.css', 'src/components/staff/gate.css'].every((f) => !/color: var\(--bg\)[;} ]/.test(read(f))))

section('the stylesheet has every look, scoped by the attribute only')
const css = read('src/components/app/staff-themes.css')
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
for (const id of T.STAFF_THEMES) {
  check(`${id}: a token block, a shift-card rule, a header rule and a picker miniature rule`, new RegExp(`\\[data-staff-theme='${id}'\\]\\s*\\{[^}]*--bg:`).test(stripped) && new RegExp(`\\[data-staff-theme='${id}'\\] \\.app-shiftcard \\{`).test(stripped) && new RegExp(`\\[data-staff-theme='${id}'\\] \\.app-header \\{`).test(stripped) && new RegExp(`\\[data-staff-theme='${id}'\\](\\.tp| \\.tp__)`).test(stripped))
}
check('no rule depends on the page or a route (a preview inside the picker gets the same look)', !/\.native-app\s+\[data-staff-theme/.test(stripped))
check('the light looks put a dark band under the iPhone status bar', /\[data-staff-theme='crema'\]::after[^}]*env\(safe-area-inset-top/.test(stripped) && /\[data-staff-theme='latte'\]::after[^}]*env\(safe-area-inset-top/.test(stripped))
check('the shift pass numbers its checklists and draws a perforation and a barcode', /counter-increment: ck/.test(stripped) && /counter\(ck, decimal-leading-zero\)/.test(stripped) && /border-top: 2px dashed/.test(stripped) && /\.app-shiftcard::after \{ content: ''/.test(stripped))
const motionBlock = /@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*)\n\}\s*$/.exec(stripped)?.[1] ?? ''
check('ALL motion is inside prefers-reduced-motion: no-preference (no keyframe or transition outside it)', motionBlock.length > 400 && !/@keyframes|transition:/.test(stripped.replace(motionBlock, '')))
check('the reveal is a circle from the tapped point (view transition) with the ring/burst layer above it, and a colour cross-fade where view transitions do not exist', /@keyframes theme-reveal/.test(motionBlock) && /clip-path: circle\(0 at var\(--vt-x/.test(motionBlock) && /view-transition-new\(root\) \{ z-index: 2; animation: theme-reveal/.test(motionBlock) && /view-transition-group\(theme-fx\)/.test(motionBlock) && /html\.theme-anim/.test(motionBlock))

section('the change: reveal, ring, burst, settle (theme-transition.ts)')
check('a person who asked for less motion gets an instant change, nothing else', /prefers-reduced-motion: reduce/.test(tr) && /if \(prefersLess\(\)\) \{ applyTheme\(next\); return \}/.test(tr))
check('the reveal radius reaches the farthest corner from the tap, and the circle is driven by --vt-x/--vt-y/--vt-r on <html>', /Math\.hypot\(Math\.max\(o\.x, w - o\.x\), Math\.max\(o\.y, h - o\.y\)\)/.test(tr) && /setProperty\('--vt-x'/.test(tr) && /setProperty\('--vt-r'/.test(tr) && /dataset\.themeVt = '1'/.test(tr))
check('it uses document.startViewTransition when it exists, always cleans up after (finished), and survives it throwing', /typeof start === 'function'/.test(tr) && /transition\.finished\.then\(clear, clear\)/.test(tr) && /catch \{\s*clear\(\)\s*applyTheme\(next\)/.test(tr))
check('the fallback is a colour glide (class on <html>, removed after) with the same ring and burst', /classList\.add\('theme-anim'\)/.test(tr) && /classList\.remove\('theme-anim'\)/.test(tr))
for (const id of T.STAFF_THEMES) check(`${id}: has its own burst (a shape, a count, a reach, a ring)`, new RegExp(id + String.raw`: \{ shape: '(spark|heart|bean|ticket|bokeh)', count: \d+, size: \[[^\]]+\], reach: \[[^\]]+\].*ring: \{ width: \d+, style: '(solid|dashed)' \}`).test(tr))
check('the five bursts are five different drawings (spark, bokeh, ticket, bean, heart)', ['spark', 'bokeh', 'ticket', 'bean', 'heart'].every((shape) => new RegExp(`shape: '${shape}'`).test(tr)))
check('the effects layer is aria-hidden, never takes a tap and is removed when over', /aria-hidden', 'true'/.test(tr) && /pointerEvents: 'none'/.test(tr) && /layer\.remove\(\)/.test(tr))
check('the cards of the page settle in one after another (staggered), the header does not move', /\.app-page > \*/.test(tr) && /index \* 55/.test(tr) && /app-header/.test(tr))
check('the shapes are fixed drawings: the only HTML ever put into the effects layer is a drawing from SHAPES', (tr.match(/innerHTML =/g) ?? []).length === 1 && /el\.innerHTML = SHAPES\[recipe\.shape\]\(palette\[i % palette\.length\]!\)/.test(tr))

section('hard-coded status colours no longer fight the light looks')
const { readdirSync, statSync } = await import('node:fs')
const walk = (d) => readdirSync(join(ROOT, d)).flatMap((n) => { const f = `${d}/${n}`; return statSync(join(ROOT, f)).isDirectory() ? walk(f) : f.endsWith('.tsx') ? [f] : [] })
const redLiterals = walk('src').filter((f) => /'#ff6b6b'/.test(read(f)))
check('no component writes the red status colour as a literal in a style (it is var(--danger): the same red on the dark looks, a darker one on the light looks)', redLiterals.length === 0, redLiterals.join(', '))

section('contrast (WCAG): every pair a look draws text or controls on')
const hex = (value) => { const m = /^#([0-9a-f]{6})$/i.exec(value.trim()); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
const lum = ([r, g, b]) => { const f = (c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const blend = (top, alpha, under) => top.map((c, i) => Math.round(c * alpha + under[i] * (1 - alpha)))
const tokensOf = (id) => {
  const m = new RegExp(`\\[data-staff-theme='${id}'\\]\\s*\\{([^}]*)\\}`).exec(stripped)
  const out = {}
  for (const part of (m?.[1] ?? '').split(';')) { const kv = /--([a-z0-9-]+):\s*(.+)$/i.exec(part.trim()); if (kv) out[kv[1]] = kv[2].trim() }
  return out
}
const need = (name, fg, bg, min) => { const r = fg && bg ? ratio(fg, bg) : 0; check(`${name} ≥ ${min}:1`, r >= min, `measured ${r.toFixed(2)}`) }
const root = (() => { const m = /:root \{([^}]*)\}/.exec(read('src/app/globals.css')); const out = {}; for (const part of (m?.[1] ?? '').split(';')) { const kv = /--([a-z0-9-]+):\s*(#[0-9a-f]{6})/i.exec(part.trim()); if (kv) out[kv[1]] = kv[2] } return out })()
for (const id of T.STAFF_THEMES) {
  const t = tokensOf(id)
  const c = (k) => hex(t[k] ?? root[k] ?? '')
  const onNeon = hex(t['on-neon'] ?? '') ?? c('bg')
  console.log(`  — ${id}`)
  need(`${id}: body text on the page`, c('text'), c('bg'), 7)
  need(`${id}: body text on a card`, c('text'), c('bg-elev'), 7)
  need(`${id}: body text on a sheet / raised row`, c('text'), c('bg-elev-2'), 7)
  need(`${id}: secondary text on the page`, c('text-dim'), c('bg'), 4.5)
  need(`${id}: secondary text on a card`, c('text-dim'), c('bg-elev'), 4.5)
  need(`${id}: secondary text on a raised row`, c('text-dim'), c('bg-elev-2'), 4.5)
  need(`${id}: tertiary text on the page`, c('text-faint'), c('bg'), 4.5)
  need(`${id}: tertiary text on a card`, c('text-faint'), c('bg-elev'), 4.5)
  need(`${id}: text on an accent fill (buttons, counts, tabs)`, onNeon, c('neon'), 4.5)
  need(`${id}: accent text and icons on a card`, c('neon-soft'), c('bg-elev'), 4.5)
  need(`${id}: accent text and icons on the page`, c('neon-soft'), c('bg'), 4.5)
  need(`${id}: the second accent (info) on a card`, c('neon-2'), c('bg-elev'), 4.5)
  need(`${id}: the accent as a control edge on a card (non-text)`, c('neon'), c('bg-elev'), 3)
  if (T.isLightTheme(id)) {
    for (const k of ['ok', 'warn', 'danger']) need(`${id}: status colour ${k} on a card`, c(k), c('bg-elev'), 4.5)
    need(`${id}: danger text on its tint`, c('danger'), hex(t['danger-bg'] ?? ''), 4.5)
    need(`${id}: warn text on its tint`, c('warn'), hex(t['warn-bg'] ?? ''), 4.5)
    need(`${id}: ok text on its tint`, c('ok'), hex(t['ok-bg'] ?? ''), 4.5)
  }
}
console.log('  — surfaces that carry their own colours')
const H = (v) => hex(v)
// crema: the dark shift card, the mint pill on it, the mint workshop card, the "soon" chip
need('crema shift card: cream text on espresso', H('#fff9ee'), H('#26150d'), 7)
need('crema shift card: secondary text on espresso', H('#e6d6c4'), H('#26150d'), 7)
need('crema shift card: tertiary text on espresso', H('#d3c1ad'), H('#26150d'), 4.5)
need('crema shift card: accent text on espresso', H('#ffb08a'), H('#26150d'), 4.5)
need('crema shift card: espresso text on the orange button', H('#26150d'), H('#f4601f'), 4.5)
need('crema shift card: the mint pill', H('#0a3b32'), H('#7fe9d2'), 4.5)
need('crema workshop card: secondary text on mint', H('#3d5a51'), H('#c4ebdd'), 4.5)
need('crema workshop card: body text on mint', H('#26150d'), H('#c4ebdd'), 7)
need('crema workshop card: accent text on mint', H('#2c5d4f'), H('#c4ebdd'), 4.5)
need('crema "soon" chip', H('#26150d'), H('#ffd9c4'), 7)
need('crema notifications-on card: secondary text on its tint', H('#6b5546'), H('#d3f0e6'), 4.5)
// latte: the pink-peach shift card (check the darkest and the lightest ends of its gradient), the mint pill, the workshop card
for (const end of ['#fbc3d3', '#fde0cf', '#fff3ea']) {
  need(`latte shift card on ${end}: body text`, H('#3a211b'), H(end), 7)
  need(`latte shift card on ${end}: secondary text`, H('#6a4a42'), H(end), 4.5)
  need(`latte shift card on ${end}: accent text`, H('#a02b55'), H(end), 4.5)
  need(`latte shift card on ${end}: the schedule row`, H('#8f2349'), H(end), 4.5)
}
need('latte shift card: the live pill', H('#1d6b43'), H('#fff7f3'), 4.5)
need('latte shift card: the pink button', H('#3a1620'), H('#e45f87'), 4.5)
need('latte workshop card: secondary text on peach', H('#7a5a52'), H('#fde7dc'), 4.5)
need('latte workshop card: body text on peach', H('#3a211b'), H('#fde7dc'), 7)
need('latte "soon" chip', H('#b0305a'), H('#fde3ea'), 4.5)
need('latte row icons on their pink tint', H('#b0305a'), H('#fde3ea'), 4.5)
// glass: the brightest light pool sits under the greeting; text must still read on the blended colour
const poolAlpha = Number(/::before \{[^}]*?radial-gradient\(54% 34% at 92% 4%, rgba\(255, 122, 69, ([0-9.]+)\)/.exec(stripped)?.[1] ?? 1)
const pool = blend([255, 122, 69], poolAlpha, H('#120a07'))
const glassCard = blend([255, 255, 255], 0.07, pool)
const gt = tokensOf('glass')
need(`glass: body text over the brightest light pool (alpha ${poolAlpha})`, H(gt.text), glassCard, 7)
need('glass: secondary text over the brightest light pool', H(gt['text-dim']), glassCard, 4.5)
need('glass: tertiary text over the brightest light pool', H(gt['text-faint']), glassCard, 4.5)
need('glass: the live label on the shift card', H('#a6f0e0'), blend([255, 150, 100], 0.2, H('#2a1a12')), 4.5)
// pass and neon: the status pills and the dim copy on their cards
need('neon: the mint live pill on the card', H('#7fe9d2'), H('#1c1310'), 7)
need('pass: the mint live pill on the card', H('#8fe8d3'), H('#17100c'), 7)
need('neon/pass/glass: dark text on the accent button', H('#110b08'), H('#ff7a45'), 4.5)

console.log(`\n${pass > 0 && failures.length === 0 ? '✓' : '✗'} ${pass} passed, ${failures.length} failed`)
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1) }
