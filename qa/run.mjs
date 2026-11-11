#!/usr/bin/env node
// The automatic QA suite (docs/QA_BLUEPRINT.md). Two suites, two reports: the dashboard (qa/reports/latest.{json,md}) and the kiosk
// (qa/reports/kiosk-latest.{json,md}). With --post both go to the developer's morning review (/staff/dev/qa).
//
//   npm run qa                        everything (static, regression checks, unit, security, features, screens, survival)
//   npm run qa -- --only static,unit  some stages
//   npm run qa -- --fast              skip the existing regression scripts (the slowest part)
//   npm run qa -- --reuse-build       keep the last production build in qa/.work (after a change, rebuild!)
//   npm run qa -- --suite kiosk       one suite (dashboard | kiosk); both by default, two reports
//   npm run qa -- --post              also post the reports (in GitHub Actions: GitHub's identity token; by hand: QA_REPORT_SECRET)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { harnessStage } from './stages/harness.mjs'
import { staticStage } from './stages/static.mjs'
import { checksStage } from './stages/checks.mjs'
import { resolveBrowser } from './lib/browser.mjs'
import { unitStage } from './stages/unit.mjs'
import { startLive } from './live/app.mjs'
import { securityStage } from './live/security.mjs'
import { featuresStage } from './live/features.mjs'
import { uiStage } from './live/ui.mjs'
import { survivalStage } from './live/survival.mjs'
import { kioskStaticStage } from './kiosk/static.mjs'
import { kioskApiStage } from './kiosk/api.mjs'
import { kioskUiStage } from './kiosk/ui.mjs'
import { buildReport, writeReport } from './lib/report.mjs'
import { run, npmCli } from './lib/exec.mjs'
import { findJdk } from './lib/jdk.mjs'
import { qaCredential } from './lib/github-token.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const value = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined }
const only = value('only')?.split(',')
const want = (id) => !only || only.includes(id)
const startedAt = new Date().toISOString()
const source = value('source') ?? (process.env.GITHUB_EVENT_NAME === 'schedule' ? 'schedule' : process.env.GITHUB_EVENT_NAME === 'push' ? 'push' : process.env.CI ? 'manual' : 'local')

const reportsDir = path.join(ROOT, 'qa/reports')
// Two suites, two reports (owner, 2026-11-05): the dashboard (the portal) and the kiosk (the tablet: its page, APIs and app). One run
// builds the app once and runs both; `--suite dashboard|kiosk` runs one. Each report is compared with that suite's previous one.
const SUITES = { dashboard: 'latest.json', kiosk: 'kiosk-latest.json' }
const suiteArg = value('suite')
const wantSuite = (s) => !suiteArg || suiteArg === s
const readPrevious = (file) => { try { return JSON.parse(fs.readFileSync(path.join(reportsDir, file), 'utf8')) } catch { return null } }

const results = { dashboard: [], kiosk: [] }
const metrics = { audit: null, perf: null, contrastLowest: null }
const kioskMetrics = { audit: null, perf: null, contrastLowest: null }
const banner = (s) => console.log(`\n━━ ${s.title}`)

async function runStage(stage, suite = 'dashboard') { banner(stage); const r = await stage.run(); results[suite].push(r); return r }

// what this run really ran on (docs/QA_BLUEPRINT.md, "Machines"): said at the top of every log, never assumed
{
  const jdk = findJdk()
  const { browser, problems } = await resolveBrowser() // chosen once, before any stage: the first browser that proves it works
  console.log(`QA on ${process.platform} ${process.arch} · Node ${process.version} · npm ${npmCli() ?? '(the npm on the PATH)'} · JDK ${jdk ? `${jdk.version} (${jdk.home})` : 'none found: the Java tests will be skipped'}`)
  console.log(`Browser: ${browser ?? (problems.length ? 'none works (see below): the browser tests will FAIL' : 'none found: the browser tests cannot run (npx playwright install chromium)')}`)
  for (const p of problems) console.log(`  ! ${p}`)
}

