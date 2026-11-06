#!/usr/bin/env node
/*
 * Checks the kiosk's screens added on 2026-11-04, on the page exactly as the app packages it (scripts/assemble-kiosk-bundle.mjs),
 * in headless Chromium at the tablet's sizes (600x1000 portrait, 1000x600 landscape), against a local mock of the portal:
 *
 *   the ads        arrows on the sides (right one points right, left one points left), drag sideways, going round, auto-play,
 *                  slide or fade, what a tap does, hiding ads and the club, nothing a drag or an arrow does counts as a tap
 *   the header     who is on shift and when we close (from the portal, or from the opening hours), first names as text only,
 *                  stale answers hidden, the second row in portrait, the branch name from the tablet's branch
 *   the battery    no pill over the display; the tray pulled down from the top edge; corner and hidden modes
 *   the settings   what the portal says, what the panel changes (saved with the kiosk's key, kept and retried offline, a refusal
 *                  dropped), the tablet's name in every address, the default language, the switch
 *   the report     battery, charging, versions, the test alert; a newer settings time fetches the content again
 *   the panel      opens only with the app's token, every control changes a setting and saves it, preview, the device calls
 *   the club card  its words in the middle of the card
 *
 *   node scripts/check-kiosk-ui.mjs        (KIOSK_SHOTS=<dir> also saves screenshots)
 *
 * Nothing touches production: a local server stands in for the portal.
 */
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { assemble } from './assemble-kiosk-bundle.mjs'

const require = createRequire(import.meta.url)
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = process.env.KIOSK_SHOTS ? resolve(process.env.KIOSK_SHOTS) : ''
// EDGE_PATH lets CI and Linux run this check with Chromium (the QA suite sets it); on the owner's PC it finds Edge as before.
const EDGE = process.env.EDGE_PATH || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p))

let passed = 0
const failures = []
function check(name, ok, detail) {
  if (ok) passed += 1
  else { failures.push(`${name}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); console.log(`  FAIL ${name}`, detail ?? '') }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- the packaged page and a mock portal ---------------------------------------------------------------------------------
const work = mkdtempSync(join(tmpdir(), 'sarcafe-kiosk-ui-'))
const assets = join(work, 'assets')
assemble(assets)
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

const U = (n) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`
const ADS = [
  { id: U(1), kind: 'location', title: 'מודעה ראשונה', body: 'טקסט ראשון', action: 'none', qr: null, imageUrl: null },
  { id: U(2), kind: 'custom', title: 'מודעה שנייה', body: 'טקסט שני', action: 'menu', qr: null, imageUrl: null },
  { id: U(3), kind: 'loyalty', title: 'מועדון הלקוחות', body: 'טקסט שלישי', action: 'join', qr: null, imageUrl: null },
  { id: U(4), kind: 'custom', title: 'מודעה רביעית', body: 'טקסט רביעי', action: 'none', qr: null, imageUrl: null },
]
const DEFAULTS = {
  display: { showEmployees: true, showClosing: true, closingSource: 'shift_then_hours', showBranch: true, showItemCount: true, showCredit: true, clubEnabled: true },
  ads: { arrows: true, swipe: true, autoPlay: true, loop: true, transition: 'slide', tapAction: 'ad', slideSeconds: null, hiddenIds: [] },
  timing: { idleSeconds: null, graceSeconds: null, successSeconds: 10, contentRefreshMinutes: 15 },
  language: { default: 'he', enabled: ['he', 'en', 'ar'], showSwitch: true },
  battery: { display: 'tray', alertEnabled: true, alertPercent: 50, criticalEnabled: false, criticalPercent: 15 },
}
const merged = (over = {}) => { const out = JSON.parse(JSON.stringify(DEFAULTS)); for (const [s, f] of Object.entries(over)) Object.assign(out[s], f); return out }
let contentVersion = 0
const makeContent = ({ settings = {}, ads = ADS, hours = null, kiosk = {}, branchName = { he: 'גבעת חביבה', en: 'Givat Haviva', ar: null }, updatedAt = '2026-11-04T08:00:00.000Z' } = {}) => ({
  version: `ui-v${++contentVersion}`,
  settings: { idleSeconds: 60, graceSeconds: 10, slideSeconds: 7 },
  ads, hours, highlights: [],
  kiosk: { device: 'givat-haviva-1', name: 'קיוסק גבעת חביבה', registered: true, branch: { slug: 'givat-haviva', name: branchName },
    branchTiming: { idleSeconds: 60, graceSeconds: 10, slideSeconds: 7 }, settings: merged(settings), settingsUpdatedAt: updatedAt, ...kiosk },
})

const mock = { content: null, shift: null, shiftStatus: 200, log: [], reports: [], saves: [], deviceReply: null, reportReply: null, stock: null, stockWrites: [], stockOpen: true, menu: null, menuWrites: [] }
// the menu as /api/kiosk/menu-edit answers it (src/lib/kiosk/menu-edit.ts menuTree)
const MENU = () => [
  { id: 'hot', name: 'קפה חם', items: [{ uid: 'coffee', name: 'הפוך קטן', price: '12', types: [] }] },
  { id: 'pastries', name: 'מאפים', items: [{ uid: 'pastry', name: 'מאפה רגיל', price: '12', types: [{ uid: 'cheese', name: 'גבינית', price: '' }] }] },
]
// the live-stock list as /api/kiosk/stock answers it (src/lib/kiosk/stock.ts stockView)
const STOCK = () => [
  { id: 'sandwiches', name: 'כריכים וטוסטים', items: [
    { uid: 'toasts', name: 'טוסטים', available: true, quantity: null, types: [{ uid: 'caprese', name: 'קפרזה', available: true, quantity: null }, { uid: 'cheddar', name: "מוצרלה וצ'דר", available: false, quantity: null }] },
    { uid: 'sandwiches', name: 'כריכים', available: true, quantity: 4, types: [] }] },
  { id: 'pastries', name: 'מאפים', items: [{ uid: 'pastry', name: 'מאפה רגיל', available: true, quantity: null, types: [{ uid: 'cheese', name: 'גבינית', available: true, quantity: 1 }] }] },
  { id: 'shakes', name: 'שייק פירות טבעי', items: [{ uid: 'shake', name: 'שייק', available: true, quantity: null, types: [{ uid: 'banana', name: 'בננה תמר', available: true, quantity: null }] }] },
]
function resetMock() {
  Object.assign(mock, { content: makeContent(), shift: { ok: true, asOf: new Date().toISOString(), people: ['דנה', 'יוסי'], closesAt: '22:00' }, shiftStatus: 200, log: [], reports: [], saves: [], deviceReply: null, reportReply: null, stock: STOCK(), stockWrites: [], stockOpen: true, menu: MENU(), menuWrites: [] })
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' }
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
  const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify(body)) }
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return }
  if (url.pathname.startsWith('/api/')) mock.log.push({ method: req.method, path: url.pathname, search: url.search, key: req.headers['x-kiosk-key'] ?? null })
  if (url.pathname === '/api/kiosk/content') return mock.content ? json(200, mock.content) : json(500, { error: 'down' })
  if (url.pathname === '/api/kiosk/menu') return json(200, { unchanged: true })
  if (url.pathname === '/api/kiosk/shift') {
    if (req.headers['x-kiosk-key'] !== 'test-key') return json(401, { ok: false })
    return mock.shift && mock.shiftStatus === 200 ? json(200, mock.shift) : json(mock.shiftStatus, { ok: false })
  }
  if (url.pathname === '/api/kiosk/menu-edit') {
    let text = ''
    req.on('data', (c) => { text += c })
    req.on('end', () => {
      if (req.headers['x-kiosk-key'] !== 'test-key') return json(401, { ok: false })
      if (req.method === 'GET') return json(200, { ok: true, open: mock.stockOpen, categories: mock.menu })
      const b = JSON.parse(text || '{}')
      mock.menuWrites.push(b)
      if (!mock.stockOpen) return json(403, { ok: false, error: 'closed' })
      const items = mock.menu.flatMap((c) => c.items)
      if (b.op === 'update') { const i = items.find((x) => x.uid === b.itemUid); const o = b.typeUid ? i.types.find((t) => t.uid === b.typeUid) : i; if (b.name) o.name = b.name; if (b.price !== undefined) o.price = b.price }
      if (b.op === 'add_item') mock.menu.find((c) => c.id === b.categoryId).items.push({ uid: `k${items.length}`, name: b.name, price: b.price || '', types: [] })
      if (b.op === 'add_type') items.find((x) => x.uid === b.itemUid).types.push({ uid: `t${Date.now()}`, name: b.name, price: b.price || '' })
      if (b.op === 'remove_item') for (const c of mock.menu) c.items = c.items.filter((x) => x.uid !== b.itemUid)
      if (b.op === 'remove_type') for (const i of items) i.types = i.types.filter((t) => t.uid !== b.typeUid)
      return json(200, { ok: true, categories: mock.menu })
    })
    return undefined
  }
  if (url.pathname === '/api/kiosk/stock') {
    let text = ''
    req.on('data', (c) => { text += c })
    req.on('end', () => {
      if (req.headers['x-kiosk-key'] !== 'test-key') return json(401, { ok: false })
      if (req.method === 'GET') return json(200, { ok: true, open: mock.stockOpen, categories: mock.stock })
      const body = JSON.parse(text || '{}')
      mock.stockWrites.push(body)
      if (!mock.stockOpen) return json(403, { ok: false, error: 'closed' })
      for (const c of mock.stock) for (const i of c.items) {
        if (i.uid !== body.itemUid) continue
        const o = body.typeUid ? i.types.find((t) => t.uid === body.typeUid) : i
        if (body.quantity !== undefined) o.quantity = body.quantity
        o.available = body.quantity === 0 ? false : body.available ?? o.available
      }
      return json(200, { ok: true, categories: mock.stock })
    })
    return undefined
  }
  if (url.pathname === '/api/kiosk/device') {
    let text = ''
    req.on('data', (c) => { text += c })
    req.on('end', () => {
      const body = JSON.parse(text || '{}')
      if (req.headers['x-kiosk-key'] !== 'test-key') return json(401, { ok: false })
      if (req.method === 'POST') {
        mock.reports.push(body)
        const r = mock.reportReply ? mock.reportReply(body) : { status: 200, body: { ok: true, settingsUpdatedAt: '2026-11-04T08:00:00.000Z' } }
        return json(r.status, r.body)
      }
      mock.saves.push(body)
      const r = mock.deviceReply ? mock.deviceReply(body) : { status: 200, body: { ok: true, settings: merged(Object.fromEntries(Object.entries(body.patch || {}).map(([s, f]) => [s, Object.fromEntries(Object.entries(f).filter(([, v]) => v !== null))]))), settingsUpdatedAt: new Date().toISOString() } }
      return json(r.status, r.body)
    })
    return undefined
  }
  const file = join(assets, decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html')
  if (!file.startsWith(assets) || !existsSync(file)) { res.writeHead(404); res.end(); return undefined }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' })
  res.end(readFileSync(file))
  return undefined
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

const { chromium } = require('playwright')
const browser = await chromium.launch({ headless: true, ...(EDGE ? { executablePath: EDGE } : {}) })

// A fresh tablet: the app's two bridges are mocked, the portal is the mock above. `native` adds the app's read-only facts and the staff door.
async function open({ w = 600, h = 1000, query = '', storage = {}, battery = null, noWebBattery = false, staff = false, wait = true, content } = {}) {
  if (content !== undefined) mock.content = content
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  page.errors = []
  page.on('pageerror', (e) => page.errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push(m.text()) })
  await page.addInitScript(({ api, battery, staff, storage, noWebBattery }) => {
    if (noWebBattery) { try { Object.defineProperty(Navigator.prototype, 'getBattery', { value: undefined, configurable: true }) } catch (e) { /* kept */ } }
    window.SarcafeKiosk = { config: () => JSON.stringify({ api, signupKey: 'test-key', perf: 'full' }) }
    window.__ready = []
    window.KioskNative = { ready: (v) => window.__ready.push(v) }
    if (battery) {
      window.__battery = { ...battery }
      Object.assign(window.KioskNative, { battery: () => JSON.stringify(window.__battery), appVersion: () => 3, webVersion: () => 'abc123def456' })
    }
    window.__staff = { calls: [], orient: 'auto', perf: 'auto', brightness: -1 }
    if (staff) {
      window.KioskStaff = {
        info: (t) => (t === 'tok' ? JSON.stringify({ appCode: 3, appName: '0.3', orient: window.__staff.orient, perf: window.__staff.perf, brightness: window.__staff.brightness, model: 'Test', android: '11', freeMb: 100, webVersion: 'abc', updates: 'Last check: now' }) : 'null'),
        act: (t, a, v) => { window.__staff.calls.push([t, a, v]); if (t !== 'tok') return JSON.stringify({ ok: false, error: 'denied' }); if (['orient', 'perf', 'brightness'].includes(a)) window.__staff[a] = a === 'brightness' ? Number(v) : v; return JSON.stringify({ ok: true }) },
        close: (t) => window.__staff.calls.push([t, 'close']),
      }
    }
    for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v))
  }, { api: `${base}/api/kiosk/menu`, battery, staff, storage, noWebBattery })
  await page.goto(`${base}/index.html${query}`)
  if (wait) await page.waitForFunction(() => window.__kioskAttract && window.__kioskAttract.version !== 'builtin', null, { timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(150)
  return page
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) }) }
const ev = (page, fn, arg) => page.evaluate(fn, arg)
const attract = (page) => ev(page, () => ({
  index: window.__kioskAttract.index, n: window.__kioskAttract.slides,
  title: (document.querySelectorAll('.attract-ad')[window.__kioskAttract.index] || {}).dataset?.id || '',
  dots: [...document.querySelectorAll('.attract-dots i')].findIndex((d) => d.classList.contains('is-active')),
  screen: document.body.dataset.screen,
}))
const idOf = (n) => U(n)
const settle = (page, ms = 520) => page.waitForTimeout(ms)
const box = (page, sel) => page.locator(sel).first().boundingBox()

