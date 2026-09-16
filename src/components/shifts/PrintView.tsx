'use client'

import { useShifts } from '@/components/shifts/ShiftsProvider'
import WeekGrid from '@/components/shifts/WeekGrid'
import { formatDateLabel, weekDates } from '@/lib/shifts/time'

// Standalone content for /owner/schedule/print — relies on the browser's
// own print-to-PDF, no PDF library. Renders the SAME WeekGrid the builder
// and staff view use, so paper and screen can never diverge; the only
// addition is a clear draft/published label so a printed draft is never
// mistaken for the live schedule.
export default function PrintView() {
  const { db, loading, weekStart } = useShifts()
  if (loading || !db) return <p style={{ padding: 20 }}>טוען…</p>

  const currentWeek = db.weeks.find((w) => w.weekStart === weekStart)
  const weekShifts = currentWeek ? db.shifts.filter((s) => s.weekId === currentWeek.id) : []
  const weekAssignments = db.assignments.filter((a) => weekShifts.some((s) => s.id === a.shiftId))

  return (
    <div style={{ padding: 20, background: '#fff', color: '#111', minHeight: '100vh' }}>
      <style>{`@media print { .no-print { display: none !important } }`}</style>
      <button type="button" className="no-print press" onClick={() => window.print()} style={{ marginBottom: 16, padding: '8px 16px', borderRadius: 8, border: '1px solid #ccc', background: '#fff', cursor: 'pointer' }}>
        הדפסה
      </button>
      <h1 style={{ fontSize: '1.2rem', margin: '0 0 4px' }} className="ltr-isolate">
        {formatDateLabel(weekStart)} – {formatDateLabel(weekDates(weekStart)[6]!)}
      </h1>
      <p style={{ margin: '0 0 16px', fontSize: '0.85rem', color: currentWeek?.status === 'published' ? '#0a7' : '#a70' }}>
        {currentWeek?.status === 'published' ? 'פורסם' : 'טיוטה — טרם פורסם'}
      </p>
      <div style={{ colorScheme: 'light' }}>
        <WeekGrid weekStart={weekStart} shifts={weekShifts} assignments={weekAssignments} settings={db.settings} dayNotes={currentWeek?.dayNotes} />
      </div>
    </div>
  )
}
