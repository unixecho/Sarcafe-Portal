// The staff API contract: request schemas (zod — the SERVER narrows every body
// field by field with these, never spreading a body into a write) and response
// types (the client's fetchers are typed against them). One file, imported by the
// route handlers AND by lib/pos/client.ts, so the two sides cannot drift.
//
// Every route answers errors with the one envelope in lib/http/errors.ts:
//   { error: { code: PosErrorCode, message: string, details?: … } }
// Employees never read `code`/`message` — the UI maps each code to plain language.

import { z } from 'zod'
import type { Localized } from '@/lib/menu/types'
import type {
  ItemStatus, PosErrorCode, PosMenu, PosPoint, PosPointStaff, PosRoute, PosSession, StaffDirEntry,
} from './types'

const uuid = z.string().uuid()

// ---- Shared pieces --------------------------------------------------------------------

export const modifierSelectionSchema = z
  .object({
    groupUid: z.string().min(1).max(80),
    optionUid: z.string().min(1).max(80),
    qty: z.number().int().min(1).max(9).optional(),
  })
  .strict()

const lineCommon = {
  qty: z.number().int().min(1).max(99),
  note: z.string().max(240).nullable().optional(),
  forName: z.string().max(80).nullable().optional(),
}

/** A catalogue line (ids and counts only) or a hand-typed one. */
export const lineInputSchema = z.union([
  z
    .object({
      itemUid: z.string().min(1).max(80),
      typeUid: z.string().max(80).nullable().optional(),
      priceChoice: z.number().int().min(0).max(9).nullable().optional(),
      /** undefined = AS-IS (the defaults); an array — even [] — is taken exactly */
      modifiers: z.array(modifierSelectionSchema).max(24).optional(),
      ...lineCommon,
    })
    .strict(),
  z
    .object({
      custom: z
        .object({
          name: z.string().min(1).max(80),
          priceAgorot: z.number().int().min(0).max(99_999),
          pointId: uuid,
        })
        .strict(),
      ...lineCommon,
    })
    .strict(),
])

// ---- Requests -----------------------------------------------------------------------------

export const createOrderBody = z
  .object({
    branchId: uuid,
    /** Idempotency key: generated ONCE when the cashier taps send, reused by every retry. */
    clientKey: uuid,
    customerName: z.string().min(1).max(120),
    customerPhone: z.string().max(40).nullable().optional(),
    receiptRef: z.string().max(80).nullable().optional(),
    slipTotalAgorot: z.number().int().min(0).max(99_999_999).nullable().optional(),
    note: z.string().max(400).nullable().optional(),
    lines: z.array(lineInputSchema).min(1).max(60),
  })
  .strict()
export type CreateOrderBody = z.infer<typeof createOrderBody>

export const addItemsBody = z
  .object({ branchId: uuid, lines: z.array(lineInputSchema).min(1).max(60) })
  .strict()
export type AddItemsBody = z.infer<typeof addItemsBody>

export const editOrderBody = z
  .object({
    branchId: uuid,
    customerName: z.string().min(1).max(120),
    customerPhone: z.string().max(40).nullable().optional(),
    receiptRef: z.string().max(80).nullable().optional(),
    note: z.string().max(400).nullable().optional(),
  })
  .strict()
export type EditOrderBody = z.infer<typeof editOrderBody>

export const voidBody = z
  .object({
    branchId: uuid,
    /** null / omitted = every line that has not been delivered (cancel the order) */
    itemIds: z.array(uuid).min(1).max(100).nullable().optional(),
    reason: z.string().min(1).max(60),
  })
  .strict()
export type VoidBody = z.infer<typeof voidBody>

const liveStatus = z.enum(['sent', 'preparing', 'ready', 'delivered'])
export const advanceBody = z
  .object({ branchId: uuid, ids: z.array(uuid).min(1).max(100), from: liveStatus, to: liveStatus })
  .strict()
export type AdvanceBody = z.infer<typeof advanceBody>

