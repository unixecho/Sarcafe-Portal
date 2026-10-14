import OwnerChecklistsPageBody from '@/components/checklists/OwnerChecklistsPageBody'

export const dynamic = 'force-dynamic'

// /owner/checklists/<assignment id>: the page an owner's "checklist not submitted" alert opens.
export default async function OwnerChecklistPage({ params }: { params: Promise<{ id: string }> }) {
  return <OwnerChecklistsPageBody focusId={(await params).id} />
}
