// Stage — security, against the running app: every API route signed out, cross-site writes, headers, error bodies that leak nothing,
// who can open which page, and the QA report endpoint's lock.
import fs from 'node:fs'
import path from 'node:path'
import { createStage, assert } from '../lib/harness.mjs'
import { PUBLIC_ROUTES } from '../stages/static.mjs'
import { SECRETS } from './app.mjs'

const LEAK = /(at\s+\S+\s+\(|\/home\/|node_modules|stack|SQLSTATE|relation\s+\w+|secret_internal_table|syntax error at|PGRST\d+|service_role|eyJhbGci)/i

function routes(root) {
  const out = []
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (e.name === 'route.ts') out.push(p) } }
  walk(path.join(root, 'src/app/api'))
  return out.map((f) => {
    const rel = path.relative(path.join(root, 'src/app/api'), path.dirname(f)).split(path.sep).join('/')
    const src = fs.readFileSync(f, 'utf8')
    const methods = [...src.matchAll(/export\s+(?:const|async function)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1])
    const url = '/api/' + rel.replace(/\[token\]/g, 'qa-not-a-real-token-000000').replace(/\[id\]/g, '00000000-0000-4000-8000-00000000dead')
    return { rel, url, methods: [...new Set(methods)] }
  })
}

export function securityStage(root, live) {
  const stage = createStage('security', 'אבטחה מול האפליקציה הרצה')
  const all = routes(root)

  stage.test('probe-signed-out', `כל ${all.length} נתיבי ה־API: בלי התחברות לא מקבלים מידע פרטי ולא נופלים (500)`, 'security', async () => {
    const problems = []
    for (const r of all) {
      for (const method of r.methods) {
        const body = method === 'GET' || method === 'DELETE' ? undefined : {}
        const res = await live().call(r.url, { method, body, origin: true })
        if (res.status >= 500 && !(r.rel.startsWith('kiosk/') && res.status === 503)) problems.push(`${method} ${r.rel} → ${res.status}`)
        if (res.status < 300 && !PUBLIC_ROUTES[r.rel] && !(r.rel === 'auth/signout')) problems.push(`${method} ${r.rel} answered ${res.status} without a session`)
        if (LEAK.test(res.text)) problems.push(`${method} ${r.rel} leaks: ${res.text.match(LEAK)?.[0]}`)
      }
    }
    assert.deepEqual(problems, [], 'problems:')
  }, { timeout: 180_000 })

  stage.test('cross-site', 'כתיבה מאתר זר נחסמת (403) גם עם עוגיית התחברות', 'security', async () => {
    for (const url of ['/api/owner/team-message', '/api/staff/tool-usage', '/api/staff/notifications', '/api/owner/dashboard']) {
      const res = await live().call(url, { method: 'POST', as: 'owner', origin: 'https://evil.example', body: { x: 1 } })
      assert.equal(res.status, 403, `${url}`)
    }
  })
  stage.test('form-post', 'שליחת טופס רגיל (לא JSON) להודעה לצוות נדחית', 'security', async () => {
    const res = await live().call('/api/owner/team-message', { method: 'POST', as: 'owner', origin: true, headers: { 'content-type': 'text/plain' }, body: 'branch=givat-haviva&text=hi' })
    assert.ok(res.status === 400 || res.status === 415, `got ${res.status}`)
  })
  stage.test('headers', 'כותרות האבטחה בכל עמוד (מסגור, nosniff, HSTS, הרשאות, בלי X-Powered-By)', 'security', async () => {
    for (const url of ['/login', '/owner/dashboard', '/staff', '/staff/dev/qa', '/api/branches']) {
      const res = await live().call(url, { as: 'owner' })
      assert.equal(res.headers.get('x-frame-options'), 'DENY', url)
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff', url)
      assert.match(res.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/, url)
      assert.match(res.headers.get('strict-transport-security') ?? '', /max-age=\d+/, url)
      assert.ok(!res.headers.get('x-powered-by'), `${url} x-powered-by`)
    }
  })
  stage.test('private-cache', 'תשובות פרטיות לא נשמרות במטמון (no-store)', 'security', async () => {
    for (const url of ['/api/owner/team-message?branch=givat-haviva', '/api/staff/tool-usage', '/api/staff/notifications', '/api/owner/dashboard?branch=givat-haviva']) {
      const res = await live().call(url, { as: 'owner' })
      assert.match(res.headers.get('cache-control') ?? '', /no-store/, url)
    }
  })
  stage.test('pages-signed-out', 'עמודי הצוות והניהול שולחים מי שלא מחובר להתחברות', 'security', async () => {
    for (const url of ['/owner/dashboard', '/staff', '/staff/dev', '/staff/dev/qa', '/owner/staff', '/staff/schedule']) {
      const res = await live().call(url)
      assert.ok([302, 303, 307, 308].includes(res.status) && /\/login/.test(res.headers.get('location') ?? ''), `${url} → ${res.status} ${res.headers.get('location')}`)
    }
  })
  stage.test('roles-pages', 'עובד/ת לא נכנס/ת ללוח הבעלים ולא לסקירת ה־QA', 'security', async () => {
    const owner = await live().call('/owner/dashboard', { as: 'dana' })
    assert.ok(owner.status >= 300 && owner.status < 400 && !/\/owner\/dashboard/.test(owner.headers.get('location') ?? ''), `employee on /owner/dashboard → ${owner.status} ${owner.headers.get('location')}`)
    // The page redirects them; with streaming that can be a 200 carrying a redirect, so what matters is that no report content is in it.
    const shipped = JSON.parse(fs.readFileSync(path.join(root, 'qa/reports/latest.json'), 'utf8'))
    for (const who of ['dana', 'gm']) {
      const qa = await live().call('/staff/dev/qa', { as: who })
      assert.ok(!/qa-hero|qa-ring|qa-stage/.test(qa.text) && !qa.text.includes(shipped.review.headline), `${who} can read the QA review`)
    }
  })
  stage.test('roles-api', 'ה־API של הבעלים סגור בפני עובדים ומנהלים שאינם בעלים', 'security', async () => {
    assert.status(await live().call('/api/owner/dashboard?branch=givat-haviva', { as: 'dana' }), 403)
    assert.status(await live().call('/api/owner/dashboard?branch=givat-haviva', { as: 'gm' }), 403)
    assert.status(await live().call('/api/owner/team-message?branch=givat-haviva', { as: 'dana' }), 403)
    assert.status(await live().call('/api/owner/team-message?branch=maor', { as: 'gm' }), 403)
  })
  stage.test('qa-ingest-lock', 'דוח ה־QA מתקבל רק עם הסוד, בגודל סביר ובמבנה הנכון', 'security', async () => {
    const shipped = JSON.parse(fs.readFileSync(path.join(root, 'qa/reports/latest.json'), 'utf8'))
    const post = (body, headers = {}) => live().call('/api/qa/report', { method: 'POST', body, headers })
    assert.status(await post(shipped), 401, 'no secret')
    assert.status(await post(shipped, { authorization: 'Bearer wrong' }), 401, 'wrong secret')
    const auth = { authorization: `Bearer ${SECRETS.QA_REPORT_SECRET}` }
    assert.status(await post({ ...shipped, extra: true }, auth), 400, 'unknown key')
    assert.status(await post('x'.repeat(700_000), { ...auth, 'content-type': 'application/json' }), [400, 413], 'oversize')
    const ok = await post({ ...shipped, run: { ...shipped.run, source: 'manual' } }, auth)
    assert.status(ok, 201, 'valid report')
    assert.ok(live().db('qa_runs').length >= 1, 'stored')
  })
  stage.test('qa-ingest-missing', 'לפני המיגרציה: שמירת הדוח עונה "עוד לא מוכן" ולא נופלת', 'recovery', async () => {
    await live().control('/__qa/missing', { tables: ['qa_runs'] })
    try {
      const shipped = JSON.parse(fs.readFileSync(path.join(root, 'qa/reports/latest.json'), 'utf8'))
      const res = await live().call('/api/qa/report', { method: 'POST', body: shipped, headers: { authorization: `Bearer ${SECRETS.QA_REPORT_SECRET}` } })
      assert.status(res, 503)
      assert.equal(res.json?.error?.code, 'not_ready')
    } finally { await live().control('/__qa/missing', {}) }
  })
  return stage
}
