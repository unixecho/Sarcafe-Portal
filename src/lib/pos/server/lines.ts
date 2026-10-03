// Turning what the browser SENT into what the database STORES.
//
// The browser sends ids and counts: "item X, type Y, price #1, these option ids,
// quantity 2". Everything that has a value — the price, the name, the label of every
// modifier, which selling point makes it — is read here from the published menu and
// the owner's routing, and handed to the pos_* functions already resolved. The
// pricing rules themselves live in lib/pos/pricing.ts (pure, shared with the screens
// so the total on a cashier's display is computed by the same code); this file only
// gathers their inputs and speaks HTTP. It must never re-implement a price.
//
// Service-role reads: the caller has already passed a guard.

import { createServiceRoleClient } from '@/lib/supabase/server'
import { ApiError } from '@/lib/http/errors'
import { priceLine, type PricingContext } from '@/lib/pos/pricing'
import { normalizeCustomerName, normalizePhone } from '@/lib/pos/validate'
import { LIMITS } from '@/lib/pos/vocab'
import type { LineInput, LineProblem, ResolvedLine } from '@/lib/pos/types'
import { loadPosMenu } from './menu'
import { posError } from './guard'

type ReadResult<T> = { data: T | null; error: { code?: string } | null }

/** A failed read is a 500, never an empty list: an empty routing table would turn
 *  every item into "no selling point makes this" — a lie the cashier would act on. */
function must<T>(label: string, res: ReadResult<T>): T | null {
  if (res.error) {
    console.error(`${label} read failed:`, res.error.code)
    throw posError('internal_error')
  }
  return res.data
}

/** Points, routes, the owner's "not sold here" list and the published menu — everything
 *  priceLine() needs and nothing it does not. */
export async function buildPricingContext(branchId: string): Promise<PricingContext> {
  const service = createServiceRoleClient()
  const [menu, points, routes, settings] = await Promise.all([
    loadPosMenu(branchId),
    service.from('pos_points').select('id, active, excluded_uids').eq('branch_id', branchId).eq('active', true),
    service.from('pos_point_routes').select('kind, ref, point_id').eq('branch_id', branchId),
    service.from('pos_branch_settings').select('unsold_refs').eq('branch_id', branchId).maybeSingle(),
  ])

  return {
    categories: menu?.categories ?? [],
    modifierGroups: menu?.modifierGroups ?? [],
    routing: {
      points: (must('pos_points', points as ReadResult<unknown>) ?? []) as PricingContext['routing']['points'],
      routes: (must('pos_point_routes', routes as ReadResult<unknown>) ?? []) as PricingContext['routing']['routes'],
      unsold: ((must('pos_branch_settings', settings as ReadResult<unknown>) as { unsold_refs?: string[] } | null)?.unsold_refs ?? []),
    },
  }
}

export type ResolveResult = { ok: true; lines: ResolvedLine[] } | { ok: false; index: number; problem: LineProblem }

/** Prices and routes every line of an order, stopping at the first one that cannot be sold. */
export async function resolveLines(inputs: LineInput[], branchId: string): Promise<ResolveResult> {
  const ctx = await buildPricingContext(branchId)
  const lines: ResolvedLine[] = []
  for (let index = 0; index < inputs.length; index++) {
    const input = inputs[index] as LineInput
    const priced = priceLine(input, ctx)
    if (!priced.ok) return { ok: false, index, problem: priced.problem }
    lines.push(priced.line)
  }
  return { ok: true, lines }
}

/** A pricing problem -> the ApiError a route throws. The status of each code (409 when the
 *  menu moved under the cashier, 422 when it cannot be sold as asked, 400 when malformed)
 *  lives with the rest of the table in guard.ts. `details` says WHICH line and what was
 *  wrong with it, so the cashier's screen can point at the item. */
export function problemToApiError(problem: LineProblem, index?: number): ApiError {
  const details: Record<string, unknown> = {}
  if (typeof index === 'number') details.lineIndex = index
  if (problem.itemUid) details.itemUid = problem.itemUid
  if (problem.groupUid) details.groupUid = problem.groupUid
  if (problem.optionUid) details.optionUid = problem.optionUid
  return posError(problem.code, details)
}

// ---- Customer fields -----------------------------------------------------------------

export type CustomerFields = {
  name: string
  phone: string | null
  receiptRef: string | null
  note: string | null
}

/** Trim + length-check an optional free-text field. Over the cap is a refusal, not a
 *  silent truncation: a note that quietly loses its last words is worse than an error. */
function optionalText(value: string | null | undefined, max: number): string | null | 'too_long' {
  const s = (value ?? '').trim()
  if (s === '') return null
  return Array.from(s).length > max ? 'too_long' : s
}

/**
 * The customer block of an order, normalised with the shared validators. Any problem
 * is one code — 'bad_customer' — because that is the database's own word for it, and
 * the cashier needs the same sentence whichever layer noticed first. The phone is
 * personal data: it is returned to the caller for the RPC and goes nowhere else.
 */
export function normalizeCustomerFields(input: {
  customerName: string
  customerPhone?: string | null
  receiptRef?: string | null
  note?: string | null
}): CustomerFields {
  const name = normalizeCustomerName(input.customerName)
  if (name === null) throw posError('bad_customer', { field: 'name' })

  const phone = normalizePhone(input.customerPhone)
  if (phone === 'invalid') throw posError('bad_customer', { field: 'phone' })

  const receiptRef = optionalText(input.receiptRef, LIMITS.receiptRefMax)
  if (receiptRef === 'too_long') throw posError('bad_customer', { field: 'receipt' })

  const note = optionalText(input.note, LIMITS.orderNoteMax)
  if (note === 'too_long') throw posError('bad_customer', { field: 'note' })

  return { name, phone, receiptRef, note }
}
