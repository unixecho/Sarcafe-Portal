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
    <main style={{ maxWidth: 560, margin: '0 auto', padding: '0 16px 32px' }}>
      <OwnerHeader title="הצהרת נגישות" backHref="/owner/dashboard" />
      <p style={{ fontSize: '0.82rem', color: 'var(--text-faint)', marginBottom: 16 }}>
        שדה ריק פשוט לא יוצג בעמוד הציבורי — אין צורך למלא הכל.
      </p>
      <AccessibilityStatementEditor initial={statement} />
    </main>
  )
}
