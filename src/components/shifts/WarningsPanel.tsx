'use client'

import { useMemo } from 'react'
import { AlertTriangle, XCircle } from 'lucide-react'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { evaluate, groupWarnings } from '@/lib/shifts/rules'

const CODE_LABELS: Record<string, string> = {
  overlap: 'משמרות חופפות',
  duplicate_assignment: 'שיבוץ כפול',
  min_rest: 'מנוחה לא מספקת',
  max_weekly_hours: 'חריגה משעות שבועיות',
  max_daily_hours: 'חריגה משעות יומיות',
  max_consecutive_days: 'ימים רצופים רבים מדי',
  understaffed: 'איוש חסר',
  overstaffed: 'איוש עודף',
  unassigned_shift: 'משמרת ללא שיבוץ',
  inactive_staff: 'שיבוץ לאיש/אשת צוות לא פעיל/ה',
  unknown_role: 'תפקיד שלא קיים יותר',
  non_working_day: 'משמרת ביום סגור',
  availability_conflict: 'התנגשות עם זמינות',
}

export default function WarningsPanel({ onJump }: { onJump?: (shiftId: string) => void }) {
  const { db, weekStart } = useShifts()

  const warnings = useMemo(() => {
    if (!db) return []
    return evaluate({
      weekStart,
      settings: db.settings,
      roster: db.roster,
      shifts: db.shifts,
      assignments: db.assignments,
      availability: db.availability,
    })
  }, [db, weekStart])

  if (!db) return null

  if (warnings.length === 0) {
    return <p style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '24px 0', fontSize: '0.88rem' }}>אין התראות לשבוע הזה 🎉</p>
  }

  const grouped = groupWarnings(warnings)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[...grouped.entries()].map(([code, list]) => (
        <div
          key={code}
          style={{
            padding: '10px 12px',
            borderRadius: 12,
            background: 'var(--bg-elev)',
            border: `1px solid ${list[0]!.severity === 'error' ? 'rgba(255,107,107,0.35)' : 'var(--line)'}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            {list[0]!.severity === 'error' ? (
              <XCircle size={15} color="#ff6b6b" aria-hidden="true" />
            ) : (
              <AlertTriangle size={15} color="#ffb240" aria-hidden="true" />
            )}
            <strong style={{ fontSize: '0.85rem' }}>{CODE_LABELS[code] ?? code}</strong>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-faint)' }}>({list.length})</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {list.map((w, i) => (
              <button
                key={i}
                type="button"
                className={w.shiftId && onJump ? 'press' : undefined}
                onClick={() => w.shiftId && onJump?.(w.shiftId)}
                style={{
                  textAlign: 'start',
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  fontSize: '0.8rem',
                  color: 'var(--text-dim)',
                  cursor: w.shiftId && onJump ? 'pointer' : 'default',
                }}
              >
                {w.message}
                {w.staffId && ` — ${db.roster.find((r) => r.staffId === w.staffId)?.displayName ?? ''}`}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
