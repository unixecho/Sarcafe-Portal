import { redirect } from 'next/navigation'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { staffLandingPath } from '@/lib/pos/server/landing'

export const dynamic = 'force-dynamic'

// The POS when an event this person may work is live right now, otherwise their
// shift schedule — grows into a tile grid the same way /owner/dashboard did if/when
// more staff-facing (non-owner) features land. Middleware has already required an
// active staff row; a failed read here just means the schedule, as before.
export default async function StaffIndexPage() {
  let target: '/pos' | '/staff/schedule' = '/staff/schedule'
  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) {
      const { data: row } = await createServiceRoleClient()
        .from('staff')
        .select('role, badge, branch_id')
        .eq('auth_user_id', user.id)
        .eq('active', true)
        .maybeSingle()
      if (row) target = await staffLandingPath(row)
    }
  } catch {
    target = '/staff/schedule'
  }
  redirect(target)
}
