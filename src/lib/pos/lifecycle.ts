// The line lifecycle and what a card does with it. Pure.
//
//   sent ──▶ preparing ──▶ ready ──▶ delivered        (voided is the soft delete)
//
// The state machine itself is ENFORCED by pos_advance_items (020); this module is
// the client's mirror of it — "so the UI can hide a control the server would
// refuse, not so the UI can decide" (Ayeka). A button that does nothing is worse
// than no button.
//
// THE MODEL: each LINE has its own lifecycle. A card groups an order's lines for
// one point, but never merges their states — a burger can be ready beside a toast
// nobody has started. The card's one big button therefore advances the lines that
// are at the card's LEAST-advanced stage, so repeated taps walk the whole card
// through accept → ready → handed over without ever skipping a line.

import type { ItemStatus, OrderStatus, PosItem, PosPoint } from './types'
import { UNDO } from './vocab'

/** Order of the live part of the lifecycle. */
export const STAGE_ORDER: readonly ItemStatus[] = ['sent', 'preparing', 'ready', 'delivered']

export type Transition = { from: ItemStatus; to: ItemStatus }

/** The forward steps, and the two mis-tap reverts any staff member may make.
 *  (delivered → ready exists too but is manager-only, or the same person within
 *  UNDO.deliveredWindowS — decided by the route, see canUndoDelivered.) */
export const FORWARD: readonly Transition[] = [
  { from: 'sent', to: 'preparing' },
  { from: 'preparing', to: 'ready' },
  { from: 'ready', to: 'delivered' },
]
/** A fast point may skip "accept". */
export const SKIP_ACCEPT: Transition = { from: 'sent', to: 'ready' }
export const REVERTS: readonly Transition[] = [
  { from: 'ready', to: 'preparing' },
  { from: 'preparing', to: 'sent' },
]

const key = (t: Transition) => `${t.from}>${t.to}`
const ALLOWED = new Set([...FORWARD, SKIP_ACCEPT, ...REVERTS].map(key))

export function isAllowedTransition(from: ItemStatus, to: ItemStatus, opts: { manager?: boolean } = {}): boolean {
  if (from === 'delivered' && to === 'ready') return !!opts.manager
  return ALLOWED.has(`${from}>${to}`)
}

export function nextStatus(status: ItemStatus): ItemStatus | null {
  return FORWARD.find((t) => t.from === status)?.to ?? null
}

export const isLiveStatus = (s: ItemStatus) => s === 'sent' || s === 'preparing' || s === 'ready'

/** The least-advanced LIVE status among the lines (sent < preparing < ready), or
 *  null when nothing is live (all delivered / voided). */
export function cardStage(lines: Pick<PosItem, 'status'>[]): ItemStatus | null {
  for (const stage of ['sent', 'preparing', 'ready'] as const) {
    if (lines.some((l) => l.status === stage)) return stage
  }
  return null
}

export type CardAction = {
  /** what the big button is called — mapped to words by i18n */
  kind: 'accept' | 'ready' | 'handover'
  from: ItemStatus
  to: ItemStatus
  ids: string[]
}

/**
 * What the card's one big button does right now. null when there is nothing to
 * press: nothing live, or the lines are `ready` at a point that does not hand over
 * (someone else — a runner / the cashier — completes those).
 */
export function cardAction(lines: Pick<PosItem, 'id' | 'status'>[], point: Pick<PosPoint, 'hands_over'>): CardAction | null {
  const stage = cardStage(lines)
  if (!stage) return null
  const ids = lines.filter((l) => l.status === stage).map((l) => l.id)
  if (stage === 'sent') return { kind: 'accept', from: 'sent', to: 'preparing', ids }
  if (stage === 'preparing') return { kind: 'ready', from: 'preparing', to: 'ready', ids }
  if (!point.hands_over) return null
  return { kind: 'handover', from: 'ready', to: 'delivered', ids }
}

/** One line's own next step (a single line can still be advanced alone). */
export function lineAction(line: Pick<PosItem, 'id' | 'status'>, point: Pick<PosPoint, 'hands_over'>): CardAction | null {
  return cardAction([line], point)
}

/** The same person may take back a delivery for a short while; a manager always may. */
export function canUndoDelivered(
  line: Pick<PosItem, 'status' | 'delivered_by' | 'delivered_at'>,
  actorId: string,
  nowMs: number,
  isManager = false,
): boolean {
  if (line.status !== 'delivered') return false
  if (isManager) return true
  if (line.delivered_by !== actorId || !line.delivered_at) return false
  return nowMs - Date.parse(line.delivered_at) <= UNDO.deliveredWindowS * 1000
}

/** Mirror of pos_recompute_order(): void when no un-voided line remains,
 *  completed when every un-voided line is delivered, otherwise open. */
export function deriveOrderStatus(lines: Pick<PosItem, 'status'>[]): OrderStatus {
  const live = lines.filter((l) => l.status !== 'voided')
  if (live.length === 0) return 'void'
  return live.every((l) => l.status === 'delivered') ? 'completed' : 'open'
}

/** Σ qty × unit over un-voided lines — what pos_recompute_order stores in total_agorot. */
export function orderTotalAgorot(lines: Pick<PosItem, 'status' | 'qty' | 'unit_agorot'>[]): number {
  return lines.reduce((sum, l) => (l.status === 'voided' ? sum : sum + l.qty * l.unit_agorot), 0)
}

/** Every un-voided line delivered, and at least one. */
export function isFullyDelivered(lines: Pick<PosItem, 'status'>[]): boolean {
  return deriveOrderStatus(lines) === 'completed'
}
