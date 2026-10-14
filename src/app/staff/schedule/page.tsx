import StaffSchedulePageBody from '@/components/shifts/StaffSchedulePageBody'
import { scheduleEntry } from '@/lib/shifts/entry'

export const dynamic = 'force-dynamic'

export default async function StaffSchedulePage({ searchParams }: { searchParams: Promise<{ tab?: string | string[]; week?: string | string[] }> }) {
  return <StaffSchedulePageBody entry={scheduleEntry(await searchParams)} />
}
