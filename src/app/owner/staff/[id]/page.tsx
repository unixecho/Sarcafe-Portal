import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'
import OwnerHeader from '@/components/OwnerHeader'
import StaffRecordsView from '@/components/staff/StaffRecordsView'
import { requireOwner } from '@/lib/owner/guard'
import { loadStaffRecords } from '@/lib/staff/records'

export const dynamic = 'force-dynamic'
export default async function EmployeeRecordPage({ params }: { params: Promise<{ id: string }> }) {
  try { await requireOwner() } catch { redirect('/login?next=/owner/staff') }
  const parsed = z.string().uuid().safeParse((await params).id)
  if (!parsed.success) notFound()
  const initial = await loadStaffRecords(parsed.data, true)
  return <main id="main" tabIndex={-1} style={{ maxWidth: 920, margin: '0 auto', padding: '0 16px 32px' }}><OwnerHeader title="תיק עובד" backHref="/owner/staff"/><StaffRecordsView initial={initial} owner/></main>
}
