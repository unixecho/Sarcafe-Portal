import BenefitsFrame from '@/components/identity/BenefitsFrame'
import RegistrationFlow from '@/components/identity/RegistrationFlow'
import { resolveIdentitySession } from '@/lib/identity/server/session'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'הרשמה להטבה', robots: { index: false, follow: false }, referrer: 'no-referrer' as const }

// An organization's employee registers here with the link their department head gave them (FABLE-003). An open page on purpose (the
// employee is usually not signed in yet): the server renders nothing about any link (its token is in the URL fragment, which never
// reaches a server). The client trades the token for an HttpOnly cookie; the link is opened only after a proven Google sign-in.
// Private like the rest of /benefits for now (no customer widget, decision D5 in docs/SARCAFE_IDENTITY.md); component accessibility
// (keyboard, contrast in five looks, RTL, reduced motion) is tested.
export default async function BenefitsRegisterPage() {
  const { session } = await resolveIdentitySession()
  return (
    <BenefitsFrame title="הרשמה להטבה" signedIn={!!session}>
      <RegistrationFlow />
    </BenefitsFrame>
  )
}