export const checkinBody = z
  .object({ pointId: uuid, event: z.enum(['check_in', 'check_out']) })
  .strict()
export type CheckinBody = z.infer<typeof checkinBody>

export const handleBody = z.object({ handle: z.string().min(1).max(40) }).strict()
export type HandleBody = z.infer<typeof handleBody>

// ---- Responses ------------------------------------------------------------------------------

export type ApiErrorBody = { error: { code: PosErrorCode; message: string; details?: Record<string, unknown> } }

export type BranchLite = { id: string; slug: string; name: Localized; kind: 'permanent' | 'event' }

export type PosMe = {
  id: string
  handle: string
  /** false until the person has confirmed their nickname (staff.handle_set_at is null) */
  handleConfirmed: boolean
  colour: string | null
  /** OP, or a general manager of this branch — may configure, see stats, void delivered lines.
   *  Always false for a QUICK-LOGIN session (blueprint §1a.5): floor work only. */
  isManager: boolean
  /** The short number typed at quick login (staff.employee_no). */
  employeeNo?: string | null
  /** Has a quick-login passcode been set (never the code itself). */
  hasPasscode?: boolean
  /** This session was opened with employee number + passcode, not Google. */
  quickSession?: boolean
  /** Opaque code session, with no authenticated Supabase browser client. */
  codeOnly?: boolean
}

/** Everything the staff app needs for first paint. Also server-rendered into /pos's props. */
export type BootstrapResponse = {
  me: PosMe
  /** the POS-enabled branches this person may work, for the (rare) chooser */
  branches: BranchLite[]
  branch: BranchLite | null
  enabled: boolean
  session: PosSession | null
  points: PosPoint[]
  routes: PosRoute[]
  pointStaff: PosPointStaff[]
  unsold: string[]
  menu: PosMenu | null
  directory: StaffDirEntry[]
  serverTime: string
}

export type MenuResponse = { unchanged: true; stamp: string } | { unchanged: false; menu: PosMenu }

export type CreateOrderResponse = {
  ok: true
  deduped: boolean
  order: { id: string; ticketNo: number; totalAgorot: number }
}
export type AddItemsResponse = { ok: true; added: number; totalAgorot: number }
export type EditOrderResponse = { ok: true }
export type VoidResponse = { ok: true; voided: string[]; skipped: string[]; orderStatus: string }
export type AdvanceResponse = { ok: string[]; conflict: string[]; missing: string[] }
export type CheckinResponse = { ok: true }
export type HandleResponse = { ok: true; handle: string }

/** GET /api/board/[token] — PUBLIC. First names and numbers only. */
export type BoardResponse = {
  branchName: Localized
  points: { id: string; name: string; colour: string }[]
  ready: {
    orderId: string
    ticketNo: number
    firstName: string
    pointId: string
    pointName: string
    pointColour: string
    readyAt: string
  }[]
  preparing: number
  serverTime: string
}

export type { ItemStatus }

// Read selectors are a closed vocabulary. Table names, columns, actor IDs and SQL filters never come from a browser.
const readScope = { branch: uuid }
const readSession = { ...readScope, session: uuid }
const eventOrder = z.enum(['asc', 'desc']).optional()
export const posReadQuery = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('live'), ...readSession }).strict(),
  z.object({ kind: z.literal('orders'), ...readSession, before: z.coerce.number().int().min(1).optional() }).strict(),
  z.object({ kind: z.literal('order'), ...readScope, order: uuid }).strict(),
  z.object({ kind: z.literal('order_events'), ...readScope, order: uuid, direction: eventOrder }).strict(),
  z.object({ kind: z.literal('point_history'), ...readSession, point: uuid, limit: z.coerce.number().int().min(1).max(600).default(60) }).strict(),
  z.object({ kind: z.literal('checkin'), ...readScope, point: uuid, session: uuid.optional() }).strict(),
])
export type PosReadQuery = z.infer<typeof posReadQuery>
