// Stage 1 — static: things that are wrong before anything runs. Types, the database rules from CLAUDE.md, secrets in git, known
// vulnerable dependencies, and that every API route is guarded (or is on the reviewed public list below).
import fs from 'node:fs'
import path from 'node:path'
import { createStage, assert } from '../lib/harness.mjs'
import { run, npm, NODE, packageBin } from '../lib/exec.mjs'

// Every route must name one of these guards, or be on PUBLIC with its reason. A new unguarded route fails the suite.
const GUARDS = /requireOwner|requireMenuEditor|requireAnyMenuEditor|resolveStaffIdentity|requireStaffIdentity|qaCallerAllowed|requireSchedule\w*|requirePublishedScheduleViewer|bearerMatches|privateStaffRoute|messengerFor|resolveTabletWrite|requireOrderStaff|performOrderDispatch|performDispatch|keysMatch|requirePos\w*|requireStaff\w*|getUser\(\)/
export const PUBLIC_ROUTES = {
  'auth/quick-login': 'the six-digit sign-in itself: credential rate limit, fails closed',
  'board/[token]': 'the cart board, opened by its secret token',
  'branches': 'public branch list for the portal (names, hours, links)',
  'feedback': 'customer suggestion box: GET answers only { enabled }, POST is same-origin, size-capped and rate limited',
  'kiosk/content': 'kiosk ads and hours, public by design',
  'kiosk/content/feedback': 'the QR poll answer, anonymous, rate limited',
  'kiosk/menu': 'the published menu snapshot',
  'kiosk/waitlist': 'kiosk loyalty sign-up, kiosk key + rate limit',
  'kiosk/pair': 'a fresh kiosk asks for a pairing and polls it with its own secret token (hashed); the short code only lets a signed-in owner pick it; 15 min, claimed once, rate limited',
  'kiosk/enroll': 'a newly installed kiosk trades its ONE-TIME install code (from the owner\'s QR, 24 h, hashed, used once) for its settings; rate limited, fails closed',
  'loyaltysignup': 'public loyalty sign-up: same-origin, HMAC form token, rate limit',
  'order/[token]': 'a customer order, by its secret token',
  'order/recover': 'customer order recovery, rate limited',
  'order/subscribe': 'customer order push, token-gated',
  'order/unsubscribe': 'customer order push, token-gated',
  'order/test-notification': 'customer push self-check, token-gated, rate limited',
}

