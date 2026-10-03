// The POS's shared vocabulary. Pure types — no React, no DOM, no server APIs, so
// it is safe to import from client components, route handlers and the
// check-pos.mjs harness alike.
//
// Row types are snake_case because they mirror the database columns exactly
// (the browser reads these tables directly over RLS). Request/response DTOs are
// camelCase. docs/POS_BLUEPRINT.md is the spec; supabase/migrations/020 + 021
// are the schema.

import type { Localized, MenuCategory, ModifierGroup, ModifierKind } from '@/lib/menu/types'

export type { ModifierKind }

// ---- Vocabularies (each is the TS half of a CHECK constraint in 020/021) ------

/** Per-LINE lifecycle. `picked_up_*` is a stamped fact, NOT a status. */
export type ItemStatus = 'sent' | 'preparing' | 'ready' | 'delivered' | 'voided'
export const ITEM_STATUSES: readonly ItemStatus[] = ['sent', 'preparing', 'ready', 'delivered', 'voided']

/** Derived by pos_recompute_order(); never set by hand. */
export type OrderStatus = 'open' | 'completed' | 'void'
export type SessionKind = 'live' | 'training'
export type SessionStatus = 'active' | 'closed'

export type PosEventType =
  | 'order_created' | 'items_added' | 'order_edited'
  | 'item_claimed' | 'item_ready' | 'item_picked_up' | 'item_delivered' | 'item_reverted'
  | 'item_voided' | 'order_voided' | 'order_completed'
  | 'session_opened' | 'session_closed' | 'training_wiped'
  | 'point_created' | 'point_updated' | 'point_deactivated' | 'routes_changed'
  | 'checkin' | 'checkout'
  | 'handle_changed' | 'board_token_rotated' | 'settings_changed' | 'pii_cleared'
  | 'pin_changed' | 'quick_login'

export const POS_EVENT_TYPES: readonly PosEventType[] = [
  'order_created', 'items_added', 'order_edited',
  'item_claimed', 'item_ready', 'item_picked_up', 'item_delivered', 'item_reverted',
  'item_voided', 'order_voided', 'order_completed',
  'session_opened', 'session_closed', 'training_wiped',
  'point_created', 'point_updated', 'point_deactivated', 'routes_changed',
  'checkin', 'checkout',
  'handle_changed', 'board_token_rotated', 'settings_changed', 'pii_cleared',
  'pin_changed', 'quick_login',
]

// ---- Rows ------------------------------------------------------------------------

export type PosSession = {
  id: string
  branch_id: string
  kind: SessionKind
  status: SessionStatus
  started_at: string
  started_by: string | null
  ended_at: string | null
  ended_by: string | null
}

export type PosPoint = {
  id: string
  branch_id: string
  name: string
  icon: string
  colour: string
  hands_over: boolean
  prep_minutes: number
  excluded_uids: string[]
  sort_order: number
  active: boolean
}

export type PosRoute = {
  id: string
  branch_id: string
  point_id: string
  kind: 'category' | 'item'
  ref: string
}

export type PosPointStaff = { point_id: string; staff_id: string }

/** One selection snapshotted onto a line (021). Labels + prices are copied in at
 *  order time so history never depends on the current menu. */
export type ModifierSnapshot = {
  group_uid: string
  group: Localized | null
  kind: ModifierKind
  option_uid: string
  label: Localized
  price_delta_agorot: number
  qty: number
  /** substitute only: the ingredient that was replaced */
  source: Localized | null
}

export type PosOrder = {
  id: string
  branch_id: string
  session_id: string
  ticket_no: number
  client_key: string
  customer_name: string
  /** PERSONAL DATA. Never copy into an event payload, never show on the board. */
  customer_phone: string | null
  receipt_ref: string | null
  slip_total_agorot: number | null
  slip_mismatch: boolean
  note: string | null
  status: OrderStatus
  total_agorot: number
  created_by: string
  created_by_handle: string
  created_at: string
  completed_at: string | null
  voided_at: string | null
  voided_by: string | null
  void_reason: string | null
}

export type PosItem = {
  id: string
  order_id: string
  branch_id: string
  seq: number
  batch_no: number
  point_id: string
  point_name: string
  item_uid: string | null
  category_id: string | null
  category_title: Localized | null
  name: Localized
  type_uid: string | null
  type_label: Localized | null
  variant_label: string | null
  /** FINAL per-unit price = base_agorot + Σ(modifier price_delta × qty). */
  unit_agorot: number
  base_agorot: number
  modifiers: ModifierSnapshot[]
  qty: number
  for_name: string | null
  note: string | null
  is_custom: boolean
  status: ItemStatus
  created_by: string
  created_at: string
  sent_at: string
  claimed_by: string | null
  claimed_at: string | null
  ready_at: string | null
  picked_up_by: string | null
  picked_up_at: string | null
  delivered_by: string | null
  delivered_at: string | null
  voided_by: string | null
  voided_at: string | null
  voided_from: Exclude<ItemStatus, 'voided'> | null
  void_reason: string | null
}