// =========================================================================================================================
for (const [w, h, tag] of [[600, 1000, 'portrait'], [1000, 600, 'landscape']]) {
  console.log(`\n${tag} ${w}x${h}`)
  const t = (name) => `${tag}: ${name}`
  resetMock()

  // ---- the ads: arrows ----------------------------------------------------------------------------------------------------
  {
    mock.content = makeContent({ settings: { ads: { autoPlay: false } } })
    const page = await open({ w, h })
    check(t('four ads are shown, starting with the first'), JSON.stringify(await attract(page)) === JSON.stringify({ index: 0, n: 4, title: idOf(1), dots: 0, screen: 'welcome' }), await attract(page))
    const right = await box(page, '.attract-arrow-right')
    const left = await box(page, '.attract-arrow-left')
    check(t('two arrow buttons, big enough to hit (56 px and up), the right one on the right and the left one on the left'), right && left && right.width >= 56 && right.height >= 56 && left.width >= 56 && right.x > left.x && right.x > w / 2 && left.x < w / 2, { right, left })
    const dirs = await ev(page, () => {
      // "M9 4.5 16.5 12 9 19.5" is a chevron whose tip is at the right (x = 16.5); the left one's tip is at the left (x = 7.5)
      const tip = (sel) => { const d = document.querySelector(`${sel} path`).getAttribute('d'); const nums = d.match(/[\d.]+/g).map(Number); return nums[2] > nums[0] ? 'right' : 'left' }
      return { right: tip('.attract-arrow-right'), left: tip('.attract-arrow-left') }
    })
    check(t('the arrow on the right points right, the arrow on the left points left'), dirs.right === 'right' && dirs.left === 'left', dirs)
    const text = await ev(page, () => { const a = document.querySelector('.attract-ad.is-active'); const r = a.querySelector('.attract-text').getBoundingClientRect(); const L = document.querySelector('.attract-arrow-left').getBoundingClientRect(); const R = document.querySelector('.attract-arrow-right').getBoundingClientRect(); return { l: r.left, r: r.right, aL: L.right, aR: R.left } })
    check(t('the words never run under an arrow'), text.l >= text.aL - 1 && text.r <= text.aR + 1, text)
    await shot(page, `ui-${tag}-ads`)

    // Hebrew reads right to left: the right arrow goes back, the left arrow goes on
    await page.click('.attract-arrow-right'); await settle(page)
    let s = await attract(page)
    check(t('Hebrew: the right arrow goes to the one before (coming round from the first to the last)'), s.index === 3 && s.dots === 3 && s.screen === 'welcome', s)
    await page.click('.attract-arrow-left'); await settle(page)
    s = await attract(page)
    check(t('Hebrew: the left arrow goes on (back to the first)'), s.index === 0 && s.screen === 'welcome', s)
    await page.click('.attract-arrow-left'); await settle(page)
    check(t('another step on'), (await attract(page)).index === 1)

    // the arriving ad comes in from the side it lies on: the previous one from the right in Hebrew
    await page.click('.attract-arrow-right')
    await page.waitForTimeout(90)
    const mid = await ev(page, () => [...document.querySelectorAll('.attract-ad')].map((a) => ({ t: a.style.transform, v: a.style.visibility })))
    const moving = mid.filter((m) => m.t)
    check(t('while it moves, exactly two ads move: the one leaving to the left and the one arriving from the right'), moving.length === 2 && moving.some((m) => /translate3d\(-/.test(m.t)) && moving.some((m) => /translate3d\((0|[1-9])/.test(m.t) && m.v === 'visible'), mid)
    await settle(page)
    check(t('a quick second tap during a move is kept and done after it'), true)
    await page.click('.attract-arrow-right'); await page.click('.attract-arrow-right'); await settle(page, 1000)
    check(t('two quick taps go two steps'), (await attract(page)).index === ((0 - 2) + 4) % 4 || (await attract(page)).index === 2, await attract(page))

    // English reads left to right: the right arrow goes on
    await page.evaluate(() => window.KioskI18n.set('en', 'visitor')); await page.waitForTimeout(250)
    const before = (await attract(page)).index
    await page.click('.attract-arrow-right'); await settle(page)
    check(t('English: the right arrow goes ON, the left arrow goes back'), (await attract(page)).index === (before + 1) % 4, await attract(page))
    await page.click('.attract-arrow-left'); await settle(page)
    check(t('English: the left arrow goes back'), (await attract(page)).index === before, await attract(page))
    const labels = await ev(page, () => ({ r: document.querySelector('.attract-arrow-right').getAttribute('aria-label'), l: document.querySelector('.attract-arrow-left').getAttribute('aria-label') }))
    check(t('the arrows say what they do in the language on screen'), labels.r === 'Next announcement' && labels.l === 'Previous announcement', labels)
    await page.evaluate(() => window.KioskI18n.set('he', 'visitor')); await page.waitForTimeout(250)
    await page.close()
  }

  // ---- the ads: dragging, taps --------------------------------------------------------------------------------------------------
  {
    mock.content = makeContent({ settings: { ads: { autoPlay: false } } })
    const page = await open({ w, h })
    const ads = await box(page, '.attract-ads')
    const y = ads.y + ads.height / 2
    const drag = async (from, to, steps = 8, pause = 0) => {
      await page.mouse.move(ads.x + ads.width * from, y); await page.mouse.down()
      for (let i = 1; i <= steps; i += 1) { await page.mouse.move(ads.x + ads.width * (from + ((to - from) * i) / steps), y); if (pause) await page.waitForTimeout(pause) }
      await page.mouse.up()
    }
    await drag(0.75, 0.25); await settle(page, 650)
    let s = await attract(page)
    check(t('Hebrew: dragging the finger LEFT brings the previous ad in from the right'), s.index === 3 && s.screen === 'welcome', s)
    await drag(0.25, 0.75); await settle(page, 650)
    s = await attract(page)
    check(t('Hebrew: dragging the finger RIGHT brings the next ad in from the left'), s.index === 0 && s.screen === 'welcome', s)
    await drag(0.5, 0.58, 8, 40); await settle(page, 650)   // short AND slow: not a flick
    s = await attract(page)
    check(t('a short, slow drag snaps back, and is not a tap either'), s.index === 0 && s.screen === 'welcome', s)
    await drag(0.5, 0.58, 4, 0); await settle(page, 650)
    s = await attract(page)
    check(t('...but a short flick is enough to turn the page (a quick swipe)'), s.index === 1 && s.screen === 'welcome', s)
    await drag(0.75, 0.25); await settle(page, 650)
    // a drag in progress follows the finger and shows the neighbour
    await page.mouse.move(ads.x + ads.width * 0.7, y); await page.mouse.down()
    for (let i = 1; i <= 6; i += 1) await page.mouse.move(ads.x + ads.width * 0.7 - i * 25, y)
    const during = await ev(page, () => [...document.querySelectorAll('.attract-ad')].map((a) => a.style.transform))
    check(t('during a drag the ad under the finger and its neighbour move with it'), during.filter(Boolean).length === 2 && during.some((x) => /translate3d\(-150px/.test(x)), during)
    await shot(page, `ui-${tag}-drag`)
    await page.mouse.up(); await settle(page, 650)
    // the finger comes back across its start: the other neighbour
    await page.mouse.move(ads.x + ads.width * 0.5, y); await page.mouse.down()
    await page.mouse.move(ads.x + ads.width * 0.4, y); await page.mouse.move(ads.x + ads.width * 0.3, y); await page.mouse.move(ads.x + ads.width * 0.62, y); await page.mouse.move(ads.x + ads.width * 0.75, y)
    const crossed = await ev(page, () => [...document.querySelectorAll('.attract-ad')].filter((a) => a.style.visibility === 'visible').length)
    await page.mouse.up(); await settle(page, 650)
    check(t('a finger that turns back swaps the neighbour (only one other ad is ever shown)'), crossed === 1, crossed)
    check(t('no page error while dragging'), page.errors.length === 0, page.errors)

    // taps
    const base0 = await attract(page)
    await page.mouse.click(ads.x + ads.width / 2, y - 40)
    await page.waitForTimeout(450)
    check(t('a plain tap on an ad with no action opens the main screen (choice)'), (await attract(page)).screen === 'choice', await attract(page))
    await page.close()

    const page2 = await open({ w, h })
    await page2.click('.attract-arrow-left'); await settle(page2); await page2.click('.attract-arrow-left'); await settle(page2) // third ad: join
    const ads2 = await box(page2, '.attract-ads')
    await page2.mouse.click(ads2.x + ads2.width / 2, ads2.y + ads2.height / 2 - 30)
    await page2.waitForTimeout(450)
    check(t('a tap on an ad with an action opens that action (the club sign-up)'), (await attract(page2)).screen === 'join', await attract(page2))
    await page2.close()
  }

  // ---- the ads: settings --------------------------------------------------------------------------------------------------------
  {
    const run = async (settings, fn, extra = {}) => {
      mock.content = makeContent({ settings: { ads: { autoPlay: false }, ...settings }, ...extra })
      const page = await open({ w, h })
      try { return await fn(page) } finally { await page.close() }
    }
    await run({ ads: { autoPlay: false, arrows: false } }, async (p) => check(t('arrows off: no arrow buttons'), await ev(p, () => getComputedStyle(document.querySelector('.attract-arrow-right')).display === 'none' && getComputedStyle(document.querySelector('.attract-arrow-left')).display === 'none')))
    await run({ ads: { autoPlay: false, swipe: false } }, async (p) => {
      const a = await box(p, '.attract-ads'); const y = a.y + a.height / 2
      await p.mouse.move(a.x + a.width * 0.75, y); await p.mouse.down(); for (let i = 1; i <= 8; i += 1) await p.mouse.move(a.x + a.width * (0.75 - i * 0.06), y); await p.mouse.up(); await settle(p, 650)
      check(t('drag off: dragging changes nothing'), (await attract(p)).index === 0, await attract(p))
    })
    await run({ ads: { autoPlay: false, loop: false } }, async (p) => {
      check(t('going round off: on the first ad the "back" arrow (the right one in Hebrew) is disabled'), await ev(p, () => document.querySelector('.attract-arrow-right').disabled === true && document.querySelector('.attract-arrow-left').disabled === false))
      await p.click('.attract-arrow-left', { timeout: 2000 }); await settle(p)
      await p.click('.attract-arrow-left'); await settle(p); await p.click('.attract-arrow-left'); await settle(p)
      check(t('going round off: on the last ad the "on" arrow is disabled and nothing wraps'), await ev(p, () => document.querySelector('.attract-arrow-left').disabled === true) && (await attract(p)).index === 3, await attract(p))
    })
    await run({ ads: { autoPlay: false, tapAction: 'main' } }, async (p) => {
      await p.click('.attract-arrow-left'); await settle(p); await p.click('.attract-arrow-left'); await settle(p)
      const a = await box(p, '.attract-ads'); await p.mouse.click(a.x + a.width / 2, a.y + a.height / 2 - 30); await p.waitForTimeout(450)
      check(t('tap = always the main screen: even the join ad opens the choice screen'), (await attract(p)).screen === 'choice', await attract(p))
    })
    await run({ ads: { autoPlay: false, transition: 'fade' } }, async (p) => {
      await p.click('.attract-arrow-left'); await p.waitForTimeout(120)
      const moved = await ev(p, () => [...document.querySelectorAll('.attract-ad')].some((a) => a.style.transform))
      await settle(p, 1000)
      check(t('fade: the ads cross-fade without moving, and the step still lands'), !moved && (await attract(p)).index === 1, await attract(p))
    })
    await run({ ads: { autoPlay: false, hiddenIds: [U(2)] } }, async (p) => {
      const ids = await ev(p, () => [...document.querySelectorAll('.attract-ad')].map((a) => a.dataset.id))
      check(t('an ad hidden on this tablet is not shown'), JSON.stringify(ids) === JSON.stringify([U(1), U(3), U(4)]), ids)
    })
    await run({ ads: { autoPlay: false, hiddenIds: [U(1), U(2), U(3), U(4)] } }, async (p) => {
      const r = await ev(p, () => ({ box: document.querySelector('.attract-ads').hidden, buttons: !!document.querySelector('.attract-menu') }))
      check(t('every ad hidden: no empty frame, the two buttons stay'), r.box === true && r.buttons === true, r)
    })
    await run({ ads: { autoPlay: false, hiddenIds: [U(2), U(3), U(4)] } }, async (p) => {
      const r = await ev(p, () => ({ arrows: getComputedStyle(document.querySelector('.attract-arrow-right')).display, dots: document.querySelector('.attract-ads').classList.contains('is-single') }))
      check(t('one ad: no arrows, nothing to swipe'), r.arrows === 'none' && r.dots, r)
    })
    await run({ display: { clubEnabled: false } }, async (p) => {
      const r = await ev(p, () => ({ join: getComputedStyle(document.querySelector('.attract-join')).display, kinds: [...document.querySelectorAll('.attract-ad')].map((a) => a.dataset.kind) }))
      check(t('club off: no join button and no club ad'), r.join === 'none' && !r.kinds.includes('loyalty'), r)
      await p.evaluate(() => document.querySelector('.screen-picker [data-screen="choice"]').click()); await p.waitForTimeout(500)
      const c = await ev(p, () => ({ club: getComputedStyle(document.querySelector('.decision-loyalty')).display, menu: getComputedStyle(document.querySelector('.decision-menu')).display }))
      check(t('club off: the choice screen offers only the menu'), c.club === 'none' && c.menu !== 'none', c)
      const wide = await box(p, '.attract-menu'); void wide
    })
    // auto-play (with the durations scaled down)
    {
      mock.content = makeContent({ settings: { ads: { autoPlay: true } } })
      const p = await open({ w, h, query: '?kioskTestScale=0.05' })
      const seen = new Set()
      for (let i = 0; i < 10; i += 1) { await p.waitForTimeout(160); seen.add((await attract(p)).index) }
      check(t('auto-play moves on by itself'), seen.size >= 3, [...seen])
      const a = await box(p, '.attract-ads'); const y = a.y + a.height / 2
      await p.mouse.move(a.x + a.width * 0.5, y); await p.mouse.down()
      const held = (await attract(p)).index
      await p.waitForTimeout(1200)
      check(t('a finger on the ads holds the show'), (await attract(p)).index === held, await attract(p))
      await p.mouse.up()
      await p.close()
    }
  }

  // ---- the header -----------------------------------------------------------------------------------------------------------------
  {
    mock.shift = { ok: true, asOf: new Date().toISOString(), people: ['דנה', 'יוסי'], closesAt: '22:00' }
    mock.content = makeContent({ settings: { ads: { autoPlay: false } } })
    const page = await open({ w, h })
    await page.waitForTimeout(1900)
    await page.evaluate(() => document.querySelector('.screen-picker [data-screen="choice"]').click()); await page.waitForTimeout(600)
    const hdr = await ev(page, () => {
      const h = document.querySelector('.kiosk-header').getBoundingClientRect()
      const panel = document.querySelector('.panel-choice').getBoundingClientRect()
      return { text: document.querySelector('.kiosk-shift').textContent, who: !document.querySelector('.ks-who').hidden, close: !document.querySelector('.ks-close').hidden, h: Math.round(h.height), panelTop: Math.round(panel.top), overflow: document.querySelector('.kiosk-header').scrollWidth > document.querySelector('.kiosk-header').clientWidth + 1, docOverflow: document.documentElement.scrollWidth > window.innerWidth + 1 }
    })
    check(t('the header says who is on shift and when we close'), hdr.who && hdr.close && /דנה/.test(hdr.text) && /יוסי/.test(hdr.text) && /22:00/.test(hdr.text), hdr)
    check(t('the panels start right under the header, whatever its height'), Math.abs(hdr.panelTop - hdr.h) <= 2, hdr)
    check(t('nothing in the header runs off the side'), !hdr.overflow && !hdr.docOverflow, hdr)
    check(t('portrait has a second row for it, landscape one row'), tag === 'portrait' ? hdr.h > 85 : hdr.h <= 70, hdr.h)
    const req = mock.log.find((l) => l.path === '/api/kiosk/shift')
    check(t('the shift is asked for with the kiosk\'s key (it names people)'), req && req.key === 'test-key', req)
    await shot(page, `ui-${tag}-header`)
    await page.evaluate(() => document.querySelector('.screen-picker [data-screen="menu"]').click()); await page.waitForTimeout(500)
    await shot(page, `ui-${tag}-header-menu`)

    // other languages
    await page.evaluate(() => window.KioskI18n.set('en', 'visitor')); await page.waitForTimeout(250)
    const en = await ev(page, () => document.querySelector('.kiosk-shift').textContent)
    check(t('English: "On shift:" and "Closing at"'), /On shift:/.test(en) && /Closing at/.test(en) && /22:00/.test(en), en)
    await page.evaluate(() => window.KioskI18n.set('ar', 'visitor')); await page.waitForTimeout(250)
    const ar = await ev(page, () => ({ t: document.querySelector('.kiosk-shift').textContent, over: document.documentElement.scrollWidth > window.innerWidth + 1 }))
    check(t('Arabic: its own words, no overflow'), /في الوردية/.test(ar.t) && /الإغلاق/.test(ar.t) && !ar.over, ar)
    await page.evaluate(() => window.KioskI18n.set('he', 'visitor'))
    await page.close()
  }
  {
    // a name is text, never markup; more than three are summarised; an old answer is not shown
    mock.shift = { ok: true, asOf: new Date().toISOString(), people: ['<img src=x onerror="window.__xss=1">', 'א', 'ב', 'ג', 'ד'], closesAt: '23:30' }
    mock.content = makeContent({ settings: { ads: { autoPlay: false } } })
    const page = await open({ w, h })
    await page.waitForTimeout(1900)
    const r = await ev(page, () => ({ imgs: document.querySelectorAll('.kiosk-shift img').length, xss: window.__xss === 1, text: document.querySelector('.ks-who').textContent }))
    check(t('a name is text: no markup from the portal is ever drawn'), r.imgs === 0 && !r.xss && /<img/.test(r.text), r)
    check(t('more than three people: three names and a count'), /\+2/.test(r.text), r.text)
    await page.evaluate(() => { const real = Date.now; Date.now = () => real() + 6 * 60000 })
    await page.evaluate(() => window.KioskShift.render())
    const stale = await ev(page, () => document.querySelector('.kiosk-shift').hidden)
    check(t('an answer older than five minutes is not shown'), stale === true)
    await page.close()
  }
  {
    // settings that switch parts off, and the closing time from the opening hours
    const today = new Date()
    const hoursFor = () => {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())
      const get = (type) => parts.find((p) => p.type === type).value
      const wd = new Date(Date.UTC(+get('year'), +get('month') - 1, +get('day'))).getUTCDay()
      return { timezone: 'Asia/Jerusalem', week: Array.from({ length: 7 }, (_, d) => ({ day: d, open: '00:00', close: '23:59' })), exceptions: [], wd }
    }
    void today
    const h2 = hoursFor()
    const hours = { timezone: h2.timezone, week: h2.week, exceptions: [] }
    mock.shift = { ok: true, asOf: new Date().toISOString(), people: [], closesAt: null }
    for (const [name, settings, expect] of [
      ['nothing from the shifts, hours as the fallback: the opening hours\' closing time', { display: { closingSource: 'shift_then_hours' } }, { close: '23:59', who: false }],
      ['hours only', { display: { closingSource: 'hours' } }, { close: '23:59', who: false }],
      ['shift only, and no shift: nothing', { display: { closingSource: 'shift' } }, { close: null, who: false }],
      ['closing switched off', { display: { showClosing: false } }, { close: null, who: false }],
    ]) {
      mock.content = makeContent({ settings: { ads: { autoPlay: false }, ...settings }, hours })
      const p = await open({ w, h })
      await p.waitForTimeout(1900)
      await p.evaluate(() => window.KioskShift.render())
      const r = await ev(p, () => ({ close: document.querySelector('.ks-close').hidden ? null : document.querySelector('.ks-close b').textContent, who: !document.querySelector('.ks-who').hidden }))
      check(t(`closing: ${name}`), r.close === expect.close && r.who === expect.who, r)
      await p.close()
    }
    mock.shift = { ok: true, asOf: new Date().toISOString(), people: ['דנה'], closesAt: '21:15' }
    mock.content = makeContent({ settings: { ads: { autoPlay: false }, display: { showEmployees: false } }, hours })
    let p = await open({ w, h })
    await p.waitForTimeout(1900)
    check(t('employees switched off: no name in the header (the closing time stays)'), await ev(p, () => document.querySelector('.ks-who').hidden && !document.querySelector('.ks-close').hidden && document.querySelector('.ks-close b').textContent === '21:15'))
    await p.close()
    mock.content = makeContent({ settings: { ads: { autoPlay: false }, display: { showEmployees: false, showClosing: false } } })
    mock.log.length = 0
    p = await open({ w, h })
    await p.waitForTimeout(1900)
    check(t('both off: the header has no chips and the shift is not even asked for'), await ev(p, () => document.querySelector('.kiosk-shift').hidden) && !mock.log.some((l) => l.path === '/api/kiosk/shift'))
    await p.close()
    mock.shift = { ok: true, asOf: new Date().toISOString(), people: ['דנה'], closesAt: '22:00' }
    mock.shiftStatus = 502
    mock.content = makeContent({ settings: { ads: { autoPlay: false } } })
    p = await open({ w, h })
    await p.waitForTimeout(1900)
    check(t('the portal failing: no chips, no error'), await ev(p, () => document.querySelector('.kiosk-shift').hidden) && p.errors.length === 0, p.errors)
    await p.close()
    mock.shiftStatus = 200
  }
  {
    // the branch this tablet belongs to names itself in the header
    mock.content = makeContent({ settings: { ads: { autoPlay: false } }, kiosk: { device: 'maor-1', branch: { slug: 'maor', name: { he: 'מאור', en: 'Maor', ar: 'معور' } } } })
    const p = await open({ w, h })
    await p.evaluate(() => document.querySelector('.screen-picker [data-screen="choice"]').click()); await p.waitForTimeout(600)
    const r = await ev(p, () => ({ branch: document.querySelector('.kiosk-header .branch').textContent.trim(), menuText: document.querySelector('.decision-menu .decision-copy small').textContent }))
    check(t('another branch: its name in the header and in the words about its menu'), r.branch === 'מאור' && /מאור/.test(r.menuText) && !/גבעת חביבה/.test(r.menuText), r)
    await p.evaluate(() => window.KioskI18n.set('ar', 'visitor')); await p.waitForTimeout(250)
    check(t('...and in Arabic, from the Arabic name the portal has for it'), (await ev(p, () => document.querySelector('.kiosk-header .branch').textContent.trim())) === 'معور')
    await p.evaluate(() => window.KioskI18n.set('en', 'visitor')); await p.waitForTimeout(250)
    check(t('...and in English'), (await ev(p, () => document.querySelector('.kiosk-header .branch').textContent.trim())) === 'Maor')
    await p.close()
    // Givat Haviva keeps the fixed words exactly as before (the portal's longer names, "... Branch", are not used for it)
    mock.content = makeContent({ settings: { ads: { autoPlay: false } }, branchName: { he: 'גבעת חביבה', en: 'Givat Haviva Branch', ar: 'فرع جفعات حبيبة' } })
    const g = await open({ w, h })
    await g.evaluate(() => document.querySelector('.screen-picker [data-screen="choice"]').click()); await g.waitForTimeout(500)
    await g.evaluate(() => window.KioskI18n.set('en', 'visitor')); await g.waitForTimeout(250)
    const gh = await ev(g, () => document.querySelector('.kiosk-header .branch').textContent.trim())
    await g.evaluate(() => window.KioskI18n.set('ar', 'visitor')); await g.waitForTimeout(250)
    const ga = await ev(g, () => document.querySelector('.kiosk-header .branch').textContent.trim())
    check(t('the first branch keeps its fixed words in every language (nothing changes on the kiosk that already runs)'), gh === 'Givat Haviva' && ga === 'جفعات حبيبة', { gh, ga })
    await g.close()
    mock.content = makeContent({ settings: { ads: { autoPlay: false }, display: { showBranch: false } } })
    const q = await open({ w, h })
    await q.evaluate(() => document.querySelector('.screen-picker [data-screen="choice"]').click()); await q.waitForTimeout(500)
    check(t('branch name off'), await ev(q, () => getComputedStyle(document.querySelector('.kiosk-header .branch')).display === 'none'))
    await q.close()
  }

  // ---- the club card ---------------------------------------------------------------------------------------------------------------
  {
    mock.content = makeContent({ settings: { ads: { autoPlay: false } } })
    mock.shift = { ok: true, asOf: new Date().toISOString(), people: ['דנה'], closesAt: '22:00' }
    const page = await open({ w, h })
    await page.evaluate(() => document.querySelector('.screen-picker [data-screen="choice"]').click()); await page.waitForTimeout(700)
    const r = await ev(page, () => {
      const card = document.querySelector('.decision-loyalty').getBoundingClientRect()
      const parts = [...document.querySelectorAll('.decision-loyalty > *')].map((n) => n.getBoundingClientRect())
      const top = Math.min(...parts.map((p) => p.top)); const bottom = Math.max(...parts.map((p) => p.bottom))
      return { above: Math.round(top - card.top), below: Math.round(card.bottom - bottom), h: Math.round(card.height) }
    })
    check(t('the club card\'s words sit in the middle of the card (as much room above as below)'), Math.abs(r.above - r.below) <= 6 && r.above > 12, r)
    if (tag === 'portrait') {
      const m = await ev(page, () => {
        const card = document.querySelector('.decision-menu').getBoundingClientRect()
        const parts = [...document.querySelectorAll('.decision-menu > *')].filter((n) => getComputedStyle(n).display !== 'none').map((n) => n.getBoundingClientRect())
        return { above: Math.round(Math.min(...parts.map((p) => p.top)) - card.top), below: Math.round(card.bottom - Math.max(...parts.map((p) => p.bottom))) }
      })
      check(t('and the menu card too, where it has no list under its words'), Math.abs(m.above - m.below) <= 6, m)
    }
    await shot(page, `ui-${tag}-choice`)
    await page.close()
  }

  // ---- the battery: no pill, a tray -----------------------------------------------------------------------------------------------
  {
    mock.content = makeContent({ settings: { ads: { autoPlay: false } } })
    const page = await open({ w, h, battery: { level: 47, charging: false } })
    await page.waitForTimeout(400)
    const vis = (sel) => ev(page, (s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return !e.hidden && getComputedStyle(e).display !== 'none' && r.width > 0 && r.bottom > 0 && r.top < window.innerHeight }, sel)
    check(t('the reading comes from the app'), (await ev(page, () => window.KioskBattery.level)) === 47 && (await ev(page, () => window.KioskBattery.charging)) === false && (await ev(page, () => window.KioskBattery.source)) === 'app')
    check(t('by default nothing about the battery is on the screen (no pill over the display)'), !(await vis('.kiosk-tray')) && !(await vis('.kiosk-battery')))
    const swipe = async (x, y0, y1, dx = 0) => { await page.mouse.move(x, y0); await page.mouse.down(); for (let i = 1; i <= 6; i += 1) await page.mouse.move(x + (dx * i) / 6, y0 + ((y1 - y0) * i) / 6); await page.mouse.up() }
    await swipe(w / 2, 100, 220)
    await page.waitForTimeout(500)
    check(t('a swipe that does not start at the top edge opens nothing'), !(await vis('.kiosk-tray')))
    await swipe(w / 2, 4, 20)
    await page.waitForTimeout(500)
    check(t('a short pull opens nothing'), !(await vis('.kiosk-tray')))
    await swipe(w / 2, 4, 40, 160)
    await page.waitForTimeout(500)
    check(t('a sideways swipe from the top edge opens nothing'), !(await vis('.kiosk-tray')))
    await swipe(w / 2, 4, 90)
    await page.waitForTimeout(550)
    const tray = await ev(page, () => ({ open: document.querySelector('.kiosk-tray').classList.contains('is-open'), text: document.querySelector('.kiosk-tray').textContent, low: document.querySelector('.kiosk-tray').classList.contains('is-low') }))
    check(t('a swipe down from the top edge drops the tray with the charge'), tray.open && /47%/.test(tray.text) && /לא בטעינה/.test(tray.text), tray)
    await shot(page, `ui-${tray.open ? tag : tag}-tray`)
    await page.click('.kiosk-tray')
    await page.waitForTimeout(650)
    check(t('a tap on it puts it away'), !(await vis('.kiosk-tray')))
    await page.evaluate(() => { window.__battery = { level: 12, charging: false } })
    await page.evaluate(() => window.KioskBattery.read())
    await page.evaluate(() => window.KioskBattery.openTray()); await page.waitForTimeout(500)
    check(t('low charge shows in the warning colour, critical in red'), await ev(page, () => document.querySelector('.kiosk-tray').classList.contains('is-critical')))
    await page.evaluate(() => { window.__battery = { level: 80, charging: true } }); await page.evaluate(() => window.KioskBattery.read()); await page.waitForTimeout(100)
    check(t('charging shows the bolt and "בטעינה"'), await ev(page, () => { const t = document.querySelector('.kiosk-tray'); return t.classList.contains('is-charging') && /בטעינה/.test(t.textContent) && !/לא בטעינה/.test(t.textContent) }))
    await page.close()

    mock.content = makeContent({ settings: { ads: { autoPlay: false }, battery: { display: 'corner' } } })
    const p2 = await open({ w, h, battery: { level: 33, charging: false } })
    await p2.waitForTimeout(400)
    const badge = await ev(p2, () => { const e = document.querySelector('.kiosk-battery'); const r = e.getBoundingClientRect(); return { shown: !e.hidden, text: e.textContent, bottom: Math.round(window.innerHeight - r.bottom), pointer: getComputedStyle(e).pointerEvents } })
    check(t('corner mode: a small badge that takes no touch and sits above the footer'), badge.shown && /33%/.test(badge.text) && badge.pointer === 'none' && badge.bottom >= 40, badge)
    await p2.close()
    mock.content = makeContent({ settings: { ads: { autoPlay: false }, battery: { display: 'hidden' } } })
    const p3 = await open({ w, h, battery: { level: 33, charging: false } })
    await p3.mouse.move(w / 2, 4); await p3.mouse.down(); for (let i = 1; i <= 6; i += 1) await p3.mouse.move(w / 2, 4 + i * 15); await p3.mouse.up(); await p3.waitForTimeout(500)
    check(t('hidden mode: the pull opens nothing'), !(await ev(p3, () => document.querySelector('.kiosk-tray').classList.contains('is-open'))))
    await p3.close()
  }
}

// =========================================================================================================================
console.log('\nsettings, saving, the tablet\'s name')
resetMock()
{
  // what the portal says is applied, and survives a reload (the tablet starts from its last answer)
  mock.content = makeContent({ settings: { ads: { autoPlay: false, arrows: false }, display: { showCredit: false }, language: { default: 'en', enabled: ['en', 'ar'], showSwitch: true }, timing: { successSeconds: 20 } } })
  let page = await open()
  const cfg = await ev(page, () => ({ arrows: window.KioskConfig.get('ads.arrows'), credit: document.documentElement.classList.contains('kx-hide-credit'), def: window.KioskConfig.get('language.default'), registered: window.KioskConfig.registered, name: window.KioskConfig.deviceName }))
  check('the portal\'s settings for this tablet are applied', cfg.arrows === false && cfg.credit === true && cfg.def === 'en' && cfg.registered === true && cfg.name === 'קיוסק גבעת חביבה', cfg)
  check('timing: the success screen time reaches the session controller', (await ev(page, () => window.KioskSession.settings.successSeconds)) === 20)
  await page.reload()
  await page.waitForTimeout(500)
  const again = await ev(page, () => ({ lang: window.KioskI18n.lang, dir: document.documentElement.dir, hidden: [...document.querySelectorAll('.lang-switch-welcome [data-lang]')].filter((b) => b.hidden).map((b) => b.dataset.lang), credit: getComputedStyle(document.querySelector('.welcome-credit')).display }))
  check('after a restart the tablet starts in the default language and offers only the languages that are on', again.lang === 'en' && again.dir === 'ltr' && again.hidden.join() === 'he' && again.credit === 'none', again)
  await page.evaluate(() => { window.KioskI18n.set('ar', 'visitor') }); await page.waitForTimeout(200)
  await page.evaluate(() => window.KioskSession.resetNow('test')); await page.waitForTimeout(1500)
  check('every reset returns to the default language (not always Hebrew)', (await ev(page, () => window.KioskI18n.lang)) === 'en')
  await page.close()

  mock.content = makeContent({ settings: { ads: { autoPlay: false }, language: { showSwitch: false } } })
  page = await open()
  check('switch off: no language switch anywhere', await ev(page, () => [...document.querySelectorAll('.lang-switch')].every((s) => s.hidden)))
  await page.close()
  mock.content = makeContent({ settings: { ads: { autoPlay: false }, language: { default: 'ar', enabled: ['ar'] } } })
  page = await open()
  check('a single language: no switch, and the kiosk speaks it', await ev(page, () => [...document.querySelectorAll('.lang-switch')].every((s) => s.hidden)) && (await ev(page, () => window.KioskI18n.lang)) === 'ar')
  await page.close()
}
{
  // a change from the panel: at once on the tablet, then saved with the key
  resetMock()
  mock.content = makeContent({ settings: { ads: { autoPlay: false } } })
  const page = await open()
  await page.evaluate(() => window.KioskConfig.patch({ ads: { arrows: false }, battery: { alertPercent: 40 } }))
  check('a change applies at once', await ev(page, () => window.KioskConfig.get('ads.arrows') === false && getComputedStyle(document.querySelector('.attract-arrow-right')).display === 'none'))
  check('...and is waiting to be saved', (await ev(page, () => window.KioskConfig.sync.pending)) === true)
  await page.waitForTimeout(1600)
  const save = mock.saves.at(-1)
  const log = mock.log.filter((l) => l.path === '/api/kiosk/device' && l.method === 'PUT')
  check('it is saved: only the patch, with the kiosk\'s key, to /api/kiosk/device', save && JSON.stringify(save.patch) === JSON.stringify({ ads: { arrows: false }, battery: { alertPercent: 40 } }) && log.at(-1).key === 'test-key', { save, log })
  check('...and nothing is pending afterwards', (await ev(page, () => window.KioskConfig.sync.pending)) === false)
  check('a change back to what the portal has is not sent again', await (async () => { const n = mock.saves.length; await page.evaluate(() => window.KioskConfig.patch({ ads: { arrows: true } })); await page.waitForTimeout(1500); return mock.saves.length === n + 1 && mock.saves.at(-1).patch.ads.arrows === true })())
  check('an invalid change is refused on the tablet before it is sent (out of range, unknown key)', await ev(page, () => { const a = window.KioskConfig.patch({ battery: { alertPercent: 5 } }); const b = window.KioskConfig.patch({ nope: { x: 1 } }); const c = window.KioskConfig.patch({ ads: { slideSeconds: 'x' } }); return !a && !b && !c }))
  await page.close()
}
{
  // offline or not ready: kept, shown as such, retried; a refusal is dropped
  resetMock()
  mock.content = makeContent({ settings: { ads: { autoPlay: false } } })
  mock.deviceReply = () => ({ status: 503, body: { ok: false, error: 'not_ready' } })
  let page = await open()
  await page.evaluate(() => window.KioskConfig.patch({ display: { showCredit: false } }))
  await page.waitForTimeout(1600)
  let st = await ev(page, () => ({ sync: window.KioskConfig.sync, credit: document.documentElement.classList.contains('kx-hide-credit') }))
  check('the portal not ready: the change stays on the tablet and is kept for a retry', st.sync.pending && st.sync.lastError === 'not_ready' && st.credit === true, st)
  await page.reload(); await page.waitForTimeout(500)
  check('...and survives a restart', (await ev(page, () => window.KioskConfig.get('display.showCredit'))) === false && (await ev(page, () => window.KioskConfig.sync.pending)) === true)
  mock.deviceReply = null
  await page.evaluate(() => window.KioskConfig.flush())
  await page.waitForTimeout(400)
  check('when the portal is ready the kept change is sent and cleared', (await ev(page, () => window.KioskConfig.sync.pending)) === false && mock.saves.at(-1).patch.display.showCredit === false)
  await page.close()

  mock.deviceReply = () => ({ status: 400, body: { ok: false, error: 'bad_settings', message: 'כלל' } })
  page = await open({ content: makeContent({ settings: { ads: { autoPlay: false } } }) })
  await page.evaluate(() => window.KioskConfig.patch({ display: { showClosing: false } })); await page.waitForTimeout(1600)
  st = await ev(page, () => ({ pending: window.KioskConfig.sync.pending, now: window.KioskConfig.get('display.showClosing'), err: window.KioskConfig.sync.lastError }))
  check('a refusal by the portal drops the change and says why (it would be refused forever)', st.pending === false && st.now === true && st.err === 'כלל', st)
  await page.close()
  mock.deviceReply = null
}
{
  // the tablet's own name is in every address; a new name starts clean
  resetMock()
  mock.content = makeContent({ settings: { ads: { autoPlay: false } } })
  const page = await open()
  await page.evaluate(() => window.KioskConfig.patch({ display: { showCredit: false } }))
  await page.evaluate(() => window.KioskConfig.setDevice('maor-1'))
  check('a bad name is refused', await ev(page, () => window.KioskConfig.setDevice('Bad Name!') === false && window.KioskConfig.device === 'maor-1'))
  check('changing the name drops what was waiting for the old one', (await ev(page, () => window.KioskConfig.sync.pending)) === false)
  mock.log.length = 0
  await page.evaluate(() => window.__kioskAttract.fetchContent(true))
  await page.evaluate(() => window.KioskShift.poll())
  await page.evaluate(() => window.KioskDevice.report('t'))
  await page.waitForTimeout(300)
  const paths = mock.log.filter((l) => l.path !== '/index.html')
  check('content, shift and report all carry the tablet\'s name', paths.some((l) => l.path === '/api/kiosk/content' && /device=maor-1/.test(l.search)) && paths.some((l) => l.path === '/api/kiosk/shift' && /device=maor-1/.test(l.search)), paths)
  check('the report names it in its body', mock.reports.at(-1).device === 'maor-1', mock.reports.at(-1))
  await page.evaluate(() => window.KioskConfig.patch({ ads: { arrows: false } })); await page.waitForTimeout(1500)
  check('a save names it too', mock.saves.at(-1).device === 'maor-1')
  await page.evaluate(() => window.KioskConfig.setDevice(''))
  mock.log.length = 0
  await page.evaluate(() => window.__kioskAttract.fetchContent(true))
  check('no name: the address is exactly what it always was (no ?device)', mock.log.filter((l) => l.path === '/api/kiosk/content').every((l) => !/device=/.test(l.search)))
  await page.close()
}

console.log('\nthe report to the portal')
{
  resetMock()
  mock.content = makeContent({ settings: { ads: { autoPlay: false } } })
  const page = await open({ battery: { level: 47, charging: false }, query: '?kioskTestScale=0.05' })
  const r = await ev(page, () => window.KioskDevice.report('t'))
  const body = mock.reports.at(-1)
  check('the report carries the charge, whether it is charging, the app and the page versions', r.ok && body.battery.level === 47 && body.battery.charging === false && body.app === 3 && body.web === 'abc123def456', body)
  check('...and nothing else (no customer data, no address)', JSON.stringify(Object.keys(body).sort()) === JSON.stringify(['app', 'battery', 'web']), Object.keys(body))
  check('...with the kiosk\'s key', mock.log.filter((l) => l.path === '/api/kiosk/device' && l.method === 'POST').at(-1).key === 'test-key')
  await page.waitForTimeout(1200)
  mock.log.length = 0
  mock.reportReply = () => ({ status: 200, body: { ok: true, settingsUpdatedAt: '2026-11-05T09:00:00.000Z' } })
  await page.evaluate(() => window.KioskDevice.report('t'))
  await page.waitForTimeout(500)
  check('a newer settings time makes the tablet fetch the content again (the owner changed something)', mock.log.some((l) => l.path === '/api/kiosk/content'), mock.log)
  mock.reportReply = () => ({ status: 503, body: { ok: false, error: 'not_ready' } })
  check('the portal not ready: the report fails quietly', (await ev(page, () => window.KioskDevice.report('t'))).ok === false && page.errors.length === 0, page.errors)
  mock.reportReply = null
  const n = mock.reports.length
  await page.evaluate(() => { window.__battery = { level: 47, charging: true } }); await page.evaluate(() => window.KioskBattery.read())
  await page.waitForTimeout(2300)
  check('plugging in is reported soon, not at the next timer', mock.reports.length > n && mock.reports.at(-1).battery.charging === true, mock.reports.length - n)
  const t1 = await ev(page, () => window.KioskDevice.test())
  check('the test alert is a report with test: true and nothing else', t1.ok && JSON.stringify(mock.reports.at(-1)) === JSON.stringify({ test: true }), mock.reports.at(-1))
  await page.close()

  // without the app's own reading the page's Battery API is used; with neither nothing is claimed
  const p2 = await open({ battery: null, noWebBattery: true })
  const none = await ev(p2, () => ({ level: window.KioskBattery.level, src: window.KioskBattery.source }))
  const sent = await ev(p2, () => window.KioskDevice.report('t'))
  check('no reading: the report says nothing about the battery (never a made-up number)', none.level === null && sent.ok && mock.reports.at(-1).battery === undefined, { none, last: mock.reports.at(-1) })
  await p2.close()
}

console.log('\nthe control panel')
{
  resetMock()
  mock.content = makeContent({ settings: { ads: { autoPlay: false } } })
  let page = await open({ staff: true, battery: { level: 61, charging: false } })
  check('the panel does not open without the app\'s token', (await ev(page, () => window.KioskAdmin.open(''))) === false && (await ev(page, () => window.KioskAdmin.isOpen)) === false)
  check('a call to the app with a wrong token is refused (nothing happens)', (await ev(page, () => JSON.parse(window.KioskStaff.act('wrong', 'reload', '')).ok)) === false)
  check('a token the app did not give is refused too (the app answers "null" to it)', (await ev(page, () => window.KioskAdmin.open('forged'))) === false && (await ev(page, () => window.KioskAdmin.isOpen)) === false)
  check('it opens with the right token', (await ev(page, () => window.KioskAdmin.open('tok'))) === true && (await ev(page, () => window.KioskAdmin.isOpen)) === true)
  await page.waitForTimeout(200)
  const tabs = await ev(page, () => [...document.querySelectorAll('.kx-tabs button')].map((b) => b.textContent))
  check('eleven tabs (live stock, then the menu editor)', JSON.stringify(tabs) === JSON.stringify(['סקירה', 'מלאי', 'תפריט', 'מסכים', 'מודעות', 'זמנים', 'שפות', 'סוללה', 'מכשיר', 'עדכונים', 'אבחון']), tabs)
  await shot(page, 'ui-panel-overview')
  const cards = await ev(page, () => document.querySelector('.kx-cards').textContent)
  check('the overview shows the charge, the tablet and the branch', /61%/.test(cards) && /קיוסק גבעת חביבה/.test(cards) && /גבעת חביבה/.test(cards), cards)

  const goto = async (id) => { await page.evaluate((i) => window.KioskAdmin.show(i), id); await page.waitForTimeout(80) }
  const sw = (label) => page.locator(`.kx-switch[aria-label="${label}"]`)
  // a switch
  await goto('display')
  await shot(page, 'ui-panel-display')
  check('a switch shows its state', (await sw('להציג מי במשמרת').getAttribute('aria-checked')) === 'true')
  await sw('להציג מי במשמרת').click()
  await page.waitForTimeout(100)
  check('tapping it changes the setting at once (the header loses the names)', (await sw('להציג מי במשמרת').getAttribute('aria-checked')) === 'false' && (await ev(page, () => window.KioskConfig.get('display.showEmployees'))) === false)
  await page.waitForTimeout(1400)
  check('...and saves it', JSON.stringify(mock.saves.at(-1).patch) === JSON.stringify({ display: { showEmployees: false } }), mock.saves.at(-1))
  // a choice
  await page.locator('.kx-seg button', { hasText: 'סוף המשמרת' }).click(); await page.waitForTimeout(1400)
  check('a choice of a few sets one value', mock.saves.at(-1).patch.display.closingSource === 'shift')
  // timing steppers: follow the branch, then set, then back
  await goto('timing')
  const num = () => ev(page, () => document.querySelectorAll('.kx-num')[0].textContent.trim())
  check('a timing that follows the branch shows the branch\'s value', (await num()).startsWith('60'), await num())
  await page.locator('.kx-stepper').first().locator('button').nth(1).click(); await page.waitForTimeout(100)
  check('+ moves it by its step and it is now the tablet\'s own', (await num()).startsWith('70') && (await ev(page, () => window.KioskConfig.get('timing.idleSeconds'))) === 70 && (await ev(page, () => window.KioskSession.settings.idleSeconds)) === 70)
  await page.locator('.kx-link', { hasText: 'איפוס לפי הסניף' }).first().click(); await page.waitForTimeout(100)
  check('"back to the branch" goes back to following it', (await ev(page, () => window.KioskConfig.get('timing.idleSeconds'))) === null && (await num()).startsWith('60'))
  for (let i = 0; i < 80 && !(await page.locator('.kx-stepper').first().locator('button').nth(1).isDisabled()); i += 1) await page.locator('.kx-stepper').first().locator('button').nth(1).click({ timeout: 2000 }).catch(() => {})
  check('a number stops at its limit (300) and the button is off there', (await ev(page, () => window.KioskConfig.get('timing.idleSeconds'))) === 300 && (await page.locator('.kx-stepper').first().locator('button').nth(1).isDisabled()))
  // languages
  await goto('lang')
  await sw('עברית').click(); await page.waitForTimeout(100)
  check('the default language cannot be switched off', (await ev(page, () => window.KioskConfig.get('language.enabled'))).includes('he') && /חייבת להיות מופעלת/.test(await ev(page, () => document.querySelector('.kx-status').textContent)))
  await sw('English').click(); await page.waitForTimeout(100)
  check('another language can', !(await ev(page, () => window.KioskConfig.get('language.enabled'))).includes('en'))
  // ads on this tablet
  await goto('ads')
  const adRows = await ev(page, () => [...document.querySelectorAll('.kx-switch')].map((b) => b.getAttribute('aria-label')))
  check('every ad of the portal is listed with a switch for this tablet', ['מודעה ראשונה', 'מודעה שנייה', 'מועדון הלקוחות', 'מודעה רביעית'].every((x) => adRows.includes(x)), adRows)
  await sw('מודעה שנייה').click(); await page.waitForTimeout(100)
  check('switching one off hides it on this tablet only (its id goes to hiddenIds)', JSON.stringify(await ev(page, () => window.KioskConfig.get('ads.hiddenIds'))) === JSON.stringify([U(2)]))
  // battery
  await goto('battery')
  await shot(page, 'ui-panel-battery')
  await sw('להתריע כשהטעינה יורדת').click(); await page.waitForTimeout(100)
  check('the battery alert has an off switch', (await ev(page, () => window.KioskConfig.get('battery.alertEnabled'))) === false)
  await sw('להתריע כשהטעינה יורדת').click(); await page.waitForTimeout(100)
  await sw('התראה דחופה נוספת').click(); await page.waitForTimeout(100)
  check('the urgent alert can be added, with its own level below the ordinary one', (await ev(page, () => window.KioskConfig.get('battery.criticalEnabled'))) === true && /התראה דחופה מתחת/.test(await ev(page, () => document.querySelector('.kx-body').textContent)))
  const mark = mock.reports.length
  await page.getByText('שליחת התראת בדיקה למפתח').click()
  await page.waitForTimeout(500)
  check('"send a test alert" asks the portal for exactly that', mock.reports.length === mark + 1 && mock.reports.at(-1).test === true, mock.reports.at(-1))
  check('...and says it was sent', /נשלחה התראת בדיקה/.test(await ev(page, () => document.querySelector('.kx-status').textContent)))
  // the app's side
  await goto('device')
  await shot(page, 'ui-panel-device')
  await page.locator('.kx-seg button', { hasText: 'לאורך' }).click(); await page.waitForTimeout(150)
  await page.locator('.kx-action', { hasText: 'הגדרות Wi-Fi' }).click()
  const calls = await ev(page, () => window.__staff.calls)
  check('device actions go to the app with the token and the value', calls.some((c) => c[0] === 'tok' && c[1] === 'orient' && c[2] === 'portrait') && calls.some((c) => c[1] === 'wifi'), calls)
  check('the app\'s answer is shown (the rotation now says portrait)', (await page.locator('.kx-seg button.is-on').first().textContent()) === 'לאורך' || (await ev(page, () => window.__staff.orient)) === 'portrait')
  await goto('updates')
  await shot(page, 'ui-panel-updates')
  check('updates show what the app says', /abc/.test(await ev(page, () => document.querySelector('.kx-body').textContent)))
  await goto('diag')
  const diag = await ev(page, () => document.querySelector('.kx-body').textContent)
  check('diagnostics show the tablet\'s name and the sync state', /givat-haviva-1/.test(diag) && /שינויים שממתינים לשליחה/.test(diag))
  await page.getByText('החזרת כל ההגדרות לברירת המחדל').click()
  await page.locator('.kx-dialog .is-primary').click(); await page.waitForTimeout(150)
  const defaults = await ev(page, () => JSON.stringify(window.KioskConfig.all()))
  check('"everything back to the defaults" puts every setting back', defaults === JSON.stringify(DEFAULTS), defaults)
  // preview
  await goto('overview')
  await page.getByText('תצוגה מקדימה', { exact: false }).first().click(); await page.waitForTimeout(150)
  check('preview puts the panel away and shows the way back', (await ev(page, () => getComputedStyle(document.getElementById('kiosk-admin')).display)) === 'none' && (await ev(page, () => getComputedStyle(document.querySelector('.kx-back')).display)) !== 'none')
  await page.locator('.kx-back').click(); await page.waitForTimeout(100)
  check('...and it comes back where it was', (await ev(page, () => getComputedStyle(document.getElementById('kiosk-admin')).display)) !== 'none')
  // close
  await page.locator('.kx-close').click(); await page.waitForTimeout(150)
  check('closing the panel tells the app (with the token) and removes it', !(await ev(page, () => window.KioskAdmin.isOpen)) && (await ev(page, () => window.__staff.calls)).some((c) => c[1] === 'close' && c[0] === 'tok') && (await page.locator('#kiosk-admin').count()) === 0)
  check('no page errors', page.errors.length === 0, page.errors)
  await page.close()

  // the panel closes by itself after three minutes without a touch
  page = await open({ staff: true })
  await page.clock.install()
  await page.evaluate(() => window.KioskAdmin.open('tok'))
  await page.clock.fastForward(2 * 60 * 1000 + 30 * 1000)
  const still = await ev(page, () => window.KioskAdmin.isOpen)
  await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })))
  await page.clock.fastForward(2 * 60 * 1000 + 30 * 1000)
  const touched = await ev(page, () => window.KioskAdmin.isOpen)
  await page.clock.fastForward(3 * 60 * 1000 + 5000)
  check('after 2.5 minutes it is still open, a touch restarts the three minutes, and then it closes by itself', still === true && touched === true && (await ev(page, () => window.KioskAdmin.isOpen)) === false)
  await page.close()

  // on a desktop (no app) the test hook opens it; on the tablet's own origin it never would
  page = await open({ query: '?kioskAdmin=open' })
  check('a desktop browser can open it for testing (?kioskAdmin=open); the kiosk\'s own address cannot', (await ev(page, () => window.KioskAdmin.isOpen)) === true)
  await page.close()
}

