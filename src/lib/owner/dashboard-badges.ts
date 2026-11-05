import 'server-only'

import type { createServiceRoleClient } from '@/lib/supabase/server'

type Service = ReturnType<typeof createServiceRoleClient>

/** Requests waiting for a manager at this branch: swaps a colleague already accepted, and shift requests not yet answered.
 *  null when it could not be read (the pill is then simply not shown, never a wrong "0"). */
export async function countPendingDecisions(service: Service, branchId: string): Promise<number | null> {
  const [swaps, requests] = await Promise.all([
    service.from('shift_swaps').select('id', { count: 'exact', head: true }).eq('branch_id', branchId).eq('status', 'peer_accepted'),
    service.from('shift_requests').select('id', { count: 'exact', head: true }).eq('branch_id', branchId).eq('status', 'pending'),
  ])
  if (swaps.error || requests.error) return null
  return (swaps.count ?? 0) + (requests.count ?? 0)
}

export { toolBadges } from '@/lib/tools/badges'
