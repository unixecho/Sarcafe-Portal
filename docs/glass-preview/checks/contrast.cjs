// Contrast audit: text colour vs the pixels that are really behind it (photo, glass, blur included). WCAG AA: 4.5 (3 for large text).
const { chromium } = require('playwright')
const fs = require('fs')
const W = Number(process.argv[2] || 390)
const GATHER = () => {
  const out = [], tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const lin = (c) => { c /= 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4 }
  let n; while ((n = tw.nextNode())) {
    const t = n.textContent.replace(/\s+/g, ' ').trim(); if (!t) continue
    const el = n.parentElement; if (!el || el.closest('[hidden], script, style, .sr-only, title')) continue
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') continue
    let op = 1; for (let e = el; e && e !== document.documentElement; e = e.parentElement) op *= Number(getComputedStyle(e).opacity)
    const m = cs.color.match(/[\d.]+/g).map(Number); const alpha = (m[3] ?? 1) * op; if (alpha < .05) continue
    const range = document.createRange(); range.selectNodeContents(n)
    for (const r of range.getClientRects()) {
      const x0 = Math.max(0, r.left), y0 = Math.max(0, r.top), x1 = Math.min(innerWidth, r.right), y1 = Math.min(innerHeight, r.bottom)
      if (x1 - x0 < 3 || y1 - y0 < 4) continue
      const dockTop = document.querySelector('.dock > div')?.getBoundingClientRect().top ?? innerHeight
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, top = document.elementFromPoint(cx, cy)
      if (cy > dockTop - 34 && !el.closest('.dock, .toast')) continue      // page content scrolling out under the bottom bar's fade is not being read
      const card = [...document.querySelectorAll('.lg-menu-card')].find((c) => { const q = c.getBoundingClientRect(); return cx > q.left && cx < q.right && cy > q.top && cy < q.bottom })
      if (card && !card.contains(el)) continue                                         // the menu's surface ignores the pointer, but it does cover this text
      if (!top || !(top === el || el.contains(top) || top.contains(el))) continue      // covered by something else (dock, popover): not what the viewer reads here
      out.push({ t: t.slice(0, 34), x: x0, y: y0, w: x1 - x0, h: y1 - y0, c: m.slice(0, 3), a: alpha, size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight) || 400, cls: (el.className?.toString() || el.tagName).slice(0, 28) })
    }
  }
  return out
}
const ANALYSE = async ({ b64, items }) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode()
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0)
  const L = (r, g, b) => { const f = (c) => { c /= 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4 }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b) }
  return items.map((it) => {
    const x = Math.round(it.x), y = Math.round(it.y), w = Math.max(1, Math.round(it.w)), h = Math.max(1, Math.round(it.h))
    const d = cx.getImageData(x, y, w, h).data, ratios = []
    for (let i = 0; i < d.length; i += 4) {
      const bg = [d[i], d[i + 1], d[i + 2]], fg = it.c.map((v, k) => v * it.a + bg[k] * (1 - it.a))
      const l1 = L(...fg), l2 = L(...bg), hi = Math.max(l1, l2), lo = Math.min(l1, l2); ratios.push((hi + .05) / (lo + .05))
    }
    ratios.sort((a, b) => a - b); return { ...it, ratio: ratios[Math.floor(ratios.length * .1)] }
  })
}
;(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: W, height: 844 }, deviceScaleFactor: 1 })
  await p.goto('file://' + process.cwd() + '/wrapped.html'); await p.waitForTimeout(1200)
  const results = []
  const audit = async (state) => {
    const items = await p.evaluate(GATHER)
    await p.addStyleTag({ content: '*,*::placeholder{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important}', }).then(async (h) => {
      await p.waitForTimeout(150); const b64 = (await p.screenshot()).toString('base64'); await h.evaluate((e) => e.remove())
      const res = await p.evaluate(ANALYSE, { b64, items }); res.forEach((r) => results.push({ state, ...r }))
    })
  }
  const bar = async () => p.locator('.lg-tab-bar').boundingBox()
  const goTab = async (i) => { const bb = await bar(); await p.mouse.click(bb.x + bb.width * (1 - (i + .5) / 5), bb.y + bb.height / 2); await p.waitForTimeout(900) }
  // home, scrolled top to bottom
  const total = await p.evaluate(() => document.documentElement.scrollHeight)
  for (let y = 0, k = 0; y < total; y += 600, k++) { await p.evaluate((y) => scrollTo(0, y), y); await p.waitForTimeout(450); await audit(`home y=${y}`) }
  await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(300)
  // menus and popovers
  await p.getByRole('button', { name: /התראות, 3 חדשות/ }).click(); await p.waitForTimeout(1400); await audit('notifications menu'); await p.keyboard.press('Escape'); await p.waitForTimeout(700)
  await p.getByRole('button', { name: 'החשבון שלי' }).click(); await p.waitForTimeout(1400); await audit('account menu'); await p.keyboard.press('Escape'); await p.waitForTimeout(700)
  const search = p.getByRole('combobox').first(); await search.click(); await p.waitForTimeout(700); await audit('search empty')
  await search.fill('סיד'); await p.waitForTimeout(500); await audit('search typing'); await search.fill('משלוח חלב'); await p.waitForTimeout(500); await audit('search milk'); await search.fill('qqqq'); await p.waitForTimeout(500); await audit('search none'); await p.keyboard.press('Escape'); await search.fill(''); await p.evaluate(() => document.activeElement.blur())
  // toast
  await p.evaluate(() => { document.getElementById('compose').scrollIntoView({ block: 'center' }) }); await p.waitForTimeout(400)
  await p.getByLabel('תוכן ההודעה').fill('בדיקה'); await p.getByRole('button', { name: /^שליחה ל/ }).click(); await p.waitForTimeout(500); await audit('toast + compose sent')
  await p.getByText('כל הצוות', { exact: true }).first().click(); await p.waitForTimeout(500); await audit('compose all')
  await p.getByText('משמרת מסוימת', { exact: true }).first().click(); await p.waitForTimeout(300)
  await p.getByRole('radio', { name: /שבת/ }).click(); await p.waitForTimeout(500); await audit('compose closed shift')
  // other tabs
  for (const [i, n] of [[1, 'schedule'], [2, 'staff'], [3, 'pos'], [4, 'more']]) { await goTab(i); await audit(`tab ${n}`); if (n === 'more') { await p.evaluate(() => scrollTo(0, 700)); await p.waitForTimeout(400); await audit('tab more y=700') } }
  await goTab(0); await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(300)
  await p.getByText('עובד', { exact: true }).first().click(); await p.waitForTimeout(1000)
  const total2 = await p.evaluate(() => document.documentElement.scrollHeight)
  for (let y = 0; y < total2; y += 600) { await p.evaluate((y) => scrollTo(0, y), y); await p.waitForTimeout(400); await audit(`employee y=${y}`) }
  const fails = results.filter((r) => r.ratio < ((r.size >= 24 || (r.size >= 18.66 && r.weight >= 700)) ? 3 : 4.5))
  fs.writeFileSync(`contrast-${W}.json`, JSON.stringify(results))
  console.log(`${W}px: ${results.length} text runs measured in ${new Set(results.map((r) => r.state)).size} states; ${fails.length} below AA`)
  const seen = new Set()
  for (const f of fails.sort((a, b) => a.ratio - b.ratio)) { const k = f.t + '|' + f.cls; if (seen.has(k)) continue; seen.add(k); console.log(`  ${f.ratio.toFixed(2)}  [${f.state}] "${f.t}" (${f.cls}, ${f.size}px, rgb(${f.c.map(Math.round)}) a=${f.a.toFixed(2)})`) }
  const min = results.reduce((m, r) => Math.min(m, r.ratio), 99); console.log('lowest ratio overall:', min.toFixed(2)); await b.close()
})()
