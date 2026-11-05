// The live app for the QA suite: a production build of THIS checkout, started against the stand-in Supabase, plus helpers to call it
// as anyone (signed out, owner, developer, general manager, employee) and a browser. Never touches the real project.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { startStandin, sessionCookie } from '../standin/supabase.mjs'
import { seed, tokenFor, userFor } from '../standin/seed.mjs'
import { run, start } from '../lib/exec.mjs'
import { browserPath } from '../stages/checks.mjs'

const require = createRequire(import.meta.url)
export const STANDIN_PORT = 54399
export const APP_PORT = 3399
export const SECRETS = { CRON_SECRET: 'qa-cron-secret-0123456789', QA_REPORT_SECRET: 'qa-report-secret-0123456789' }

const SKIP = new Set(['node_modules', '.next', '.git', 'qa', '.vercel'])
function copyTree(from, to, top = true) {
  fs.mkdirSync(to, { recursive: true })
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (top && SKIP.has(e.name)) continue
    if (e.name === 'node_modules' || e.name === '.next') continue
    const a = path.join(from, e.name), b = path.join(to, e.name)
    if (e.isDirectory()) copyTree(a, b, false)
    else if (e.isFile()) fs.copyFileSync(a, b)
  }
}

export async function startLive(root, { log = console.log, reuseBuild = false } = {}) {
  const work = path.join(root, 'qa/.work/app')
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${STANDIN_PORT}`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'qa-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'qa-service-role-key',
    RATE_LIMIT_KEY_SECRET: 'qa-rate-limit-secret',
    NEXT_TELEMETRY_DISABLED: '1',
    ...SECRETS,
  }
  const standin = await startStandin({ port: STANDIN_PORT, seed })
  const built = reuseBuild && fs.existsSync(path.join(work, '.next/BUILD_ID'))
  if (!built) {
    log('  building the app against the stand-in (production build)…')
    fs.rmSync(work, { recursive: true, force: true })
    copyTree(root, work)
    fs.mkdirSync(path.join(work, 'qa/reports'), { recursive: true })
    fs.copyFileSync(path.join(root, 'qa/reports/latest.json'), path.join(work, 'qa/reports/latest.json'))
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(work, 'node_modules'), 'dir')
    // the carousel's own browser check needs its throwaway fixture page: only ever in this scratch copy
    await run('node', [path.join(root, 'scripts/check-shift-scroller.mjs'), '--write-fixture', work], { cwd: root, timeout: 30_000 })
    // --profile: a production build whose React <Profiler> still reports renders (check:shift-scroller counts renders per swipe;
    // in a plain production build onRender never fires and the count reads NaN). Everything else is the real production build.
    const b = await run('npx', ['next', 'build', '--profile'], { cwd: work, env, timeout: 900_000 })
    if (b.code !== 0) { await standin.close(); throw new Error(`next build failed:\n${b.output.slice(-3000)}`) }
  }
  const server = start('npx', ['next', 'start', '-p', String(APP_PORT), '-H', '127.0.0.1'], { cwd: work, env: { ...env, NODE_ENV: 'production' }, readyRe: /Ready in|started server|Local:/i, timeout: 120_000 })
  await server.ready
  const base = `http://127.0.0.1:${APP_PORT}`
  // warm up: the first request compiles nothing in production, but it opens the route cache
  await fetch(`${base}/login`).catch(() => null)

  const { chromium } = require('playwright')
  const executablePath = browserPath()
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })

  const cookieFor = (who) => (who ? sessionCookie(standin.url, tokenFor(who), userFor(who), `refresh-${who}`) : null)
  /** fetch the app as someone. opts: { as, method, body, origin (true = same site), headers } */
  async function call(pathname, opts = {}) {
    const headers = { ...(opts.headers ?? {}) }
    const c = cookieFor(opts.as)
    if (c) headers.cookie = `${c.name}=${c.value}`
    if (opts.body !== undefined) { headers['content-type'] ??= 'application/json'; }
    if (opts.origin === true) headers.origin = base
    else if (typeof opts.origin === 'string') headers.origin = opts.origin
    const res = await fetch(base + pathname, { method: opts.method ?? 'GET', headers, body: opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body), redirect: 'manual' })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* not JSON */ }
    return { status: res.status, headers: res.headers, text, json }
  }
  /** A browser page as someone. `askBranch: true` keeps the once-per-login "which branch?" sheet; by default it was already answered. */
  async function page(who, { width = 390, height = 844, theme, reducedMotion = 'no-preference', askBranch = false } = {}) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, locale: 'he-IL', timezoneId: 'Asia/Jerusalem', reducedMotion })
    // The install sheet ("add to the home screen", shown once in a plain browser) is marked as seen, so it does not cover the screen under test.
    await context.addInitScript(() => { try { localStorage.setItem('sarcafe:staff-install-intro:v1', 'seen') } catch { /* private */ } })
    if (!askBranch) await context.addInitScript(() => { try { sessionStorage.setItem('sarcafe:dashboard-branch-confirmed', '1') } catch { /* private */ } })
    const c = cookieFor(who)
    const cookies = c ? [{ name: c.name, value: c.value, domain: '127.0.0.1', path: '/' }] : []
    if (theme) cookies.push({ name: 'sarcafe_staff_theme', value: theme, domain: '127.0.0.1', path: '/' })
    if (cookies.length) await context.addCookies(cookies)
    const p = await context.newPage()
    const errors = []
    p.on('pageerror', (e) => errors.push(String(e).slice(0, 300)))
    p.on('console', (msg) => { if (msg.type() === 'error' && !/favicon|fonts\.g|ERR_|net::|Failed to load resource|hydrat/i.test(msg.text())) errors.push(msg.text().slice(0, 300)) })
    return { page: p, context, errors, close: () => context.close() }
  }
  const control = async (pathname, body) => (await fetch(standin.url + pathname, { method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body) })).json()

  return {
    base, standin, browser, call, page, control,
    db: (table) => standin.db[table] ?? [],
    reset: () => standin.reset(),
    async stop() { await browser.close().catch(() => null); server.stop(); await standin.close().catch(() => null) },
    logs: server.logs,
  }
}
