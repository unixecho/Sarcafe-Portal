// The "who is on shift" strip (src/components/shifts/ShiftScroller.tsx) in a real browser: Edge through Playwright, touch phones
// and a landscape phone, right to left. It needs a running copy of the app that serves the fixture page below; it never touches
// production data. Do not run `next dev` in the working checkout (another session may share .next): use a scratch copy.
//
//   node scripts/check-shift-scroller.mjs --write-fixture <copy root>   writes src/app/fixture-shifts/page.tsx into that COPY
//   node scripts/check-shift-scroller.mjs [base url] [screenshot dir]   default http://localhost:3098
//
// What it proves: on load "now" is whole and centred; every slide, once reached, is whole inside the strip (no edge cut off); the
// page never scrolls sideways and the card never moves (arrows, swipes, keys); arrows point the right way and stop at the ends;
// the dots follow; a vertical drag over the strip scrolls the page, not the strip; all slides are one height; a refresh keeps the
// slide the reader swiped to; the strip re-renders once per slide change, not per scroll frame.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'

const FIXTURE = String.raw`'use client'

// THROWAWAY fixture for scripts/check-shift-scroller.mjs: scratch copies only, never commit.
import { Profiler, Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import OnShiftNow from '@/components/shifts/OnShiftNow'
import type { OnShiftBranch, OnShiftPerson, OnShiftSlot } from '@/lib/staff/on-shift'
import '@/components/app/app.css'
import '@/components/app/staff-themes.css'

declare global { interface Window { __shsRenders?: number; __shsBump?: () => void } }

const NAMES = ['נועה', 'איתי', 'מאיה', 'יונתן', 'שירה', 'עומר', 'תמר', 'דניאל']
const LONG = 'אלכסנדרה־מרגריטה בן־שושן־וולקובינסקי'
const people = (n: number, tag: string, long = false): OnShiftPerson[] =>
  Array.from({ length: n }, (_, i) => ({ key: tag + i, staffId: i === 0 && tag === 'n' ? 'me' : 's' + tag + i, name: long ? LONG + ' ' + (i + 1) : NAMES[i % NAMES.length]!, startTime: '07:00', endTime: '15:00', station: i % 2 ? 'בר' : null }))
const slot = (kind: OnShiftSlot['kind'], list: OnShiftPerson[]): OnShiftSlot => ({ kind, when: list.length ? 'היום' : null, hours: list.length ? '07:00–15:00' : null, people: list })

function slotsFor(c: string, bump: number): OnShiftSlot[] {
  const extra = bump % 2 ? 1 : 0
  switch (c) {
    case 'nonow': return [slot('previous', people(2, 'p')), slot('now', []), slot('next', people(3, 'x'))]
    case 'nonext': return [slot('previous', people(2, 'p')), slot('now', people(3 + extra, 'n')), slot('next', [])]
    case 'noprev': return [slot('previous', []), slot('now', people(3 + extra, 'n')), slot('next', people(2, 'x'))]
    case 'one': return [slot('now', people(2 + extra, 'n'))]
    case 'long': return [slot('previous', people(2, 'p', true)), slot('now', people(3 + extra, 'n', true)), slot('next', people(2, 'x', true))]
    case 'sizes': return [slot('previous', people(1, 'p')), slot('now', people(1 + extra, 'n')), slot('next', people(8, 'x'))]
    default: return [slot('previous', people(2, 'p')), slot('now', people(3 + extra, 'n')), slot('next', people(2, 'x'))]
  }
}

function Fixture() {
  const q = useSearchParams()
  const [bump, setBump] = useState(0)
  if (typeof window !== 'undefined') window.__shsBump = () => setBump((b) => b + 1)
  const slots = slotsFor(q.get('case') ?? 'all', bump)
  const branch: OnShiftBranch = { id: 'b1', slug: 'b1', name: 'סניף מרכז', slots, people: slots.find((s) => s.kind === 'now')?.people ?? [], next: null }
  return (
    <div className="native-app" data-staff-theme="neon">
      <main id="main" tabIndex={-1} style={{ maxWidth: 1560, margin: '0 auto', padding: '0 16px 32px' }}>
        <h1 style={{ margin: '12px 0' }}>לוח משמרות</h1>
        <Profiler id="shs" onRender={() => { window.__shsRenders = (window.__shsRenders ?? 0) + 1 }}>
          <OnShiftNow branches={[branch]} viewerId="me" clock="12:00" />
        </Profiler>
        {q.get('wide') && <div style={{ width: 1400, height: 40, background: '#333' }}>wide sibling</div>}
        <div style={{ height: 1600 }} aria-hidden="true" />
      </main>
    </div>
  )
}

export default function Page() {
  return <Suspense><Fixture /></Suspense>
}
`

