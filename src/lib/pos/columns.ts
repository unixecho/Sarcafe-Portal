// ONE shared column list per table. Ayeka lost a round to this: the TS type said
// `selected_options` existed, the SELECT string forgot to ask for it, and a
// station screen crashed on `undefined.length`. A type and a SELECT drift
// independently — so every read of a POS table imports its list from here, and
// check-pos.mjs asserts each list covers every field of its row type.

export const SESSION_COLUMNS = 'id, branch_id, kind, status, started_at, started_by, ended_at, ended_by'

export const POINT_COLUMNS =
  'id, branch_id, name, icon, colour, hands_over, prep_minutes, excluded_uids, sort_order, active'

export const ROUTE_COLUMNS = 'id, branch_id, point_id, kind, ref'

export const POINT_STAFF_COLUMNS = 'point_id, staff_id'

export const ORDER_COLUMNS =
  'id, branch_id, session_id, ticket_no, client_key, customer_name, customer_phone, receipt_ref, slip_total_agorot, ' +
  'slip_mismatch, note, status, total_agorot, created_by, created_by_handle, created_at, completed_at, voided_at, ' +
  'voided_by, void_reason'

export const ITEM_COLUMNS =
  'id, order_id, branch_id, seq, batch_no, point_id, point_name, item_uid, category_id, category_title, name, ' +
  'type_uid, type_label, variant_label, unit_agorot, base_agorot, modifiers, qty, for_name, note, is_custom, status, ' +
  'created_by, created_at, sent_at, claimed_by, claimed_at, ready_at, picked_up_by, picked_up_at, delivered_by, ' +
  'delivered_at, voided_by, voided_at, voided_from, void_reason'

export const EVENT_COLUMNS = 'id, branch_id, session_id, order_id, item_id, point_id, event, actor_id, actor_handle, payload, at'

export const CHECKIN_COLUMNS = 'id, branch_id, session_id, point_id, staff_id, event, at'

export const DIRECTORY_COLUMNS = 'id, handle, colour'

/** The parent order, as embedded into a station / orders read of its lines. The
 *  phone is included on purpose: staff may tap-to-call about an uncollected order. */
export const ORDER_EMBED = `pos_orders!inner(${ORDER_COLUMNS})`

/** Tables the realtime channel watches (all in the supabase_realtime publication, replica identity full). */
export const REALTIME_TABLES = [
  'pos_orders', 'pos_order_items', 'pos_events', 'pos_points', 'pos_sessions', 'pos_point_checkins',
] as const
export type RealtimeTable = (typeof REALTIME_TABLES)[number]
