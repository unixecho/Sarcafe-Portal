import StaffSchedulePageBody from '@/components/shifts/StaffSchedulePageBody'
import { scheduleEntry } from '@/lib/shifts/entry'

export const dynamic = 'force-dynamic'

// The link a shared schedule carries: /staff/schedule/<branch slug>.
export default async function StaffBranchSchedulePage({ params, searchParams }: { params: Promise<{ branch: string }>; searchParams: Promise<{ tab?: string | string[]; week?: string | string[] }> }) {
  const { branch } = await params
  return <StaffSchedulePageBody branchSlug={branch} entry={scheduleEntry(await searchParams)} />
}
