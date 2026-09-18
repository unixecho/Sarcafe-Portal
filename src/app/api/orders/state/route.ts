import { NextResponse, type NextRequest } from 'next/server'
import { apiRoute, BadRequest, NotFound } from '@/lib/http/errors'
import { requireOrderStaff } from '@/lib/orders/guard'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { loadOrdersBoard } from '@/lib/orders/state-query'

// The single read endpoint for the POS/order board — mirrors
// /api/shifts/state's shape (one GET, branch-scoped).
export const GET = apiRoute(async (request: NextRequest) => {
  const branchSlug = request.nextUrl.searchParams.get('branch')
  if (!branchSlug) throw BadRequest('Unknown or missing branch.')

  const service = createServiceRoleClient()
  const { data: branch } = await service.from('branches').select('id').eq('slug', branchSlug).maybeSingle()
  if (!branch) throw NotFound('Branch not found.')

  const staff = await requireOrderStaff(branch.id)
  const board = await loadOrdersBoard(branch.id, staff)
  return NextResponse.json({ board })
})
