import { redirect } from 'next/navigation'
import OwnerHeader from '@/components/OwnerHeader'
import WorkshopViewer from '@/components/workshop/WorkshopViewer'
import { resolveStaffIdentity } from '@/lib/staff/session'

export const dynamic = 'force-dynamic'

// The coffee workshop for the cart staff. Any signed-in staff identity may read it (a code sign-in too): it is training,
// not personal data. The slide pictures and the .pptx are plain files under /workshop.
export default async function WorkshopPage() {
  const me = await resolveStaffIdentity()
  if (!me) redirect('/login?next=/staff&quick=1')
  return (
    <main id="main" tabIndex={-1} className="app-page">
      <OwnerHeader title="סדנת קפה" backHref="/staff" />
      <WorkshopViewer />
    </main>
  )
}
