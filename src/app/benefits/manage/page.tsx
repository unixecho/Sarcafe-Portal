import { redirect } from 'next/navigation'
import { CircleAlert } from 'lucide-react'
import BenefitsFrame from '@/components/identity/BenefitsFrame'
import BenefitsManage from '@/components/identity/BenefitsManage'
import BenefitsReauth from '@/components/identity/BenefitsReauth'
import { resolveIdentitySession } from '@/lib/identity/server/session'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'ניהול הטבות', robots: { index: false, follow: false }, referrer: 'no-referrer' as const }

// What the signed-in person administers (FABLE-002): an organization, or a department they head. A session that is a proven Google
// sign-in (src/lib/identity/session-proof.ts) is needed to be here at all (the middleware sends a signed-out visitor to /benefits); it gives nothing by itself. The lists and
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
        : failed
          ? (
            <section className="gl-surf gl-surf--bad gl-card" role="alert" data-identity="manage-unavailable">
              <p className="gl-note gl-note--bad"><CircleAlert size={18} aria-hidden="true" />לא הצלחנו לבדוק את ההתחברות כרגע. נסו שוב בעוד רגע.</p>
            </section>
          )
          // signed in, but THIS session is not a proven Google sign-in (a code, a password, a link): offer a fresh Google sign-in that
          // returns here. Nothing redirects automatically, so there is no loop: the person presses the button or signs out.
          : <BenefitsReauth returnTo="/benefits/manage" reason={session?.via === 'employee_code' ? 'employee_code' : session?.via === 'quick' ? 'quick' : 'other'} />}
    </BenefitsFrame>
  )
}
