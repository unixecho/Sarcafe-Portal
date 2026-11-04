// usage: node perf.cjs file.html  -> frame-time stats for (a) switching branch, (b) scrolling, (c) switching tabs, 4x CPU throttle
const { chromium } = require('playwright')
const file = process.argv[2]
const stats = (a) => { if (!a.length) return {}; const s = [...a].sort((x, y) => x - y); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return { frames: a.length, p50: +q(.5).toFixed(1), p95: +q(.95).toFixed(1), max: +s[s.length - 1].toFixed(1), over50: a.filter((x) => x > 50).length } }
;(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
  const c = await p.context().newCDPSession(p); await c.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await p.goto('file://' + process.cwd() + '/' + file); await p.waitForTimeout(1500)
  await p.evaluate(() => { window.__f = []; let l = performance.now(); const t = (n) => { window.__f.push(n - l); l = n; requestAnimationFrame(t) }; requestAnimationFrame(t) })
  const run = async (name, fn) => { await p.evaluate(() => { window.__f.length = 0 }); await fn(); await p.waitForTimeout(1600); const f = await p.evaluate(() => window.__f.slice(1)); console.log(name.padEnd(14), JSON.stringify(stats(f))) }
  await run('branch switch', async () => { await p.getByText('מאור', { exact: true }).first().click() })
  await run('branch back', async () => { await p.getByText('גבעת חביבה', { exact: true }).first().click() })
  await run('scroll', async () => { for (let i = 0; i < 14; i++) { await p.mouse.wheel(0, 260); await p.waitForTimeout(60) } })
  await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(300)
  await run('tab switch', async () => { const bb = await p.locator('.lg-tab-bar').boundingBox(); await p.mouse.click(bb.x + bb.width * 0.5, bb.y + bb.height / 2) })
  await b.close()
})()
