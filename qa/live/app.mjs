// The live app for the QA suite: a production build of THIS checkout, started against the stand-in Supabase, plus helpers to call it
// as anyone (signed out, owner, developer, general manager, employee) and a browser. Never touches the real project.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { startStandin, sessionCookie } from '../standin/supabase.mjs'
import { seed, tokenFor, userFor } from '../standin/seed.mjs'
import { run, start, NODE, packageBin } from '../lib/exec.mjs'
import { workDir, removeScratch, copySource, linkDependencies, sourceFingerprint, assertPortFree } from '../lib/scratch.mjs'
import { resolveBrowser } from '../lib/browser.mjs'

const require = createRequire(import.meta.url)
export const STANDIN_PORT = 54399
export const APP_PORT = 3399
export const SECRETS = { CRON_SECRET: 'qa-cron-secret-0123456789', QA_REPORT_SECRET: 'qa-report-secret-0123456789', KIOSK_SIGNUP_KEY: 'qa-kiosk-key-0123456789' }
// GitHub's token signer, played by the stand-in (lib/qa/auth.ts reads <issuer>/.well-known/jwks): tests sign with signToken()
export const OIDC_ISSUER = `http://127.0.0.1:54399/__qa`

// The fingerprint of the source a build in qa/.work was made from (qa/lib/scratch.mjs sourceFingerprint), kept beside the build.
const STAMP = '.qa-source'

export async function startLive(root, { log = console.log, reuseBuild = false } = {}) {
  const work = workDir(root, 'app')
  // The test app's whole world: the stand-in and made-up keys. It is started with the operating system's variables only
  // (cleanEnv), so a real project address, key or provider setting in the developer's shell can never reach it.
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${STANDIN_PORT}`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'qa-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'qa-service-role-key',
    QA_OIDC_ISSUER: OIDC_ISSUER,
    RATE_LIMIT_KEY_SECRET: 'qa-rate-limit-secret',
    NEXT_TELEMETRY_DISABLED: '1',
    ...SECRETS,
  }
  const next = packageBin(root, 'next')
  // a server left over from an earlier run would answer for this one (an OLD build passing or failing today's tests): refuse to start
  await assertPortFree(STANDIN_PORT, 'the stand-in Supabase')
  await assertPortFree(APP_PORT, 'the test app')

  // Everything started from here on is closed again when a later step fails: nothing is left running or listening.
  let standin = null, server = null, browser = null
  const closeAll = async () => {
    await browser?.close().catch(() => null)
    await server?.stop().catch(() => null)
    await standin?.close().catch(() => null)
  }
  try {
    standin = await startStandin({ port: STANDIN_PORT, seed })
    const fingerprint = sourceFingerprint(root)
    let built = false
    if (reuseBuild) {
      let stamp = null
      try { stamp = fs.readFileSync(path.join(work, STAMP), 'utf8').trim() } catch { /* no build yet */ }
      built = stamp === fingerprint && fs.existsSync(path.join(work, '.next/BUILD_ID'))
      // a kept build is only kept when it was made from exactly this source: a stale one would test yesterday's app
      if (!built) log(stamp ? '  --reuse-build: the source changed since the last build, building again' : '  --reuse-build: no finished build to keep, building')
    }
    if (!built) {
      log('  building the app against the stand-in (production build)…')
      removeScratch(root, work)
      const copied = copySource(root, work)
      log(`  ${copied} source files copied to qa/.work/app`)
      fs.mkdirSync(path.join(work, 'qa/reports'), { recursive: true })
      for (const f of ['latest.json', 'kiosk-latest.json']) fs.copyFileSync(path.join(root, 'qa/reports', f), path.join(work, 'qa/reports', f))
      linkDependencies(root, work)
      // the carousel's own browser check needs its throwaway fixture page: only ever in this scratch copy
      const fixture = await run(NODE, [path.join(root, 'scripts/check-shift-scroller.mjs'), '--write-fixture', work], { cwd: root, timeout: 30_000 })
      if (fixture.code !== 0) throw new Error(`the carousel fixture was not written:\n${fixture.output.slice(-600)}`)
      // --profile: a production build whose React <Profiler> still reports renders (check:shift-scroller counts renders per swipe;
      // in a plain production build onRender never fires and the count reads NaN). Everything else is the real production build.
      const b = await run(NODE, [next, 'build', '--profile'], { cwd: work, env, cleanEnv: true, timeout: 900_000 })
      if (b.code !== 0) throw new Error(`next build failed:\n${b.output.slice(-3000)}`)
      fs.writeFileSync(path.join(work, STAMP), fingerprint + '\n')
    }
    server = start(NODE, [next, 'start', '-p', String(APP_PORT), '-H', '127.0.0.1'], { cwd: work, env: { ...env, NODE_ENV: 'production' }, cleanEnv: true, readyRe: /Ready in|started server|Local:/i, timeout: 120_000 })
    await server.ready
    const { chromium } = require('playwright')
    const { browser: executablePath, problems } = await resolveBrowser()
    if (!executablePath && problems.length) throw new Error(`no browser on this machine works: ${problems.join(' | ')}`)
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
  } catch (err) {
    await closeAll()
    throw err
  }
  const base = `http://127.0.0.1:${APP_PORT}`
  // warm up: the first request compiles nothing in production, but it opens the route cache
  await fetch(`${base}/login`).catch(() => null)

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
  // `iphone: true` gives the page an iPhone's safe areas (59 px under the status bar and notch, 34 px over the home indicator), as
  // on a real phone with viewport-fit=cover. Plain Chromium has none, which is how a top bar sitting 59 px over the first card was missed.
  async function page(who, { width = 390, height = 844, theme, reducedMotion = 'no-preference', askBranch = false, iphone = false } = {}) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, locale: 'he-IL', timezoneId: 'Asia/Jerusalem', reducedMotion })
    // The install sheet ("add to the home screen", shown once in a plain browser) is marked as seen, so it does not cover the screen under test.
    await context.addInitScript(() => { try { localStorage.setItem('sarcafe:staff-install-intro:v1', 'seen') } catch { /* private */ } })
    if (!askBranch) await context.addInitScript(() => { try { sessionStorage.setItem('sarcafe:dashboard-branch-confirmed', '1') } catch { /* private */ } })
    const c = cookieFor(who)
    const cookies = c ? [{ name: c.name, value: c.value, domain: '127.0.0.1', path: '/' }] : []
    if (theme) cookies.push({ name: 'sarcafe_staff_theme', value: theme, domain: '127.0.0.1', path: '/' })
    if (cookies.length) await context.addCookies(cookies)
    const p = await context.newPage()
    if (iphone) await (await context.newCDPSession(p)).send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 59, bottom: 34, left: 0, right: 0 } })
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
    stop: closeAll,
    logs: server.logs,
  }
}
