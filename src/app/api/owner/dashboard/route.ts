import { NextResponse, type NextRequest } from 'next/server'
import { apiRoute, BadRequest, NotFound } from '@/lib/http/errors'
import { requireOwner } from '@/lib/owner/guard'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { readDashboardStats } from '@/lib/owner/dashboard-stats'
import { readDashboardSignals } from '@/lib/owner/signals'
import { countPendingDecisions } from '@/lib/owner/dashboard-badges'
import { loadShortageReport } from '@/lib/checklists/issues-server'
import { shortageCount } from '@/lib/checklists/gaps'
import { SLUG_PATTERN } from '@/lib/branches'

// Polled by DashboardLive every 30s, and re-fetched on tab refocus and on a branch switch. Returns {stats, signals, shortages,
// requests} for one branch as a single JSON blob — deliberately over-fetching rather than diffing, since this is a low-traffic,
// owner-only screen where simplicity beats payload size (same trade-off AyekaBar's own dashboard route documents making).
// shortages / requests are null when they could not be read: the screen then says "not available", never a wrong 0.
export const GET = apiRoute(async (request: NextRequest) => {
  await requireOwner()

  const branchSlug = request.nextUrl.searchParams.get('branch')
  if (!branchSlug || !SLUG_PATTERN.test(branchSlug)) throw BadRequest('Unknown or missing branch.')

  const service = createServiceRoleClient()
  const { data: branch } = await service.from('branches').select('id').eq('slug', branchSlug).maybeSingle()
  if (!branch) throw NotFound('Branch not found.')

  const [stats, signals, shortages, requests] = await Promise.all([
    readDashboardStats(branch.id),
    readDashboardSignals(branch.id),
    loadShortageReport(service, branch.id).then((report) => shortageCount(report)).catch(() => null),
    countPendingDecisions(service, branch.id).catch(() => null),
  ])

  return NextResponse.json({ stats, signals, shortages, requests }, { headers: { 'Cache-Control': 'private, no-store' } })
})
