// Stage — the glass screens in a real browser (Chromium through Playwright), as each kind of person, in every look.
import { createStage, assert } from '../lib/harness.mjs'
import { ID } from '../standin/seed.mjs'
import { auditScreen } from './contrast.mjs'
import { run, NODE } from '../lib/exec.mjs'
import { browserPath } from '../stages/checks.mjs'
import { fileURLToPath } from 'node:url'

const LOOKS = ['neon', 'glass', 'pass', 'crema', 'latte']
const setLook = (live, who, look) => { const row = live().db('staff').find((s) => s.id === ID[who]); if (row) row.ui_theme = look }

export function uiStage(live, metrics) {
  const stage = createStage('ui', 'המסכים בדפדפן אמיתי: לוחות, תפריטים, הודעה, חיפוש וקריאוּת')
  // Every page slides in (.page-enter, 0.32 s from translateX(∓3%)). A measurement taken during that slide saw the page 5 px off
  // to the side (ui.widths, flaky once at 768 px, 2026-11-05), so tests measure the settled page: finite animations are awaited (2 s cap).
  const settled = (page) => page.evaluate(() => Promise.race([
    Promise.all(document.getAnimations().filter((a) => { const t = a.effect?.getTiming?.(); return t && t.iterations !== Infinity }).map((a) => a.finished.catch(() => null))),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ])).catch(() => null)
  const open = async (who, url, opts) => {
    const s = await live().page(who, opts)
    const res = await s.page.goto(live().base + url, { waitUntil: 'networkidle' })
    await settled(s.page)
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

  // The owner's iPhone, 2026-11-05: the top bar sat 59 px down on the first card (the status bar's room was not reserved) and the
  // dock floated 46 px up with the page showing under it. Plain Chromium has no notch: `iphone: true` gives the page an iPhone's
  // safe areas (59 top, 34 bottom).
  const isOpaque = (c) => /^rgb\([^,/]+,[^,/]+,[^,/)]+\)$/.test(c) || /^rgba\(.*,\s*1\)$/.test(c) || /\/\s*1\)$/.test(c)
  stage.test('iphone-edges', 'באייפון: השורה העליונה לא מכסה את הכרטיס הראשון, והסרגל התחתון צמוד לתחתית בלי טקסט מתחתיו, גם בגלילה', 'e2e', async () => {
    for (const [who, url] of [['owner', '/owner/dashboard'], ['dana', '/staff'], ['dev', '/staff/dev/qa']]) {
      const s = await open(who, url, { width: 430, height: 932, iphone: true })
      try {
        const p = s.page
        await p.waitForTimeout(400)
        const at = () => p.evaluate(() => {
          const bar = document.querySelector('.gl-top__bar').getBoundingClientRect()
          const first = document.querySelector('.gl-main > *').getBoundingClientRect()
          const dock = document.querySelector('.gl-dock')
          const pill = dock.querySelector('.lg-tab-bar').getBoundingClientRect()
          const stops = getComputedStyle(dock).backgroundImage.match(/rgba?\([^)]*\)|color\([^)]*\)|oklab\([^)]*\)/g) ?? []
          return { barTop: bar.top, barBottom: bar.bottom, firstTop: first.top, dockBottom: dock.getBoundingClientRect().bottom, gap: innerHeight - pill.bottom, last: stops.at(-1) ?? '', vh: innerHeight }
        })
        const a = await at()
        assert.ok(a.barBottom <= a.firstTop + 0.5, `${url}: the top bar covers the first card by ${Math.round(a.barBottom - a.firstTop)} px`)
        assert.ok(a.barTop >= 59, `${url}: the top bar sits under the status bar (top ${Math.round(a.barTop)})`)
        assert.ok(a.gap >= 8 && a.gap <= 26, `${url}: the dock sits ${Math.round(a.gap)} px above the bottom (8–26)`)
        assert.ok(Math.abs(a.dockBottom - a.vh) < 1, `${url}: the band under the dock reaches the bottom`)
        assert.ok(isOpaque(a.last), `${url}: the band under the dock ends opaque (${a.last})`)
        await p.evaluate(() => window.scrollTo(0, 500))
        await p.waitForTimeout(300)
        const b = await at()
        assert.ok(Math.abs(b.barTop - a.barTop) < 1, `${url}: the top bar stays put while scrolling (${Math.round(a.barTop)} → ${Math.round(b.barTop)})`)
        assert.ok(Math.abs(b.gap - a.gap) < 1, `${url}: the dock stays put while scrolling`)
        assert.deepEqual(s.errors, [], `${url}: page errors`)
      } finally { await s.close() }
    }
  })

  // The owner's iPhone, 2026-11-05: the kiosk page's save bar (sticky to the end of the editor) was left stuck at the editor's TOP,
  // over the content, after scrolling down and back up. It is fixed to the screen now, while the editor is on screen.
  stage.test('kiosk-save-bar', 'תוכן הקיוסק: פס השמירה צמוד לתחתית המסך כל עוד העורך על המסך, בגלילה למטה ובחזרה למעלה, ולא מכסה את הסוף', 'e2e', async () => {
    const s = await open('owner', '/owner/kiosk', { width: 430, height: 932, iphone: true })
    try {
      const p = s.page
      assert.equal(await p.locator('[data-kiosk-save-bar]').count(), 1, 'the editor and its save bar are on the page')
      const read = () => p.evaluate(() => {
        const el = document.querySelector('[data-kiosk-save-bar]')
        const r = el.getBoundingClientRect(), ed = el.parentElement.getBoundingClientRect(), cs = getComputedStyle(el)
        const last = el.previousElementSibling?.getBoundingClientRect()
        return { gap: innerHeight - r.bottom, top: r.top, shown: cs.visibility === 'visible', editorOn: ed.top < innerHeight - 96 && ed.bottom > 0, lastBottom: last?.bottom ?? 0, atEnd: Math.ceil(scrollY + innerHeight) >= document.documentElement.scrollHeight - 1 }
      })
      const max = await p.evaluate(() => document.documentElement.scrollHeight - innerHeight)
      const stops = [max, ...Array.from({ length: Math.ceil(max / 280) }, (_, i) => Math.max(0, max - (i + 1) * 280))]
      let checked = 0
      for (const y of stops) {
        await p.evaluate((yy) => window.scrollTo(0, yy), y)
        await p.waitForTimeout(260)
        const m = await read()
        if (m.editorOn) {
          assert.ok(m.shown, `scroll ${y}: the bar is shown while the editor is on screen`)
          assert.ok(m.gap >= 8 && m.gap <= 30, `scroll ${y}: the bar sits at the bottom of the screen (${Math.round(m.gap)} px up)`)
          if (m.atEnd) assert.ok(m.lastBottom <= m.top + 0.5, `at the end the bar covers the last section by ${Math.round(m.lastBottom - m.top)} px`)
          checked++
        } else {
          assert.ok(!m.shown, `scroll ${y}: the bar is hidden while only the tablets card is on screen`)
        }
      }
      assert.ok(checked >= 2, `checked ${checked} positions with the editor on screen`)
      assert.deepEqual(s.errors, [], 'page errors')
    } finally { await s.close() }
  })

  // Owner, 2026-11-05: "make sure the bottom nav bar is constant and the pages don't need to load to switch content". The dock is
  // drawn by the /owner and /staff layouts (DockHost), so moving between its tabs keeps the SAME element on screen, with no full page
  // load; the tapped tab lights at once; a quick second tap wins; the destination's skeleton is on screen while the server works.
  const settle = async (p, from) => {
    await p.waitForFunction((prev) => location.pathname !== prev, from, { timeout: 15000 })
    await p.waitForFunction(() => !document.querySelector('[data-glass-skeleton], .app-loading-content') && document.documentElement.dataset.vt !== 'running', null, { timeout: 15000 })
  }
  stage.test('dock-constant', 'הסרגל התחתון קבוע: אותו סרגל בין הלשוניות, בלי טעינה מחדש של הדף, הלשונית נדלקת מיד ולחיצה מהירה שנייה מנצחת', 'e2e', async () => {
    for (const [who, start, tabs] of [
      ['owner', '/owner/dashboard', [['סידור', '/owner/schedule'], ['צוות', '/owner/staff'], ['צ׳קליסטים', '/owner/checklists'], ['בית', '/owner/dashboard']]],
      ['dana', '/staff', [['משמרות', '/staff/schedule'], ['פרופיל', '/staff/profile'], ['צ׳קליסט', '/staff/checklists'], ['בית', '/staff']]],
    ]) {
      const s = await open(who, start)
      try {
        const p = s.page
        await p.evaluate(() => { window.__sameDocument = true; document.querySelector('.gl-dock').__sameDock = true })
        for (const [label, path] of tabs) {
          const from = await p.evaluate(() => location.pathname)
          await p.locator('.gl-dock .lg-tab', { hasText: label }).first().click()
          // lit at once (before the page arrives)
          const lit = await p.evaluate(() => document.querySelector('.gl-dock .lg-tab[data-selected]')?.textContent?.trim())
          assert.equal(lit, label, `${who}: "${label}" lights at the tap`)
          await settle(p, from)
          const m = await p.evaluate(() => ({ path: location.pathname, same: window.__sameDocument === true, dock: document.querySelector('.gl-dock')?.__sameDock === true, n: document.querySelectorAll('.gl-dock').length }))
          assert.equal(m.path, path, `${who}: "${label}" opens ${path}`)
          assert.ok(m.same, `${who}: "${label}" reloaded the whole page`)
          assert.ok(m.dock && m.n === 1, `${who}: "${label}" replaced or doubled the dock`)
        }
        // two quick taps: the second one is where you end up
        const [a, b] = tabs
        const from = await p.evaluate(() => location.pathname)
        await p.locator('.gl-dock .lg-tab', { hasText: a[0] }).first().click()
        await p.waitForTimeout(80)
        await p.locator('.gl-dock .lg-tab', { hasText: b[0] }).first().click()
        await settle(p, from)
        await p.waitForTimeout(400)
        assert.equal(await p.evaluate(() => location.pathname), b[1], `${who}: a quick second tap wins`)
        assert.ok(await p.evaluate(() => window.__sameDocument === true && document.querySelector('.gl-dock')?.__sameDock === true), `${who}: quick taps kept the page and the dock`)
        // the page knows the dock is there (bars at the bottom move above it), and a task that owns the screen (a checklist being
        // filled sets html[data-task]) makes it step aside
        assert.equal(await p.evaluate(() => document.documentElement.dataset.dock), '1', `${who}: html[data-dock] while the dock is shown`)
        const hidden = await p.evaluate(async () => {
          document.documentElement.dataset.task = 'checklist'
          await new Promise((r) => requestAnimationFrame(r))
          const gone = getComputedStyle(document.querySelector('.gl-dock')).display === 'none'
          delete document.documentElement.dataset.task
          await new Promise((r) => requestAnimationFrame(r))
          return gone && getComputedStyle(document.querySelector('.gl-dock')).display !== 'none'
        })
        assert.ok(hidden, `${who}: the dock steps aside for a task and comes back after it`)
        assert.deepEqual(s.errors, [], `${who}: page errors`)
      } finally { await s.close() }
    }
  }, { timeout: 120_000 })

  stage.test('skeleton-fast', 'שרת איטי: הסרגל נשאר והשלד של הדף מופיע מיד, והתוכן מחליף אותו כשהוא מגיע', 'perf', async () => {
    const s = await open('owner', '/owner/schedule')
    try {
      const p = s.page
      await p.waitForTimeout(800) // the dock's links prefetch their loading screens
      await live().control('/__qa/fault', { mode: 'slow', ms: 2500, tables: ['branches'] })
      const t0 = Date.now()
      await p.locator('.gl-dock .lg-tab', { hasText: 'בית' }).first().click()
      await p.waitForSelector('[data-glass-skeleton]', { timeout: 4000 })
      const shown = Date.now() - t0
      assert.ok(shown < 1200, `the skeleton took ${shown} ms (server answering in 2.5 s)`)
      assert.equal(await p.locator('.gl-dock').count(), 1, 'the dock stays while the page loads')
      await p.waitForSelector('[data-glass-skeleton]', { state: 'detached', timeout: 20000 })
      assert.ok(await p.locator('.gl-welcome').first().isVisible(), 'the real dashboard replaced the skeleton')
    } finally { await live().control('/__qa/fault', { mode: 'none' }); await s.close() }
  })

  // Owner, 2026-11-05: "make revisited tabs instant and only skeleton load the fields that will need to be updated". Pages seen in
  // the last 3 minutes come from the router's cache (next.config staleTimes); their live parts re-read only their own numbers; after
  // a save the next page shown asks the server once (RouterFreshness). First visits stream: the page first, the fields after.
  const watchRevisit = (p) => p.evaluate(() => {
    window.__sawSkeleton = false
    new MutationObserver(() => { if (document.querySelector('[data-glass-skeleton], .app-loading-content, [data-live-skeleton], [data-shift-skeleton]')) window.__sawSkeleton = true }).observe(document.body, { childList: true, subtree: true })
  })
  const pageRequests = (p, path) => { const seen = []; p.on('request', (r) => { const u = new URL(r.url()); if (u.pathname === path && r.headers()['rsc'] === '1') seen.push(Date.now()) }); return seen }
  stage.test('revisit-instant', 'חזרה ללשונית שכבר ביקרתם בה: מוצגת מיד, בלי שלד ובלי בקשה לשרת', 'perf', async () => {
    for (const [who, home, other] of [['owner', '/owner/dashboard', ['סידור', '/owner/schedule']], ['dana', '/staff', ['פרופיל', '/staff/profile']]]) {
      const s = await open(who, home)
      try {
        const p = s.page
        await p.locator('.gl-dock .lg-tab', { hasText: other[0] }).first().click()
        await settle(p, home)
        await watchRevisit(p)
        const asked = pageRequests(p, home)
        const t0 = Date.now()
        await p.locator('.gl-dock .lg-tab', { hasText: 'בית' }).first().click()
        await p.waitForFunction((h) => location.pathname === h && !!document.querySelector('.gl-welcome:not(.gl-sk-card)'), home, { timeout: 5000 })
        const ms = Date.now() - t0
        await p.waitForTimeout(600)
        assert.ok(!(await p.evaluate(() => window.__sawSkeleton)), `${who}: a skeleton appeared on a revisit`)
        assert.equal(asked.length, 0, `${who}: the revisit asked the server for the page`)
        assert.ok(ms < 1200, `${who}: the revisit took ${ms} ms`)
      } finally { await s.close() }
    }
  })
  stage.test('revisit-numbers', 'חזרה אחרי יותר מ־10 שניות: רק המספרים של הלוח נקראים מחדש, במקום, בלי שלד', 'perf', async () => {
    const s = await open('owner', '/owner/dashboard')
    try {
      const p = s.page
      await p.locator('.gl-dock .lg-tab', { hasText: 'סידור' }).first().click()
      await settle(p, '/owner/dashboard')
      await p.waitForTimeout(10_500)
      await watchRevisit(p)
      const numbers = []; p.on('request', (r) => { if (r.url().includes('/api/owner/dashboard')) numbers.push(r.url()) })
      await p.locator('.gl-dock .lg-tab', { hasText: 'בית' }).first().click()
      await p.waitForFunction(() => location.pathname === '/owner/dashboard', null, { timeout: 5000 })
      await p.waitForTimeout(2000)
      assert.ok(numbers.length >= 1, 'the live numbers were not re-read on a revisit of an older copy')
      assert.ok(!(await p.evaluate(() => window.__sawSkeleton)), 'a skeleton appeared while only the numbers refreshed')
    } finally { await s.close() }
  }, { timeout: 60_000 })
  stage.test('refresh-after-save', 'אחרי שמירה: הדף הבא שמוצג נקרא מהשרת פעם אחת (לא מוצג מצב ישן)', 'e2e', async () => {
    const s = await open('owner', '/owner/dashboard')
    try {
      const p = s.page
      await p.locator('.gl-dock .lg-tab', { hasText: 'סידור' }).first().click()
      await settle(p, '/owner/dashboard')
      const id = live().db('schedule_notifications').find((n) => n.staff_id === ID.owner)?.id
      assert.ok(id, 'a notification to mark as read')
      const status = await p.evaluate(async (nid) => (await fetch('/api/staff/notifications', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: [nid] }) })).status, id)
      assert.equal(status, 200, 'the save itself')
      const asked = pageRequests(p, '/owner/dashboard')
      await p.locator('.gl-dock .lg-tab', { hasText: 'בית' }).first().click()
      await p.waitForFunction(() => location.pathname === '/owner/dashboard', null, { timeout: 5000 })
      await p.waitForTimeout(2000)
      assert.ok(asked.length >= 1, 'after a save, the page shown next was not read again from the server')
    } finally { await s.close() }
  })
  stage.test('fields-stream', 'כניסה ראשונה עם מסד נתונים איטי: הדף מופיע, ורק השדות של המספרים מנצנצים עד שהם מגיעים', 'perf', async () => {
    const s = await live().page('owner')
    try {
      const p = s.page
      await live().control('/__qa/fault', { mode: 'slow', ms: 3000, tables: ['shift_requests'] })
      await p.goto(live().base + '/owner/dashboard', { waitUntil: 'commit' })
      await p.waitForSelector('.gl-welcome:not(.gl-sk-card)', { timeout: 8000 })
      assert.ok(await p.locator('[data-live-skeleton]').count() === 1, 'the page was shown before its numbers, with the numbers shimmering')
      assert.ok(await p.locator('.gl-dock').count() === 1, 'the dock is there while the numbers load')
      await p.waitForSelector('[data-live-skeleton]', { state: 'detached', timeout: 15000 })
      assert.ok(await p.locator('.gl-stats .gl-stat').count() >= 3, 'the numbers arrived')
    } finally { await live().control('/__qa/fault', { mode: 'none' }); await s.close() }
  })

  // Owner, 2026-11-05: "the borders don't look good" — a square dark box behind the two rounded "coming soon" tiles.
  stage.test('soon-tiles', 'כרטיסי "בקרוב" בבית העובד/ת: שני כרטיסים מעוגלים בלי מלבן כהה מאחוריהם, בכל המראות', 'e2e', async () => {
    for (const look of LOOKS) {
      setLook(live, 'dana', look)
      const s = await open('dana', '/staff', { theme: look })
      try {
        const m = await s.page.evaluate(() => {
          const group = document.querySelector('.app-group:has(> .app-row--soon)')
          if (!group) return null
          const g = getComputedStyle(group)
          const tiles = [...group.querySelectorAll(':scope > .app-row--soon')].map((t) => { const c = getComputedStyle(t); return { radius: parseFloat(c.borderTopLeftRadius), bg: c.backgroundColor } })
          return { grid: g.display === 'grid', bg: g.backgroundColor, radius: parseFloat(g.borderTopLeftRadius), filter: g.backdropFilter, tiles }
        })
        assert.ok(m, `${look}: the coming-soon group is on the page`)
        if (m.grid) {
          // the bento looks: the group is only a grid, the tiles are the cards
          assert.ok(/rgba\(0, 0, 0, 0\)|transparent/.test(m.bg) && (m.filter === 'none' || !m.filter), `${look}: no box behind the tiles (${m.bg}, ${m.filter})`)
          for (const t of m.tiles) {
            assert.ok(t.radius >= 12, `${look}: tile radius ${t.radius}`)
            assert.ok(!/rgba\(0, 0, 0, 0\)/.test(t.bg), `${look}: the tile has its own surface`)
          }
        } else {
          assert.ok(m.radius >= 12, `${look}: the list card is rounded (${m.radius})`)
        }
      } finally { await s.close() }
    }
    setLook(live, 'dana', 'neon')
  })

  // The server work per screen: one sign-in check by the middleware and one shared by the layout and the page (React cache).
  stage.test('auth-once', 'בדיקת "מי מחובר" פעם אחת לבקשה: הפריסה והדף חולקים אותה (בלי סבב נוסף מול Supabase)', 'perf', async () => {
    for (const [who, url] of [['dana', '/staff'], ['owner', '/owner/dashboard'], ['dana', '/staff/profile']]) {
      await live().control('/__qa/stats', { clear: true })
      const r = await live().call(url, { as: who })
      assert.equal(r.status, 200, `${url} as ${who}`)
      const users = (await live().control('/__qa/stats')).byPath['/auth/v1/user'] ?? 0
      assert.ok(users <= 2, `${url}: asked the auth server ${users} times (middleware + one shared answer)`)
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
    const r = await run(NODE, [script, live().base], { timeout: 900_000, env: { EDGE_PATH: browserPath() ?? '' } })
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
          const over = await overflowX(s.page)
          // name what sticks out (a flaky run once said only "@768"): the widest elements past either edge
          const culprits = over > 0 ? await s.page.evaluate(() => [...document.querySelectorAll('body *')].map((el) => ({ el, r: el.getBoundingClientRect() }))
            .filter(({ r }) => r.width && (r.right > innerWidth + 0.5 || r.left < -0.5)).sort((a, b) => Math.max(b.r.right - innerWidth, -b.r.left) - Math.max(a.r.right - innerWidth, -a.r.left)).slice(0, 3)
            .map(({ el, r }) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 2).join('.')} [${Math.round(r.left)}..${Math.round(r.right)}]`).join(', ')) : ''
          assert.ok(over <= 0, `${who} ${url} @${width}: ${over} px sideways; ${culprits}`)
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
