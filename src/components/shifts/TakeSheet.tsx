'use client'

import { useId, useMemo, useState } from 'react'
import { Check, X } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import { InlineError, Pill } from '@/components/shifts/ui'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { clashesFor, exchangeOffers, nameOf } from '@/lib/shifts/view'
import { formatShiftLabel, isolatedRange, weekStartOf } from '@/lib/shifts/time'

type Mode = 'take' | 'exchange'

// "I would like THEIR shift." Two honest ways to ask a colleague who holds it:
//   take      they give it to me and I give nothing back (I have a free day, or no shift at all)
//   exchange  I give them one of my own upcoming shifts for it
// Either way the colleague answers first, then a manager decides; the schedule
// changes only after both.
export default function TakeSheet({ open, onClose, assignmentId, onDone }: { open: boolean; onClose: () => void; assignmentId: string; onDone: () => void }) {
  const { db, dispatch } = useShifts()
  const titleId = useId()
  const [pickedMode, setPickedMode] = useState<Mode | null>(null)
  const [offerId, setOfferId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const target = db?.assignments.find((a) => a.id === assignmentId)
  const shift = target ? db?.shifts.find((s) => s.id === target.shiftId) : undefined
  const holderId = target?.staffId ?? null
  const offers = useMemo(() => (db && shift && holderId ? exchangeOffers(db, shift, holderId) : []), [db, shift, holderId])

  if (!db || !target || !shift || !holderId) return null
  const holder = nameOf(db, holderId, target.staffName)
  const me = db.viewerStaffId
  const clash = me ? clashesFor(me, shift, weekStartOf(shift.date), db.shifts, db.assignments)[0] : undefined
  const mode: Mode = pickedMode ?? (clash ? 'exchange' : 'take')
  const offered = offers.find((o) => o.assignment.id === offerId && !o.blocked)
  const label = formatShiftLabel(shift.date, shift.startTime, shift.endTime)
  const canSubmit = !busy && (mode === 'take' ? !clash : !!offered)

  function close() {
    setError(null)
    onClose()
  }

  async function submit() {
    if (!canSubmit || !target) return
    setBusy(true)
    setError(null)
    const note = reason.trim() || null
    const res =
      mode === 'take'
        ? await dispatch({ type: 'requestTake', assignmentId: target.id, reason: note }, { quiet: true, success: `הבקשה נשלחה ל${holder}. אם יסכים/ה — היא תעבור למנהל/ת.` })
        : await dispatch(
            { type: 'requestSwap', assignmentId: offered!.assignment.id, targetStaffId: holderId, returnAssignmentId: target.id, reason: note },
            { quiet: true, success: `בקשת ההחלפה נשלחה ל${holder}. אם יסכים/ה — היא תעבור למנהל/ת.` }
          )
    setBusy(false)
    if (res.ok) onDone()
    else setError(res.message)
  }

  const summary =
    mode === 'take'
      ? `אתם מבקשים לקחת מ${holder} את ${label}, בלי לתת משמרת בתמורה.`
      : offered
        ? `אתם נותנים ל${holder} את ${formatShiftLabel(offered.shift.date, offered.shift.startTime, offered.shift.endTime)}, ומקבלים ממנו/ה את ${label}.`
        : null

  return (
    <SheetShell open={open} onClose={close} labelledBy={titleId} className="sch-sheet">
      <div className="sch-sheet__head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 id={titleId} className="sch-sheet__title">
            בקשה למשמרת של {holder}
          </h2>
          <p className="sch-sheet__sub">{label}</p>
        </div>
        <button type="button" className="sch-iconbtn press" onClick={close} aria-label="סגירה">
          <X size={20} aria-hidden="true" />
        </button>
      </div>

      <div className="sheet-scroll" style={{ gap: 18 }}>
        <div className="sch-block">
          <span className="sch-label" style={{ margin: 0 }}>
            איך תרצו לקבל אותה?
          </span>
          <div className="sch-row" role="radiogroup" aria-label="סוג הבקשה">
            <button type="button" role="radio" aria-checked={mode === 'take'} disabled={!!clash} className="sch-chip press" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setPickedMode('take')}>
              לקחת אותה
            </button>
            <button type="button" role="radio" aria-checked={mode === 'exchange'} className="sch-chip press" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setPickedMode('exchange')}>
              להחליף עם משמרת שלי
            </button>
          </div>
          {clash && <p className="sch-sub" style={{ color: 'var(--warn)' }}>אתם כבר עובדים בשעות האלה ({formatShiftLabel(clash.date, clash.startTime, clash.endTime)}), אז אפשר רק להחליף אותה בתמורה.</p>}
        </div>

        {mode === 'exchange' && (
          <div className="sch-block">
            <span className="sch-label" style={{ margin: 0 }}>
              איזו משמרת שלכם לתת בתמורה?
            </span>
            <div role="radiogroup" aria-label="משמרת בתמורה" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {offers.map(({ assignment, shift: mine, blocked }) => (
                <button key={assignment.id} type="button" role="radio" aria-checked={offerId === assignment.id} disabled={!!blocked} className="sch-pick press" onClick={() => setOfferId(assignment.id)}>
                  <span className="sch-pick__main">
                    <span className="sch-pick__name">{formatShiftLabel(mine.date, mine.startTime, mine.endTime)}</span>
                    <span className="sch-pick__hint">המשמרת שלכם — {holder} יעבוד/תעבוד בה</span>
                    {blocked === 'mine_overlaps' && <span className="sch-pick__hint" style={{ color: 'var(--warn)' }}>אחרי ההחלפה היא תחפוף למשמרת אחרת שלכם</span>}
                    {blocked === 'theirs_overlaps' && <span className="sch-pick__hint" style={{ color: 'var(--warn)' }}>{holder} כבר עובד/ת בשעות האלה ({isolatedRange(mine.startTime, mine.endTime)})</span>}
                  </span>
                  <span className="sch-check" aria-hidden="true">
                    {offerId === assignment.id && <Check size={16} />}
                  </span>
                </button>
              ))}
              {offers.length === 0 && <p className="sch-sub">אין לכם משמרות עתידיות להציע בתמורה{clash ? '' : ' — אפשר לבקש לקחת אותה בלי תמורה'}.</p>}
            </div>
          </div>
        )}

        <label>
          <span className="sch-label">הערה (לא חובה)</span>
          <input className="sch-input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="למשל: אשמח להחליף כי יש לי אירוע" />
        </label>

        {summary && (
          <div className="sch-card sch-card--attention" style={{ gap: 6 }}>
            <Pill tone="info">מה יקרה</Pill>
            <p style={{ margin: 0, lineHeight: 1.6 }}>{summary}</p>
            <p className="sch-sub">
              {holder} צריך/ה להסכים, ואז המנהל/ת צריכים לאשר. <strong>עד האישור הלוח לא משתנה</strong> — כל אחד נשאר במשמרת שלו.
            </p>
          </div>
        )}
        {error && <InlineError>{error}</InlineError>}
      </div>

      <div className="sch-sheet__foot">
        <button type="button" className="sch-btn press" style={{ flex: 1 }} onClick={close}>
          ביטול
        </button>
        <button type="button" className="sch-btn sch-btn--primary press" style={{ flex: 2 }} disabled={!canSubmit} onClick={submit}>
          {busy ? 'שולח…' : mode === 'exchange' && !offered ? 'בחרו משמרת בתמורה' : mode === 'take' ? `שליחת בקשה ל${holder}` : 'שליחת בקשת ההחלפה'}
        </button>
      </div>
    </SheetShell>
  )
}
