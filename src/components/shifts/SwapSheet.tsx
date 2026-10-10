'use client'

import { useId, useMemo, useState } from 'react'
import { Check, X } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import { Avatar, InlineError, Pill } from '@/components/shifts/ui'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { clashesFor, isActiveSwap, nameOf, swapPendingAssignmentIds } from '@/lib/shifts/view'
import { formatShiftLabel, hasStarted, isolatedRange, weekStartOf } from '@/lib/shifts/time'

export type SwapIntent = 'handover' | 'exchange'

export function swapRequestTerms(intent: SwapIntent, mode: 'person' | 'open', targetId: string | null, returnId: string | null) {
  if (intent === 'exchange') return targetId && returnId ? { targetStaffId: targetId, returnAssignmentId: returnId } : null
  if (mode === 'person') return targetId ? { targetStaffId: targetId, returnAssignmentId: null } : null
  return { targetStaffId: null, returnAssignmentId: null }
}

export default function SwapSheet({
  open,
  onClose,
  assignmentId,
  shiftLabel,
  initialIntent,
  onDone,
}: {
  open: boolean
  onClose: () => void
  assignmentId: string
  shiftLabel: string
  initialIntent: SwapIntent
  onDone: () => void
}) {
  const { db, dispatch } = useShifts()
  const titleId = useId()
  const [intent, setIntent] = useState<SwapIntent>(initialIntent)
  const [mode, setMode] = useState<'person' | 'open'>(initialIntent === 'handover' ? 'open' : 'person')
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
  const terms = swapRequestTerms(intent, mode, targetId, returnId)
  const canSubmit = !busy && !!terms && (intent !== 'exchange' || !!returned)

  function close() {
    setError(null)
    onClose()
  }

  async function submit() {
    if (!canSubmit || !terms) return
    setBusy(true)
    setError(null)
    const res = await dispatch(
      {
        type: 'requestSwap',
        assignmentId,
        ...terms,
        reason: reason.trim() || null,
      },
      {
        quiet: true,
        success:
          intent === 'exchange'
            ? `בקשת ההחלפה נשלחה ל${targetName}. לאחר תשובה היא תעבור למנהל/ת.`
            : mode === 'person'
              ? `בקשת המסירה נשלחה ל${targetName}. לאחר תשובה היא תעבור למנהל/ת.`
              : 'המשמרת נפתחה למסירה. לאחר שמישהו יתנדב היא תעבור למנהל/ת.',
      }
    )
    setBusy(false)
    if (res.ok) onDone()
    else setError(res.message)
  }

  // The sentence the whole sheet builds toward.
  const summary = intent === 'exchange'
    ? targetId && returned
      ? `אתם נותנים ל${targetName} את ${shiftLabel}, ומקבלים ממנו/ה את ${formatShiftLabel(returned.shift.date, returned.shift.startTime, returned.shift.endTime)}.`
      : null
    : mode === 'open'
      ? `אתם מציעים את ${shiftLabel} לכל עמית/ה שיכול/ה לקחת אותה, בלי לקבל משמרת בתמורה.`
      : targetId
        ? `אתם מוסרים ל${targetName} את ${shiftLabel}, בלי לקבל משמרת בתמורה.`
        : null

  return (
    <SheetShell open={open} onClose={close} labelledBy={titleId} className="sch-sheet">
      <div className="sch-sheet__head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 id={titleId} className="sch-sheet__title">
            {intent === 'handover' ? 'מסירת משמרת' : 'החלפת משמרת'}
          </h2>
          <p className="sch-sheet__sub">{shiftLabel}</p>
        </div>
        <button type="button" className="sch-iconbtn press" onClick={close} aria-label="סגירה">
          <X size={20} aria-hidden="true" />
        </button>
      </div>

      <div className="sheet-scroll" style={{ gap: 18 }}>
        {alreadySwapping && <InlineError>כבר קיימת בקשה פתוחה על המשמרת הזו.</InlineError>}

        <div className="sch-block">
          <span className="sch-label" style={{ margin: 0 }}>
            מה תרצו לעשות?
          </span>
          <div className="sch-row" role="radiogroup" aria-label="סוג הבקשה">
            <button type="button" role="radio" aria-checked={intent === 'handover'} className="sch-chip press" style={{ flex: 1, justifyContent: 'center' }} onClick={() => { setIntent('handover'); setMode('open'); setTargetId(null); setReturnId(null) }}>
              למסור בלי תמורה
            </button>
            <button type="button" role="radio" aria-checked={intent === 'exchange'} className="sch-chip press" style={{ flex: 1, justifyContent: 'center' }} onClick={() => { setIntent('exchange'); setMode('person'); setTargetId(null); setReturnId(null) }}>
              להחליף משמרות
            </button>
          </div>
        </div>

        <div className="sch-block">
          <span className="sch-label" style={{ margin: 0 }}>
            1. {intent === 'handover' ? 'למי למסור את המשמרת?' : 'עם מי להחליף?'}
          </span>
          {intent === 'handover' && (
            <div className="sch-row" role="radiogroup" aria-label="סוג הבקשה">
              <button type="button" role="radio" aria-checked={mode === 'person'} className="sch-chip press" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setMode('person')}>
                עמית/ה מסוים/ת
              </button>
              <button type="button" role="radio" aria-checked={mode === 'open'} className="sch-chip press" style={{ flex: 1, justifyContent: 'center' }} onClick={() => { setMode('open'); setReturnId(null) }}>
                פתוח לכולם
              </button>
            </div>
          )}

          {mode === 'person' && (
            <div role="radiogroup" aria-label="בחירת עמית/ה" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {colleagues.length === 0 && <p className="sch-sub">אין עמיתים אחרים לבקש מהם.</p>}
              {colleagues.map(({ row, clash }) => {
                const noLogin = !row.hasLogin
                const cannotReceive = noLogin || (intent === 'handover' && !!clash)
                return (
                  <button
                    key={row.staffId}
                    type="button"
                    role="radio"
                    aria-checked={targetId === row.staffId}
                    disabled={cannotReceive}
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
                      {clash && !noLogin && <span className="sch-pick__hint" style={{ color: 'var(--warn)' }}>{intent === 'handover' ? `כבר עובד/ת בשעות האלה (${isolatedRange(clash.startTime, clash.endTime)})` : `עובד/ת בשעות האלה (${isolatedRange(clash.startTime, clash.endTime)}) — בחרו את המשמרת הזו בתמורה`}</span>}
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

        {intent === 'exchange' && targetId && (
          <div className="sch-block">
            <span className="sch-label" style={{ margin: 0 }}>
              2. איזו משמרת מקבלים בתמורה?
            </span>
            <div role="radiogroup" aria-label="תמורה" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
          <span className="sch-label">{intent === 'exchange' ? '3. ' : '2. '}הערה (לא חובה)</span>
          <input className="sch-input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="למשל: יש לי תור לרופא" />
        </label>

        {summary && (
          <div className="sch-card sch-card--attention" style={{ gap: 6 }}>
            <Pill tone="info">מה יקרה</Pill>
            <p style={{ margin: 0, lineHeight: 1.6 }}>{summary}</p>
            <p className="sch-sub">
              {mode === 'person' ? `${targetName} צריך/ה להסכים, ואז ` : ''}המנהל/ת צריכים לאשר. <strong>עד האישור הלוח לא משתנה</strong> — המשמרת נשארת שלכם.
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
          {busy ? 'שולח…' : !canSubmit ? intent === 'exchange' && targetId ? 'בחרו משמרת בתמורה' : 'בחרו עמית/ה' : intent === 'handover' ? 'שליחת בקשת המסירה' : 'שליחת בקשת ההחלפה'}
        </button>
      </div>
    </SheetShell>
  )
}
