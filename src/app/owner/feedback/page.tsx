import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import OwnerHeader from '@/components/OwnerHeader'
import FeedbackInbox from '@/components/FeedbackInbox'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { isOp } from '@/lib/staff/access'
import { getBranches } from '@/lib/branches/server'
import { BRANCH_COOKIE } from '@/lib/branches/current'

export const dynamic = 'force-dynamic'

// OP only — unlike the menu/audit/links/reviews routes, this is unsolicited
// free text from the public, sometimes with a contact address attached, and
// being trusted with the menu has never implied being handed customer
// correspondence (same reasoning AyekaBar's own feedback route documents).
export default async function OwnerFeedbackPage() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const service = createServiceRoleClient()
  const { data: me } = await service
    .from('staff')
    .select('role, badge')
    .eq('auth_user_id', user.id)
    .eq('active', true)
    .maybeSingle()
  if (!isOp(me)) redirect('/no-access')

  const branches = await getBranches()
  // Same "all branches" default as /owner/staff — feedback is legitimately
  // cross-branch, so an unset cookie means "show everything," not "pick
  // the first branch." A branch the owner DID pick elsewhere still filters
  // the inbox to it by default.
  const cookieStore = await cookies()
  const cookieSlug = cookieStore.get(BRANCH_COOKIE)?.value
  const initialBranch = cookieSlug && branches.some((b) => b.slug === cookieSlug) ? cookieSlug : ''

  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 640, margin: '0 auto', padding: '0 16px 32px' }}>
      <OwnerHeader title="משוב מלקוחות" backHref="/owner/dashboard" />
      <FeedbackInbox branches={branches} initialBranch={initialBranch} />
    </main>
  )
}
