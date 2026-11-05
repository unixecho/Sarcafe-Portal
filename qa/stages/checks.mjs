// Stage 2 — every existing check:* and verify:* script (the project's regression net, 30+ scripts written over many sessions).
// Each is one test here. A script that needs something this machine does not have (Windows Edge for the kiosk checks, a fixture
// copy for the scroller) is SKIPPED with the reason, never silently passed.
import fs from 'node:fs'
import path from 'node:path'
import { createStage, assert } from '../lib/harness.mjs'
import { run } from '../lib/exec.mjs'

// check:shift-scroller needs a running copy serving its fixture page: the live stage runs it (qa/live/ui.mjs, 'carousel').
const NEEDS = {
  'check:shift-scroller': 'runs in the live stage against the built copy (see ui.carousel)',
}
// The real a11y-widget source is read by check:a11y-scope; a machine that could only install the stand-in cannot run it.
const widgetStandIn = (root) => { try { return /STAND-IN/i.test(fs.readFileSync(path.join(root, 'node_modules/a11y-widget/package.json'), 'utf8')) } catch { return false } }
const ENV_SKIP = [/Edge (?:is )?not found|msedge|Cannot find Edge|EDGE.*undefined|executablePath.*undefined/i]

export function browserPath() {
  try {
    const { chromium } = require('playwright')
    const p = chromium.executablePath()
    if (p && fs.existsSync(p)) return p
  } catch { /* fall through */ }
  for (const p of [process.env.QA_CHROMIUM, '/opt/pw-browsers/chromium'].filter(Boolean)) if (fs.existsSync(p)) return p
  return undefined
}
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

// The plain-Java parts of the kiosk app (StaffPin, OtaRules, PinReset) are compiled and run by the kiosk checks with javac: they look
// for a JDK through JAVA_HOME, so it is pointed at the javac on this machine (GitHub's runners set JAVA_HOME themselves).
function javaHome() {
  if (process.env.JAVA_HOME) return process.env.JAVA_HOME
  try { const javac = fs.realpathSync('/usr/bin/javac'); return path.dirname(path.dirname(javac)) } catch { return '' }
}

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
      const r = await run('npm', ['run', '-s', name], { cwd: root, timeout: 600_000, env: { TEST_BROWSER: browser ?? '', EDGE_PATH: browser ?? '', CI: '1', JAVA_HOME: javaHome() } })
      if (r.code !== 0 && ENV_SKIP.some((re) => re.test(r.output))) throw Object.assign(new Error('SKIP: needs Windows Edge'), { skip: true })
      const summary = (r.output.match(/(\d+)\s+(?:passed|pass|checks?)[^\n]*/i) ?? [])[0] ?? ''
      assert.ok(r.code === 0, `exit ${r.code}. ${r.output.split('\n').filter((l) => /✗|FAIL|fail|Error/.test(l)).slice(0, 4).join(' | ').slice(0, 450) || r.output.slice(-300)}`)
      stage.counts = { ...(stage.counts ?? {}), [name]: summary }
    }, { retry: false, timeout: 620_000 })
  }
  return stage
}
