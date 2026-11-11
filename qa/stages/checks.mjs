// Stage 2 — every existing check:* and verify:* script (the project's regression net, 30+ scripts written over many sessions).
// Each is one test here. A script that needs something this machine does not have (Windows Edge for the kiosk checks, a fixture
// copy for the scroller) is SKIPPED with the reason, never silently passed.
import fs from 'node:fs'
import path from 'node:path'
import { createStage, assert } from '../lib/harness.mjs'
import { npm } from '../lib/exec.mjs'
import { findJdk } from '../lib/jdk.mjs'
import { browserPath, browserProblems } from '../lib/browser.mjs'

// check:shift-scroller needs a running copy serving its fixture page: the live stage runs it (qa/live/ui.mjs, 'carousel').
const NEEDS = {
  'check:shift-scroller': 'runs in the live stage against the built copy (see ui.carousel)',
}
// The real a11y-widget source is read by check:a11y-scope; a machine that could only install the stand-in cannot run it.
const widgetStandIn = (root) => { try { return /STAND-IN/i.test(fs.readFileSync(path.join(root, 'node_modules/a11y-widget/package.json'), 'utf8')) } catch { return false } }
// Only when this machine has NO browser at all: then a script falls back to Windows Edge and cannot run elsewhere. A browser that is
// installed but was rejected by the probe (qa/lib/browser.mjs), or a launch error with the suite's own browser, is a FAILURE with the
// reason, never this skip (it used to be: Chromium's own flags contain "msEdge", and a failed probe was accepted).
const ENV_SKIP = [/Edge (?:is )?not found|msedge|Cannot find Edge|EDGE.*undefined|executablePath.*undefined/i]
export { browserPath, browserProblems }

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
  const rejected = browserProblems()
  for (const name of scripts) {
    const category = name.startsWith('verify:') ? 'sql' : /security/.test(name) ? 'security' : 'regression'
    // Run in another stage (named in NEEDS), so not listed here: a "skipped" line would read as a risk in every morning review.
    if (NEEDS[name] && !process.env.QA_ALL) continue
    if (name === 'check:a11y-scope' && widgetStandIn(root)) { stage.skip(name, name, category, 'the real a11y-widget package is not installed on this machine (stand-in); GitHub Actions runs it'); continue }
    stage.test(name, name, category, async () => {
      const r = await npm(['run', '-s', name], { cwd: root, timeout: 600_000, env: { TEST_BROWSER: browser ?? '', EDGE_PATH: browser ?? '', CI: '1', JAVA_HOME: javaHome() } })
      const wantsBrowser = r.code !== 0 && !browser && ENV_SKIP.some((re) => re.test(r.output))
      if (wantsBrowser && rejected.length === 0) throw Object.assign(new Error('SKIP: needs Windows Edge'), { skip: true })
      if (wantsBrowser) assert.ok(false, `no browser on this machine works: ${rejected.join(' | ').slice(0, 450)}`)
      const summary = (r.output.match(/(\d+)\s+(?:passed|pass|checks?)[^\n]*/i) ?? [])[0] ?? ''
      assert.ok(r.code === 0, `exit ${r.code}. ${r.output.split('\n').filter((l) => /✗|FAIL|fail|Error/.test(l)).slice(0, 4).join(' | ').slice(0, 450) || r.output.slice(-300)}`)
      stage.counts = { ...(stage.counts ?? {}), [name]: summary }
    }, { retry: false, timeout: 620_000 })
  }
  return stage
}
