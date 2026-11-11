// The browser every browser test uses: the first candidate that EXISTS AND PROVES IT WORKS on this machine.
//
// "Works" is a bounded readiness check, not "a process could be created": the browser is started the way the suite will start it
// (Playwright, headless: qa/lib/browser-probe.mjs, in its own process), must render a test page, give its title back and end with
// exit 0, all inside the time limit. A non-zero exit, a time-out, a start error or an exit without the rendered page each REJECT the
// candidate with a recorded reason, and the next candidate is tried (Codex review R2, 2026-11-12: status 23 and ETIMEDOUT used to
// be accepted). A probe that runs out of time is ended with everything it started (run() in exec.mjs).
//
// Why not the browser's own `--dump-dom`: on Windows the installed Edge hands the page to another process and its launcher exits 0
// at once with nothing printed, so a command-line probe cannot tell a working Edge from a broken one.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { run, NODE } from './exec.mjs'

const require = createRequire(import.meta.url)
export const PROBE_MARK = 'qa-browser-probe-ok'
const PROBE_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'browser-probe.mjs')
const lastLine = (s) => s.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('[qa]')).pop()?.slice(0, 300) ?? ''
const isFile = (p) => { try { return fs.statSync(p).isFile() } catch { return false } }
/** The probe's command for a browser: [program, arguments]. The tests replace it to play browsers that fail in each way. */
const realCommand = (exe) => [NODE, [PROBE_SCRIPT, exe, PROBE_MARK]]

/** Checks that the browser at `exe` works. Resolves { ok: true } or { ok: false, reason }; never throws. */
export async function probeBrowser(exe, { timeout = 45_000, command = realCommand } = {}) {
  const [cmd, args] = command(exe)
  const r = await run(cmd, args, { timeout })
  if (r.spawnError) return { ok: false, reason: `does not start: ${r.spawnError}` }
  if (r.timedOut) return { ok: false, reason: `gave no answer within ${timeout} ms (stopped, with everything it started)` }
  if (r.code !== 0) return { ok: false, reason: `exited with ${r.code}${lastLine(r.output) ? `: ${lastLine(r.output)}` : ''}` }
  if (!r.output.includes(PROBE_MARK)) return { ok: false, reason: 'exited 0 without rendering the test page' }
  return { ok: true }
}

/**
 * The first candidate (a path) that is a file and passes the probe. Resolves { browser: path | null, problems: [text] }: one line
 * for every installed candidate that was rejected, with the reason. A candidate that is not installed is passed over silently.
 */
export async function selectBrowser(candidates, { probe = probeBrowser } = {}) {
  const problems = []
  for (const exe of candidates) {
    if (!exe || !isFile(exe)) continue
    const r = await probe(exe)
    if (r.ok) return { browser: exe, problems }
    problems.push(`${exe} is installed but is not usable: ${r.reason}`)
  }
  return { browser: null, problems }
}

// Playwright's own Chromium first (what GitHub Actions uses); then QA_CHROMIUM and the container's copy; on Windows, last, the
// installed Edge, which is what the check:* scripts use there when run by hand.
function candidates() {
  const list = []
  try { list.push(require('playwright').chromium.executablePath()) } catch { /* playwright is not installed */ }
  list.push(process.env.QA_CHROMIUM, '/opt/pw-browsers/chromium')
  if (process.platform === 'win32') for (const base of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles]) if (base) list.push(path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
  return list
}

let resolving
let resolved
/** Chooses this run's browser once. Resolves { browser, problems } (see selectBrowser). */
export function resolveBrowser() {
  resolving ??= selectBrowser(candidates()).then((r) => (resolved = r))
  return resolving
}
const need = () => { if (!resolved) throw new Error('the browser was not chosen yet: await resolveBrowser() first (qa/lib/browser.mjs)'); return resolved }
/** This run's browser (undefined when none works). resolveBrowser() must have finished. */
export const browserPath = () => need().browser ?? undefined
/** Browsers found on this machine that were rejected, each with the reason. resolveBrowser() must have finished. */
export const browserProblems = () => [...need().problems]
