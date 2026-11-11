// Stage 2 — every existing check:* and verify:* script (the project's regression net, 30+ scripts written over many sessions).
// Each is one test here. A script that needs something this machine does not have (Windows Edge for the kiosk checks, a fixture
// copy for the scroller) is SKIPPED with the reason, never silently passed.
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { createStage, assert } from '../lib/harness.mjs'
import { npm } from '../lib/exec.mjs'
import { findJdk } from '../lib/jdk.mjs'

// check:shift-scroller needs a running copy serving its fixture page: the live stage runs it (qa/live/ui.mjs, 'carousel').
const NEEDS = {
  'check:shift-scroller': 'runs in the live stage against the built copy (see ui.carousel)',
}
// The real a11y-widget source is read by check:a11y-scope; a machine that could only install the stand-in cannot run it.
const widgetStandIn = (root) => { try { return /STAND-IN/i.test(fs.readFileSync(path.join(root, 'node_modules/a11y-widget/package.json'), 'utf8')) } catch { return false } }
// Only when the suite has NO browser to give a script: then the script falls back to Windows Edge and cannot run elsewhere. When the
// suite did hand it a browser, a launch error is a failure (it used to be reported as this skip: Chromium's own flags contain "msEdge").
const ENV_SKIP = [/Edge (?:is )?not found|msedge|Cannot find Edge|EDGE.*undefined|executablePath.*undefined/i]

// The browser every browser test uses: the first of these that EXISTS AND STARTS on this machine. Playwright's own Chromium first
// (what GitHub Actions uses); then QA_CHROMIUM and the container's copy; on Windows, last, the installed Edge, which is what the
// check:* scripts use there when run by hand. A browser that is installed but cannot start (seen on the owner's PC: Windows refused
// Playwright's chrome.exe, "side-by-side configuration is incorrect") is passed over and named in browserProblems(), not hidden.
let browser
const problems = []
const starts = (exe) => {
  const r = spawnSync(exe, ['--headless', '--disable-gpu', '--no-first-run', '--dump-dom', 'about:blank'], { stdio: 'ignore', timeout: 30_000, windowsHide: true })
  if (r.error && r.error.code !== 'ETIMEDOUT') { problems.push(`${exe} is installed but does not start: ${r.error.message}`); return false }
  return true
}
export function browserPath() {
  if (browser !== undefined) return browser ?? undefined
  const candidates = []
  try { candidates.push(require('playwright').chromium.executablePath()) } catch { /* playwright is not installed */ }
  candidates.push(process.env.QA_CHROMIUM, '/opt/pw-browsers/chromium')
  if (process.platform === 'win32') for (const base of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles]) if (base) candidates.push(path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
  browser = candidates.filter(Boolean).find((p) => fs.existsSync(p) && starts(p)) ?? null
  return browser ?? undefined
}
/** Browsers that were found on this machine but could not be started (each with the reason). */
export const browserProblems = () => { browserPath(); return [...problems] }
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

// The plain-Java parts of the kiosk app (StaffPin, OtaRules, PinReset) are compiled and run by the kiosk checks with javac: they look
// for a JDK through JAVA_HOME, so it is pointed at the JDK found on this machine (qa/lib/jdk.mjs: JAVA_HOME when it holds a compiler,
// else the javac on the PATH, javac.exe on Windows).
const javaHome = () => findJdk()?.home ?? ''

/** `suite`: the dashboard runs every check:* / verify:* script except the kiosk's; the kiosk suite runs only those (name has "kiosk"). */
export function checksStage(root, suite = 'dashboard') {
  const kiosk = suite === 'kiosk'
  const stage = createStage(kiosk ? 'kiosk-checks' : 'checks', kiosk ? 'בדיקות הרגרסיה של הקיוסק (check:kiosk-* ו־verify:kiosk-*)' : 'בדיקות הרגרסיה הקיימות (check:* ו־verify:*)')
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const scripts = Object.keys(pkg.scripts).filter((s) => /^(check|verify):/.test(s) && /kiosk/.test(s) === kiosk).sort()
  const browser = browserPath()
  for (const name of scripts) {
    const category = name.startsWith('verify:') ? 'sql' : /security/.test(name) ? 'security' : 'regression'
    // Run in another stage (named in NEEDS), so not listed here: a "skipped" line would read as a risk in every morning review.
    if (NEEDS[name] && !process.env.QA_ALL) continue
    if (name === 'check:a11y-scope' && widgetStandIn(root)) { stage.skip(name, name, category, 'the real a11y-widget package is not installed on this machine (stand-in); GitHub Actions runs it'); continue }
    stage.test(name, name, category, async () => {
      const r = await npm(['run', '-s', name], { cwd: root, timeout: 600_000, env: { TEST_BROWSER: browser ?? '', EDGE_PATH: browser ?? '', CI: '1', JAVA_HOME: javaHome() } })
      if (r.code !== 0 && !browser && ENV_SKIP.some((re) => re.test(r.output))) throw Object.assign(new Error('SKIP: needs Windows Edge'), { skip: true })
      const summary = (r.output.match(/(\d+)\s+(?:passed|pass|checks?)[^\n]*/i) ?? [])[0] ?? ''
      assert.ok(r.code === 0, `exit ${r.code}. ${r.output.split('\n').filter((l) => /✗|FAIL|fail|Error/.test(l)).slice(0, 4).join(' | ').slice(0, 450) || r.output.slice(-300)}`)
      stage.counts = { ...(stage.counts ?? {}), [name]: summary }
    }, { retry: false, timeout: 620_000 })
  }
  return stage
}
