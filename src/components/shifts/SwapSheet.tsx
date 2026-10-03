'use client'

import { useId, useMemo, useState } from 'react'
import { Check, X } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import { Avatar, InlineError, Pill } from '@/components/shifts/ui'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { clashesFor, isActiveSwap, nameOf, swapPendingAssignmentIds } from '@/lib/shifts/view'
import { formatShiftLabel, hasStarted, isolatedRange, weekStartOf } from '@/lib/shifts/time'

// "Ask someone to cover / swap my shift" in three plain questions:
//   1. Who?            a specific colleague, or "anyone who can" (open to all)
//   2. In return?      nothing (I just hand the shift over) or one of THEIR shifts
//   3. Anything to add? (optional note)
// and then a sentence that says exactly what will happen if everyone agrees —
// including that nothing changes until the manager approves.
export default function SwapSheet({
  open,
  onClose,
  assignmentId,
  shiftLabel,
  onDone,
}: {
  open: boolean
  onClose: () => void
  assignmentId: string
  shiftLabel: string
  onDone: () => void
}) {
  const { db, dispatch } = useShifts()
  const titleId = useId()
  const [mode, setMode] = useState<'person' | 'open'>('person')
  const [targetId, setTargetId] = useState<string | null>(null)
  const [returnId, setReturnId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mine = db?.assignments.find((a) => a.id === assignmentId)
  const myShift = mine ? db?.shifts.find((s) => s.id === mine.shiftId) : undefined

  const colleagues = useMemo(() => {
    if (!db || !myShift) return []
    const me = db.viewerStaffId
    return db.roster
      .filter((r) => r.active && r.schedulable && r.staffId !== me)
      .map((r) => {
        const clash = clashesFor(r.staffId, myShift, weekStartOf(myShift.date), db.shifts, db.assignments)[0]
        return { row: r, clash }
      })
      .sort((a, b) => Number(!!a.clash) - Number(!!b.clash) || a.row.displayName.localeCompare(b.row.displayName, 'he'))
  }, [db, myShift])

  const theirShifts = useMemo(() => {
    if (!db || !targetId || !myShift) return []
    const swapIds = swapPendingAssignmentIds(db.swaps)
    const byShift = new Map(db.shifts.map((s) => [s.id, s]))
    const me = db.viewerStaffId
    return db.assignments
      .filter((a) => a.staffId === targetId && !swapIds.has(a.id))
      .map((a) => ({ a, shift: byShift.get(a.shiftId)! }))
      .filter((x) => x.shift && !hasStarted(x.shift, db.now) && x.shift.branchId === myShift.branchId)
      .map((x) => ({ ...x, clash: me ? clashesFor(me, x.shift, weekStartOf(x.shift.date), db.shifts, db.assignments).filter((c) => c.id !== myShift.id)[0] : undefined }))
      .sort((p, q) => p.shift.date.localeCompare(q.shift.date) || p.shift.startTime.localeCompare(q.shift.startTime))
  }, [db, targetId, myShift])

  if (!db || !mine || !myShift) return null
  const targetName = targetId ? nameOf(db, targetId) : null
  const returned = returnId ? theirShifts.find((t) => t.a.id === returnId) : undefined
  const alreadySwapping = db.swaps.some((s) => isActiveSwap(s) && (s.assignmentId === mine.id || s.returnAssignmentId === mine.id))
  const canSubmit = mode === 'open' || (!!targetId && !busy)

  function close() {
    setError(null)
    onClose()
  }

  async function submit() {
    setBusy(true)
    setError(null)
    const res = await dispatch(
      {
        type: 'requestSwap',
        assignmentId,
        targetStaffId: mode === 'person' ? targetId : null,
        returnAssignmentId: mode === 'person' ? returnId : null,
        reason: reason.trim() || null,
      },
      { quiet: true, success: mode === 'person' ? `הבקשה נשלחה ל${targetName} ✓ ברגע שיגיב/תגיב — היא תעבור למנהל/ת.` : 'הבקשה נפתחה לכולם ✓ ברגע שמישהו יתנדב — היא תעבור למנהל/ת.' }
    )
    setBusy(false)
    if (res.ok) onDone()
    else setError(res.message)
  }

  // The sentence the whole sheet builds toward.
  const summary =
    mode === 'open'
      ? `אתם מבקשים שמישהו יחליף אתכם ב${shiftLabel}. כל עמית/ה שיכול/ה יוכל/תוכל להתנדב, ואז המנהל/ת יחליטו.`
      : !targetId
        ? null
        : returned
          ? `אתם נותנים ל${targetName} את ${shiftLabel}, ומקבלים ממנו/ה את ${formatShiftLabel(returned.shift.date, returned.shift.startTime, returned.shift.endTime)}.`
          : `אתם נותנים ל${targetName} את ${shiftLabel}, ולא מקבלים משמרת בתמורה.`

  return (
    <SheetShell open={open} onClose={close} labelledBy={titleId} className="sch-sheet">
      <div className="sch-sheet__head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 id={titleId} className="sch-sheet__title">
            בקשת החלפה
          </h2>
          <p className="sch-sheet__sub">{shiftLabel}</p>
        </div>
        <button type="button" className="sch-iconbtn press" onClick={close} aria-label="סגירה">
          <X size={20} aria-hidden="true" />
        </button>
      </div>

      <div className="sheet-scroll" style={{ gap: 18 }}>
        {alreadySwapping && <InlineError>כבר קיימת בקשת החלפה פתוחה על המשמרת הזו.</InlineError>}

        <div className="sch-block">
          <span className="sch-label" style={{ margin: 0 }}>
            1. מי יחליף אתכם?
          </span>
          <div className="sch-row" role="radiogroup" aria-label="סוג הבקשה">
            <button type="button" role="radio" aria-checked={mode === 'person'} className="sch-chip press" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setMode('person')}>
              עמית/ה מסוים/ת
            </button>
            <button type="button" role="radio" aria-checked={mode === 'open'} className="sch-chip press" style={{ flex: 1, justifyContent: 'center' }} onClick={() => { setMode('open'); setReturnId(null) }}>
              פתוח לכולם
            </button>
          </div>

          {mode === 'person' && (
            <div role="radiogroup" aria-label="בחירת עמית/ה" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {colleagues.length === 0 && <p className="sch-sub">אין עמיתים אחרים לבקש מהם.</p>}
              {colleagues.map(({ row, clash }) => {
                const noLogin = !row.hasLogin
                return (
                  <button
                    key={row.staffId}
                    type="button"
                    role="radio"
                    aria-checked={targetId === row.staffId}
                    disabled={noLogin}
                    className="sch-pick press"
                    onClick={() => {
                      setTargetId(row.staffId)
                      setReturnId(null)
                    }}
                  >
                    <Avatar name={row.displayName} />
                    <span className="sch-pick__main">
                      <span className="sch-pick__name">{row.displayName}</span>
                      {noLogin && <span className="sch-pick__hint">אין לו/ה כניסה לאפליקציה, ולכן אי אפשר לשלוח לו/ה בקשה</span>}
                      {clash && !noLogin && <span className="sch-pick__hint" style={{ color: 'var(--warn)' }}>עובד/ת בשעות האלה ({isolatedRange(clash.startTime, clash.endTime)}) — אפשר רק להחליף משמרת בתמורה</span>}
                    </span>
                    <span className="sch-check" aria-hidden="true">
                      {targetId === row.staffId && <Check size={16} />}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {mode === 'person' && targetId && (
          <div className="sch-block">
            <span className="sch-label" style={{ margin: 0 }}>
              2. מה מקבלים בתמורה?
            </span>
            <div role="radiogroup" aria-label="תמורה" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button type="button" role="radio" aria-checked={returnId === null} className="sch-pick press" onClick={() => setReturnId(null)}>
                <span className="sch-pick__main">
                  <span className="sch-pick__name">כלום — אני רק מעביר/ה את המשמרת</span>
                  <span className="sch-pick__hint">{targetName} ייקח/תיקח את המשמרת שלכם</span>
                </span>
                <span className="sch-check" aria-hidden="true">
                  {returnId === null && <Check size={16} />}
                </span>
              </button>
              {theirShifts.map(({ a, shift, clash }) => (
                <button key={a.id} type="button" role="radio" aria-checked={returnId === a.id} className="sch-pick press" onClick={() => setReturnId(a.id)}>
                  <span className="sch-pick__main">
                    <span className="sch-pick__name">{formatShiftLabel(shift.date, shift.startTime, shift.endTime)}</span>
                    <span className="sch-pick__hint">משמרת של {targetName} — תעבדו בה אתם</span>
                    {clash && <span className="sch-pick__hint" style={{ color: 'var(--warn)' }}>חופפת למשמרת אחרת שלכם</span>}
                  </span>
                  <span className="sch-check" aria-hidden="true">
                    {returnId === a.id && <Check size={16} />}
                  </span>
                </button>
              ))}
              {theirShifts.length === 0 && <p className="sch-sub">ל{targetName} אין עכשיו משמרות פתוחות להחלפה.</p>}
            </div>
          </div>
        )}

        <label>
          <span className="sch-label">{mode === 'person' ? '3. ' : '2. '}הערה (לא חובה)</span>
          <input className="sch-input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="למשל: יש לי תור לרופא" />
        </label>

        {summary && (
          <div className="sch-card sch-card--attention" style={{ gap: 6 }}>
            <Pill tone="info">מה יקרה</Pill>
            <p style={{ margin: 0, lineHeight: 1.6 }}>{summary}</p>
            <p className="sch-sub">
              {mode === 'person' ? `${targetName} צריך/ה להסכים, ואז` : ''} המנהל/ת צריכים לאשר. <strong>עד האישור הלוח לא משתנה</strong> — המשמרת נשארת שלכם.
            </p>
          </div>
        )}
        {error && <InlineError>{error}</InlineError>}
      </div>

      <div className="sch-sheet__foot">
        <button type="button" className="sch-btn press" style={{ flex: 1 }} onClick={close}>
          ביטול
        </button>
        <button type="button" className="sch-btn sch-btn--primary press" style={{ flex: 2 }} disabled={!canSubmit || busy || alreadySwapping} onClick={submit}>
          {busy ? 'שולח…' : mode === 'person' && !targetId ? 'בחרו עמית/ה' : 'שליחת הבקשה'}
        </button>
      </div>
    </SheetShell>
  )
}
