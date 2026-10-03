'use client'

import { useId, useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import { InlineError } from '@/components/shifts/ui'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { clashesFor, indexByShift, nameOf } from '@/lib/shifts/view'
import { formatDayLabel, formatShiftLabel, hasStarted, isolatedRange, weekStartOf } from '@/lib/shifts/time'
import type { Shift } from '@/lib/shifts/types'

// "Change this person's shift": move them from the shift they are on to another
// one, in a single step (so there is never a moment where they are on neither,
// or on both). Only the manager does this; the database re-checks that the move
// does not double-book them and cancels any swap that was waiting on the old shift.
export default function MoveShiftSheet({
  open,
  onClose,
  assignmentId,
  staffId,
  fromShift,
  onMoved,
}: {
  open: boolean
  onClose: () => void
  assignmentId: string
  staffId: string
  fromShift: Shift
  onMoved: () => void
}) {
  const { db, dispatch } = useShifts()
  const titleId = useId()
  const [target, setTarget] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const options = useMemo(() => {
    if (!db) return []
    const byShift = indexByShift(db.assignments)
    return db.shifts
      .filter((s) => s.id !== fromShift.id && s.branchId === fromShift.branchId && !hasStarted(s, db.now))
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
      .map((s) => {
        const on = byShift.get(s.id) ?? []
        const already = on.some((a) => a.staffId === staffId)
        const clash = clashesFor(staffId, s, weekStartOf(s.date), db.shifts, db.assignments, null).filter((c) => c.id !== fromShift.id)[0]
        return { shift: s, names: on.map((a) => nameOf(db, a.staffId, a.staffName)), already, clash }
      })
  }, [db, fromShift, staffId])

  if (!db) return null
  const personName = nameOf(db, staffId)
  const chosen = options.find((o) => o.shift.id === target)

  function close() {
    setTarget(null)
    setError(null)
    onClose()
  }

  async function move() {
    if (!target || !chosen) return
    setBusy(true)
    setError(null)
    const res = await dispatch(
      { type: 'moveAssignment', assignmentId, toShiftId: target },
      { quiet: true, success: `${personName} הועבר/ה ל${formatShiftLabel(chosen.shift.date, chosen.shift.startTime, chosen.shift.endTime)}` }
    )
    setBusy(false)
    if (res.ok) {
      setTarget(null)
      onMoved()
    } else {
      setError(res.message)
    }
  }

  let lastDate = ''
  return (
    <SheetShell open={open} onClose={close} labelledBy={titleId} className="sch-sheet">
      <div className="sch-sheet__head">
        <div style={{ flex: 1 }}>
          <h2 id={titleId} className="sch-sheet__title">
            העברת {personName} למשמרת אחרת
          </h2>
          <p className="sch-sheet__sub">עכשיו: {formatShiftLabel(fromShift.date, fromShift.startTime, fromShift.endTime)}</p>
        </div>
      </div>

      <div className="sheet-scroll" role="radiogroup" aria-labelledby={titleId}>
        {options.length === 0 && <p className="sch-sub" style={{ textAlign: 'center', padding: '20px 0' }}>אין משמרות אחרות שאפשר להעביר אליהן.</p>}
        {options.map(({ shift, names, already, clash }) => {
          const header = shift.date !== lastDate
          lastDate = shift.date
          const disabled = already || !!clash
          return (
            <div key={shift.id} style={{ display: 'contents' }}>
              {header && (
                <p className="sch-label" style={{ margin: '8px 2px 0' }}>
                  {formatDayLabel(shift.date)}
                </p>
              )}
              <button type="button" role="radio" aria-checked={target === shift.id} disabled={disabled} className="sch-pick press" onClick={() => setTarget(shift.id)}>
                <span className="sch-pick__main">
                  <span className="sch-pick__name ltr-isolate" style={{ direction: 'ltr', textAlign: 'start' }}>
                    {shift.startTime}–{shift.endTime}
                  </span>
                  <span className="sch-pick__hint">{names.length > 0 ? `משובצים: ${names.join(', ')}` : 'ללא שיבוץ'}</span>
                  {already && <span className="sch-pick__hint" style={{ color: 'var(--danger)' }}>כבר משובץ/ת במשמרת הזו</span>}
                  {clash && (
                    <span className="sch-pick__hint" style={{ color: 'var(--danger)' }}>
                      חופפת למשמרת אחרת של {personName} ({isolatedRange(clash.startTime, clash.endTime)})
                    </span>
                  )}
                </span>
                <span className="sch-check" aria-hidden="true">
                  {target === shift.id && <Check size={16} />}
                </span>
              </button>
            </div>
          )
        })}
      </div>

      {error && <InlineError>{error}</InlineError>}
      <div className="sch-sheet__foot">
        <button type="button" className="sch-btn press" style={{ flex: 1 }} onClick={close}>
          ביטול
        </button>
        <button type="button" className="sch-btn sch-btn--primary press" style={{ flex: 2 }} disabled={!target || busy} onClick={move}>
          {busy ? 'מעביר…' : chosen ? `העברה ל${formatDayLabel(chosen.shift.date)} ${chosen.shift.startTime}` : 'בחרו משמרת'}
        </button>
      </div>
    </SheetShell>
  )
}
