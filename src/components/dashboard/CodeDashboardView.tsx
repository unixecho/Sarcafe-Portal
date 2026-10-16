import InstallAppButton from '@/components/app/InstallAppButton'
import ShiftStatusCard from '@/components/staff/ShiftStatusCard'
import { loadShiftStatus } from '@/lib/staff/shift-status'
import { createServiceRoleClient } from '@/lib/supabase/server'
import type { StaffIdentity } from '@/lib/staff/session'

// The dashboard of a SIX-DIGIT-CODE sign-in (owner, 2026-10-17): the QR code on the cart opens /crew, the person types their
// number and code, and lands here to do the shift's checklists, nothing else. So the page is the shift card and one row to put
// the page on the phone's Home Screen (that shortcut matters only here: the app sign-in already lives on the Home Screen).
// The schedule is not available on a code session: the card still points at it, and the tap goes to the sign-in that
// needs the app installed (/login?next=/staff/schedule). No alerts, workshop, tiles or profile.
export const CODE_SCHEDULE_HREF = '/login?next=/staff/schedule'

export default async function CodeDashboardView({ me }: { me: StaffIdentity }) {
  const shiftStatus = await loadShiftStatus(createServiceRoleClient(), me.id)
  const name = me.first_name || me.display_name || 'צוות Sarcafe'
  const date = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())
  return (
    <>
      <div className="app-welcome"><div><h2>שלום, {name}</h2><p>{date}</p></div></div>
      <ShiftStatusCard status={shiftStatus} scheduleHref={CODE_SCHEDULE_HREF} developer={false} codeMode />
      <div className="app-group app-account"><InstallAppButton /></div>
    </>
  )
}
