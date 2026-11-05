// CI fallback, ephemeral checkouts only: when the private a11y-widget tarball cannot be downloaded, install everything else
// exactly from the lockfile and put a stand-in for that one package (it only renders the public accessibility button,
// which the suite does not test). The QA report says so. Never run this in a working copy you will commit from.
import fs from 'node:fs'
import { execSync } from 'node:child_process'
if (!process.env.CI) { console.error('install-without-widget: CI only'); process.exit(1) }
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'))
delete pkg.dependencies['a11y-widget']
delete lock.packages['node_modules/a11y-widget']
delete lock.packages[''].dependencies['a11y-widget']
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2))
fs.writeFileSync('package-lock.json', JSON.stringify(lock, null, 2))
execSync('npm ci --no-audit --no-fund', { stdio: 'inherit' })
fs.mkdirSync('node_modules/a11y-widget', { recursive: true })
fs.writeFileSync('node_modules/a11y-widget/package.json', JSON.stringify({ name: 'a11y-widget', version: '1.2.1', description: 'CI STAND-IN (the private tarball could not be downloaded)', main: 'index.js', types: 'index.d.ts' }))
fs.writeFileSync('node_modules/a11y-widget/index.js', "exports.A11yWidget=function(){return null};exports.WIDGET_COVERAGE=[{id:'stand-in',labels:{he:'רכיב נגישות',en:'a11y widget'}}]")
fs.writeFileSync('node_modules/a11y-widget/index.d.ts', 'export type A11yWidgetConfig = { storageKey?: string; statementHref?: string; avoid?: string[] }\nexport declare function A11yWidget(props: { config?: A11yWidgetConfig }): null\nexport declare const WIDGET_COVERAGE: { id: string; labels: { he: string; en: string } }[]\n')
execSync('git checkout -- package.json package-lock.json', { stdio: 'inherit' })
console.log('installed with an a11y-widget stand-in')
