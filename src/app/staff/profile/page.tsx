import { redirect } from 'next/navigation'
import OwnerHeader from '@/components/OwnerHeader'
import StaffRecordsView from '@/components/staff/StaffRecordsView'
import { resolveStaffIdentity } from '@/lib/staff/session'
import { loadStaffRecords } from '@/lib/staff/records'
import StaffAccountActions from '@/components/staff/StaffAccountActions'
import '@/components/shifts/schedule.css'

export const dynamic = 'force-dynamic'
export default async function StaffProfilePage({ searchParams }: { searchParams: Promise<{ setup?: string; linked?: string; error?: string }> }) {
  const me = await resolveStaffIdentity()
  if (!me) redirect('/login?next=/staff&quick=1')
  const params = await searchParams
  const initial = await loadStaffRecords(me.id, me.via === 'google' && !me.quick)
  return <main id="main" tabIndex={-1} style={{ maxWidth: 800, margin: '0 auto', padding: '0 16px 32px' }}><OwnerHeader title="החשבון שלי" backHref="/staff"/><StaffRecordsView initial={initial}><StaffAccountActions linked={!!me.auth_user_id} quick={me.quick} focusGoogle={params.setup === 'google'} linkFailed={Boolean(params.error)} linkedNow={params.linked === '1'}/></StaffRecordsView></main>
}
