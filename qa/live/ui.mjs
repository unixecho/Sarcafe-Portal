// Stage — the glass screens in a real browser (Chromium through Playwright), as each kind of person, in every look.
import { createStage, assert } from '../lib/harness.mjs'
import { ID } from '../standin/seed.mjs'
import { auditScreen } from './contrast.mjs'
import { run } from '../lib/exec.mjs'
import { browserPath } from '../stages/checks.mjs'
import { fileURLToPath } from 'node:url'

const LOOKS = ['neon', 'glass', 'pass', 'crema', 'latte']
const setLook = (live, who, look) => { const row = live().db('staff').find((s) => s.id === ID[who]); if (row) row.ui_theme = look }

export function uiStage(live, metrics) {
  const stage = createStage('ui', 'המסכים בדפדפן אמיתי: לוחות, תפריטים, הודעה, חיפוש וקריאוּת')
  const open = async (who, url, opts) => {
    const s = await live().page(who, opts)
    const res = await s.page.goto(live().base + url, { waitUntil: 'networkidle' })
    return { ...s, status: res?.status() }
  }
  const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

  stage.test('reset', 'מתחילים ממצב נקי', 'e2e', async () => { live().reset() }, { retry: false })

  stage.test('owner-home', 'לוח הבעלים: שורה עליונה עם סניפים, פעמון וחשבון; הודעה לצוות; חיפוש; סרגל תחתון', 'e2e', async () => {
    const s = await open('owner', '/owner/dashboard')
    try {
      assert.equal(s.status, 200)
      const p = s.page
      assert.ok(await p.locator('.gl-top__bar').isVisible(), 'top bar')
      assert.equal(await p.locator('.gl-top__branch .lg-tab').count(), 2, 'branch switch')
      assert.ok(await p.getByRole('button', { name: /^התראות/ }).isVisible(), 'bell')
      assert.ok(await p.getByRole('button', { name: 'החשבון שלי' }).isVisible(), 'account')
      assert.ok(await p.locator('#team-message').isVisible(), 'team message')
      assert.ok(await p.locator('#tool-finder').count(), 'finder')
      assert.equal(await p.locator('.gl-dock .lg-tab').count(), 5, 'dock tabs')
      assert.match(await p.locator('.gl-short').innerText(), /סידור עבודה/, 'shortcuts')
      assert.match(await p.locator('body').innerText(), /2 בקשות/, 'the "2 בקשות" pill from real pending requests')
      assert.ok((await overflowX(p)) <= 0, 'horizontal overflow')
      assert.deepEqual(s.errors, [], 'page errors:')
    } finally { await s.close() }
  })

  stage.test('branch-sheet', 'בכניסה הראשונה: "איזה סניף?" עם מתג הזכוכית, ונסגר בבחירה', 'e2e', async () => {
    const s = await open('owner', '/owner/dashboard', { askBranch: true })
    try {
      const sheet = s.page.getByRole('dialog', { name: /איזה סניף/ })
      await sheet.waitFor({ timeout: 8000 })
      assert.match(await sheet.innerText(), /איזה סניף/)
      await sheet.getByRole('button', { name: /המשך ל/ }).click()
      await s.page.waitForTimeout(600)
      assert.equal(await s.page.getByRole('dialog', { name: /איזה סניף/ }).count(), 0, 'sheet closed')
    } finally { await s.close() }
  })

  stage.test('notifications', 'פעמון ההתראות נפתח כתפריט הזכוכית; חיובי בירוק, שלילי באדום; "סימון הכול כנקרא" עובד', 'e2e', async () => {
    const s = await open('owner', '/owner/dashboard')
    try {
      const p = s.page
      await p.getByRole('button', { name: /^התראות/ }).click()
      await p.waitForTimeout(900)
      assert.ok(await p.locator('.gl-notif .lg-menu-card').isVisible(), 'menu open')
      assert.ok(await p.locator('.gl-nt--ok').count() >= 1, 'green item')
      assert.ok(await p.locator('.gl-nt--bad').count() >= 1, 'red item')
      const green = await p.locator('.gl-nt--ok strong').first().evaluate((e) => getComputedStyle(e).color)
      const red = await p.locator('.gl-nt--bad strong').first().evaluate((e) => getComputedStyle(e).color)
      assert.ok(/rgb\((\d+), (\d+), (\d+)\)/.test(green) && Number(green.match(/\d+/g)[1]) > Number(green.match(/\d+/g)[0]), `green is green: ${green}`)
      assert.ok(Number(red.match(/\d+/g)[0]) > Number(red.match(/\d+/g)[1]), `red is red: ${red}`)
      await p.getByRole('menuitem', { name: /סימון הכול כנקרא/ }).click().catch(async () => p.locator('.lg-menu-item', { hasText: 'סימון הכול כנקרא' }).click())
      await p.waitForTimeout(700)
      assert.ok(live().db('schedule_notifications').filter((n) => n.staff_id === ID.owner).every((n) => n.read_at), 'all read in the database')
      assert.equal(await p.locator('.gl-top__dot').count(), 0, 'badge gone')
      assert.ok(await p.locator('.gl-toast--ok').isVisible(), 'green confirmation toast')
    } finally { await s.close() }
  })

  // The owner's iPhone, 2026-11-05: with a long list every row was squeezed to 32 px and the text of each notification ran over the
  // next one. The seed's three notifications never filled the menu, so this test gives the owner a realistic long list.
  stage.test('notifications-long', 'רשימת התראות ארוכה: כל שורה בגובה שלה, בלי טקסט על טקסט, נגללת באצבע ולא נפתחת בטעות', 'e2e', async () => {
    const rows = live().db('schedule_notifications')
    const kinds = ['waitlist.signup', 'kiosk.poll', 'dev.kiosk_battery', 'schedule.published', 'schedule.window_closing', 'shift.today', 'shift.next']
    const added = Array.from({ length: 24 }, (_, i) => ({
      id: crypto.randomUUID(), branch_id: ID.gh, staff_id: ID.owner, kind: kinds[i % kinds.length],
      title: `בעלים · התעניינות חדשה במועדון שרקפה, לקוח מספר ${i + 1} מהקיוסק בגבעת חביבה`,
      body: 'לקוח חדש הצטרף לרשימת המתעניינים במועדון הלקוחות הדיגיטלי, בהסכמה, מהקיוסק שליד העגלה. גבעת חביבה · 08:00–13:00',
      link: {}, created_at: new Date(Date.now() - (i + 3) * 3_600_000).toISOString(), read_at: i < 2 ? null : new Date().toISOString(), push_sent_at: new Date().toISOString(),
    }))
    rows.push(...added)
    try {
      for (const width of [320, 390]) {
        const s = await open('owner', '/owner/dashboard', { width, height: 700 })
        try {
          const p = s.page
          await p.getByRole('button', { name: /^התראות/ }).click()
          await p.waitForTimeout(900)
          const m = await p.evaluate(() => {
            const items = [...document.querySelectorAll('.gl-notif .lg-menu-content > .lg-menu-item')]
            const bad = []
            items.forEach((el, i) => {
              const r = el.getBoundingClientRect()
              if (el.scrollHeight > el.clientHeight + 1) bad.push(`row ${i} spills (${el.scrollHeight} > ${el.clientHeight})`)
              for (const t of el.querySelectorAll('strong, small')) {
                const tr = t.getBoundingClientRect()
                if (tr.height && (tr.top < r.top - 0.5 || tr.bottom > r.bottom + 0.5)) { bad.push(`row ${i}: text outside its row`); break }
              }
              const title = el.querySelector('.gl-nt__top strong')
              if (title && title.getBoundingClientRect().height > parseFloat(getComputedStyle(title).lineHeight) * 2 + 2) bad.push(`row ${i}: title over two lines`)
              const next = items[i + 1]
              if (next && r.bottom > next.getBoundingClientRect().top + 0.5) bad.push(`rows ${i}/${i + 1} overlap`)
            })
            const list = document.querySelector('.gl-notif .lg-menu-content')
            const lr = list.getBoundingClientRect()
            return { n: items.length, bad, scrollable: list.scrollHeight - list.clientHeight, at: { x: Math.round(lr.left + lr.width / 2), top: Math.round(lr.top), bottom: Math.round(lr.bottom) } }
          })
          assert.ok(m.n >= 15, `${width}px: ${m.n} rows`)
          assert.deepEqual(m.bad.slice(0, 4), [], `${width}px`)
          assert.ok(m.scrollable > 200, `${width}px: the list scrolls (${m.scrollable})`)
          // a finger swipe up scrolls the list, and lifting the finger opens nothing (glisse menus select on release)
          const cdp = await s.context.newCDPSession(p)
          await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
          const url = p.url()
          const x = m.at.x, y0 = m.at.bottom - 40, y1 = m.at.top + 60
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] })
          for (let i = 1; i <= 12; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + ((y1 - y0) * i) / 12 }] }); await p.waitForTimeout(16) }
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
          await p.waitForTimeout(700)
          const top = await p.evaluate(() => document.querySelector('.gl-notif .lg-menu-content')?.scrollTop ?? -1)
          assert.ok(top > 60, `${width}px: a finger swipe scrolled the list (${top})`)
          assert.equal(p.url(), url, `${width}px: the swipe opened nothing`)
          assert.ok(await p.locator('.gl-notif .lg-menu-card').isVisible(), `${width}px: the menu is still open after the swipe`)
          assert.deepEqual(s.errors, [], `${width}px: page errors`)
        } finally { await s.close() }
      }
    } finally {
      for (const row of added) { const i = rows.indexOf(row); if (i >= 0) rows.splice(i, 1) }
    }
  })

  stage.test('branch-switch', 'החלפת סניף בשורה העליונה: הנתונים, הרקע והעוגייה מתעדכנים', 'e2e', async () => {
    const s = await open('owner', '/owner/dashboard')
    try {
      const p = s.page
      const req = p.waitForRequest((r) => r.url().includes('/api/owner/dashboard?branch=maor'))
      await p.locator('.gl-top__branch .lg-tab', { hasText: 'מאור' }).click()
      await req
      await p.waitForTimeout(600)
      assert.match(await p.locator('.gl-bg').getAttribute('style'), /maor-1/, 'backdrop')
      const cookies = await s.context.cookies()
      assert.equal(cookies.find((c) => c.name === 'sarcafe_branch')?.value, 'maor', 'cookie')
    } finally { await s.close() }
  })

  stage.test('team-message-ui', 'הודעה לצוות מהמסך: בוחרים יום ועובד/ת, שולחים, מקבלים אישור ירוק', 'e2e', async () => {
    live().standin.state.limits.clear()
    const s = await open('owner', '/owner/dashboard')
    try {
      const p = s.page
      const card = p.locator('#team-message')
      await card.scrollIntoViewIfNeeded()
      await card.getByRole('radio', { name: /מחר/ }).click()
      await card.getByRole('radio', { name: /^דנה/ }).click()
      assert.match(await card.locator('.gl-summary').innerText(), /רק ל־דנה/)
      assert.ok(await card.getByRole('radio', { name: /איתי/ }).isDisabled(), 'no notifications = cannot be picked')
      await p.locator('#team-message-text').fill('מגיע משלוח חלב בבוקר')
      await card.getByRole('button', { name: /שליחה/ }).click()
      await p.locator('.gl-toast--ok').waitFor({ timeout: 8000 })
      assert.match(await p.locator('.gl-toast--ok').innerText(), /נשלחה לעובד אחד/)
      assert.equal(await p.locator('#team-message-text').inputValue(), '', 'cleared after sending')
      const rows = live().db('schedule_notifications').filter((n) => n.kind === 'staff.message')
      assert.deepEqual(rows.map((r) => r.staff_id), [ID.dana])
    } finally { await s.close() }
  })

  stage.test('team-message-errors', 'שגיאה בשרת או בלי אינטרנט: הודעה אדומה, והטקסט נשאר כדי לנסות שוב', 'survival', async () => {
    live().standin.state.limits.clear()
    const s = await open('owner', '/owner/dashboard')
    try {
      const p = s.page
      await p.locator('#team-message').scrollIntoViewIfNeeded()
      await p.locator('#team-message-text').fill('בדיקת תקלה')
      await live().control('/__qa/fault', { mode: 'error', tables: ['branches'] })
      await p.locator('#team-message').getByRole('button', { name: /שליחה/ }).click()
      await p.locator('.gl-toast--bad').waitFor({ timeout: 8000 })
      assert.equal(await p.locator('#team-message-text').inputValue(), 'בדיקת תקלה', 'text kept')
      await live().control('/__qa/fault', { mode: 'none' })
      await s.context.setOffline(true)
      await p.waitForTimeout(400)
      await p.locator('#team-message').getByRole('button', { name: /שליחה/ }).click()
      await p.waitForTimeout(600)
      assert.match(await p.locator('.gl-toast--bad').last().innerText(), /אין חיבור/)
      await s.context.setOffline(false)
      await p.locator('#team-message').getByRole('button', { name: /שליחה/ }).click()
      await p.locator('.gl-toast--ok').waitFor({ timeout: 8000 })
    } finally { await live().control('/__qa/fault', { mode: 'none' }); await s.close() }
  })

  stage.test('finder', 'החיפוש: משלים, מציע ופותח; השימוש נשמר להיסטוריה של האדם', 'e2e', async () => {
    const s = await open('owner', '/owner/dashboard')
    try {
      const p = s.page
      const input = p.locator('#tool-finder input')
      await input.click()
      await p.locator('.gl-finder__pop').waitFor()
      assert.match(await p.locator('.gl-finder__pop').innerText(), /מומלץ לך עכשיו/)
      await input.fill('סיד')
      assert.match(await p.locator('.gl-finder__row').first().innerText(), /סידור עבודה/, 'completion')
      await input.press('ArrowDown')
      await input.press('ArrowUp')
      await Promise.all([p.waitForURL(/\/owner\/schedule/, { timeout: 15000 }), input.press('Enter')])
      await p.waitForTimeout(400)
      assert.ok(live().db('staff_tool_usage').some((r) => r.staff_id === ID.owner && r.tool_id === 'schedule-manage'), 'usage stored for the person')
    } finally { await s.close() }
  })

  stage.test('employee-home', 'בית העובד/ת: בלי הודעה לצוות, בלי החלפת סניף, החיפוש לא מציע כלי בעלים', 'security', async () => {
    const s = await open('dana', '/staff')
    try {
      const p = s.page
      assert.equal(s.status, 200)
      assert.equal(await p.locator('#team-message').count(), 0, 'team message shown to an employee')
      assert.equal(await p.locator('.gl-top__branch').count(), 0, 'branch switch shown to an employee')
      const input = p.locator('#tool-finder input')
      await input.fill('עובדים')
      await p.waitForTimeout(300)
      assert.notMatch(await p.locator('.gl-finder__pop').innerText(), /העובדים שלי|נרשמים למועדון|תוכן הקיוסק/, 'owner tool offered')
      assert.deepEqual(s.errors, [], 'page errors:')
    } finally { await s.close() }
  })

  stage.test('gm-home', 'מנהל/ת סניף: הודעה לצוות לסניף שלו/ה בלבד', 'e2e', async () => {
    const s = await open('gm', '/staff')
    try {
      assert.ok(await s.page.locator('#team-message').isVisible(), 'team message for the manager')
      assert.equal(await s.page.locator('#team-message .gl-seg').filter({ hasText: 'מאור' }).count(), 0, 'another branch offered')
    } finally { await s.close() }
  })

  stage.test('dev-and-qa', 'לוח המפתח: מתג התצוגות, כרטיס ה־QA, ועמוד הסקירה נפתח', 'e2e', async () => {
    const s = await open('dev', '/staff/dev?view=dev')
    try {
      const p = s.page
      assert.ok(await p.locator('a[href="/staff/dev/qa"]').first().isVisible(), 'QA card')
      // keyboard: the lens control is a real tablist (arrows move the selection and the view)
      // (scoped by name: a developer-owner also has the top bar's branch switch, which is a .gl-seg too)
      await p.getByRole('radiogroup', { name: 'תצוגות' }).locator('.lg-tab[data-selected]').focus()
      await p.keyboard.press('ArrowLeft')
      await p.waitForTimeout(500)
      assert.match(p.url(), /view=(alerts|employee)/, 'ArrowLeft moved the view')
      await p.getByRole('radiogroup', { name: 'תצוגות' }).locator('.lg-tab', { hasText: 'מנהל' }).click()
      await p.waitForTimeout(500)
      assert.match(p.url(), /view=manager/)
      await p.goto(live().base + '/staff/dev/qa', { waitUntil: 'networkidle' })
      assert.ok(await p.locator('.qa-hero').isVisible(), 'review hero')
      assert.ok(await p.locator('.qa-ring').isVisible(), 'ring')
      assert.deepEqual(s.errors, [], 'page errors:')
    } finally { await s.close() }
  })

  stage.test('on-shift', '"מי במשמרת עכשיו": כרטיס זכוכית, מתג הקודמת/עכשיו/הבאה, הקרוסלה ממשיכה לעבוד', 'e2e', async () => {
    const s = await open('dana', '/staff/schedule')
    try {
      const p = s.page
      assert.equal(s.status, 200)
      const card = p.locator('.osn__branch').first()
      await card.waitFor()
      assert.match(await card.getAttribute('class'), /gl-surf/)
      assert.match(await card.innerText(), /דנה/)
      const dots = () => card.locator('.shs__dots span').evaluateAll((els) => els.findIndex((e) => e.classList.contains('is-on')))
      assert.equal(await dots(), 1, 'opens on now')
      await card.locator('.shs__seg .lg-tab', { hasText: 'הבאה' }).click()
      await p.waitForTimeout(800)
      assert.equal(await dots(), 2, 'switcher moved the strip')
      assert.ok(await card.locator('.shs__arrow[aria-label="המשמרת הבאה"]').isDisabled(), 'next arrow stops at the end')
      await card.locator('.shs__arrow[aria-label="המשמרת הקודמת"]').click()
      await p.waitForTimeout(800)
      assert.equal(await dots(), 1, 'arrow moved back')
      assert.ok((await overflowX(p)) <= 0, 'horizontal overflow')
    } finally { await s.close() }
  })

  stage.test('carousel', 'הקרוסלה של "מי במשמרת" עוברת את כל הבדיקה המקורית (check:shift-scroller) על העותק הבנוי', 'regression', async () => {
    const script = fileURLToPath(new URL('../../scripts/check-shift-scroller.mjs', import.meta.url))
    // ~400 s here (6 phone/tablet sizes × 7 cases); the limit leaves room for a slower CI machine
    const r = await run('node', [script, live().base], { timeout: 900_000, env: { EDGE_PATH: browserPath() ?? '' } })
    const summary = r.output.match(/(\d+) passed, (\d+) failed/)
    assert.ok(r.code === 0, `exit ${r.code}: ${r.output.split('\n').filter((l) => /✗/.test(l)).slice(0, 4).join(' | ').slice(0, 400) || r.output.slice(-300)}`)
    assert.ok(summary && Number(summary[1]) > 100, `too few checks ran: ${summary?.[0]}`)
  }, { timeout: 920_000, retry: false })

  stage.test('dock', 'הסרגל התחתון: הבחירה מיושרת לכרטיסייה בכל רוחב, ולחיצה עוברת לעמוד', 'e2e', async () => {
    for (const width of [360, 390, 768]) {
      const s = await open('owner', '/owner/dashboard', { width })
      try {
        const p = s.page
        const dx = await p.evaluate(() => {
          const sel = document.querySelector('.gl-dock .lg-tab[data-selected]')
          const lens = document.querySelector('.gl-dock .lg-tab-lens')
          if (!sel || !lens) return 999
          const a = sel.getBoundingClientRect(), b = lens.getBoundingClientRect()
          return Math.abs(a.x + a.width / 2 - (b.x + b.width / 2))
        })
        assert.ok(dx <= 6, `${width}px thumb off by ${dx}px`)
        const bar = await p.locator('.gl-dock .lg-tab-bar').boundingBox()
        const labels = await p.locator('.gl-dock .lg-tab-labels').first().boundingBox()
        assert.ok(labels.width <= bar.width + 70, `${width}px labels wider than the glass`)
        if (width === 390) {
          await Promise.all([p.waitForURL(/\/owner\/schedule/, { timeout: 15000 }), p.locator('.gl-dock .lg-tab', { hasText: 'סידור' }).click()])
        }
      } finally { await s.close() }
    }
  })

  stage.test('readable', 'קריאוּת: כל טקסט עומד ביחס ניגודיות AA מול מה שמאחוריו, בכל חמשת המראות', 'a11y', async () => {
    const problems = []
    let lowest = 21
    let measured = 0
    for (const look of LOOKS) {
      setLook(live, 'owner', look)
      const s = await open('owner', '/owner/dashboard')
      try {
        for (const y of [0, 700, 1400]) {
          await s.page.evaluate((yy) => window.scrollTo(0, yy), y)
          await s.page.waitForTimeout(450)
          const r = await auditScreen(s.page)
          measured += r.measured
          lowest = Math.min(lowest, r.lowest)
          for (const f of r.failures) problems.push(`${look} y=${y}: "${f.text}" ${f.ratio}:1`)
        }
        await s.page.evaluate(() => window.scrollTo(0, 0))
        await s.page.getByRole('button', { name: /^התראות/ }).click()
        await s.page.waitForTimeout(900)
        const menu = await auditScreen(s.page)
        lowest = Math.min(lowest, menu.lowest)
        for (const f of menu.failures) problems.push(`${look} menu: "${f.text}" ${f.ratio}:1`)
      } finally { await s.close() }
    }
    setLook(live, 'owner', 'glass')
    metrics.contrastLowest = Math.round(lowest * 100) / 100
    try { (await import('node:fs')).writeFileSync(new URL('../.cache/contrast.txt', import.meta.url), problems.join('\n') + '\n') } catch { /* local aid only */ }
    assert.deepEqual(problems.slice(0, 12), [], `${problems.length} below AA:`)
  }, { timeout: 240_000, retry: false })

  stage.test('widths', 'בלי גלילה לצדדים ובלי שגיאות בטלפון קטן, טאבלט ומחשב', 'e2e', async () => {
    for (const [who, url] of [['owner', '/owner/dashboard'], ['dana', '/staff'], ['dev', '/staff/dev/qa']]) {
      for (const width of [360, 768, 1280]) {
        const s = await open(who, url, { width, height: 900 })
        try {
          assert.ok((await overflowX(s.page)) <= 0, `${who} ${url} @${width}`)
          assert.deepEqual(s.errors, [], `${who} ${url} @${width} errors:`)
        } finally { await s.close() }
      }
    }
  }, { timeout: 180_000 })

  stage.test('smooth', 'גלילה חלקה בלוח הבעלים (מעבד מואט פי 4)', 'perf', async () => {
    const s = await open('owner', '/owner/dashboard')
    try {
      const p = s.page
      const cdp = await s.context.newCDPSession(p)
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
      await p.evaluate(() => { window.__f = []; let l = performance.now(); const t = (n) => { window.__f.push(n - l); l = n; requestAnimationFrame(t) }; requestAnimationFrame(t) })
      for (let i = 0; i < 14; i++) { await p.mouse.wheel(0, 240); await p.waitForTimeout(60) }
      await p.waitForTimeout(500)
      const frames = (await p.evaluate(() => window.__f.slice(1))).sort((a, b) => a - b)
      const worst = frames.at(-1) ?? 0
      const p95 = frames[Math.floor(frames.length * 0.95)] ?? 0
      metrics.perf = { scrollWorstMs: Math.round(worst), scrollP95Ms: Math.round(p95), scrollFrames: frames.length }
      assert.ok(worst < 600, `worst frame ${Math.round(worst)} ms`)
    } finally { await s.close() }
  }, { retry: false })
  return stage
}