if (wantSuite('dashboard')) {
  if (want('harness')) await runStage(harnessStage(ROOT))
  if (want('static')) { const s = staticStage(ROOT); await runStage(s); metrics.audit = s.audit ?? null }
  if (want('checks') && !flag('fast')) await runStage(checksStage(ROOT, 'dashboard'))
  if (want('unit')) await runStage(unitStage(ROOT))
}
if (wantSuite('kiosk')) {
  if (want('kiosk-static')) await runStage(kioskStaticStage(ROOT), 'kiosk')
  if (want('kiosk-checks') && !flag('fast')) await runStage(checksStage(ROOT, 'kiosk'), 'kiosk')
}

const liveStages = [
  ...(wantSuite('dashboard') ? ['security', 'features', 'ui', 'survival'] : []),
  ...(wantSuite('kiosk') ? ['kiosk-api', 'kiosk-ui'] : []),
].filter(want)
if (liveStages.length) {
  let live = null
  try {
    console.log('\n━━ האפליקציה הרצה: בנייה והפעלה מול Supabase מדומה')
    live = await startLive(ROOT, { reuseBuild: flag('reuse-build') })
    const get = () => live
    if (liveStages.includes('security')) await runStage(securityStage(ROOT, get))
    if (liveStages.includes('features')) await runStage(featuresStage(get))
    if (liveStages.includes('ui')) await runStage(uiStage(get, metrics))
    if (liveStages.includes('survival')) await runStage(survivalStage(get))
    if (liveStages.includes('kiosk-api')) await runStage(kioskApiStage(get), 'kiosk')
    if (liveStages.includes('kiosk-ui')) await runStage(kioskUiStage(get, kioskMetrics), 'kiosk')
  } catch (err) {
    console.error(String(err?.stack ?? err).slice(0, 3000))
    const failure = { id: 'live', title: 'האפליקציה הרצה', status: 'fail', durationMs: 0, tests: [{ id: 'live.start', title: 'בניית האפליקציה והפעלתה', status: 'fail', category: 'e2e', durationMs: 0, detail: String(err?.message ?? err).slice(0, 580) }] }
    for (const suite of Object.keys(results)) if (wantSuite(suite)) results[suite].push(failure)
  } finally { await live?.stop() }
}

const commit = (await run('git', ['rev-parse', 'HEAD'], { cwd: ROOT })).output.trim().slice(0, 40)
const ref = process.env.GITHUB_REF_NAME ?? (await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT })).output.trim()
const reports = []
for (const [suite, file] of Object.entries(SUITES)) {
  if (!wantSuite(suite) || results[suite].length === 0) continue
  const report = buildReport({ suite, stages: results[suite], startedAt, source, commit: /^[0-9a-f]{40}$/.test(commit) ? commit : null, ref: ref.slice(0, 120) || null, host: process.env.GITHUB_ACTIONS ? 'github-actions' : 'local', metrics: suite === 'kiosk' ? kioskMetrics : metrics, previous: readPrevious(file) })
  const md = writeReport(reportsDir, report)
  console.log(`\n${md}\n`)
  reports.push({ report, md })
}

// Posting: in GitHub Actions with GitHub's own short-lived identity token, asked for right before each post (qa/lib/github-token.mjs,
// src/lib/qa/auth.ts); a manual post uses QA_REPORT_SECRET. The address defaults to production.
if (flag('post')) {
  const url = process.env.QA_REPORT_URL || 'https://sarcafe-portal.vercel.app/api/qa/report'
  for (const { report } of reports) {
    const token = await qaCredential()
    if (!token) { console.log('No GitHub identity token and no QA_REPORT_SECRET: the reports were not posted.'); break }
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(report) }).catch((err) => ({ ok: false, status: 0, text: async () => String(err) }))
    console.log(`posted the ${report.suite} report: HTTP ${res.status} ${res.ok ? '' : (await res.text()).slice(0, 300)}`)
  }
}
if (process.env.GITHUB_STEP_SUMMARY) for (const { md } of reports) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n')
process.exit(reports.some(({ report }) => report.status === 'fail') ? 1 : 0)
