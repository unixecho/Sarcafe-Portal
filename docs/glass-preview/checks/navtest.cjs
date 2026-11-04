const { chromium } = require('playwright')
const VIEWS = ['home', 'schedule', 'staff', 'pos', 'more']   // visual order right -> left
;(async () => {
  const b = await chromium.launch(); let fails = 0, checks = 0
  const ok = (c, msg) => { checks++; if (!c) { fails++; console.log('  FAIL', msg) } }
  for (const w of [360, 390, 430, 768, 1280]) {
    const p = await b.newPage({ viewport: { width: w, height: 800 }, hasTouch: w < 800 })
    const errs = []; p.on('pageerror', (e) => errs.push(String(e)))
    await p.goto('file://' + process.cwd() + '/wrapped.html'); await p.waitForTimeout(900)
    const bar = async () => p.locator('.lg-tab-bar').boundingBox()
    const state = () => p.evaluate(() => {
      const tabs = [...document.querySelectorAll('.lg-tab-bar [role="tab"]')]
      const sel = tabs.find((t) => t.getAttribute('aria-selected') === 'true')
      const lens = document.querySelector('.lg-tab-bar .lg-tab-lens'); const lr = lens?.getBoundingClientRect(), sr = sel?.getBoundingClientRect()
      const vis = [...document.querySelectorAll('main .view')].map((v) => !v.hidden)
      return { n: tabs.length, label: sel?.textContent?.trim(), thumbDx: lr && sr ? Math.round(Math.abs(lr.x + lr.width / 2 - (sr.x + sr.width / 2))) : null, vis, scrollY: Math.round(scrollY), order: tabs.map((t) => t.textContent.trim()).join(',') }
    })
    const first = await state(); ok(first.n === 5, `${w}px: 5 tabs, got ${first.n}`)
    // click every tab, in a shuffled order, three rounds
    const order = [3, 0, 4, 1, 2, 4, 0, 2, 3, 1, 1, 0]
    for (const i of order) {
      await p.evaluate(() => scrollTo(0, 300))
      const bb = await bar(); await p.mouse.click(bb.x + bb.width * (1 - (i + .5) / 5), bb.y + bb.height / 2); await p.waitForTimeout(650)
      const s = await state()
      ok(s.vis.filter(Boolean).length === 1 && s.vis[i] === true, `${w}px click ${VIEWS[i]}: exactly that view visible (${s.vis})`)
      ok(s.thumbDx !== null && s.thumbDx <= 6, `${w}px click ${VIEWS[i]}: thumb centred on its tab (off by ${s.thumbDx}px)`)
      ok(s.scrollY === 0, `${w}px click ${VIEWS[i]}: scrolled to top (${s.scrollY})`)
    }
    // rapid taps
    const bb = await bar()
    for (const i of [1, 3, 2, 4, 0]) { await p.mouse.click(bb.x + bb.width * (1 - (i + .5) / 5), bb.y + bb.height / 2); await p.waitForTimeout(40) }
    await p.waitForTimeout(900); let s = await state(); ok(s.vis[0] && s.thumbDx <= 6, `${w}px rapid taps end on home with thumb centred (dx ${s.thumbDx}, vis ${s.vis})`)
    // drag the thumb from home to staff
    const startX = bb.x + bb.width * (1 - 0.5 / 5), y = bb.y + bb.height / 2, endX = bb.x + bb.width * (1 - 2.5 / 5)
    await p.mouse.move(startX, y); await p.mouse.down(); for (let k = 1; k <= 12; k++) { await p.mouse.move(startX + (endX - startX) * k / 12, y); await p.waitForTimeout(16) } await p.mouse.up(); await p.waitForTimeout(900)
    s = await state(); ok(s.vis[2] && s.thumbDx <= 6, `${w}px drag home->staff lands on staff (label ${s.label}, dx ${s.thumbDx}, vis ${s.vis})`)
    // keyboard
    await p.locator('.lg-tab-bar [role="tab"][aria-selected="true"]').focus(); await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(700)
    s = await state(); ok(s.vis[3], `${w}px ArrowLeft moves to the next tab visually left (${s.label})`)
    // dock never covers the last content: bottom padding larger than dock height
    const gap = await p.evaluate(() => { const d = document.querySelector('.dock').getBoundingClientRect(); const n = document.querySelector('main .note').getBoundingClientRect(); scrollTo(0, 99999); const n2 = document.querySelector('main .note').getBoundingClientRect(); return Math.round(document.querySelector('.dock > div').getBoundingClientRect().top - n2.bottom) })
    ok(gap >= 0, `${w}px last line clears the dock (gap ${gap}px)`)
    const overflowX = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); ok(overflowX <= 0, `${w}px no horizontal scroll (${overflowX})`)
    ok(errs.length === 0, `${w}px no page errors ${errs}`)
    await p.close()
  }
  console.log(`\n${checks} checks, ${fails} failed`); await b.close()
})()
