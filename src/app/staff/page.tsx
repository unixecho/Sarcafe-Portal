import { redirect } from 'next/navigation'
import Link from 'next/link'
import { CalendarClock, ChevronLeft, ClipboardCheck, MapPin, Receipt, ShoppingBag, UserRound } from 'lucide-react'
import OwnerHeader from '@/components/OwnerHeader'
import InstallAppButton from '@/components/app/InstallAppButton'
import DashboardSections, { type DashboardCategory } from '@/components/app/DashboardSections'
import DashboardNotifications, { type DashboardNotification } from '@/components/app/DashboardNotifications'
import { resolveStaffIdentity } from '@/lib/staff/session'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { hasAnyMenuEditAccess, isOp } from '@/lib/staff/access'

export const dynamic = 'force-dynamic'

export default async function StaffIndexPage() {
  const me = await resolveStaffIdentity()
  if (!me) redirect('/login?next=/staff&quick=1')
  const fullLogin = me.via === 'google' && !me.quick
  if (fullLogin && isOp(me)) redirect('/owner/dashboard')

  const scheduleHref = fullLogin ? '/staff/schedule' : '/login?next=/staff/schedule'
  const service = createServiceRoleClient()
  const [updates, count, assignmentRows] = await Promise.all([
    service.from('schedule_notifications').select('id, title, body, created_at, read_at').eq('staff_id', me.id).order('created_at', { ascending: false }).limit(20),
    service.from('schedule_notifications').select('id', { count: 'exact', head: true }).eq('staff_id', me.id).is('read_at', null),
    service.from('shift_assignments').select('shift_id').eq('staff_id', me.id),
  ])
  const assignedIds = (assignmentRows.data ?? []).map((row) => row.shift_id as string)
  const now = new Date()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const currentTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
  const { data: assignedShifts } = assignedIds.length
    ? await service.from('shifts').select('id, week_id, branch_id, shift_date, start_time, end_time, station_id').in('id', assignedIds).gte('shift_date', today).order('shift_date').order('start_time')
    : { data: [] }
  const weekIds = [...new Set((assignedShifts ?? []).map((shift) => shift.week_id as string))]
  const { data: publishedWeeks } = weekIds.length
    ? await service.from('schedule_weeks').select('id').in('id', weekIds).eq('status', 'published')
    : { data: [] }
  const publishedIds = new Set((publishedWeeks ?? []).map((week) => week.id as string))
  const nextShift = (assignedShifts ?? []).find((shift) => publishedIds.has(shift.week_id as string) && (shift.shift_date > today || shift.start_time > currentTime)) ?? null
  const { data: shiftSettings } = nextShift
    ? await service.from('shift_settings').select('stations').eq('branch_id', nextShift.branch_id).maybeSingle()
    : { data: null }
  const stations = Array.isArray(shiftSettings?.stations) ? shiftSettings.stations as { id: string; name: string }[] : []
  const station = nextShift?.station_id ? stations.find((item) => item.id === nextShift.station_id) : null
  const categories: DashboardCategory[] = [
    { title: 'המשמרת שלי', entries: [
      { href: '/staff/checklists', icon: ClipboardCheck, label: 'צ׳קליסטים למשמרת', description: 'פתיחה, החלפה וסגירה — הכל במקום אחד' },
      { href: scheduleHref, icon: CalendarClock, label: 'משמרות ובקשות', description: fullLogin ? 'הסידור שפורסם, העדפות והחלפת משמרת' : 'כניסה עם Google לצפייה בסידור ולהגשת בקשות' },
    ] },
    { title: 'במהלך השירות', entries: [
      ...(fullLogin ? [{ href: '/staff/pos', icon: ShoppingBag, label: 'הזמנות מהירות', description: 'קבלת הזמנות ומעקב בזמן אמת' }] : []),
      { href: '/pos', icon: Receipt, label: 'קופת אירועים ועמדות', description: 'הזמנות האירוע והעמדה שבה עובדים' },
    ] },
  ]
  if (fullLogin && hasAnyMenuEditAccess(me)) categories.push({ title: 'ניהול במשמרת', entries: [
    { href: '/owner/schedule', icon: CalendarClock, label: 'ניהול סידור העבודה', description: 'שיבוצים, בקשות ואישור החלפות בסניף שלך' },
    { href: '/owner/editor', icon: ShoppingBag, label: 'ניהול התפריט', description: 'עריכת התפריט והזמינות בסניף שלך' },
    { href: '/owner/pos', icon: Receipt, label: 'ניהול קופת אירועים', description: 'כלי ניהול לאירועים שבאחריותך' },
  ] })
  const name = me.first_name || me.display_name || 'צוות Sarcafe'
  const date = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())

  return (
    <main id="main" tabIndex={-1} className="app-page">
      <OwnerHeader title="Sarcafe צוות" homeHref="/staff" />
      <div className="app-welcome"><div><h2>שלום, {name}</h2><p>{fullLogin ? 'המשמרות, המשימות והצוות שלך.' : 'צ׳קליסטים וקופת אירועים, מוכנים למשמרת שלך.'}</p></div><span className="app-date">{date}</span></div>
      <Link href={scheduleHref} className="app-shift-focus press">
        <span className="app-shift-focus__icon"><CalendarClock size={24} aria-hidden="true" /></span>
        <span className="app-shift-focus__copy">
          <small>המשמרת הבאה שלך</small>
          {nextShift ? (
            <><strong><span dir="ltr">{nextShift.shift_date} · {nextShift.start_time}–{nextShift.end_time}</span></strong><span className="app-shift-focus__zone"><MapPin size={15} aria-hidden="true" />{station?.name || 'העמדה טרם נקבעה'}</span></>
          ) : (
            <><strong>{fullLogin ? 'אין משמרת קרובה בלוח שפורסם' : 'כניסה מלאה מציגה את הסידור שלך'}</strong><span>פתיחת לוח המשמרות והבקשות</span></>
          )}
        </span>
        <ChevronLeft size={19} aria-hidden="true" className="app-row__chevron" />
      </Link>
      <DashboardNotifications initialNotifications={(updates.data ?? []) as DashboardNotification[]} initialUnread={count.count ?? 0} initialError={!!updates.error || !!count.error} scheduleHref={scheduleHref} />
      <DashboardSections categories={categories} staff />
      <div className="app-group app-account"><Link href="/staff/profile" className="app-row app-row--quiet"><span className="app-row__icon"><UserRound size={22} aria-hidden="true" /></span><span className="app-row__copy"><strong>הפרופיל שלי</strong><small>פרטי חשבון, קוד כניסה והיסטוריה אישית</small></span><ChevronLeft size={18} className="app-row__chevron" aria-hidden="true" /></Link><InstallAppButton /></div>
    </main>
  )
}
