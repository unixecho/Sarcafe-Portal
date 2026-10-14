import StaffChecklistsPageBody from '@/components/checklists/StaffChecklistsPageBody'

export const dynamic = 'force-dynamic'

// /staff/checklists/<assignment id>: the page an alert, the home screen's buttons and the notification list open.
export default async function StaffChecklistPage({ params }: { params: Promise<{ id: string }> }) {
  return <StaffChecklistsPageBody openId={(await params).id} />
}
