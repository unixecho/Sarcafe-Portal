// Checks that the accessibility widget and the "skip to main content" link appear on CUSTOMER pages only (owner, 2026-10-16).
//
//   node scripts/check-a11y-scope.mjs

import ts from 'typescript'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
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
const section = (t) => console.log(`\n${t}`)

const dir = mkdtempSync(join(tmpdir(), 'check-a11y-scope-'))
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* temp dir */ } })
writeFileSync(join(dir, 'scope.mjs'), ts.transpileModule(read('src/lib/a11y-scope.ts'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText)
const S = await import(pathToFileURL(join(dir, 'scope.mjs')).href)

section('which pages are customer-facing')
for (const p of ['/', '/menu', '/menu/maor', '/order', '/order/abc', '/accessibility', '/privacy', '/board/xyz']) check(`${p} is customer-facing`, S.isCustomerFacing(p) === true)
for (const p of ['/owner', '/owner/dashboard', '/owner/branches/maor', '/owner/issues', '/staff', '/staff/dev', '/staff/schedule', '/staff/onboarding', '/pos', '/login', '/auth/callback', '/no-access', '/checklists', '/something-new', '/menuX', '/ordering', '']) check(`${JSON.stringify(p)} is NOT`, S.isCustomerFacing(p) === false)
check('no path at all is private', S.isCustomerFacing(null) === false && S.isCustomerFacing(undefined) === false)

section('every top-level page of the app is classified (a new one must be decided on purpose)')
const app = join(ROOT, 'src/app')
const tops = readdirSync(app).filter((n) => statSync(join(app, n)).isDirectory() && n !== 'api')
const CUSTOMER = ['accessibility', 'board', 'menu', 'order', 'privacy']
const PRIVATE = ['auth', 'login', 'no-access', 'owner', 'pos', 'staff', 'fixture']
const unknown = tops.filter((n) => !CUSTOMER.includes(n) && !PRIVATE.includes(n))
check('no unclassified top-level route', unknown.length === 0, unknown.join(', '))
check('the customer folders are exactly the customer prefixes', JSON.stringify([...S.CUSTOMER_PREFIXES].map((p) => p.slice(1)).sort()) === JSON.stringify([...CUSTOMER].sort()))
check('no private folder is a customer prefix', PRIVATE.every((n) => !S.isCustomerFacing(`/${n}`) && !S.isCustomerFacing(`/${n}/x`)))

section('the wiring')
const layout = read('src/app/layout.tsx')
const widget = read('src/components/PublicA11yWidget.tsx')
const skip = read('src/components/SkipLink.tsx')
check('the layout no longer hard-codes the skip link', !/<a href="#main"/.test(layout) && /<SkipLink \/>/.test(layout))
check('the skip link renders only on customer pages', /isCustomerFacing\(pathname\)\) return null/.test(skip) && /className="skip-link"/.test(skip))
check('the widget renders only on customer pages', /const customer = isCustomerFacing\(pathname\)/.test(widget) && /if \(!customer\) return null/.test(widget))
check('leaving a customer page strips every trace the widget left on the page', /classList\.remove\(\.\.\.WIDGET_HTML_CLASSES\)/.test(widget) && /removeProperty\(name\)/.test(widget) && /scope\.style\.filter = ''/.test(widget))
const pkg = read('node_modules/a11y-widget/src/apply.ts')
const classes = [...pkg.matchAll(/'(a11y-[a-z-]+)'/g)].map((m) => m[1])
check('the cleanup list covers every class the installed widget can add', classes.length >= 6 && classes.every((c) => S.WIDGET_HTML_CLASSES.includes(c)), classes.join(', '))
check('the intro still sits after the scope and before the widget', layout.indexOf('<IntroGate />') < layout.indexOf('<PublicA11yWidget'))

console.log(`\n${pass > 0 && failures.length === 0 ? '✓' : '✗'} ${pass} passed, ${failures.length} failed`)
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1) }
