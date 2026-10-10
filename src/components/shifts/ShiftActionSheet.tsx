'use client'

import { useId, useState } from 'react'
import { ArrowLeftRight, BellRing, Hand, UserPlus, X } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import SwapSheet, { type SwapIntent } from '@/components/shifts/SwapSheet'
import { InlineError, Notice, Person, Pill, RequestStatusPill, SwapStatusPill } from '@/components/shifts/ui'
import { coverageOf } from '@/lib/shifts/coverage'
import { matchPreset } from '@/lib/shifts/presets'
import { formatShiftLabel, hasStarted, weekStartOf, formatDayLabel } from '@/lib/shifts/time'
import { clashesFor, indexByShift, isActiveSwap, nameOf, rosterRow } from '@/lib/shifts/view'

// One shift, from the employee's side: what it is, who is on it, and the one or
// two things they can do about it — all explained in the sheet itself, so nobody
// has to know what a "swap" or a "request" is before tapping.
//   my shift          -> give it away or exchange it with a colleague
//   someone else's    -> ask to join it, if it still needs people and I am free
// Everything that would change the schedule goes to the manager first; this sheet
// says so in words before the button is pressed.
export default function ShiftActionSheet({ shiftId, onClose }: { shiftId: string | null; onClose: () => void }) {
  const { db, dispatch } = useShifts()
  const titleId = useId()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [swapOpen, setSwapOpen] = useState(false)
  const [swapIntent, setSwapIntent] = useState<SwapIntent>('handover')
  const [confirm, setConfirm] = useState<(ConfirmRequest & { onYes: () => void }) | null>(null)

  const shift = db && shiftId ? db.shifts.find((s) => s.id === shiftId) : undefined
  if (!db || !shift) return null

  const me = db.viewerStaffId
  const myRow = rosterRow(db, me)
  const on = indexByShift(db.assignments).get(shift.id) ?? []
  const mine = on.find((a) => a.staffId === me)
  const cov = coverageOf(shift, on)
  const started = hasStarted(shift, db.now)
  const preset = matchPreset(shift, db.settings.presets) ?? (shift.presetId ? db.settings.presets.find((p) => p.id === shift.presetId) : undefined)
  const roleById = new Map(db.settings.roles.map((r) => [r.id, r]))
  const mySwap = mine ? db.swaps.find((s) => isActiveSwap(s) && (s.assignmentId === mine.id || s.returnAssignmentId === mine.id)) : undefined
  const myRequest = db.requests.find((r) => r.shiftId === shift.id && r.staffId === me && r.status === 'pending')
  const lastRequest = db.requests.find((r) => r.shiftId === shift.id && r.staffId === me && r.status !== 'pending')
  const clash = me && !mine ? clashesFor(me, shift, weekStartOf(shift.date), db.shifts, db.assignments)[0] : undefined
  const unavailable = !!me && db.availability.some((a) => a.staffId === me && a.entries.some((e) => e.date === shift.date && e.kind === 'unavailable'))
  const full = cov.needed > 0 && cov.assigned >= cov.needed
  const label = formatShiftLabel(shift.date, shift.startTime, shift.endTime)

  function close() {
    setNote('')
    setError(null)
    onClose()
  }

  async function requestToJoin() {
    if (!shift) return
    setBusy(true)
    setError(null)
    const res = await dispatch({ type: 'requestShift', shiftId: shift.id, note: note.trim() || null }, { quiet: true, success: 'הבקשה נשלחה ✓ המנהל/ת יענו, ותראו את התשובה כאן ובעדכונים (הפעמון).' })
    setBusy(false)
    if (res.ok) close()
    else setError(res.message)
  }

  async function cancelRequest() {
    if (!myRequest) return
    setBusy(true)
    const res = await dispatch({ type: 'cancelRequest', requestId: myRequest.id }, { quiet: true, success: 'הבקשה בוטלה' })
    setBusy(false)
    if (res.ok) close()
    else setError(res.message)
  }

  function askCancelSwap() {
    if (!mySwap) return
    const requestKind = mySwap.returnAssignmentId ? 'ההחלפה' : 'המסירה'
    setConfirm({
      title: `לבטל את בקשת ${requestKind}?`,
      body: 'המשמרת תישאר שלך, כמו שהיא.',
      confirmLabel: 'ביטול הבקשה',
      cancelLabel: 'להשאיר',
      danger: true,
      onYes: async () => {
        setBusy(true)
        const res = await dispatch({ type: 'cancelSwap', swapId: mySwap.id }, { quiet: true, success: `בקשת ${requestKind} בוטלה — המשמרת נשארה שלך` })
        setBusy(false)
        if (res.ok) close()
        else setError(res.message)
      },
    })
  }

  return (
    <>
      <SheetShell open onClose={close} labelledBy={titleId} suspended={swapOpen || !!confirm} className="sch-sheet">
        <div className="sch-sheet__head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id={titleId} className="sch-sheet__title">
              {formatDayLabel(shift.date)}
            </h2>
            <p className="sch-sheet__sub ltr-isolate" style={{ direction: 'ltr', textAlign: 'start' }}>
              {shift.startTime}–{shift.endTime}
              {preset ? ` · ${preset.name}` : ''}
            </p>
          </div>
          <button type="button" className="sch-iconbtn press" onClick={close} aria-label="סגירה">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="sheet-scroll" style={{ gap: 16 }}>
          <div className="sch-block">
            <span className="sch-label" style={{ margin: 0 }}>
              מי במשמרת
            </span>
            <div className="sch-wrapflex">
              {on.length === 0 ? (
                <span className="sch-sub">עוד אף אחד לא משובץ.</span>
              ) : (
                on.map((a) => <Person key={a.id} name={nameOf(db, a.staffId, a.staffName)} role={a.roleId ? roleById.get(a.roleId) : null} />)
              )}
            </div>
            {cov.state === 'partial' && <Pill tone="warn">חסרים עוד {cov.missing} במשמרת הזו</Pill>}
            {cov.state === 'full' && <Pill tone="ok">המשמרת מאוישת</Pill>}
            {shift.note && <p className="sch-sub">{shift.note}</p>}
          </div>

          {started && <Notice tone="info">המשמרת הזו כבר התחילה או עברה, ולכן אי אפשר לבקש עליה כלום.</Notice>}

          {/* ---------------- my shift ---------------- */}
          {!started && mine && (
            <div className="sch-block">
              <Pill tone="mine">המשמרת שלך</Pill>
              {mySwap ? (
                <div className="sch-card sch-card--attention">
                  <div className="sch-row" style={{ flexWrap: 'wrap' }}>
                    <SwapStatusPill status={mySwap.status} />
                  </div>
                  <p className="sch-sub" style={{ color: 'var(--text)' }}>
                    {mySwap.status === 'open' &&
                      (mySwap.returnAssignmentId
                        ? `ביקשתם מ${nameOf(db, mySwap.toStaffId, mySwap.toStaffName)} להחליף איתכם. מחכים לתשובה.`
                        : mySwap.toStaffId
                          ? `ביקשתם למסור את המשמרת ל${nameOf(db, mySwap.toStaffId, mySwap.toStaffName)}. מחכים לתשובה.`
                          : 'פתחתם את המשמרת למסירה. מחכים שמישהו יתנדב.')}
                    {mySwap.status === 'peer_accepted' && `${nameOf(db, mySwap.toStaffId, mySwap.toStaffName)} הסכים/ה. עכשיו מחכים לאישור המנהל/ת.`}
                  </p>
                  <p className="sch-sub">עד שהמנהל/ת יאשרו — המשמרת נשארת שלכם.</p>
                  <button type="button" className="sch-btn sch-btn--danger press" disabled={busy} onClick={askCancelSwap}>
                    ביטול בקשת {mySwap.returnAssignmentId ? 'ההחלפה' : 'המסירה'}
                  </button>
                </div>
              ) : db.settings.features.swaps ? (
                <>
                  <p className="sch-sub">לא יכולים להגיע? בחרו אם למסור את המשמרת בלי לקבל אחרת, או להחליף אותה עם עמית/ה. הלוח משתנה רק אחרי אישור המנהל/ת.</p>
                  <div className="sch-row" style={{ flexWrap: 'wrap' }}>
                    <button type="button" className="sch-btn sch-btn--primary press" style={{ flex: '1 1 180px' }} onClick={() => { setSwapIntent('handover'); setSwapOpen(true) }}>
                      <Hand size={18} aria-hidden="true" /> מסירת משמרת
                    </button>
                    <button type="button" className="sch-btn press" style={{ flex: '1 1 180px' }} onClick={() => { setSwapIntent('exchange'); setSwapOpen(true) }}>
                      <ArrowLeftRight size={18} aria-hidden="true" /> החלפת משמרת
                    </button>
                  </div>
                </>
              ) : (
                <p className="sch-sub">מסירה והחלפת משמרות כבויות כרגע. לשינוי — פנו למנהל/ת.</p>
              )}
            </div>
          )}

          {/* ---------------- someone else's shift ---------------- */}
          {!started && !mine && (
            <div className="sch-block">
              {myRequest ? (
                <div className="sch-card sch-card--attention">
                  <RequestStatusPill status="pending" />
                  <p className="sch-sub" style={{ color: 'var(--text)' }}>
                    ביקשתם להצטרף למשמרת הזו. המנהל/ת יאשרו או ידחו, ותקבלו על כך הודעה.
                  </p>
                  <button type="button" className="sch-btn sch-btn--danger press" disabled={busy} onClick={cancelRequest}>
                    ביטול הבקשה
                  </button>
                </div>
              ) : !shift.requestsOpen ? (
                <Notice tone="info">המנהל/ת לא פתחו את המשמרת הזו לבקשות. אפשר לפתוח משמרת שלכם ולבקש החלפה או למסור אותה בלי משמרת חוזרת.</Notice>
              ) : myRow && !myRow.schedulable ? (
                <Notice tone="warn">אתם מוגדרים כלא זמינים לשיבוץ בסניף הזה, ולכן אי אפשר לבקש משמרת. לשינוי — פנו למנהל/ת.</Notice>
              ) : clash ? (
                <Notice tone="warn">אתם כבר עובדים בשעות האלה ({formatShiftLabel(clash.date, clash.startTime, clash.endTime)}), ולכן אי אפשר להצטרף.</Notice>
              ) : full ? (
                <Notice tone="info">המשמרת כבר מאוישת. אם אתם רוצים לעבוד בה — אפשר לפתוח את אחת המשמרות שלכם ולבקש להחליף עם מי שמשובץ/ת בה.</Notice>
              ) : unavailable ? (
                <Notice tone="warn">סימנתם שאתם לא זמינים ביום הזה, ולכן אי אפשר לבקש את המשמרת. אם התחרטתם — עדכנו קודם בלשונית &quot;בקשות לשבוע&quot;.</Notice>
              ) : (
                <>
                  <p className="sch-sub" style={{ color: 'var(--text)' }}>
                    רוצים לעבוד במשמרת הזו? שלחו בקשה — המנהל/ת יאשרו או ידחו, ותקבלו הודעה. עד אז כלום לא משתנה בלוח.
                  </p>
                  <label>
                    <span className="sch-label">הערה למנהל/ת (לא חובה)</span>
                    <input className="sch-input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="למשל: אני יכול/ה גם להישאר עד הסגירה" />
                  </label>
                  <button type="button" className="sch-btn sch-btn--primary press" disabled={busy} onClick={requestToJoin}>
                    <UserPlus size={18} aria-hidden="true" /> {busy ? 'שולח…' : 'בקשה להצטרף למשמרת'}
                  </button>
                </>
              )}
              {lastRequest && !myRequest && (
                <p className="sch-sub" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <BellRing size={14} aria-hidden="true" /> הבקשה האחרונה שלכם למשמרת הזו: <RequestStatusPill status={lastRequest.status} />
                  {lastRequest.decisionNote ? ` ״${lastRequest.decisionNote}״` : ''}
                </p>
              )}
            </div>
          )}

          {error && <InlineError>{error}</InlineError>}
        </div>
      </SheetShell>

      {mine && swapOpen && <SwapSheet open onClose={() => setSwapOpen(false)} assignmentId={mine.id} shiftLabel={label} initialIntent={swapIntent} onDone={() => { setSwapOpen(false); close() }} />}

      <ConfirmSheet
        request={confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm
          setConfirm(null)
          c?.onYes()
        }}
      />
    </>
  )
}
