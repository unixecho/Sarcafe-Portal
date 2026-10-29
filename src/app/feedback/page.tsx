import type { Metadata } from 'next'
import PublicBackdrop from '@/components/PublicBackdrop'
import PollForm from '@/components/kiosk-feedback/PollForm'
import { getPollOptions } from '@/lib/kiosk/content'
import { KIOSK_BRANCH_SLUG } from '@/lib/kiosk/menu'

export const metadata: Metadata = {
  title: 'Sarcafe | מה תרצו שנגיש?',
  robots: { index: false, follow: false },
}
// The owner's option list is read at request time, so a change on /owner/kiosk shows on the next scan.
export const dynamic = 'force-dynamic'

// The public poll the kiosk's feedback card points at (its QR). Anonymous and free of personal data: nothing here asks
// for a name, phone or e-mail, and the answer travels to /api/kiosk/content/feedback with no identifier but a random
// request id. It is a page of its own; the kiosk only shows the QR.
export default async function FeedbackPollPage() {
  const options = await getPollOptions()
  return (
    <PublicBackdrop branchSlug={KIOSK_BRANCH_SLUG}>
      <main id="main" tabIndex={-1} dir="rtl" lang="he" style={{ maxWidth: 520, margin: '0 auto', padding: '28px 16px 48px', position: 'relative' }}>
        <PollForm options={options} />
      </main>
    </PublicBackdrop>
  )
}
