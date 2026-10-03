// Where a plain staff member lands after signing in with nothing more specific asked
// for: the POS when an event they may work is live right now, otherwise their shift
// schedule (what they saw before the POS existed). Shared by /auth/callback and /staff.
//
// Never an error: a failed read is "no live session" -> the schedule, exactly as before.

import { createServiceRoleClient } from '@/lib/supabase/server'
import { canAccessBranch } from '@/lib/pos/server/guard'
import type { AccessRow } from '@/lib/staff/access'

export async function staffLandingPath(staff: AccessRow | null | undefined): Promise<'/pos' | '/staff/schedule'> {
  try {
    const service = createServiceRoleClient()
    const { data: enabled, error } = await service.from('pos_branch_settings').select('branch_id').eq('enabled', true)
    if (error || !enabled) return '/staff/schedule'
    const mine = (enabled as { branch_id: string }[]).map((r) => r.branch_id).filter((id) => canAccessBranch(staff, id))
    if (mine.length === 0) return '/staff/schedule'
    const { data: live, error: liveErr } = await service.from('pos_sessions').select('id').in('branch_id', mine).eq('status', 'active').limit(1)
    if (liveErr) return '/staff/schedule'
    return live && live.length > 0 ? '/pos' : '/staff/schedule'
  } catch {
    return '/staff/schedule'
  }
}