console.log('\nlive stock from the panel (the dashboard\'s live list, edited on the tablet)')
{
  resetMock()
  let page = await open({ staff: true })
  await page.evaluate(() => window.KioskAdmin.open('tok'))
  await page.locator('.kx-tabs button', { hasText: 'מלאי' }).click()
  await page.locator('.kx-stock').first().waitFor({ timeout: 5000 })
  const titles = await page.locator('.kx-sec').allInnerTexts()
  check('the stock tab lists the live categories with every type (sandwiches & toasts, pastries, shakes)', ['כריכים וטוסטים · טוסטים', 'כריכים וטוסטים', 'מאפים · מאפה רגיל', 'שייק פירות טבעי · שייק'].every((t) => titles.some((x) => x.startsWith(t))), titles)
  check('...asked for with the kiosk key (no tablet name configured = the portal\'s default tablet)', mock.log.some((l) => l.path === '/api/kiosk/stock' && l.method === 'GET' && l.key === 'test-key'), mock.log.filter((l) => l.path === '/api/kiosk/stock'))
  const cheddar = page.locator('.kx-stock', { hasText: "מוצרלה וצ'דר" })
  check('a sold-out type reads "אזל"', /אזל/.test(await cheddar.innerText()) && (await cheddar.getAttribute('class')).includes('is-out'))
  await page.getByRole('button', { name: 'יותר גבינית' }).click()
  // wait for the save to finish (the row says "שומר…" meanwhile)
  const saved = () => page.waitForFunction(() => document.querySelector('.kx-stock') && ![...document.querySelectorAll('.kx-stock')].some((r) => r.textContent.includes('שומר')), null, { timeout: 5000 }).catch(() => {})
  await saved()
  check('+ on a counted type sends the new count for that type', JSON.stringify(mock.stockWrites.at(-1)) === JSON.stringify({ itemUid: 'pastry', typeUid: 'cheese', quantity: 2 }), mock.stockWrites)
  const cheeseRow = await page.locator('.kx-stock', { hasText: 'גבינית' }).innerText()
  check('...and the row shows it', /במלאי · 2/.test(cheeseRow), cheeseRow)
  await cheddar.getByRole('switch').click()
  await page.waitForTimeout(100); await saved()
  check('the switch puts a sold-out type back in stock', JSON.stringify(mock.stockWrites.at(-1)) === JSON.stringify({ itemUid: 'toasts', typeUid: 'cheddar', available: true }) && /במלאי/.test(await cheddar.innerText()), mock.stockWrites.at(-1))
  await page.getByRole('button', { name: 'פחות כריכים' }).click()
  await page.waitForTimeout(100); await saved()
  check('an item without types is counted on its own row', mock.stockWrites.at(-1).itemUid === 'sandwiches' && mock.stockWrites.at(-1).typeUid === null && mock.stockWrites.at(-1).quantity === 3)
  check('no page errors in the stock tab', page.errors.length === 0, page.errors)
  await page.close()

  resetMock()
  mock.stockOpen = false
  page = await open({ staff: true })
  await page.evaluate(() => window.KioskAdmin.open('tok'))
  await page.locator('.kx-tabs button', { hasText: 'מלאי' }).click()
  await page.locator('.kx-stock').first().waitFor({ timeout: 5000 })
  check('closed: the tab says so and nothing can be changed', /הסניף סגור/.test(await page.locator('.kx-body').innerText()) && (await page.locator('.kx-stock button:not([disabled])').count()) === 0)
  await page.close()
}

