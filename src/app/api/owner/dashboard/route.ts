import { NextResponse, type NextRequest } from 'next/server'
import { apiRoute, BadRequest, NotFound } from '@/lib/http/errors'
import { requireOwner } from '@/lib/owner/guard'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { readDashboardStats } from '@/lib/owner/dashboard-stats'
import { readDashboardSignals } from '@/lib/owner/signals'

// Polled by DashboardLive every 30s, and re-fetched on tab refocus. Returns
// {stats, signals} for one branch as a single JSON blob — deliberately
// over-fetching rather than diffing, since this is a low-traffic,
// owner-only screen where simplicity beats payload size (same trade-off
// AyekaBar's own dashboard route documents making).
export const GET = apiRoute(async (request: NextRequest) => {
  await requireOwner()

  const branchSlug = request.nextUrl.searchParams.get('branch')
  if (!branchSlug) throw BadRequest('Unknown or missing branch.')

  const service = createServiceRoleClient()
  const { data: branch } = await service.from('branches').select('id').eq('slug', branchSlug).maybeSingle()
  if (!branch) throw NotFound('Branch not found.')

  const [stats, signals] = await Promise.all([
    readDashboardStats(branch.id),
    readDashboardSignals(branch.id),
  ])

  return NextResponse.json({ stats, signals })
})