export type PosEvent = {
  id: number
  branch_id: string
  session_id: string | null
  order_id: string | null
  item_id: string | null
  point_id: string | null
  event: PosEventType
  actor_id: string | null
  actor_handle: string | null
  payload: Record<string, unknown>
  at: string
}

export type PosCheckin = {
  id: string
  branch_id: string
  session_id: string | null
  point_id: string
  staff_id: string
  event: 'check_in' | 'check_out'
  at: string
}

/** pos_staff_directory — the ONLY staff fields any device may read. */
export type StaffDirEntry = { id: string; handle: string; colour: string | null }

/** An order with its lines, as the station / orders screens hold it. */
export type PosOrderWithItems = PosOrder & { items: PosItem[] }

// ---- The menu as the POS sees it -----------------------------------------------------

/** The published, variant-resolved menu plus a cheap change stamp. */
export type PosMenu = {
  categories: MenuCategory[]
  modifierGroups: ModifierGroup[]
  /** `${published_at}|${updated_at}|${active_variant_id}` — poll this, refetch only on change. */
  stamp: string
  publishedAt: string | null
}

// ---- Resolved pricing (what the server computes; what the client previews) ------------

/** A selection as the CLIENT sends it. Only ids and counts — never prices or labels. */
export type ModifierSelection = { groupUid: string; optionUid: string; qty?: number }

/** One line as the CLIENT sends it. */
export type LineInput =
  | {
      itemUid: string
      typeUid?: string | null
      /** index into the slash-split price list ("14/16" -> 0 | 1); required iff the price is a slash range */
      priceChoice?: number | null
      modifiers?: ModifierSelection[]
      qty: number
      note?: string | null
      forName?: string | null
    }
  | {
      /** hand-typed item (free tap water needs a real line: price 0 is valid) */
      custom: { name: string; priceAgorot: number; pointId: string }
      qty: number
      note?: string | null
      forName?: string | null
    }

/** A line after the SERVER has priced and routed it — the exact shape the
 *  pos_create_order / pos_add_items RPCs take in `p_lines`. */
export type ResolvedLine = {
  point_id: string
  item_uid: string | null
  category_id: string | null
  category_title: Localized | null
  name: Localized
  type_uid: string | null
  type_label: Localized | null
  variant_label: string | null
  unit_agorot: number
  base_agorot: number
  modifiers: ModifierSnapshot[]
  qty: number
  for_name: string | null
  note: string | null
  is_custom: boolean
}

/** Why a line could not be priced/routed. `code` is also an API error code. */
export type LineProblemCode =
  | 'unknown_item' | 'sold_out' | 'no_point' | 'not_sold' | 'no_price' | 'needs_price_choice'
  | 'unknown_type' | 'type_sold_out' | 'needs_type'
  | 'unknown_modifier' | 'modifier_unavailable' | 'modifier_required' | 'modifier_too_many'
  | 'modifier_too_few' | 'modifier_qty' | 'bad_qty' | 'bad_custom'
export type LineProblem = { code: LineProblemCode; itemUid?: string; groupUid?: string; optionUid?: string }

export type PriceResult =
  | { ok: true; line: ResolvedLine }
  | { ok: false; problem: LineProblem }

// ---- Routing -----------------------------------------------------------------------------

/** What an item resolves to. Only `point` is sellable. */
export type RouteResult =
  | { kind: 'point'; pointId: string }
  | { kind: 'unrouted' }      // nobody makes it (a configuration gap — the dashboard flags it)
  | { kind: 'unsold' }        // the owner deliberately does not sell it at this event
  | { kind: 'excluded' }      // inside a point's category, but that point opted it out

// ---- Errors ------------------------------------------------------------------------------

/** Every `error.code` a /api/pos route can return. Employees never see these
 *  strings — the UI maps each to plain language (lib/pos/i18n.ts). */
export type PosErrorCode =
  | 'unauthorized' | 'forbidden' | 'needs_handle' | 'not_enabled' | 'no_session'
  | 'bad_request' | 'bad_customer' | 'bad_line' | 'bad_point' | 'bad_reason'
  | 'not_found' | 'order_void' | 'rate_limited' | 'internal_error' | 'conflict'
  | LineProblemCode
