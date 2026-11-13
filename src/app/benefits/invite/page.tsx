import BenefitsFrame from '@/components/identity/BenefitsFrame'
import InvitationAccept from '@/components/identity/InvitationAccept'
import { resolveIdentitySession } from '@/lib/identity/server/session'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'הזמנה', robots: { index: false, follow: false }, referrer: 'no-referrer' as const }

// Accepting a department-head invitation (FABLE-002). An open page on purpose: the recipient is usually not signed in yet. The
// server renders nothing about any invitation here (the token is in the URL fragment, which never reaches a server); the client
// component trades the token for an HttpOnly cookie, and the invitation is shown only after a verified Google sign-in, only to
// its intended recipient.
export default async function BenefitsInvitePage() {
  const { session } = await resolveIdentitySession()
  return (
    <BenefitsFrame title="הזמנה" signedIn={!!session}>
      <InvitationAccept />
    </BenefitsFrame>
  )
}
