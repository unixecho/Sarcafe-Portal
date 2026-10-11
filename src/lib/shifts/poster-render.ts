// Draws a PosterModel (poster-model.ts) on a canvas in the Sarcafe look: the dark
// espresso ground, the branch's own generated photograph fading into it at the top,
// the cream badge, glass day cards with hairline dividers, and each person as a
// coloured chip — the same vocabulary the app uses on screen, sized for a phone's
// share sheet. Browser-only (it needs a canvas and the page's loaded font).
//
// Two passes over one layout function: the first only measures (so the canvas can
// be exactly as tall as the week needs, however many people are on it), the second
// paints. Hebrew runs right-to-left; times and dates are drawn left-to-right so a
// range like 07:00–13:00 always reads in clock order.

import { initialsOf } from './names'
import type { PosterDay, PosterModel, PosterPerson, PosterRow } from './poster-model'

export const POSTER_WIDTH = 540

const PAD = 18
const INK = '#fdf6ec'
const DIM = '#b9ada0'
const FAINT = '#9c9086'
const BG = '#150f0c'
const NEON = '#ff7a45'
const NEON_SOFT = '#ffab7a'
const SAGE = '#c3ceac'
const WARN = '#ffc857'
const HEADER_H = 190
const TIME_COL = 124

export type PosterAssets = { scene: HTMLImageElement | null; logo: HTMLImageElement | null }

async function loadImage(url: string | null): Promise<HTMLImageElement | null> {
  if (!url) return null
  const image = new Image()
  image.src = url
  try {
    await image.decode()
    return image
  } catch {
    return null
  }
}

export async function loadPosterAssets(sceneUrl: string | null): Promise<PosterAssets> {
  const [scene, logo] = await Promise.all([loadImage(sceneUrl), loadImage('/sarcafe-logo.png')])
  return { scene, logo }
}

type Ctx = CanvasRenderingContext2D
type TextOptions = { size: number; weight?: number; color: string; align?: 'left' | 'right' | 'center'; dir?: 'ltr' | 'rtl'; maxWidth?: number }

function roundedRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function layout(ctx: Ctx, model: PosterModel, assets: PosterAssets, font: string, draw: boolean): number {
  const right = POSTER_WIDTH - PAD
  const left = PAD

  // Width of a run of text WITHOUT painting it (the paint pass must never draw while measuring).
  const width = (value: string, o: Pick<TextOptions, 'size' | 'weight' | 'maxWidth'>): number => {
    ctx.font = `${o.weight ?? 500} ${o.size}px ${font}`
    return Math.min(ctx.measureText(value).width, o.maxWidth ?? Infinity)
  }
  const text = (value: string, x: number, y: number, o: TextOptions): number => {
    ctx.font = `${o.weight ?? 500} ${o.size}px ${font}`
    ctx.fillStyle = o.color
    ctx.textAlign = o.align ?? 'right'
    ctx.direction = o.dir ?? 'rtl'
    ctx.textBaseline = 'alphabetic'
    if (draw) ctx.fillText(value, x, y, o.maxWidth)
    return width(value, o)
  }
  const fill = (path: () => void, style: string | CanvasGradient, stroke?: string, lineWidth = 1) => {
    if (!draw) return
    path()
    ctx.fillStyle = style
    ctx.fill()
    if (stroke) {
      ctx.strokeStyle = stroke
      ctx.lineWidth = lineWidth
      ctx.stroke()
    }
  }
  const pill = (label: string, xRight: number, y: number, color: string, bg: string): number => {
    const w = width(label, { size: 11, weight: 700 }) + 18
    fill(() => roundedRect(ctx, xRight - w, y, w, 20, 10), bg)
    text(label, xRight - w / 2, y + 14, { size: 11, weight: 700, color, align: 'center' })
    return w
  }
  const avatar = (p: PosterPerson, cx: number, cy: number) => {
    fill(() => {
      ctx.beginPath()
      ctx.arc(cx, cy, 10, 0, Math.PI * 2)
    }, p.color)
    text(p.emoji ?? initialsOf(p.name), cx, cy + 4, { size: p.emoji ? 11 : 10, weight: 800, color: p.emoji ? INK : '#241812', align: 'center', dir: 'rtl' })
  }

  // ---- ground + header ---------------------------------------------------------------
  if (draw) {
    ctx.fillStyle = BG
    ctx.fillRect(0, 0, POSTER_WIDTH, 100000)
    if (assets.scene) {
      const s = assets.scene
      const scale = Math.max(POSTER_WIDTH / s.naturalWidth, (HEADER_H + 30) / s.naturalHeight)
      const w = s.naturalWidth * scale
      const h = s.naturalHeight * scale
      // The picture is taller than the header band: keep it inside the band or it shows through the cards below.
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, POSTER_WIDTH, HEADER_H + 30)
      ctx.clip()
      ctx.drawImage(s, (POSTER_WIDTH - w) / 2, -(h - (HEADER_H + 30)) * 0.4, w, h)
      ctx.restore()
    }
    const fade = ctx.createLinearGradient(0, 0, 0, HEADER_H + 30)
    fade.addColorStop(0, 'rgba(13,10,8,0.5)')
    fade.addColorStop(0.55, 'rgba(18,12,9,0.78)')
    fade.addColorStop(1, BG)
    ctx.fillStyle = fade
    ctx.fillRect(0, 0, POSTER_WIDTH, HEADER_H + 30)
    const glow = ctx.createRadialGradient(right, 40, 0, right, 40, 260)
    glow.addColorStop(0, 'rgba(255,122,69,0.22)')
    glow.addColorStop(1, 'rgba(255,122,69,0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, POSTER_WIDTH, HEADER_H + 30)
  }

  const badge = 52
  fill(() => {
    ctx.beginPath()
    ctx.arc(right - badge / 2, 44 + badge / 2 - 6, badge / 2, 0, Math.PI * 2)
  }, '#fdf6ec')
  if (draw && assets.logo) {
    const inner = badge * 0.94
    ctx.drawImage(assets.logo, right - badge / 2 - inner / 2, 44 + badge / 2 - 6 - inner / 2, inner, inner)
  }
  text(`Sarcafe · ${model.branchName}`, right - badge - 12, 66, { size: 13, weight: 700, color: NEON_SOFT })
  text(model.title, right, 128, { size: 34, weight: 800, color: INK })
  const rangeW = text(model.rangeLabel, right, 156, { size: 16, weight: 600, color: DIM, dir: 'ltr' })
  if (model.published) pill('פורסם', right - rangeW - 12, 141, SAGE, 'rgba(147,163,111,0.22)')
  else pill('טיוטה — טרם פורסם', right - rangeW - 12, 141, WARN, 'rgba(255,200,87,0.18)')

  // ---- summary ---------------------------------------------------------------------
  let y = HEADER_H
  fill(() => roundedRect(ctx, left, y, POSTER_WIDTH - PAD * 2, 54, 20), 'rgba(253,246,236,0.07)', 'rgba(253,246,236,0.1)')
  text(model.summary, right - 18, y + 33, { size: 19, weight: 800, color: INK })
  text(model.scope === 'mine' ? 'השבוע שלכם' : 'כל הצוות', left + 18, y + 32, { size: 13, weight: 600, color: FAINT, align: 'left' })
  y += 54 + 14

  // ---- days ------------------------------------------------------------------------
  for (const day of model.days) y = layoutDay(day, y)

  // ---- footer ----------------------------------------------------------------------
  y += 4
  if (draw) {
    ctx.fillStyle = 'rgba(253,246,236,0.08)'
    ctx.fillRect(left, y, POSTER_WIDTH - PAD * 2, 1)
  }
  y += 24
  text(model.published ? 'Sarcafe · sarcafe-portal.vercel.app' : 'טיוטה — ייתכנו שינויים · Sarcafe', POSTER_WIDTH / 2, y, { size: 12, weight: 600, color: DIM, align: 'center' })
  y += 18
  text(model.madeAt, POSTER_WIDTH / 2, y, { size: 11, weight: 500, color: FAINT, align: 'center' })
  return y + 26

  // ----------------------------------------------------------------------------------
  function layoutDay(day: PosterDay, top: number): number {
    const cardW = POSTER_WIDTH - PAD * 2
    const peopleRight = right - 14 - TIME_COL
    const peopleLeft = left + 14
    // First measure the card's height from its rows.
    const rowHeights = day.rows.map((row) => rowHeight(row, peopleRight - peopleLeft))
    const head = 46 + (day.note ? 18 : 0)
    const body = day.rows.length === 0 ? 40 : rowHeights.reduce((a, b) => a + b, 0)
    const height = head + body + 6

    fill(
      () => roundedRect(ctx, left, top, cardW, height, 22),
      day.today ? 'rgba(255,122,69,0.09)' : 'rgba(253,246,236,0.055)',
      day.today ? 'rgba(255,122,69,0.55)' : 'rgba(253,246,236,0.09)',
      day.today ? 1.5 : 1
    )
    const weekdayW = text(day.weekday, right - 14, top + 30, { size: 18, weight: 800, color: INK })
    const dateW = text(day.date, right - 14 - weekdayW - 10, top + 30, { size: 14, weight: 600, color: DIM, dir: 'ltr' })
    let chipX = right - 14 - weekdayW - 10 - dateW - 10
    if (day.relative) chipX -= pill(day.relative, chipX, top + 15, NEON_SOFT, 'rgba(255,122,69,0.18)') + 6
    if (day.closed) pill('סגור', chipX, top + 15, DIM, 'rgba(253,246,236,0.08)')
    else if (day.hours) {
      // The label runs right-to-left and the range left-to-right: as one string the digits would be reordered ("19:00–07:00").
      const label = 'שעות פעילות'
      const rangeW = text(day.hours, left + 14, top + 29, { size: 12, weight: 500, color: FAINT, align: 'left', dir: 'ltr' })
      text(label, left + 14 + rangeW + 7 + width(label, { size: 12, weight: 500 }), top + 29, { size: 12, weight: 500, color: FAINT })
    }
    if (day.note) text(day.note, right - 14, top + 50, { size: 12, weight: 600, color: NEON_SOFT, maxWidth: cardW - 28 })

    let rowTop = top + head
    if (day.rows.length === 0) {
      text(day.closed ? 'הסניף סגור' : model.scope === 'mine' ? 'יום חופשי' : 'אין משמרות', right - 14, rowTop + 22, { size: 14, weight: 500, color: FAINT })
    }
    day.rows.forEach((row, i) => {
      const h = rowHeights[i]!
      if (draw) {
        ctx.fillStyle = 'rgba(253,246,236,0.07)'
        ctx.fillRect(left + 14, rowTop, cardW - 28, 1)
      }
      if (row.mine) {
        fill(() => roundedRect(ctx, left + 8, rowTop + 6, cardW - 16, h - 8, 14), 'rgba(255,122,69,0.14)')
        fill(() => roundedRect(ctx, right - 12, rowTop + 14, 4, h - 24, 2), NEON)
      }
      text(row.time, right - 22, rowTop + 28, { size: 16, weight: 800, color: row.mine ? NEON_SOFT : INK, dir: 'ltr' })
      let sub = rowTop + 46
      for (const line of [row.label, row.place]) {
        if (!line) continue
        text(line, right - 22, sub, { size: 12, weight: 500, color: DIM, maxWidth: TIME_COL - 6 })
        sub += 16
      }
      layoutPeople(row, peopleRight - 6, peopleLeft, rowTop + 14)
      rowTop += h
    })
    return top + height + 10
  }

  function rowHeight(row: PosterRow, avail: number): number {
    const lines = placePeople(row, avail, 0, 0, false)
    const timeColumn = 40 + (row.label ? 16 : 0) + (row.place ? 16 : 0)
    return Math.max(timeColumn, 18 + lines * 28 + (row.note ? 16 : 0)) + 6
  }

  function layoutPeople(row: PosterRow, xRight: number, xLeft: number, top: number) {
    const lines = placePeople(row, xRight - xLeft, xRight, top, true)
    if (row.note) text(row.note, xRight, top + lines * 28 + 12, { size: 12, weight: 500, color: DIM, maxWidth: xRight - xLeft })
  }

  /** Lays the row's people out as chips, right to left, wrapping; returns how many lines it took. */
  function placePeople(row: PosterRow, avail: number, xRight: number, top: number, paint: boolean): number {
    if (row.people.length === 0) {
      if (paint) text('אף אחד עוד לא משובץ', xRight, top + 16, { size: 13, weight: 500, color: WARN })
      return 1
    }
    let x = xRight
    let line = 0
    let used = 0
    for (const p of row.people) {
      const nameW = width(p.name, { size: 13, weight: p.mine ? 800 : 600 })
      const roleW = p.role ? width(p.role, { size: 11, weight: 500 }) + 6 : 0
      const chipW = 20 + 6 + nameW + roleW + 14
      if (used > 0 && used + chipW > avail) {
        line++
        used = 0
        x = xRight
      }
      if (paint) {
        const cy = top + 12 + line * 28
        avatar(p, x - 10, cy)
        text(p.name, x - 26, cy + 5, { size: 13, weight: p.mine ? 800 : 600, color: p.mine ? NEON_SOFT : INK })
        if (p.role) text(p.role, x - 26 - nameW - 6, cy + 5, { size: 11, weight: 500, color: DIM })
      }
      x -= chipW
      used += chipW
    }
    return line + 1
  }
}

/** Renders the poster; `scale` is the device pixel ratio (2 gives a sharp 1080-wide picture). */
export function renderPoster(model: PosterModel, assets: PosterAssets, opts: { scale?: number; fontFamily: string }): HTMLCanvasElement {
  const scale = opts.scale ?? 2
  const measure = document.createElement('canvas').getContext('2d')!
  const height = Math.ceil(layout(measure, model, assets, opts.fontFamily, false))
  const canvas = document.createElement('canvas')
  canvas.width = POSTER_WIDTH * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  layout(ctx, model, assets, opts.fontFamily, true)
  return canvas
}

export function canvasBlob(canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('canvas export failed'))), type, quality))
}
