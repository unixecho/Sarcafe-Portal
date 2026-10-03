'use client'

import { useId, useMemo, useState } from 'react'
import { Check, Search } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import { Avatar, Pill } from '@/components/shifts/ui'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { clashesFor, pendingRequestsByShift } from '@/lib/shifts/view'
import { formatShiftLabel, weekStartOf } from '@/lib/shifts/time'
import { badgeLabel } from '@/lib/staff/badges'

type Target = { date: string; startTime: string; endTime: string; shiftId: string | null }

// "Who can I put on this shift?" — a person-first list that already knows the
// answer to the questions a manager would otherwise find out the hard way:
//   * who ASKED to join this shift (shown first),
//   * who is already working at that time (greyed out, with the shift named),
//   * who said they are unavailable that day (a warning, not a block),
//   * who has no login (they can be scheduled, they just will not see the app).
// The database makes the final call (and also checks the other branch); this just
// means the manager rarely has to be told "no".
export default function StaffPickerSheet({
  open,
  onClose,
  target,
  excludeStaffIds,
  onAdd,
}: {
  open: boolean
  onClose: () => void
  target: Target
  excludeStaffIds: string[]
  onAdd: (staffIds: string[]) => void
}) {
  const { db } = useShifts()
  const titleId = useId()
  const [picked, setPicked] = useState<string[]>([])
  const [query, setQuery] = useState('')

  const rows = useMemo(() => {
    if (!db) return []
    const weekStart = weekStartOf(target.date)
    const requested = new Set(
      (target.shiftId ? (pendingRequestsByShift(db.requests).get(target.shiftId) ?? []) : []).map((r) => r.staffId)
    )
    const availability = db.availability.filter((a) => a.weekStart === weekStart && a.status === 'submitted')
    return db.roster
      .filter((r) => r.active && r.schedulable && !excludeStaffIds.includes(r.staffId))
      .map((r) => {
        const clash = clashesFor(r.staffId, { date: target.date, startTime: target.startTime, endTime: target.endTime }, weekStart, db.shifts, db.assignments, target.shiftId)[0]
        const entry = availability.find((a) => a.staffId === r.staffId)?.entries.find((e) => e.date === target.date)
        return { row: r, requested: requested.has(r.staffId), clash, unavailable: entry?.kind === 'unavailable', prefers: entry?.kind === 'prefer' }
      })
      .sort((a, b) => {
        const rank = (x: typeof a) => (x.clash ? 3 : x.requested ? 0 : x.unavailable ? 2 : 1)
        return rank(a) - rank(b) || a.row.displayName.localeCompare(b.row.displayName, 'he')
      })
  }, [db, target, excludeStaffIds])

  if (!db) return null
  const shown = query.trim() ? rows.filter((r) => r.row.displayName.toLowerCase().includes(query.trim().toLowerCase())) : rows

  function toggle(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  }
  function close() {
    setPicked([])
    setQuery('')
    onClose()
  }
  function confirm() {
    const ids = picked
    setPicked([])
    setQuery('')
    onAdd(ids)
  }

  return (
    <SheetShell open={open} onClose={close} labelledBy={titleId} className="sch-sheet">
      <div className="sch-sheet__head">
        <div style={{ flex: 1 }}>
          <h2 id={titleId} className="sch-sheet__title">
            מי עובד/ת במשמרת?
          </h2>
          <p className="sch-sheet__sub">{formatShiftLabel(target.date, target.startTime, target.endTime)}</p>
        </div>
      </div>

      {rows.length >= 8 && (
        <label style={{ position: 'relative', display: 'block', marginBottom: 8 }}>
          <span className="sr-only">חיפוש לפי שם</span>
          <Search size={16} aria-hidden="true" style={{ position: 'absolute', insetInlineStart: 14, top: 18, color: 'var(--text-faint)' }} />
          <input className="sch-input" style={{ paddingInlineStart: 38 }} placeholder="חיפוש לפי שם" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      )}

      <div className="sheet-scroll" role="group" aria-labelledby={titleId}>
        {shown.length === 0 && (
          <p className="sch-sub" style={{ textAlign: 'center', padding: '20px 0' }}>
            {rows.length === 0 ? 'אין עוד אנשי צוות זמינים לשיבוץ. אפשר להוסיף או להפעיל אנשי צוות בלשונית "צוות".' : 'לא נמצא אף אחד בשם הזה.'}
          </p>
        )}
        {shown.map(({ row, requested, clash, unavailable, prefers }) => {
          const checked = picked.includes(row.staffId)
          const blocked = !!clash
          return (
            <button
              key={row.staffId}
              type="button"
              role="checkbox"
              aria-checked={checked}
              disabled={blocked}
              className="sch-pick press"
              onClick={() => toggle(row.staffId)}
            >
              <Avatar name={row.displayName} />
              <span className="sch-pick__main">
                <span className="sch-pick__name">{row.displayName}</span>
                <span style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {row.badge && <span className="sch-pick__hint">{badgeLabel(row.badge)}</span>}
                  {requested && <Pill tone="info">ביקש/ה להצטרף</Pill>}
                  {prefers && <Pill tone="ok">מעדיף/ה את היום הזה</Pill>}
                  {unavailable && <Pill tone="warn">סימן/ה שלא זמין/ה ביום הזה</Pill>}
                  {!row.hasLogin && <Pill tone="neutral">ללא כניסה לאפליקציה</Pill>}
                </span>
                {clash && (
                  <span className="sch-pick__hint" style={{ color: 'var(--danger)' }}>
                    כבר משובץ/ת ב{formatShiftLabel(clash.date, clash.startTime, clash.endTime)} — אי אפשר בשתי משמרות חופפות
                  </span>
                )}
              </span>
              <span className="sch-check" aria-hidden="true">
                {checked && <Check size={16} />}
              </span>
            </button>
          )
        })}
      </div>

      <div className="sch-sheet__foot">
        <button type="button" className="sch-btn press" style={{ flex: 1 }} onClick={close}>
          ביטול
        </button>
        <button type="button" className="sch-btn sch-btn--primary press" style={{ flex: 2 }} disabled={picked.length === 0} onClick={confirm}>
          {picked.length === 0 ? 'בחרו מי יעבוד' : `הוספה (${picked.length})`}
        </button>
      </div>
    </SheetShell>
  )
}
