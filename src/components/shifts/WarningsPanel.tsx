'use client'

import { useMemo } from 'react'
import { AlertTriangle, PartyPopper, XCircle } from 'lucide-react'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { EmptyState } from '@/components/shifts/ui'
import { evaluate, groupWarnings } from '@/lib/shifts/rules'
import { formatShiftLabel } from '@/lib/shifts/time'
import { nameOf } from '@/lib/shifts/view'

// "What needs a look this week?" — in everyday words, grouped by kind, each line
// naming the person and the shift, and tappable to jump straight to that shift.
const CODE_LABELS: Record<string, string> = {
  overlap: 'משמרות חופפות',
  duplicate_assignment: 'שיבוץ כפול',
  min_rest: 'מנוחה קצרה בין משמרות',
  max_weekly_hours: 'יותר מדי שעות בשבוע',
  max_daily_hours: 'יותר מדי שעות ביום',
  max_consecutive_days: 'יותר מדי ימים ברצף',
  understaffed: 'חסרים אנשים במשמרת',
  overstaffed: 'יותר אנשים ממה שצריך',
  unassigned_shift: 'משמרת בלי אף אחד',
  inactive_staff: 'משובץ/ת מישהו שאינו פעיל',
  unknown_role: 'תפקיד שנמחק מההגדרות',
  non_working_day: 'משמרת ביום סגור',
  availability_conflict: 'שובץ/ה ביום שסומן כלא זמין',
}

export default function WarningsPanel({ onJump }: { onJump?: (shiftId: string) => void }) {
  const { db, weekStart } = useShifts()

  const warnings = useMemo(() => {
    if (!db) return []
    return evaluate({ weekStart, settings: db.settings, roster: db.roster, shifts: db.shifts, assignments: db.assignments, availability: db.availability })
  }, [db, weekStart])

  if (!db) return null
  const weekShiftIds = new Set(db.shifts.filter((s) => db.weeks.find((w) => w.id === s.weekId)?.weekStart === weekStart).map((s) => s.id))
  const shown = warnings.filter((w) => !w.shiftId || weekShiftIds.has(w.shiftId))

  if (shown.length === 0) {
    return <EmptyState icon={<PartyPopper size={30} aria-hidden="true" />} title="אין בעיות בלוח של השבוע הזה" hint="הכול מסודר — אפשר לפרסם." />
  }

  const grouped = groupWarnings(shown)

  return (
    <div className="sch-wrap" style={{ gap: 10 }}>
      <p className="sch-sub">אלה דברים שכדאי לבדוק. אף אחד מהם לא עוצר אתכם — אפשר לפרסם גם איתם.</p>
      {[...grouped.entries()].map(([code, list]) => {
        const isError = list[0]!.severity === 'error'
        return (
          <div key={code} className={`sch-card ${isError ? 'sch-card--danger' : ''}`} style={{ gap: 8 }}>
            <div className="sch-row">
              {isError ? <XCircle size={18} aria-hidden="true" color="var(--danger)" /> : <AlertTriangle size={18} aria-hidden="true" color="var(--warn)" />}
              <strong style={{ flex: 1 }}>{CODE_LABELS[code] ?? 'כדאי לבדוק'}</strong>
              <span className="sch-faint" style={{ fontSize: '0.78rem' }}>
                {list.length}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {list.map((w, i) => {
                const shift = w.shiftId ? db.shifts.find((s) => s.id === w.shiftId) : undefined
                const text = [w.staffId ? nameOf(db, w.staffId) : null, shift ? formatShiftLabel(shift.date, shift.startTime, shift.endTime) : null, w.message].filter(Boolean).join(' · ')
                return w.shiftId && onJump ? (
                  <button key={i} type="button" className="sch-btn sch-btn--ghost sch-btn--sm press" style={{ justifyContent: 'flex-start', textAlign: 'start', fontWeight: 600, minHeight: 44 }} onClick={() => onJump(w.shiftId!)}>
                    {text}
                  </button>
                ) : (
                  <span key={i} className="sch-sub" style={{ padding: '4px 4px' }}>
                    {text}
                  </span>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
