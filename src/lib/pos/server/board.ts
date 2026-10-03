// The Ready board's data — the one POS read a total stranger can make.
//
// The only credential is the branch's `board_token`: an unguessable string in
// pos_branch_settings (a table no browser role can read at all), rotatable by a
// manager, so a leaked link dies the moment it is rotated. This file therefore does
// three things carefully:
//
//   1. It refuses anything that cannot be a token BEFORE touching the database, so a
//      scan of garbage costs nothing.
//   2. It compares the stored token to the supplied one in constant time. The lookup
//      is by equality on the unique index (so the database does the narrowing), and
//      timingSafeEqual then confirms the match without an early exit on the first
//      differing character.
//   3. It returns the LEAST that works: a first name, a ticket number, a point's name
//      and colour, and a count. Never a phone, never a surname, never an item. The
//      phone column is not even in the select list — a leak that cannot happen
//      because the data is never fetched cannot be introduced by a later edit to the
//      response either.
//
// Service-role reads: the token comparison IS the guard.

import { timingSafeEqual } from 'node:crypto'
import { createServiceRoleClient } from '@/lib/supabase/server'
import type { BoardResponse } from '@/lib/pos/api'
import { boardEntries, preparingCount } from '@/lib/pos/board'
import { LIVE_ITEM_STATUSES } from '@/lib/pos/vocab'
import type { PosItem, PosOrder, PosPoint } from '@/lib/pos/types'
import type { Localized } from '@/lib/menu/types'

// The schema only requires >= 24 characters (020's CHECK); the alphabet is whatever
// the rotate route mints. So this is a cheap sanity screen — printable ASCII, a
// plausible length — not a format claim: it exists to turn obvious garbage away
// before a database round trip, and the equality lookup below is the real test.
const TOKEN_SHAPE = /^[!-~]{24,200}$/

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  if (x.length !== y.length) return false
  return timingSafeEqual(x, y)
}

type LiveRow = Pick<PosItem, 'order_id' | 'point_id' | 'status' | 'ready_at'> & {
  // the parent order, narrowed to the two columns the board may use
  pos_orders: Pick<PosOrder, 'ticket_no' | 'customer_name'> | Pick<PosOrder, 'ticket_no' | 'customer_name'>[] | null
}

/** null for an unknown token — the route answers every miss with one identical body. */
export async function loadBoard(token: string): Promise<BoardResponse | null> {
  if (typeof token !== 'string' || !TOKEN_SHAPE.test(token)) return null

  const service = createServiceRoleClient()
  const { data: settings, error: settingsError } = await service
    .from('pos_branch_settings')
    .select('branch_id, board_token')
    .eq('board_token', token)
    .maybeSingle()
  if (settingsError) {
    // Distinguish "the lookup failed" from "no such token": a database blip must not
    // be reported as 404 (a TV would show "not found" rather than "reconnecting").
    throw new Error(`board settings read failed: ${settingsError.code ?? 'unknown'}`)
  }
  const row = settings as { branch_id: string; board_token: string | null } | null
  if (!row || !row.board_token || !safeEqual(row.board_token, token)) return null

  const [branchRes, pointsRes, sessionRes] = await Promise.all([
    service.from('branches').select('name').eq('id', row.branch_id).maybeSingle(),
    // ALL of the branch's points (active or not): a line keeps its point after the point
    // is retired, and dropping it from the lookup would silently drop the customer from
    // the board. Only the active ones are LISTED, below.
    service.from('pos_points').select('id, name, colour, active, sort_order').eq('branch_id', row.branch_id),
    service.from('pos_sessions').select('id').eq('branch_id', row.branch_id).eq('status', 'active').maybeSingle(),
  ])
  if (branchRes.error || pointsRes.error || sessionRes.error) {
    throw new Error('board read failed')
  }

  const points = ((pointsRes.data ?? []) as unknown as (Pick<PosPoint, 'id' | 'name' | 'colour' | 'active' | 'sort_order'>)[])
  const branchName = ((branchRes.data as { name?: Localized } | null)?.name ?? { he: '' }) as Localized
  const sessionId = (sessionRes.data as { id: string } | null)?.id ?? null

  const listed = points
    .filter((p) => p.active)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    .map((p) => ({ id: p.id, name: p.name, colour: p.colour }))

  const empty: BoardResponse = { branchName, points: listed, ready: [], preparing: 0, serverTime: new Date().toISOString() }
  if (!sessionId) return empty

  // Live lines of the ACTIVE session only — an old session's leftovers must never put a
  // ghost name on the screen. The order embed names exactly two columns: no phone.
  const { data: liveData, error: liveError } = await service
    .from('pos_order_items')
    .select('order_id, point_id, status, ready_at, pos_orders!inner(ticket_no, customer_name)')
    .eq('pos_orders.session_id', sessionId)
    .in('status', LIVE_ITEM_STATUSES as unknown as string[])
    .range(0, 1999)
  if (liveError) throw new Error('board lines read failed')

  const live = (liveData ?? []) as unknown as LiveRow[]
  const orders = new Map<string, Pick<PosOrder, 'ticket_no' | 'customer_name'>>()
  for (const l of live) {
    const parent = Array.isArray(l.pos_orders) ? l.pos_orders[0] : l.pos_orders
    if (parent) orders.set(l.order_id, parent)
  }
  const pointLookup = new Map(points.map((p) => [p.id, { name: p.name, colour: p.colour }] as const))

  return {
    branchName,
    points: listed,
    ready: boardEntries(live, orders, pointLookup),
    preparing: preparingCount(live),
    serverTime: new Date().toISOString(),
  }
}
