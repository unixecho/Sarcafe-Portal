import { redirect } from 'next/navigation'
import OwnerHeader from '@/components/OwnerHeader'
import AccessibilityStatementEditor from '@/components/AccessibilityStatementEditor'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { isOp } from '@/lib/staff/access'
import { readSetting } from '@/lib/settings/server'
import { DEFAULT_ACCESSIBILITY_STATEMENT, type AccessibilityStatement } from '@/lib/settings/keys'

export const dynamic = 'force-dynamic'

export default async function OwnerAccessibilityPage() {
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

  const statement = await readSetting<AccessibilityStatement>('accessibility_statement', DEFAULT_ACCESSIBILITY_STATEMENT)

  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 560, margin: '0 auto', padding: '0 16px 32px' }}>
      <OwnerHeader title="הצהרת נגישות" backHref="/owner/dashboard" />
      {/* Entrance cadence copied verbatim from the owner dashboard so the
          owner app feels like one app page to page: header at 0ms (it rises
          inside OwnerHeader), first body block at 60ms, second at 140ms.
          Hand-written rather than a delay() counter because both blocks on
          this page are unconditional — nothing can be skipped, so a counter
          would add indirection and buy nothing. No reduced-motion work is
          needed here: globals.css already REMOVEs .rise wholesale, which is
          also what makes it visible for those users (rise-in fills
          `backwards`, so its pre-animation state is opacity 0). */}
      <p className="rise" style={{ fontSize: '0.82rem', color: 'var(--text-faint)', marginBottom: 16, animationDelay: '60ms' }}>
        שדה ריק פשוט לא יוצג בעמוד הציבורי — אין צורך למלא הכל.
      </p>
      {/* A wrapper div because the editor takes no className, and exactly ONE
          block for the entire form: the eight fields are NOT staggered — an
          operator opening this screen to correct a phone number should not
          watch rows arrive one at a time. The <span role="status"> inside is
          untouched and empty at mount; this animation is over long before any
          save status lands in it, and .rise has no `forwards` fill, so it
          leaves nothing behind on the live region. */}
      <div className="rise" style={{ animationDelay: '140ms' }}>
        <AccessibilityStatementEditor initial={statement} />
      </div>
    </main>
  )
}