if (process.argv[2] === '--write-fixture') {
  const target = path.join(path.resolve(process.argv[3] ?? '.'), 'src', 'app', 'fixture-shifts', 'page.tsx')
  if (fs.existsSync(path.join(path.dirname(target), '..', '..', '..', '.git'))) throw new Error('refusing to write the fixture into a git checkout: use a scratch copy')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, FIXTURE)
  console.log('fixture written:', target)
  process.exit(0)
}

const base = (process.argv[2] ?? 'http://localhost:3098').replace(/\/$/, '')
const shots = process.argv[3] ? path.resolve(process.argv[3]) : null
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')

let passed = 0
const failures = []
const check = (ok, label) => { if (ok) passed++; else failures.push(label) }

// Geometry of the strip, read in the page. "whole" = the slide's border box lies inside the strip's visible box on all four sides.
const measure = () => {
  const strip = document.querySelector('.shs__strip')
  const card = document.querySelector('.osn__branch').getBoundingClientRect()
  const sr = strip.getBoundingClientRect()
  const view = { l: sr.left + strip.clientLeft, r: sr.left + strip.clientLeft + strip.clientWidth, t: sr.top + strip.clientTop, b: sr.top + strip.clientTop + strip.clientHeight }
  const slides = [...strip.children].map((el) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return { kind: el.className.match(/shs__slide--(\w+)/)[1], l: r.left, r: r.right, t: r.top, b: r.bottom, h: r.height, border: ['Top', 'Right', 'Bottom', 'Left'].map((s) => parseFloat(cs['border' + s + 'Width'])) }
  })
  const mid = (view.l + view.r) / 2
  const centred = slides.findIndex((s) => Math.abs((s.l + s.r) / 2 - mid) <= 1)
  const dots = [...document.querySelectorAll('.shs__dots span')]
  const arrows = [...document.querySelectorAll('.shs__arrow')].map((b) => ({ label: b.getAttribute('aria-label'), disabled: b.disabled, x: b.getBoundingClientRect().left }))
  return { scrollX: window.scrollX, scrollY: window.scrollY, docW: document.documentElement.scrollWidth, winW: window.innerWidth, card: { l: card.left, t: card.top + window.scrollY, w: card.width }, view, slides, centred, dot: dots.findIndex((d) => d.classList.contains('is-on')), arrows, scrollLeft: strip.scrollLeft, renders: window.__shsRenders ?? 0 }
}
const whole = (m, i) => { const s = m.slides[i]; return s && s.l >= m.view.l - 0.5 && s.r <= m.view.r + 0.5 && s.t >= m.view.t - 0.5 && s.b <= m.view.b + 0.5 && s.border.every((w) => w > 0) }
const settle = (page, ms = 650) => page.waitForTimeout(ms)

// A real finger as far as the browser can tell: touchStart, twelve moves about a frame apart, touchEnd (CDP touch input goes through
// the same scrolling pipeline as a phone; synthesizeScrollGesture proved unreliable in headless Edge). dx > 0 drags to the right.
async function swipe(page, cdp, dx, dy = 0) {
  // A point on the strip that is on screen (a landscape phone may not show all of it), in viewport coordinates.
  const at = await page.evaluate(() => {
    const r = document.querySelector('.shs__strip').getBoundingClientRect()
    const top = Math.max(r.top, 0), bottom = Math.min(r.bottom, window.innerHeight)
    return { x: Math.round(r.left + r.width / 2), y: Math.round((top + bottom) / 2), visible: bottom - top }
  })
  if (at.visible < 40) throw new Error('strip is off screen for a swipe')
  const x = at.x - dx / 2, y = at.y - dy / 2
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  for (let i = 1; i <= 12; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / 12, y: y + (dy * i) / 12 }] })
    await page.waitForTimeout(16)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

const VIEWPORTS = [[320, 640], [375, 812], [390, 844], [430, 932], [768, 1024], [844, 390]]
const CASES = [['all', 3], ['nonow', 3], ['nonext', 3], ['noprev', 3], ['one', 1], ['long', 3], ['sizes', 3]]

// SHS_ONLY="390x844,all" narrows a run to the viewports / cases named (for debugging one combination).
const only = (process.env.SHS_ONLY ?? '').split(',').filter(Boolean)
const isViewport = (key) => /^\d+x\d+$/.test(key)
const pick = (key) => only.includes(key) || !only.some((o) => isViewport(o) === isViewport(key))

