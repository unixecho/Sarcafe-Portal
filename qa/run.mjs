#!/usr/bin/env node
// The automatic QA suite (docs/QA_BLUEPRINT.md). Runs every stage, writes qa/reports/latest.{json,md} and, with --post, sends the
// report to the portal's morning review (/staff/dev/qa) with QA_REPORT_SECRET.
//
//   npm run qa                        everything (static, regression checks, unit, security, features, screens, survival)
//   npm run qa -- --only static,unit  some stages
//   npm run qa -- --fast              skip the existing regression scripts (the slowest part)
//   npm run qa -- --reuse-build       keep the last production build in qa/.work (after a change, rebuild!)
//   npm run qa -- --post              also post the report (CI: QA_REPORT_URL + QA_REPORT_SECRET)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { staticStage } from './stages/static.mjs'
import { checksStage } from './stages/checks.mjs'
import { unitStage } from './stages/unit.mjs'
import { startLive } from './live/app.mjs'
import { securityStage } from './live/security.mjs'
import { featuresStage } from './live/features.mjs'
import { uiStage } from './live/ui.mjs'
import { survivalStage } from './live/survival.mjs'
import { buildReport, writeReport } from './lib/report.mjs'
import { run } from './lib/exec.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const value = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined }
const only = value('only')?.split(',')
const want = (id) => !only || only.includes(id)
const startedAt = new Date().toISOString()
const source = value('source') ?? (process.env.GITHUB_EVENT_NAME === 'schedule' ? 'schedule' : process.env.GITHUB_EVENT_NAME === 'push' ? 'push' : process.env.CI ? 'manual' : 'local')

const reportsDir = path.join(ROOT, 'qa/reports')
let previous = null
try { previous = JSON.parse(fs.readFileSync(path.join(reportsDir, 'latest.json'), 'utf8')) } catch { /* first run */ }

const results = []
const metrics = { audit: null, perf: null, contrastLowest: null }
const banner = (s) => console.log(`\n━━ ${s.title}`)

async function runStage(stage) { banner(stage); const r = await stage.run(); results.push(r); return r }

if (want('static')) { const s = staticStage(ROOT); await runStage(s); metrics.audit = s.audit ?? null }
if (want('checks') && !flag('fast')) await runStage(checksStage(ROOT))
if (want('unit')) await runStage(unitStage(ROOT))

const liveStages = ['security', 'features', 'ui', 'survival'].filter(want)
if (liveStages.length) {
  let live = null
  try {
    console.log('\n━━ האפליקציה הרצה: בנייה והפעלה מול Supabase מדומה')
    live = await startLive(ROOT, { reuseBuild: flag('reuse-build') })
    const get = () => live
    if (want('security')) await runStage(securityStage(ROOT, get))
    if (want('features')) await runStage(featuresStage(get))
    if (want('ui')) await runStage(uiStage(get, metrics))
    if (want('survival')) await runStage(survivalStage(get))
  } catch (err) {
    console.error(String(err?.stack ?? err).slice(0, 3000))
    results.push({ id: 'live', title: 'האפליקציה הרצה', status: 'fail', durationMs: 0, tests: [{ id: 'live.start', title: 'בניית האפליקציה והפעלתה', status: 'fail', category: 'e2e', durationMs: 0, detail: String(err?.message ?? err).slice(0, 580) }] })
  } finally { await live?.stop() }
}

const commit = (await run('git', ['rev-parse', 'HEAD'], { cwd: ROOT })).output.trim().slice(0, 40)
const ref = process.env.GITHUB_REF_NAME ?? (await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT })).output.trim()
const report = buildReport({ stages: results, startedAt, source, commit: /^[0-9a-f]{40}$/.test(commit) ? commit : null, ref: ref.slice(0, 120) || null, host: process.env.GITHUB_ACTIONS ? 'github-actions' : 'local', metrics, previous })
const md = writeReport(reportsDir, report)
console.log(`\n${md}\n`)

if (flag('post')) {
  const url = process.env.QA_REPORT_URL
  const secret = process.env.QA_REPORT_SECRET
  if (!url || !secret) console.log('QA_REPORT_URL / QA_REPORT_SECRET not set: the report was not posted.')
  else {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` }, body: JSON.stringify(report) }).catch((err) => ({ ok: false, status: 0, text: async () => String(err) }))
    console.log(`posted the report: HTTP ${res.status} ${res.ok ? '' : await res.text()}`)
  }
}
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n')
process.exit(report.status === 'fail' ? 1 : 0)