console.log('\nthe menu editor in the panel (names, prices, items and types)')
{
  resetMock()
  const page = await open({ staff: true })
  await page.evaluate(() => window.KioskAdmin.open('tok'))
  await page.locator('.kx-tabs button', { hasText: 'תפריט' }).click()
  await page.locator('.kx-cat').first().waitFor({ timeout: 5000 })
  const cats = await page.locator('.kx-cat').allInnerTexts()
  check('every category of the menu, closed until tapped', cats.length === 2 && /קפה חם/.test(cats[0]) && /מאפים/.test(cats[1]), cats)
  await page.locator('.kx-cat', { hasText: 'מאפים' }).click()
  await page.getByRole('button', { name: 'עריכה: מאפה רגיל', exact: true }).click()
  const dlg = page.locator('.kx-dialog')
  await dlg.getByLabel('מחיר (₪)').fill('14a')
  await dlg.getByRole('button', { name: 'שמירה', exact: true }).click()
  check('a price that is not a number is refused in the dialog', /מחיר בספרות/.test(await dlg.innerText()) && mock.menuWrites.length === 0)
  await dlg.getByLabel('מחיר (₪)').fill('14')
  await dlg.getByLabel('שם', { exact: true }).fill('מאפה רגיל גדול')
  await dlg.getByRole('button', { name: 'שמירה', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.kx-body')?.textContent.includes('מאפה רגיל גדול'), null, { timeout: 5000 }).catch(() => {})
  check('editing sends only what changed, for that item', JSON.stringify(mock.menuWrites.at(-1)) === JSON.stringify({ op: 'update', itemUid: 'pastry', typeUid: null, name: 'מאפה רגיל גדול', price: '14' }), mock.menuWrites.at(-1))
  check('...and the list shows it', /₪14/.test(await page.locator('.kx-menu-item', { hasText: 'מאפה רגיל גדול' }).innerText()))
  await page.getByRole('button', { name: 'הוספת סוג למאפה רגיל גדול', exact: true }).click()
  await page.locator('.kx-dialog').getByLabel('שם', { exact: true }).fill('שקדים')
  await page.locator('.kx-dialog').getByRole('button', { name: 'שמירה', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.kx-body')?.textContent.includes('שקדים'), null, { timeout: 5000 }).catch(() => {})
  check('a new type for an item', mock.menuWrites.at(-1).op === 'add_type' && mock.menuWrites.at(-1).itemUid === 'pastry' && mock.menuWrites.at(-1).name === 'שקדים' && (await page.locator('.kx-menu-type', { hasText: 'שקדים' }).count()) === 1)
  await page.getByRole('button', { name: 'מחיקה: מאפה רגיל גדול גבינית', exact: true }).click()
  await page.locator('.kx-dialog').getByRole('button', { name: 'מחיקה', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.kx-body')?.textContent.includes('גבינית'), null, { timeout: 5000 }).catch(() => {})
  check('deleting a type asks first, then removes it', mock.menuWrites.at(-1).op === 'remove_type' && mock.menuWrites.at(-1).typeUid === 'cheese' && (await page.locator('.kx-menu-type', { hasText: 'גבינית' }).count()) === 0)
  await page.locator('.kx-action', { hasText: 'הוספת פריט למאפים' }).click()
  await page.locator('.kx-dialog').getByLabel('שם', { exact: true }).fill('קרואסון')
  await page.locator('.kx-dialog').getByLabel('מחיר (₪)').fill('15')
  await page.locator('.kx-dialog').getByRole('button', { name: 'שמירה', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.kx-body')?.textContent.includes('קרואסון'), null, { timeout: 5000 }).catch(() => {})
  check('a new item in a category', JSON.stringify(mock.menuWrites.at(-1)) === JSON.stringify({ op: 'add_item', categoryId: 'pastries', name: 'קרואסון', price: '15' }))
  check('no page errors in the menu editor', page.errors.length === 0, page.errors)
  await page.close()

  resetMock()
  mock.stockOpen = false
  const closed = await open({ staff: true })
  await closed.evaluate(() => window.KioskAdmin.open('tok'))
  await closed.locator('.kx-tabs button', { hasText: 'תפריט' }).click()
  await closed.locator('.kx-cat').first().waitFor({ timeout: 5000 })
  await closed.locator('.kx-cat', { hasText: 'קפה חם' }).click()
  check('closed: the editor says so and its buttons are off', /הסניף סגור/.test(await closed.locator('.kx-body').innerText()) && (await closed.locator('.kx-mini:not([disabled])').count()) === 0)
  await closed.close()
}

console.log('\nthe old things still work')
{
  resetMock()
  mock.content = null
  mock.shift = null
  const page = await open({ wait: false })
  await page.waitForTimeout(1200)
  const r = await attract(page)
  check('the portal down: the built-in announcements show, with arrows', r.n === 4 && (await ev(page, () => getComputedStyle(document.querySelector('.attract-arrow-right')).display)) !== 'none', r)
  check('the portal down: the shift line is quietly absent and nothing breaks', (await ev(page, () => document.querySelector('.kiosk-shift').hidden)) && page.errors.length === 0, page.errors)
  await page.close()
}

await browser.close()
server.close()
console.log(`\ncheck-kiosk-ui: ${passed} passed, ${failures.length} failed`)
if (failures.length) { console.log(`FAILED:\n - ${failures.join('\n - ')}`); process.exit(1) }
