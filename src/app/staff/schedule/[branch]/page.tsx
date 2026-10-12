import StaffSchedulePageBody from '@/components/shifts/StaffSchedulePageBody'

export const dynamic = 'force-dynamic'

// The link a shared schedule carries: /staff/schedule/<branch slug>.
export default async function StaffBranchSchedulePage({ params }: { params: Promise<{ branch: string }> }) {
  const { branch } = await params
  return <StaffSchedulePageBody branchSlug={branch} />
}