// Known advisories that need a major upgrade, reviewed and accepted (docs/SECURITY_AUDIT_2026-10-28.md). They stay visible in the
// morning review; anything NOT on this list fails the suite. Review again when Next 16 / zod 4 are adopted.
export const ACCEPTED_ADVISORIES = {
  'GHSA-qx2v-qp2m-jg93': 'PostCSS inside Next 15 (build time only, our own CSS); fix = Next 16',
  'GHSA-6g55-p6wh-862q': 'PostCSS inside Next 15 (build time only, no user CSS); fix = Next 16',
  'GHSA-fxqj-rqcc-2cmp': 'PostCSS inside Next 15 (build time only, no user CSS); fix = Next 16',
  'GHSA-r28c-9q8g-f849': 'PostCSS inside Next 15 (build time only, no user CSS); fix = Next 16',
  'GHSA-mrhx-c7xc-m3w5': 'zod 3: every API body is size-capped before validation (parseBody 128 KB, QA report 600 KB); fix = zod 4',
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

/** Balanced-paren arguments of `create [or replace] function public.name(...)` and `drop function [if exists] public.name(...)`. */
function functionEvents(sql) {
  const events = []
  const re = /\b(create\s+(?:or\s+replace\s+)?function|drop\s+function\s+(?:if\s+exists\s+)?)\s*(?:public\.)?(\w+)\s*\(/gi
  let m
  while ((m = re.exec(sql))) {
    let depth = 1; let i = re.lastIndex; let args = ''
    while (i < sql.length && depth) { const ch = sql[i]; if (ch === '(') depth++; if (ch === ')') depth--; if (depth) args += ch; i++ }
    const types = args.split(',').map((a) => a.replace(/\bdefault\b.*$/is, '').replace(/=.*$/s, '').trim().split(/\s+/).filter((w) => !/^(in|out|inout|variadic)$/i.test(w))).map((w) => (w.length > 1 ? w.slice(1).join(' ') : w.join(' ')).toLowerCase().replace(/\s+/g, ' ')).filter(Boolean)
    events.push({ kind: /^drop/i.test(m[1]) ? 'drop' : 'create', name: m[2].toLowerCase(), sig: types.join(','), at: m.index })
  }
  // `alter function public.x(sig) rename to y` moves that signature from x to y (20261028120000 does this to sched_save_shift).
  for (const r of sql.matchAll(/alter\s+function\s+(?:public\.)?(\w+)\s*\(([^)]*)\)\s+rename\s+to\s+(\w+)/gi)) {
    const sig = r[2].split(',').map((t) => t.trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean).join(',')
    events.push({ kind: 'drop', name: r[1].toLowerCase(), sig, at: r.index }, { kind: 'create', name: r[3].toLowerCase(), sig, at: r.index })
  }
  return events.sort((a, b) => a.at - b.at)
}

export function staticStage(root) {
  const stage = createStage('static', 'בדיקה סטטית: טיפוסים, מסד נתונים, סודות ותלויות')
  const migDir = path.join(root, 'supabase/migrations')
  const migrations = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()

  stage.test('typecheck', 'TypeScript מתקמפל בלי שגיאות (tsc --noEmit)', 'static', async () => {
    const r = await run(NODE, [packageBin(root, 'typescript', 'tsc'), '--noEmit', '-p', '.'], { cwd: root, timeout: 300_000 })
    assert.ok(r.code === 0, r.output.split('\n').filter((l) => /error TS/.test(l)).slice(0, 5).join(' | ') || r.output.slice(-400))
  }, { retry: false, timeout: 320_000 })

  stage.test('migration-names', 'שמות המיגרציות לפי הכלל (YYYYMMDDHHMMSS_snake_case)', 'sql', async () => {
    const bad = migrations.filter((f) => !/^\d{3}_[a-z0-9_]+\.sql$/.test(f) && !/^\d{14}_[a-z0-9_]+\.sql$/.test(f))
    assert.deepEqual(bad, [], 'badly named:')
    const stamps = migrations.filter((f) => /^\d{14}_/.test(f)).map((f) => f.slice(0, 14))
    assert.equal(new Set(stamps).size, stamps.length, 'two migrations share a timestamp:')
  })

  stage.test('no-overloads', 'אין פונקציה עם שתי חתימות (PGRST203)', 'sql', async () => {
    const alive = new Map()
    for (const f of migrations) {
      for (const e of functionEvents(fs.readFileSync(path.join(migDir, f), 'utf8'))) {
        const set = alive.get(e.name) ?? new Set()
        if (e.kind === 'drop') set.delete(e.sig); else set.add(e.sig)
        alive.set(e.name, set)
      }
    }
    const twice = [...alive].filter(([, sigs]) => sigs.size > 1).map(([n, sigs]) => `${n}(${[...sigs].join(' | ')})`)
    assert.deepEqual(twice, [], 'overloaded:')
  })

  stage.test('functions-locked', 'כל פונקציה חדשה נעולה לדפדפן (revoke מ־public/anon/authenticated)', 'security', async () => {
    // Checked in the migration where a function FIRST appears: `create or replace` keeps the privileges it already had, and the
    // numbered history (000-024) locks its functions in bulk (024 revokes every sched_* in a loop). scripts/verify-*-sql check the real grants.
    const seen = new Set()
    const problems = []
    for (const f of migrations) {
      const sql = fs.readFileSync(path.join(migDir, f), 'utf8')
      for (const e of functionEvents(sql).filter((x) => x.kind === 'create')) {
        if (seen.has(e.name)) continue
        seen.add(e.name)
        if (!/^\d{14}_/.test(f) || f < '20261010000000' || e.name.startsWith('internal_')) continue
        const revoked = new RegExp(`revoke\\s+(all|execute)[^;]*function\\s+(public\\.)?${e.name}\\s*\\([^;]*from[^;]*public[^;]*anon[^;]*authenticated`, 'i').test(sql)
        const trigger = new RegExp(`function\\s+(public\\.)?${e.name}\\s*\\([^)]*\\)\\s*returns\\s+trigger`, 'i').test(sql)
        if (!revoked && !trigger) problems.push(`${f}: ${e.name}`)
      }
    }
    assert.deepEqual(problems, [], 'not revoked:')
  })

  stage.test('tables-rls', 'כל טבלה חדשה עם RLS', 'security', async () => {
    const problems = []
    for (const f of migrations.filter((x) => /^\d{14}_/.test(x))) {
      const sql = fs.readFileSync(path.join(migDir, f), 'utf8')
      for (const m of sql.matchAll(/create\s+table\s+if\s+not\s+exists\s+public\.(\w+)/gi)) {
        if (!new RegExp(`alter\\s+table\\s+public\\.${m[1]}\\s+enable\\s+row\\s+level\\s+security`, 'i').test(sql) && !new RegExp(`alter\\s+table\\s+public\\.[\\w, ]*${m[1]}[\\w, ]*\\s+enable`, 'i').test(sql)) problems.push(`${f}: ${m[1]}`)
      }
    }
    assert.deepEqual(problems, [], 'no RLS:')
  })

  stage.test('secrets', 'אין סודות בקבצים שבגיט', 'security', async () => {
    const r = await run('git', ['ls-files'], { cwd: root })
    const files = r.output.split('\n').filter((f) => f && !/\.(png|jpe?g|webp|gif|ico|woff2?|ttf|pdf|zip|apk|mp4|svg|lock)$/i.test(f) && !f.startsWith('qa/standin/'))
    const patterns = [
      ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
      ['Stripe live key', /\bsk_live_[0-9a-zA-Z]{16,}/],
      ['service role JWT', /eyJhbGciOi[\w-]{10,}\.eyJ[\w-]*cm9sZSI6InNlcnZpY2Vfcm9sZS[\w-]*\.[\w-]{20,}/],
      ['assigned secret', /\b(SUPABASE_SERVICE_ROLE_KEY|VAPID_PRIVATE_KEY|CRON_SECRET|QA_REPORT_SECRET|KIOSK_SIGNUP_KEY|RATE_LIMIT_KEY_SECRET)\s*=\s*['"]?[A-Za-z0-9_\-+/=.]{16,}/],
      ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
    ]
    const hits = []
    for (const f of files) {
      let text
      try { const st = fs.statSync(path.join(root, f)); if (st.size > 1_500_000) continue; text = fs.readFileSync(path.join(root, f), 'utf8') } catch { continue }
      for (const [label, re] of patterns) if (re.test(text)) hits.push(`${f} (${label})`)
    }
    assert.deepEqual(hits, [], 'possible secrets:')
  })

  stage.test('routes-guarded', 'כל נתיב API נעול או ברשימת הציבוריים שנבדקה', 'security', async () => {
    const routes = walk(path.join(root, 'src/app/api')).filter((f) => f.endsWith('route.ts'))
    const loose = []
    for (const f of routes) {
      const rel = path.relative(path.join(root, 'src/app/api'), path.dirname(f)).split(path.sep).join('/')
      if (PUBLIC_ROUTES[rel] || rel.startsWith('cron/')) continue
      if (!GUARDS.test(fs.readFileSync(f, 'utf8'))) loose.push(rel)
    }
    assert.deepEqual(loose, [], 'unguarded:')
  })

  // A browser component that reaches a Node-only module (node:crypto, server-only, …) breaks the production build — found the hard
  // way: the kiosk dashboard imported the PIN rules, which then also held the PIN hashing. Followed through every static "@/…" and
  // relative import (type-only imports are erased, so they are skipped), with the chain in the message.
  stage.test('client-boundary', 'רכיב דפדפן לא מגיע (גם לא דרך קבצים אחרים) לקוד שרץ רק בשרת (node:… / server-only)', 'static', async () => {
    const src = path.join(root, 'src')
    const files = walk(src).filter((f) => /\.(ts|tsx)$/.test(f))
    const text = new Map(files.map((f) => [f, fs.readFileSync(f, 'utf8')]))
    const resolve = (from, spec) => {
      const base = spec.startsWith('@/') ? path.join(src, spec.slice(2)) : path.resolve(path.dirname(from), spec)
      for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) if (text.has(c)) return c
      return null
    }
    const importsOf = (code) => [...code.matchAll(/^\s*(?:import|export)\s+(?!type\b)(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)].map((m) => m[1])
    const serverOnly = (code) => importsOf(code).find((s) => s.startsWith('node:') || s === 'server-only')
    const bad = []
    for (const [file, code] of text) {
      if (!/^\s*['"]use client['"]/.test(code)) continue
      const seen = new Map([[file, null]])
      const queue = [file]
      while (queue.length) {
        const f = queue.shift()
        const hit = serverOnly(text.get(f))
        if (hit) {
          const chain = []
          for (let x = f; x; x = seen.get(x)) chain.unshift(path.relative(root, x))
          bad.push(`${chain.join(' → ')} → ${hit}`)
          break
        }
        for (const spec of importsOf(text.get(f))) {
          if (!spec.startsWith('@/') && !spec.startsWith('.')) continue
          const next = resolve(f, spec)
          if (next && !seen.has(next)) { seen.set(next, f); queue.push(next) }
        }
      }
    }
    assert.deepEqual(bad, [], 'browser code that reaches server-only code:')
  })

  stage.test('npm-audit', 'אין חולשות קריטיות או גבוהות חדשות בספריות של הייצור (npm audit)', 'security', async () => {
    const r = await npm(['audit', '--omit=dev', '--json'], { cwd: root, timeout: 120_000 })
    let data
    try { data = JSON.parse(r.output.slice(r.output.indexOf('{'))) } catch { throw new Error(`npm audit gave no report: ${r.output.slice(-200)}`) }
    const v = data.metadata?.vulnerabilities ?? {}
    stage.audit = { critical: v.critical ?? 0, high: v.high ?? 0, moderate: v.moderate ?? 0, low: v.low ?? 0 }
    const serious = []
    for (const [pkg, info] of Object.entries(data.vulnerabilities ?? {})) {
      for (const via of info.via ?? []) {
        if (typeof via !== 'object' || !['high', 'critical'].includes(via.severity)) continue
        const id = String(via.url ?? '').split('/').pop()
        serious.push({ pkg, id, title: via.title })
      }
    }
    stage.acceptedAdvisories = serious.filter((x) => ACCEPTED_ADVISORIES[x.id]).map((x) => `${x.pkg} ${x.id}: ${ACCEPTED_ADVISORIES[x.id]}`)
    const fresh = serious.filter((x) => !ACCEPTED_ADVISORIES[x.id]).map((x) => `${x.pkg} ${x.id} ${x.title}`)
    assert.deepEqual(fresh, [], 'new high/critical advisories:')
  }, { retry: false, timeout: 140_000 })

  stage.test('docs', 'המסמכים שהעבודה העתידית נשענת עליהם קיימים', 'static', async () => {
    const need = ['docs/SARCAFE_GLASS_UI.md', 'docs/QA_BLUEPRINT.md', 'docs/SARCAFE_TEAM_MESSAGE.md', 'docs/SARCAFE_KIOSK_REMOTE.md', 'handoff.md', 'CLAUDE.md']
    assert.deepEqual(need.filter((p) => !fs.existsSync(path.join(root, p))), [], 'missing:')
  })
  return stage
}
