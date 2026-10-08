import { redirect } from 'next/navigation'
import OwnerHeader from '@/components/OwnerHeader'
import IntroCard from '@/components/IntroCard'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { isOp } from '@/lib/staff/access'
import { getIntroEnabled } from '@/lib/settings/server'
import { planTimeline } from '@/lib/intro/config'
import { INTRO_LINES, splitLine } from '@/lib/intro/copy'

export const dynamic = 'force-dynamic'

// The portal's opening screen: on/off, and a way to watch both versions and every
// line. Its own page rather than a card on the dashboard, for the reason
// /owner/links and /owner/accessibility give: a setting changed roughly never
// should not occupy the screen the owner opens mid-service.
//
// Middleware gates this via OP_ONLY_PREFIXES; the check below is the same
// defense-in-depth re-check every other /owner/* page does.

export default async function OwnerIntroPage() {
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

  const enabled = await getIntroEnabled()

  // How long each version runs, from the real timeline (the longest line, in
  // Hebrew, the site's default) — so this page's words follow the numbers instead
  // of repeating them.
  const seconds = (variant: 'first' | 'repeat') =>
    Math.round(
      Math.max(...INTRO_LINES.map((l) => planTimeline(splitLine(l.he.line1).length, splitLine(l.he.line2).length, variant).doneAtMs)) / 1000
    )

  // The Hebrew of every line, without the highlight markers, in the order a
  // device meets them (the first is the one a new device always sees).
  const lines = INTRO_LINES.map((l) => ({ line1: l.he.line1.replace(/\*/g, ''), line2: l.he.line2 }))

  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 560, margin: '0 auto', padding: '0 16px 32px' }}>
      <OwnerHeader title="מסך פתיחה" backHref="/owner/dashboard" />
      <div className="rise" style={{ animationDelay: '60ms' }}>
        <IntroCard initial={enabled} firstSeconds={seconds('first')} repeatSeconds={seconds('repeat')} lines={lines} />
      </div>
    </main>
  )
}
