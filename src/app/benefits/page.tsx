import { redirect } from 'next/navigation'
import { LogIn } from 'lucide-react'
import BenefitsFrame from '@/components/identity/BenefitsFrame'
import BenefitsSignIn from '@/components/identity/BenefitsSignIn'
import { resolveIdentitySession } from '@/lib/identity/server/session'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'ניהול הטבות', robots: { index: false, follow: false }, referrer: 'no-referrer' as const }

// The sign-in door of the benefits pages (FABLE-002): for an organization's administrator or a department head, who are NOT
// Sarcafe staff. It is not the staff /login and never leads there. Someone already signed in fully goes on to /benefits/manage,
// where their grants (and nothing else) decide what they see.
export default async function BenefitsDoorPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { session } = await resolveIdentitySession()
  if (session && session.via === 'google' && session.full) redirect('/benefits/manage')
  const { error } = await searchParams
  return (
    <BenefitsFrame title="ניהול הטבות" signedIn={false}>
      <section className="gl-surf gl-card" data-identity="benefits-door">
        <h1 className="gl-card__title"><LogIn size={18} aria-hidden="true" />כניסה למנהלי ארגון ולראשי מחלקות</h1>
        <p className="gl-note">העמוד הזה מיועד למי שמנהל ארגון או מחלקה שעובדיה מקבלים הטבה בסרקפה. מתחברים עם חשבון Google; ההתחברות לבדה אינה נותנת שום הרשאה.</p>
        <BenefitsSignIn returnTo="/benefits/manage" failed={error === 'auth'} />
      </section>
    </BenefitsFrame>
  )
}
