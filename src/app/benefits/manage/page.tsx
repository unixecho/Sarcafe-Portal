import { redirect } from 'next/navigation'
import { CircleAlert } from 'lucide-react'
import BenefitsFrame from '@/components/identity/BenefitsFrame'
import BenefitsManage from '@/components/identity/BenefitsManage'
import { resolveIdentitySession } from '@/lib/identity/server/session'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'ניהול הטבות', robots: { index: false, follow: false }, referrer: 'no-referrer' as const }

// What the signed-in person administers (FABLE-002): an organization, or a department they head. A verified full Google sign-in
// is needed to be here at all (the middleware sends a signed-out visitor to /benefits); it gives nothing by itself. The lists and
// every action come from /api/benefits/manage/*, which read the person's own live grants each time. No staff row is needed, none
// is created, and nothing on this page leads into the staff, owner or POS app.
export default async function BenefitsManagePage() {
  const { session, failed } = await resolveIdentitySession()
  if (!session && !failed) redirect('/benefits')
  const full = !!session && session.via === 'google' && session.full
  return (
    <BenefitsFrame title="ניהול הטבות" signedIn={!!session}>
      {full
        ? <BenefitsManage />
        : (
          <section className="gl-surf gl-surf--bad gl-card" role="alert" data-identity={failed ? 'manage-unavailable' : 'manage-full-session'}>
            <p className="gl-note gl-note--bad"><CircleAlert size={18} aria-hidden="true" />{failed
              ? 'לא הצלחנו לבדוק את ההתחברות כרגע. נסו שוב בעוד רגע.'
              : 'כאן צריך התחברות מלאה עם Google. כניסה עם קוד עובד אינה מספיקה.'}</p>
          </section>
        )}
    </BenefitsFrame>
  )
}