const browser = await chromium.launch({ executablePath: EDGE })
try {
  for (const [width, height] of VIEWPORTS) {
    if (!pick(`${width}x${height}`)) continue
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, locale: 'he-IL' })
    for (const [name, count] of CASES) {
      if (!pick(name)) continue
      const tag = `${width}x${height} ${name}`
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (e) => errors.push(String(e)))
      await page.addInitScript(() => { window.__shsScrolls = 0; addEventListener('scroll', (e) => { if (e.target?.classList?.contains('shs__strip')) window.__shsScrolls++ }, true) })
      await page.goto(`${base}/fixture-shifts?case=${name}`, { waitUntil: 'networkidle' })
      await settle(page, 400)
      const cdp = await context.newCDPSession(page)
      let m = await page.evaluate(measure)
      const nowAt = m.slides.findIndex((s) => s.kind === 'now')
      const card0 = m.card
      check(m.slides.length === count, `${tag}: ${count} slides`)
      check(m.centred === nowAt && whole(m, nowAt), `${tag}: opens on "now", whole and centred`)
      check(m.dot === (count > 1 ? nowAt : -1), `${tag}: dot on "now" at load`)
      check(m.scrollX === 0 && m.docW <= m.winW, `${tag}: no sideways page scroll (scrollX ${m.scrollX}, doc ${m.docW}/${m.winW})`)
      check(new Set(m.slides.map((s) => Math.round(s.h))).size === 1, `${tag}: all slides one height`)
      if (name === 'long') {
        const rows = await page.evaluate(() => [...document.querySelectorAll('.shs__slide')].flatMap((s) => { const sr = s.getBoundingClientRect(); return [...s.querySelectorAll('.osn__person')].map((li) => { const st = li.querySelector('strong'); const r = li.getBoundingClientRect(); const cs = getComputedStyle(st); return cs.textOverflow === 'ellipsis' && cs.whiteSpace === 'nowrap' && st.getBoundingClientRect().right <= r.right + 0.5 && r.left >= sr.left && r.right <= sr.right }) }))
        check(rows.length > 0 && rows.every(Boolean), `${tag}: long names end in an ellipsis inside their slide`)
      }
      if (shots && width === 390 && name === 'all') await page.locator('.osn').screenshot({ path: path.join(shots, 'after-390.png') })

      const steady = (mm, what) => {
        check(mm.scrollX === 0, `${tag}: page scrollX stays 0 (${what}: ${mm.scrollX})`)
        check(Math.abs(mm.card.l - card0.l) < 0.5 && Math.abs(mm.card.t - card0.t) < 0.5 && Math.abs(mm.card.w - card0.w) < 0.5, `${tag}: card did not move (${what})`)
        check(mm.centred >= 0 && whole(mm, mm.centred), `${tag}: a whole slide is centred (${what})`)
        check(mm.dot === (count > 1 ? mm.centred : -1), `${tag}: dot follows the slide (${what}: dot ${mm.dot}, slide ${mm.centred})`)
      }

      if (count > 1) {
        // The previous-shift button sits on the right (RTL) and goes back in time; both stop at the ends.
        const prevBtn = m.arrows.find((a) => a.label === 'המשמרת הקודמת')
        const nextBtn = m.arrows.find((a) => a.label === 'המשמרת הבאה')
        check(prevBtn.x > nextBtn.x, `${tag}: "previous" arrow is the right-hand one`)
        for (let i = nowAt; i > 0; i--) {
          const r0 = (await page.evaluate(measure)).renders
          await page.locator('.shs__arrow[aria-label="המשמרת הקודמת"]').click()
          await settle(page)
          const mm = await page.evaluate(measure)
          check(mm.centred === i - 1, `${tag}: previous arrow moves to slide ${i - 1} (got ${mm.centred})`)
          check(mm.renders - r0 <= 2, `${tag}: arrow re-rendered ${mm.renders - r0} times`)
          steady(mm, `previous arrow to ${i - 1}`)
        }
        m = await page.evaluate(measure)
        check(m.arrows.find((a) => a.label === 'המשמרת הקודמת').disabled, `${tag}: previous arrow disabled at the first slide`)
        for (let i = 0; i < count - 1; i++) {
          await page.locator('.shs__arrow[aria-label="המשמרת הבאה"]').click()
          await settle(page)
          const mm = await page.evaluate(measure)
          check(mm.centred === i + 1, `${tag}: next arrow moves to slide ${i + 1} (got ${mm.centred})`)
          check(mm.slides[mm.centred]?.r <= mm.slides[0].l + 0.5, `${tag}: later slides lie to the left`)
          steady(mm, `next arrow to ${i + 1}`)
        }
        m = await page.evaluate(measure)
        check(m.arrows.find((a) => a.label === 'המשמרת הבאה').disabled, `${tag}: next arrow disabled at the last slide`)

        // A touch swipe from the last (left-most) slide, finger right to left, brings back the slide on its right: one step back in time.
        const before = await page.evaluate(() => [window.__shsRenders, window.__shsScrolls])
        await swipe(page, cdp, -Math.round(Math.min(width, 600) * 0.5))
        await settle(page, 900)
        let mm = await page.evaluate(measure)
        const after = await page.evaluate(() => [window.__shsRenders, window.__shsScrolls])
        check(mm.centred === count - 2, `${tag}: one swipe moves exactly one slide (got ${mm.centred})`)
        steady(mm, 'touch swipe')
        check(after[1] - before[1] >= 4 && after[0] - before[0] <= 2, `${tag}: renders per swipe ${after[0] - before[0]} for ${after[1] - before[1]} scroll events`)

        // Two quick swipes still land squarely on a slide.
        await swipe(page, cdp, Math.round(Math.min(width, 600) * 0.5))
        await swipe(page, cdp, Math.round(Math.min(width, 600) * 0.5))
        await settle(page, 1000)
        mm = await page.evaluate(measure)
        steady(mm, 'rapid swipes')

        // Keyboard: focus the strip, ArrowRight = back in time, ArrowLeft = forward.
        await page.locator('.shs__strip').focus()
        const k0 = mm.centred
        await page.keyboard.press(k0 > 0 ? 'ArrowRight' : 'ArrowLeft')
        await settle(page)
        mm = await page.evaluate(measure)
        check(mm.centred === (k0 > 0 ? k0 - 1 : k0 + 1), `${tag}: arrow key moves one slide (${k0} -> ${mm.centred})`)
        steady(mm, 'keyboard')

        // A refresh (new props, the live shift's people changed) keeps the slide the reader is on.
        const kept = mm.centred
        await page.evaluate(() => window.__shsBump())
        await settle(page, 300)
        mm = await page.evaluate(measure)
        check(mm.centred === kept, `${tag}: refresh keeps the swiped-to slide (${kept} -> ${mm.centred})`)
        steady(mm, 'refresh')
      } else {
        check(m.arrows.length === 0, `${tag}: no arrows for a single slide`)
      }

      // A vertical drag over the strip scrolls the page, not the strip.
      const sl0 = (await page.evaluate(measure)).scrollLeft
      await page.evaluate(() => window.scrollTo(0, 0))
      await swipe(page, cdp, 0, -200)
      await settle(page, 700)
      const v = await page.evaluate(measure)
      check(v.scrollY > 60 && Math.abs(v.scrollLeft - sl0) < 1 && v.scrollX === 0, `${tag}: vertical drag scrolls the page (y ${v.scrollY}, strip ${sl0} -> ${v.scrollLeft})`)
      check(errors.length === 0, `${tag}: no page errors ${errors.join(' | ')}`)
      await cdp.detach()
      await page.close()
    }
    await context.close()
  }

  // A page that CAN scroll sideways (a wide sibling): moving the strip must never move the page (scrollIntoView used to).
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'he-IL' })
    const page = await context.newPage()
    await page.addInitScript(() => { window.__pageX = []; addEventListener('scroll', (e) => { if (e.target === document) window.__pageX.push(window.scrollX) }, true) })
    await page.goto(`${base}/fixture-shifts?case=all&wide=1`, { waitUntil: 'networkidle' })
    await settle(page, 400)
    for (const label of ['המשמרת הקודמת', 'המשמרת הבאה', 'המשמרת הבאה']) {
      await page.evaluate((l) => document.querySelector(`.shs__arrow[aria-label="${l}"]`).click(), label)
      await settle(page)
    }
    await page.evaluate(() => window.scrollTo(-300, 0))
    await settle(page, 200)
    await page.evaluate(() => document.querySelector('.shs__arrow[aria-label="המשמרת הקודמת"]').click())
    await settle(page)
    const r = await page.evaluate(() => ({ x: window.scrollX, log: window.__pageX }))
    check(r.x === -300 && r.log.every((x) => x === 0 || x === -300), `wide page: strip moves never scroll the page (${r.x}, ${r.log.join(',')})`)
    await context.close()
  }

  // Reduced motion: the arrow jumps straight there.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', locale: 'he-IL' })
    const page = await context.newPage()
    await page.goto(`${base}/fixture-shifts?case=all`, { waitUntil: 'networkidle' })
    await settle(page, 400)
    await page.evaluate(() => document.querySelector('.shs__arrow[aria-label="המשמרת הבאה"]').click())
    await page.waitForTimeout(60)
    const m = await page.evaluate(measure)
    check(m.centred === 2 && whole(m, 2), `reduced motion: arrow moves instantly (slide ${m.centred})`)
    await context.close()
  }
} finally {
  await browser.close()
}

for (const f of failures) console.log('FAIL', f)
console.log(`check-shift-scroller: ${passed} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
