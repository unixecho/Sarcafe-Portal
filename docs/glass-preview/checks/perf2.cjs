const { chromium } = require('playwright')
const stats = (a) => { const s = [...a].sort((x, y) => x - y); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return { frames: a.length, p50: +q(.5).toFixed(1), p95: +q(.95).toFixed(1), max: +s[s.length - 1].toFixed(1), over50: a.filter((x) => x > 50).length } }
;(async () => {
  const b = await chromium.launch()
  for (const [name, css] of [['as built', ''], ['surf: no blur', '.surf{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;background-color:rgb(26 17 13/.9)!important}'], ['no blur + no glisse Glass blur', '.surf,.lg-glass{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}'], ['no content-visibility', '.cat{content-visibility:visible!important}']]) {
    const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
    const c = await p.context().newCDPSession(p); await c.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await p.goto('file://' + process.cwd() + '/wrapped.html'); if (css) await p.addStyleTag({ content: css }); await p.waitForTimeout(1500)
    await p.evaluate(() => { window.__f = []; let l = performance.now(); const t = (n) => { window.__f.push(n - l); l = n; requestAnimationFrame(t) }; requestAnimationFrame(t) })
    const runs = []
    for (let r = 0; r < 3; r++) { await p.evaluate(() => { window.__f.length = 0; scrollTo(0, 0) }); await p.waitForTimeout(400); await p.evaluate(() => { window.__f.length = 0 }); for (let i = 0; i < 16; i++) { await p.mouse.wheel(0, 240); await p.waitForTimeout(50) } await p.waitForTimeout(500); runs.push(stats(await p.evaluate(() => window.__f.slice(1)))) }
    console.log(name.padEnd(34), JSON.stringify(runs[1]), '|', 'over50 per run', runs.map((x) => x.over50).join('/'))
    await p.close()
  }
  await b.close()
})()
