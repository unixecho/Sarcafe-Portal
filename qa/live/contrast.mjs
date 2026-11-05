// Readability audit: every piece of text on screen against the real pixels behind it (photo, glass, blur included).
// The text is hidden, the screen is captured, and each text's colour is compared with the worst 10% of the pixels behind it.
// WCAG AA: 4.5:1, or 3:1 for large text. Text under the dock's fade or under an open menu is not "being read" and is skipped.

const GATHER = () => {
  const out = []
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const dockTop = document.querySelector('.gl-dock > div')?.getBoundingClientRect().top ?? innerHeight
  const cards = [...document.querySelectorAll('.lg-menu-card')].map((c) => c.getBoundingClientRect())
  let n
  while ((n = tw.nextNode())) {
    const t = n.textContent.replace(/\s+/g, ' ').trim()
    if (!t) continue
    const el = n.parentElement
    if (!el || el.closest('[hidden], script, style, .sr-only, title, noscript, [aria-hidden="true"] svg')) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    let op = 1
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) op *= Number(getComputedStyle(e).opacity)
    // rgb()/rgba() are 0-255; colour-mix() results come back as color(srgb r g b / a) with channels 0-1.
    const nums = cs.color.match(/[\d.]+/g).map(Number)
    const m = cs.color.startsWith('color(') ? [nums[0] * 255, nums[1] * 255, nums[2] * 255, nums[3] ?? 1] : nums
    const alpha = (m[3] ?? 1) * op
    if (alpha < 0.05) continue
    const range = document.createRange()
    range.selectNodeContents(n)
    for (const r of range.getClientRects()) {
      const x0 = Math.max(0, r.left), y0 = Math.max(0, r.top), x1 = Math.min(innerWidth, r.right), y1 = Math.min(innerHeight, r.bottom)
      if (x1 - x0 < 3 || y1 - y0 < 4) continue
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
      if (cy > dockTop - 34 && !el.closest('.gl-dock, .gl-toasts')) continue
      const inCard = cards.find((q) => cx > q.left && cx < q.right && cy > q.top && cy < q.bottom)
      if (inCard && !el.closest('.lg-menu-card')) continue
      const top = document.elementFromPoint(cx, cy)
      if (!top || !(top === el || el.contains(top) || top.contains(el))) continue
      if (el.closest('button:disabled, [aria-disabled="true"]')) continue
      out.push({ t: t.slice(0, 40), x: x0, y: y0, w: x1 - x0, h: y1 - y0, c: m.slice(0, 3), a: alpha, size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight) || 400 })
    }
  }
  return out
}
const ANALYSE = async ({ b64, items }) => {
  const img = new Image()
  img.src = 'data:image/png;base64,' + b64
  await img.decode()
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height
  const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0)
  const L = (r, g, b) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  return items.map((it) => {
    const d = cx.getImageData(Math.round(it.x), Math.round(it.y), Math.max(1, Math.round(it.w)), Math.max(1, Math.round(it.h))).data
    const ratios = []
    for (let i = 0; i < d.length; i += 4) {
      const bg = [d[i], d[i + 1], d[i + 2]]
      const fg = it.c.map((v, k) => v * it.a + bg[k] * (1 - it.a))
      const l1 = L(...fg), l2 = L(...bg)
      ratios.push((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05))
    }
    ratios.sort((a, b) => a - b)
    return { ...it, ratio: ratios[Math.floor(ratios.length * 0.1)] ?? 21 }
  })
}

/** Audits what is on screen now. Returns { measured, lowest, failures: [{ text, ratio, size }] }. */
export async function auditScreen(page) {
  const items = await page.evaluate(GATHER)
  const handle = await page.addStyleTag({ content: '*,*::placeholder{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important}' })
  await page.waitForTimeout(120)
  const b64 = (await page.screenshot()).toString('base64')
  await handle.evaluate((e) => e.remove())
  const res = await page.evaluate(ANALYSE, { b64, items })
  const failures = res.filter((r) => r.ratio < (r.size >= 24 || (r.size >= 18.66 && r.weight >= 700) ? 3 : 4.5)).map((r) => ({ text: r.t, ratio: Math.round(r.ratio * 100) / 100, size: r.size }))
  return { measured: res.length, lowest: res.reduce((m, r) => Math.min(m, r.ratio), 21), failures }
}
