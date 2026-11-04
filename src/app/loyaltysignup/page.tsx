import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { loyaltySecret } from '@/lib/loyalty/signup-env'
import { pickLanguage } from '@/lib/loyalty/signup-shared'
import { makeFormToken } from '@/lib/loyalty/signup-server'
import LoyaltySignupForm from './LoyaltySignupForm'

export const metadata: Metadata = {
  title: 'Sarcafe | הצטרפות למועדון הלקוחות',
  description: 'Sarcafe',
  // A link we hand out, not a page to be found: kept out of search results.
  robots: { index: false, follow: false },
}
// The form token is stamped when the page is built for the visitor, and the language follows the visitor's browser: never cached.
export const dynamic = 'force-dynamic'

// The public sign-up to the (future) loyalty club, in Hebrew, English and Arabic: docs/SARCAFE_LOYALTY_SIGNUP_PAGE.md.
// Standalone by design: no account, no cookies, no analytics, no third-party scripts. What it sends goes to /api/loyaltysignup only.
export default async function LoyaltySignupPage({ searchParams }: { searchParams: Promise<{ lang?: string | string[] }> }) {
  const params = await searchParams
  const requested = Array.isArray(params.lang) ? params.lang[0] : params.lang
  const lang = pickLanguage(requested, (await headers()).get('accept-language'))
  // No secret on the host means the endpoint refuses too; the page then shows the form but every send answers "try again".
  const token = makeFormToken(loyaltySecret() || 'unset')
  return <LoyaltySignupForm initialLang={lang} token={token} />
}
