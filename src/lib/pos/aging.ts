// Aging of UNACCEPTED lines (blueprint §7.3). Pure.
//
//   fresh     < 60 s     nothing
//   warming   60–120 s   quiet amber, STILL — no animation. Ayeka's first version had
//                        two stages and "a ticket sat looking completely untouched for
//                        two full minutes and then abruptly began flashing red, which
//                        reads as broken-then-panicking rather than as time passing."
//   late      120–300 s  flash
//   critical  >= 300 s   steady glow + the overdue strip
//
// Only `sent` (not yet accepted) lines age. Once accepted the concern becomes prep
// time, which is a different question.

import type { PosItem } from './types'
import { AGING } from './vocab'

export type AgeStage = 'fresh' | 'warming' | 'late' | 'critical'
export const AGE_ORDER: readonly AgeStage[] = ['fresh', 'warming', 'late', 'critical']

export function ageStage(sentAtMs: number, nowMs: number): AgeStage {
  const raw = (nowMs - sentAtMs) / 1000
  // A timestamp that failed to parse (NaN) must never read as the loudest alarm: every
  // comparison below is false for NaN, so without this it fell straight through to
  // 'critical' — a glowing card and an overdue strip over a value that means nothing.
  if (!Number.isFinite(raw)) return 'fresh'
  const secs = Math.max(0, raw)
  if (secs < AGING.warmingS) return 'fresh'
  if (secs < AGING.lateS) return 'warming'
  if (secs < AGING.criticalS) return 'late'
  return 'critical'
}

/** null for anything that does not age (accepted / ready / delivered / voided). */
export function lineAge(line: Pick<PosItem, 'status' | 'sent_at'>, nowMs: number): AgeStage | null {
  if (line.status !== 'sent') return null
  const t = Date.parse(line.sent_at)
  return Number.isFinite(t) ? ageStage(t, nowMs) : null
}

export function worstStage(stages: (AgeStage | null)[]): AgeStage {
  let worst = 0
  for (const s of stages) if (s) worst = Math.max(worst, AGE_ORDER.indexOf(s))
  return AGE_ORDER[worst] as AgeStage
}

/** How many lines are critical. The overdue strip and the glowing cards BOTH use
 *  this one function — the strip "counts exactly the lines glowing red", never a
 *  second opinion. */
export function overdueCount(lines: Pick<PosItem, 'status' | 'sent_at'>[], nowMs: number): number {
  return lines.reduce((n, l) => (lineAge(l, nowMs) === 'critical' ? n + 1 : n), 0)
}

/** Seconds a line has been waiting since it was sent (never negative). */
export function waitingSeconds(sentAtIso: string, nowMs: number): number {
  const t = Date.parse(sentAtIso)
  return Number.isFinite(t) ? Math.max(0, Math.floor((nowMs - t) / 1000)) : 0
}
