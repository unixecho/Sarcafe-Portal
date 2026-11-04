const { chromium } = require('playwright')
const SEGS = [['branch', 'גבעת חביבה'], ['view', 'מפתח'], ['audience', 'כל הצוות'], ['period', 'ערב'], ['look', 'ניאון']]
;(async () => {
  const b = await chromium.launch(); let fails = 0, checks = 0
  const ok = (c, m) => { checks++; if (!c) { fails++; console.log('  FAIL', m) } }
  for (const w of [360, 390, 1280]) {
    const p = await b.newPage({ viewport: { width: w, height: 800 } })
    await p.goto('file://' + process.cwd() + '/wrapped.html'); await p.waitForTimeout(900)
    for (const [name, text] of SEGS) {
      const seg = () => p.locator('.lg-segmented', { hasText: text }).first()
      const n = await seg().locator('.lg-tab').count(); ok(n >= 2, `${w}px ${name}: found (${n} items)`)
      const start = await seg().evaluate((el) => [...el.querySelectorAll('.lg-tab')].findIndex((t) => t.hasAttribute('data-selected')))
      for (let i = 0; i < n; i++) {
        await seg().scrollIntoViewIfNeeded(); await p.evaluate(() => scrollBy(0, -100)); await p.waitForTimeout(100)
        const bb = await seg().locator('.lg-tab').nth(i).boundingBox(); if (!bb) { ok(false, `${w}px ${name} item ${i}: not visible`); continue }
        await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.waitForTimeout(600)
        const r = await seg().evaluate((el) => { const t = el.querySelector('.lg-tab[data-selected]'); const th = el.querySelector('.lg-segmented-thumb'); if (!t || !th) return { none: true }; const rr = th.getBoundingClientRect(), tr = t.getBoundingClientRect(), er = el.getBoundingClientRect(); return { dx: Math.round(Math.abs(rr.x + rr.width / 2 - (tr.x + tr.width / 2))), inside: tr.left >= er.left - 1 && tr.right <= er.right + 1, clipped: [...el.querySelectorAll('.lg-tab')].some((x) => x.scrollWidth > x.clientWidth + 1) } })
        if (r.none) { ok(false, `${w}px ${name} item ${i}: no selected tab / thumb`); continue }
        ok(r.dx <= 4, `${w}px ${name} item ${i}: thumb off by ${r.dx}px`); ok(r.inside, `${w}px ${name} item ${i}: outside control`); ok(!r.clipped, `${w}px ${name} item ${i}: label clipped`)
      }
      const bb = await seg().locator('.lg-tab').nth(start).boundingBox(); if (bb) { await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.waitForTimeout(500) }
    }
    await p.close()
  }
  console.log(`${checks} checks, ${fails} failed`); await b.close()
})()
