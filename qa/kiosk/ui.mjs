// Kiosk suite, stage 4 — the kiosk dashboard in a real browser (/owner/kiosk/control): the tablet's state, the remote control panel,
// the PIN reset, the switch between the two dashboards, and that it reads well in all five looks and on a phone.
import { createStage, assert } from '../lib/harness.mjs'
import { ID } from '../standin/seed.mjs'
import { auditScreen } from '../live/contrast.mjs'

const LOOKS = ['neon', 'glass', 'pass', 'crema', 'latte']
const URL_PATH = '/owner/kiosk/control'

export function kioskUiStage(live, metrics) {
  const stage = createStage('kiosk-ui', 'הקיוסק: לוח הקיוסק בדפדפן אמיתי')
  const open = async (who, url, opts) => {
    const s = await live().page(who, opts)
    const res = await s.page.goto(live().base + url, { waitUntil: 'networkidle' })
    await s.page.evaluate(() => Promise.race([Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming?.()?.iterations !== Infinity).map((a) => a.finished.catch(() => null))), new Promise((r) => setTimeout(r, 2000))])).catch(() => null)
    return { ...s, status: res?.status() }
  }
  const device = () => live().db('kiosk_devices').find((d) => d.slug === 'givat-haviva-1')
  const fresh = () => { live().standin.state.limits.clear(); const d = device(); d.pending_command = null; d.settings = {}; live().db('kiosk_pin_resets').length = 0 }

  stage.test('dashboard', 'לוח הקיוסק: מצב הטאבלט (מחובר, סוללה, גרסאות), פעולות מרחוק וכל ההגדרות, עם הסרגל התחתון', 'e2e', async () => {
    fresh()
    const s = await open('owner', URL_PATH)
    try {
      const p = s.page
      assert.ok(await p.locator('[data-kiosk-control]').isVisible(), 'the control panel')
      assert.ok(await p.getByText('קיוסק גבעת חביבה').first().isVisible(), 'the tablet by name')
      assert.ok(await p.locator('.kc-hero .gl-pill', { hasText: 'מחובר' }).first().isVisible(), 'online (reported 2 minutes ago)')
      assert.ok(await p.getByRole('img', { name: /טעינה 41%/ }).isVisible(), 'the battery ring says 41%')
      for (const title of ['מה מוצג בכותרת ובמסך הפתיחה', 'מודעות', 'זמנים', 'שפות', 'סוללה והתראות למפתח']) assert.ok(await p.getByRole('heading', { name: title }).isVisible(), `section: ${title}`)
      for (const name of ['טעינה מחדש של הדף', 'בדיקת עדכונים עכשיו', 'איפוס קוד הצוות']) assert.ok(await p.getByRole('button', { name }).isVisible(), `action: ${name}`)
      assert.equal(await p.locator('.gl-dock').count(), 1, 'the dock is here too')
      assert.ok(await p.locator('[data-dashboard-switch] .lg-tab[data-selected]', { hasText: 'הקיוסק' }).count() === 1, 'the switch says "the kiosk"')
      assert.deepEqual(s.errors, [], 'page errors')
    } finally { await s.close() }
  })

  stage.test('switch', 'מעבר בין הלוחות בשני הכיוונים, בלי טעינה מחדש של הדף ועם אותו סרגל תחתון (בעלים ומפתח)', 'e2e', async () => {
    for (const [who, start, back] of [['owner', '/owner/dashboard', /\/owner\/dashboard$/], ['dev', '/staff/dev?view=manager', /\/staff\/dev\?view=manager$/]]) {
      const s = await open(who, start)
      try {
        const p = s.page
        await p.evaluate(() => { window.__same = true })
        await p.locator('[data-dashboard-switch] .lg-tab', { hasText: 'הקיוסק' }).first().click()
        await p.waitForURL(/\/owner\/kiosk\/control$/, { timeout: 15000 })
        await p.waitForSelector('[data-kiosk-control]', { timeout: 15000 })
        await p.locator('[data-dashboard-switch] .lg-tab', { hasText: 'לוח הבקרה' }).first().click()
        await p.waitForURL(back, { timeout: 15000 })
        assert.ok(await p.evaluate(() => window.__same === true), `${who}: no full page load`)
      } finally { await s.close() }
    }
  }, { timeout: 90_000 })

  stage.test('settings-save', 'שינוי הגדרה: פס השמירה מופיע, שמירה מעדכנת את הטאבלט, ביטול מחזיר', 'e2e', async () => {
    fresh()
    const s = await open('owner', URL_PATH)
    try {
      const p = s.page
      const credit = p.getByRole('switch', { name: 'שורת "פרויקט שנוצר ביוזמת ג׳ון"' })
      await credit.click()
      await p.getByRole('region', { name: 'שמירה' }).waitFor({ timeout: 5000 })
      await p.getByRole('region', { name: 'שמירה' }).getByRole('button', { name: 'ביטול' }).click()
      await p.waitForTimeout(300)
      assert.equal(await p.getByRole('region', { name: 'שמירה' }).count(), 0, 'cancel removes the bar')
      await credit.click()
      await p.getByRole('region', { name: 'שמירה' }).getByRole('button', { name: 'שמירה' }).click()
      await p.locator('.gl-toast--ok').first().waitFor({ timeout: 8000 })
      assert.equal(device().settings.display?.showCredit, false, 'saved on the tablet\'s row')
      assert.equal(await p.getByRole('region', { name: 'שמירה' }).count(), 0, 'the bar goes once saved')
    } finally { await s.close() }
  })

  stage.test('remote-actions', 'פקודה מרחוק ואיפוס קוד מהמסך: נשלחים, מוצגים כ"ממתין לטאבלט" וניתנים לביטול; קוד חלש נדחה במקום', 'e2e', async () => {
    fresh()
    const s = await open('owner', URL_PATH)
    try {
      const p = s.page
      await p.getByRole('button', { name: 'טעינה מחדש של הדף' }).click()
      await p.locator('[data-command-pending]').waitFor({ timeout: 8000 })
      assert.equal(device().pending_command?.kind, 'reload', 'stored for the tablet')
      await p.locator('[data-command-pending]').getByRole('button', { name: 'ביטול' }).click()
      await p.locator('[data-command-pending]').waitFor({ state: 'detached', timeout: 8000 })
      assert.equal(device().pending_command, null, 'cancelled')

      await p.getByRole('button', { name: 'איפוס קוד הצוות' }).click()
      const sheet = p.getByRole('dialog')
      await sheet.waitFor({ timeout: 5000 })
      await sheet.getByLabel('קוד חדש').fill('123456')
      assert.ok(await sheet.getByText('רצף עולה או יורד קל מדי לנחש.').isVisible(), 'a guessable PIN is refused on the spot')
      await sheet.getByLabel('קוד חדש').fill('583917')
      await sheet.getByLabel('שוב, לאישור').fill('583917')
      await sheet.getByRole('button', { name: 'שמירת הקוד' }).click()
      await p.locator('[data-pin-pending]').waitFor({ timeout: 8000 })
      assert.equal(live().db('kiosk_pin_resets').length, 1, 'stored for the tablet')
      assert.ok(!JSON.stringify(live().db('kiosk_pin_resets')).includes('583917'), 'as a record, never the PIN')
      assert.deepEqual(s.errors, [], 'page errors')
    } finally { await s.close() }
  })

  stage.test('access', 'רק בעלים: עובד/ת ומנהל/ת סניף לא נכנסים ללוח הקיוסק', 'security', async () => {
    for (const who of ['dana', 'gm']) {
      const r = await live().call(URL_PATH, { as: who })
      assert.ok([302, 303, 307, 308].includes(r.status) && !/kiosk\/control/.test(r.headers.get('location') ?? ''), `${who} → ${r.status} ${r.headers.get('location')}`)
    }
    const signedOut = await live().call(URL_PATH, {})
    assert.ok([302, 303, 307, 308].includes(signedOut.status) && /login/.test(signedOut.headers.get('location') ?? ''), 'signed out goes to sign in')
  })

  stage.test('readable', 'לוח הקיוסק קריא בכל חמשת המראות, באייפון ובטאבלט, בלי גלילה לצדדים', 'a11y', async () => {
    fresh()
    const problems = []
    let lowest = 21
    for (const look of LOOKS) {
      const row = live().db('staff').find((x) => x.id === ID.owner)
      if (row) row.ui_theme = look
      const s = await open('owner', URL_PATH, { theme: look })
      try {
        for (const y of [0, 700, 1400]) {
          await s.page.evaluate((yy) => window.scrollTo(0, yy), y)
          await s.page.waitForTimeout(400)
          const r = await auditScreen(s.page)
          lowest = Math.min(lowest, r.lowest)
          for (const f of r.failures) problems.push(`${look} y=${y}: "${f.text}" ${f.ratio}:1`)
        }
      } finally { await s.close() }
    }
    const row = live().db('staff').find((x) => x.id === ID.owner)
    if (row) row.ui_theme = 'glass'
    metrics.contrastLowest = Math.round(lowest * 100) / 100
    assert.deepEqual(problems.slice(0, 6), [], 'text below AA contrast:')
    for (const [width, height, iphone] of [[390, 844, true], [768, 1024, false]]) {
      const s = await open('owner', URL_PATH, { width, height, iphone })
      try {
        const m = await s.page.evaluate(() => ({ over: document.documentElement.scrollWidth - document.documentElement.clientWidth, bar: document.querySelector('.gl-top__bar')?.getBoundingClientRect().bottom ?? 0, first: document.querySelector('.gl-main > *')?.getBoundingClientRect().top ?? 0 }))
        assert.ok(m.over <= 0, `${width}px: ${m.over}px sideways`)
        assert.ok(m.bar <= m.first + 0.5, `${width}px: the top bar covers the first card`)
      } finally { await s.close() }
    }
  }, { timeout: 180_000 })

  return stage
}
