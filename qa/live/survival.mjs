// Stage — survival and recovery: the database goes down, fails with internal details, or is slow, and comes back.
// The app must answer with a clean error (never a stack, an SQL error or a table name), keep its pages alive, and recover by itself.
import { randomUUID } from 'node:crypto'
import { createStage, assert } from '../lib/harness.mjs'
import { ID } from '../standin/seed.mjs'

const LEAK = /(at\s+\S+\s+\(|\/home\/|node_modules|SQLSTATE|secret_internal_table|line 42|XX000|stand-in: injected)/i

export function survivalStage(live) {
  const stage = createStage('survival', 'שרידות והתאוששות: מסד הנתונים נופל, מחזיר שגיאות או איטי, וחוזר')
  const fault = (body) => live().control('/__qa/fault', body)
  const ok = () => fault({ mode: 'none' })
  const apis = ['/api/owner/team-message?branch=givat-haviva', '/api/staff/notifications', '/api/staff/tool-usage', '/api/owner/dashboard?branch=givat-haviva']

  stage.test('reset', 'מתחילים ממצב נקי', 'e2e', async () => { live().reset() }, { retry: false })

  stage.test('db-error', 'שגיאה פנימית במסד הנתונים: תשובה מסודרת בלי פרטים פנימיים', 'survival', async () => {
    await fault({ mode: 'error' })
    try {
      for (const url of apis) {
        const res = await live().call(url, { as: 'owner' })
        assert.notMatch(res.text, LEAK, `${url} leaks`)
        assert.ok(res.status !== 200 || url.includes('dashboard'), `${url} answered 200 during a database error`)
      }
    } finally { await ok() }
  })
  stage.test('db-down', 'מסד הנתונים לא עונה: ה־API מחזיר שגיאה מסודרת והעמודים לא קורסים עם פרטים', 'survival', async () => {
    await fault({ mode: 'down' })
    try {
      for (const url of apis) {
        const res = await live().call(url, { as: 'owner' })
        assert.ok(res.status >= 400, `${url} → ${res.status}`)
        assert.notMatch(res.text, LEAK, `${url} leaks`)
      }
      for (const url of ['/owner/dashboard', '/staff']) {
        const res = await live().call(url, { as: 'owner' })
        assert.notMatch(res.text, LEAK, `${url} leaks`)
      }
    } finally { await ok() }
  }, { timeout: 120_000 })
  stage.test('recover', 'אחרי שמסד הנתונים חוזר: הכול עובד שוב בלי הפעלה מחדש', 'recovery', async () => {
    await ok()
    for (const url of apis) assert.status(await live().call(url, { as: 'owner' }), 200, url)
    assert.status(await live().call('/owner/dashboard', { as: 'owner' }), 200, 'dashboard')
  })
  stage.test('retry-after-outage', 'הודעה שנשלחה בזמן תקלה: נכשלת בלי לשלוח חלקית, ואותה בקשה מצליחה פעם אחת אחרי ההתאוששות', 'recovery', async () => {
    live().standin.state.limits.clear()
    const body = { requestId: randomUUID(), branch: 'givat-haviva', audience: 'shift', shiftId: ID.shiftTomorrowAm, text: 'אחרי תקלה' }
    const count = () => live().db('schedule_notifications').filter((n) => n.kind === 'staff.message').length
    const before = count()
    await fault({ mode: 'down' })
    try {
      const failed = await live().call('/api/owner/team-message', { method: 'POST', as: 'owner', origin: true, body })
      assert.ok(failed.status >= 500, `during outage → ${failed.status}`)
      // "could not check who you are" is a 503, never "please sign in" (that would send a signed-in owner to the login page)
      const plan = await live().call('/api/owner/team-message?branch=givat-haviva', { as: 'owner' })
      assert.ok(plan.status >= 500, `plan during outage → ${plan.status}`)
    } finally { await ok() }
    assert.equal(count(), before, 'partial send')
    assert.status(await live().call('/api/owner/team-message', { method: 'POST', as: 'owner', origin: true, body }), 200, 'retry')
    assert.status(await live().call('/api/owner/team-message', { method: 'POST', as: 'owner', origin: true, body }), 409, 'third time')
    assert.equal(count(), before + 2, 'exactly one send (Dana and Galit)')
  })
  stage.test('slow-db', 'מסד נתונים איטי (3 שניות): מסך ההודעה עדיין נטען', 'survival', async () => {
    await fault({ mode: 'slow', ms: 3000, tables: ['staff_push_subscriptions'] })
    try {
      const t0 = Date.now()
      const res = await live().call('/api/owner/team-message?branch=givat-haviva', { as: 'owner' })
      assert.status(res, 200)
      assert.ok(Date.now() - t0 < 20_000, 'took too long')
    } finally { await ok() }
  }, { timeout: 40_000 })
  stage.test('bell-error', 'כשההתראות לא נטענות: הפעמון אומר זאת באדום, ואפשר לנסות שוב', 'survival', async () => {
    await fault({ mode: 'error', tables: ['schedule_notifications'] })
    const s = await live().page('owner')
    try {
      await s.page.goto(live().base + '/owner/dashboard', { waitUntil: 'networkidle' }).catch(() => null)
      await s.page.getByRole('button', { name: /^התראות/ }).click()
      await s.page.waitForTimeout(800)
      assert.ok(await s.page.locator('.gl-nt--bad', { hasText: 'לא הצלחנו לטעון' }).isVisible(), 'red error item')
      await ok()
      await s.page.locator('.lg-menu-item', { hasText: 'לא הצלחנו לטעון' }).click()
      await s.page.waitForTimeout(900)
      await s.page.getByRole('button', { name: /^התראות/ }).click()
      await s.page.waitForTimeout(800)
      assert.ok(await s.page.locator('.lg-menu-item', { hasText: /סימון הכול|הכול נקרא/ }).count() >= 1, 'recovered list')
    } finally { await ok(); await s.close() }
  })
  return stage
}
