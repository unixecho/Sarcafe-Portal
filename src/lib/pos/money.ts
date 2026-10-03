// Money primitives. Pure. See pricing.ts for the line-pricing rules these serve.
//
//   * Integer agorot everywhere. ₪25.50 is 2550. Floats never reach the database.
//   * The UNIT IS IN THE NAME of every variable (…Agorot, …Shekels). Ayeka once
//     passed a shekel value to an agorot formatter and showed ₪87 as ₪0.87.
//   * Round the UNIT price to agorot BEFORE multiplying by quantity.
//   * A menu price may be a number, a slash range ("14/16" = two prices, the
//     cashier picks the one on the slip), or text. Non-numeric = not sellable.

import type { MenuItem } from '@/lib/menu/types'

/** Shekels → agorot. Rounds once, here, per UNIT. */
export function toAgorot(shekels: number): number {
  return Math.round(shekels * 100)
}

const DECIMAL = /^-?\d+(?:[.,]\d{1,2})?$/

/** A menu/modifier price (number | numeric string) → agorot, or null if it is not a plain amount.
 *  Accepts a comma decimal ("12,5") because that is how it is typed on a Hebrew keyboard. */
export function parseMoneyToAgorot(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? toAgorot(value) : null
  if (typeof value !== 'string') return null
  const s = value.trim()
  if (!DECIMAL.test(s)) return null
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? toAgorot(n) : null
}

/** What a menu price can be sold for, in agorot: one number, several (a slash
 *  range), or null when it cannot be sold at all (blank / text / any non-numeric part). */
export function priceChoices(price: MenuItem['price'] | string | undefined): number[] | null {
  if (price === null || price === undefined) return null
  if (typeof price === 'number') {
    const a = parseMoneyToAgorot(price)
    return a === null || a < 0 ? null : [a]
  }
  const s = String(price).trim()
  if (s === '') return null
  const parts = s.split('/').map((p) => p.trim())
  const out: number[] = []
  for (const p of parts) {
    const a = parseMoneyToAgorot(p)
    if (a === null || a < 0) return null
    out.push(a)
  }
  return out
}

/** A price DELTA (a type's priceDelta, a modifier's priceDelta). May be negative. null when unparseable; 0 when absent. */
export function parseDeltaAgorot(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return 0
  return parseMoneyToAgorot(value)
}

/** "₪15", "₪12.50" — no trailing ".00". Takes AGOROT. */
export function formatAgorot(agorot: number): string {
  const sign = agorot < 0 ? '−' : ''
  const abs = Math.abs(agorot)
  const whole = Math.floor(abs / 100)
  const rest = abs % 100
  return `${sign}₪${rest === 0 ? whole : `${whole}.${String(rest).padStart(2, '0')}`}`
}

/** "+₪2", "−₪1", "" for zero. */
export function formatDelta(agorot: number): string {
  if (agorot === 0) return ''
  return agorot > 0 ? `+${formatAgorot(agorot)}` : formatAgorot(agorot)
}

/** qty × unit, both already in agorot. */
export function lineTotalAgorot(unitAgorot: number, qty: number): number {
  return unitAgorot * qty
}
