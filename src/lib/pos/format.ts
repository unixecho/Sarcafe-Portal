// Display formatting — pure. Money lives in money.ts (formatAgorot, formatDelta).

import type { Localized } from '@/lib/menu/types'
import { localized } from '@/lib/menu/types'
import type { PosItem } from './types'
import { describeModifier } from './modifiers'

export type PosLang = 'he' | 'en'

/** "#42". Always wrapped in an LTR isolate by the caller (`.ltr-isolate`). */
export function ticketLabel(ticketNo: number): string {
  return `#${ticketNo}`
}

/** Ayeka's `since()`: "12 דק׳" for minutes, "1:05 ש׳" once past an hour; seconds under a minute. */
export function sinceLabel(totalSeconds: number, lang: PosLang = 'he'): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  if (s < 60) return lang === 'he' ? `${s} שנ׳` : `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return lang === 'he' ? `${m} דק׳` : `${m} min`
  const h = Math.floor(m / 60)
  const mm = String(m % 60).padStart(2, '0')
  return lang === 'he' ? `${h}:${mm} ש׳` : `${h}:${mm} h`
}

/** Elapsed as a ticking clock face, "1:42" / "12:05" — what a card shows beside its aging colour. */
export function clockLabel(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export function nameOf(l: Localized | null | undefined, lang: PosLang): string {
  return localized(l ?? undefined, lang)
}

/** "2× Latte · Oat · +extra shot ×2 …" — one line for a feed row or a receipt. Built from the SNAPSHOT. */
export function lineSummary(line: Pick<PosItem, 'qty' | 'name' | 'type_label' | 'variant_label' | 'modifiers'>, lang: PosLang): string {
  const parts: string[] = [`${line.qty}× ${nameOf(line.name, lang)}`]
  if (line.type_label) parts.push(nameOf(line.type_label, lang))
  if (line.variant_label) parts.push(line.variant_label)
  for (const m of line.modifiers ?? []) parts.push(describeModifier(m, lang))
  return parts.filter(Boolean).join(' · ')
}

/** HH:MM in the viewer's locale (24 h). */
export function timeLabel(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false })
}
