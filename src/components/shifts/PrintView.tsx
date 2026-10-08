'use client'

import { useShifts } from '@/components/shifts/ShiftsProvider'
import { formatDateLabel, weekDates, weekdayLongLabel } from '@/lib/shifts/time'
import { indexByShift, nameOf } from '@/lib/shifts/view'
import Link from 'next/link'

// Standalone content for /owner/schedule/print — relies on the browser's own
// print-to-PDF, no PDF library. Explicit black-on-white (the app's dark theme
// tokens would print as dark blocks), one column per day, every shift with its
// people and role, and a clear draft/published label so a printed draft is never
// mistaken for the live schedule.
export default function PrintView() {
  const { db, loading, weekStart } = useShifts()
  const navigation = <nav className="no-print" aria-label="ניווט" style={{ display: 'flex', gap: 16, paddingBlock: 12 }}><Link href="/owner/schedule" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>חזרה ללוח</Link><Link href="/staff" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>בית</Link></nav>
  if (loading || !db) return <div style={{ padding: 20 }}>{navigation}<p>טוען…</p></div>

  const currentWeek = db.weeks.find((w) => w.weekStart === weekStart)
  const weekShifts = currentWeek ? db.shifts.filter((s) => s.weekId === currentWeek.id) : []
  const ids = new Set(weekShifts.map((s) => s.id))
  const byShift = indexByShift(db.assignments.filter((a) => ids.has(a.shiftId)))
  const roleById = new Map(db.settings.roles.map((r) => [r.id, r]))
  const dates = weekDates(weekStart)

  return (
    <div style={{ padding: 20, background: '#fff', color: '#111', minHeight: '100vh', colorScheme: 'light' }}>
      {navigation}
      <style>{`
        @media print { .no-print { display: none !important } @page { size: A4 landscape; margin: 12mm } }
        .pv-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
        .pv-day { border: 1px solid #bbb; border-radius: 6px; padding: 6px; min-height: 120px; break-inside: avoid; }
        .pv-day h3 { margin: 0 0 4px; font-size: 0.85rem; }
        .pv-shift { border-top: 1px solid #ddd; padding: 4px 0; font-size: 0.78rem; }
        .pv-time { font-weight: 800; direction: ltr; unicode-bidi: isolate; }
        @media (max-width: 800px) { .pv-grid { grid-template-columns: 1fr } }
      `}</style>
      <button type="button" className="no-print press" onClick={() => window.print()} style={{ marginBottom: 16, padding: '10px 18px', borderRadius: 8, border: '1px solid #999', background: '#fff', cursor: 'pointer', fontSize: '1rem' }}>
        הדפסה / שמירה כ-PDF
      </button>
      <h1 style={{ fontSize: '1.3rem', margin: '0 0 4px' }}>
        לוח משמרות · <span className="ltr-isolate">{formatDateLabel(weekStart)} – {formatDateLabel(dates[6]!)}</span>
      </h1>
      <p style={{ margin: '0 0 14px', fontSize: '0.9rem', color: currentWeek?.status === 'published' ? '#0a6' : '#a60' }}>
        {currentWeek?.status === 'published' ? 'פורסם' : 'טיוטה — טרם פורסם, ייתכנו שינויים'}
      </p>
      <div className="pv-grid">
        {dates.map((date, dow) => {
          const day = weekShifts.filter((s) => s.date === date).sort((a, b) => a.startTime.localeCompare(b.startTime))
          return (
            <section key={date} className="pv-day">
              <h3>
                {weekdayLongLabel(dow)} <span className="ltr-isolate">{formatDateLabel(date)}</span>
              </h3>
              {currentWeek?.dayNotes[date] && <div style={{ fontSize: '0.74rem', color: '#555' }}>{currentWeek.dayNotes[date]}</div>}
              {day.length === 0 && <div style={{ fontSize: '0.74rem', color: '#888' }}>—</div>}
              {day.map((s) => (
                <div key={s.id} className="pv-shift">
                  <div className="pv-time">
                    {s.startTime}–{s.endTime}
                  </div>
                  {(byShift.get(s.id) ?? []).length === 0 ? (
                    <div style={{ color: '#a60' }}>ללא שיבוץ</div>
                  ) : (
                    (byShift.get(s.id) ?? []).map((a) => (
                      <div key={a.id}>
                        {nameOf(db, a.staffId, a.staffName)}
                        {a.roleId && roleById.get(a.roleId) ? <span style={{ color: '#666' }}> · {roleById.get(a.roleId)!.name}</span> : null}
                      </div>
                    ))
                  )}
                  {s.note && <div style={{ color: '#555' }}>{s.note}</div>}
                </div>
              ))}
            </section>
          )
        })}
      </div>
    </div>
  )
}
