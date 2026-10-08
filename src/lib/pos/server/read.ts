import 'server-only'
import { createServiceRoleClient } from '@/lib/supabase/server'
import type { PosReadQuery } from '@/lib/pos/api'
import { CHECKIN_COLUMNS, EVENT_COLUMNS, ITEM_COLUMNS, ORDER_COLUMNS, ORDER_EMBED } from '@/lib/pos/columns'
import { loadOrderInBranch, posError, type PosActor } from './guard'

const ORDER_WITH_ITEMS = `${ORDER_COLUMNS}, pos_order_items(${ITEM_COLUMNS})`

/** Every service-role read is scoped to an independently authorized branch and resource. */
export async function readPosData(query: PosReadQuery, actor: PosActor): Promise<unknown> {
  if (query.branch !== actor.branch.id) throw posError('forbidden')
  const service = createServiceRoleClient()
  const branchId = actor.branch.id
  if ('session' in query && query.session) {
    const { data, error } = await service.from('pos_sessions').select('id').eq('id', query.session).eq('branch_id', branchId).maybeSingle()
    if (error) throw posError('internal_error')
    if (!data) throw posError('not_found')
  }
  if ('point' in query) {
    const { data, error } = await service.from('pos_points').select('id').eq('id', query.point).eq('branch_id', branchId).maybeSingle()
    if (error) throw posError('internal_error')
    if (!data) throw posError('not_found')
  }

  let result: { data: unknown; error: { code?: string } | null }
  switch (query.kind) {
    case 'live': {
      const since = new Date(Date.now() - 60 * 60_000).toISOString()
      result = await service.from('pos_orders').select(ORDER_WITH_ITEMS).eq('branch_id', branchId).eq('session_id', query.session)
        .or(`status.eq.open,and(status.eq.completed,completed_at.gte.${since}),and(status.eq.void,voided_at.gte.${since})`)
        .order('created_at', { ascending: true }).order('ticket_no', { ascending: true }).order('seq', { ascending: true, referencedTable: 'pos_order_items' }).limit(500)
      break
    }
    case 'orders': {
      let orders = service.from('pos_orders').select(ORDER_WITH_ITEMS).eq('branch_id', branchId).eq('session_id', query.session).order('ticket_no', { ascending: false }).limit(40)
      if (query.before !== undefined) orders = orders.lt('ticket_no', query.before)
      result = await orders
      break
    }
    case 'order':
      result = await service.from('pos_orders').select(ORDER_WITH_ITEMS).eq('branch_id', branchId).eq('id', query.order).maybeSingle()
      break
    case 'order_events': {
      const order = await loadOrderInBranch<{ session_id: string }>(query.order, branchId, 'session_id')
      result = await service.from('pos_events').select(EVENT_COLUMNS).eq('branch_id', branchId).eq('session_id', order.session_id).eq('order_id', query.order)
        .order('at', { ascending: query.direction === 'asc' }).limit(query.direction === 'asc' ? 200 : 120)
      break
    }
    case 'point_history':
      result = await service.from('pos_order_items').select(`${ITEM_COLUMNS}, ${ORDER_EMBED}`).eq('branch_id', branchId).eq('point_id', query.point)
        .eq('status', 'delivered').eq('pos_orders.session_id', query.session).eq('pos_orders.branch_id', branchId).order('delivered_at', { ascending: false }).range(0, query.limit - 1)
      break
    case 'checkin': {
      if (!query.session) return []
      result = await service.from('pos_point_checkins').select(CHECKIN_COLUMNS).eq('branch_id', branchId).eq('session_id', query.session).eq('point_id', query.point)
        .eq('staff_id', actor.staff.id).order('at', { ascending: false }).limit(1)
      break
    }
  }
  if (result.error) {
    console.error('pos scoped read failed:', query.kind, result.error.code)
    throw posError('internal_error')
  }
  return result.data
}