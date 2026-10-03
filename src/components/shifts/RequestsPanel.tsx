'use client'

import { useMemo, useState } from 'react'
import { ArrowLeftRight, Check, ChevronDown, Inbox, UserPlus, X } from 'lucide-react'
import PromptSheet, { type PromptRequest } from '@/components/PromptSheet'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { Avatar, EmptyState, Notice, Person, Pill, RequestStatusPill, SwapStatusPill } from '@/components/shifts/ui'
import { issuesOf } from '@/lib/shifts/messages'
import { requestImpact, swapImpact } from '@/lib/shifts/rules'
import { coverageOf } from '@/lib/shifts/coverage'
import { formatDateLabel, formatShiftLabel, timeAgoHe, weekdayLabel, parseISODate } from '@/lib/shifts/time'
import { indexByShift, nameOf, requestLabel, sideLabel } from '@/lib/shifts/view'
import type { ShiftRequest, SwapRequest, SwapSide } from '@/lib/shifts/types'

// THE manager's inbox — everything that is waiting for a decision, in one place,
// with what each decision would do spelled out BEFORE the button is pressed:
//   * employees asking to join a shift,
//   * swaps both employees already agreed to (nothing changes in the schedule
//     until the manager approves it here),
// then, for information, swaps still waiting on an employee, the availability the
// team submitted, and a short history of what was decided.
export default function RequestsPanel() {
  const { db, dispatch, weekStart } = useShifts()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<(ConfirmRequest & { onYes: () => void }) | null>(null)
  const [prompt, setPrompt] = useState<(PromptRequest & { kind: 'request' | 'swap'; id: string }) | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  const model = useMemo(() => {
    if (!db) return null
    const pendingRequests = db.requests.filter((r) => r.status === 'pending').sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const awaitingMe = db.swaps.filter((s) => s.status === 'peer_accepted').sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const awaitingPeer = db.swaps.filter((s) => s.status === 'open')
    const history = [
      ...db.requests.filter((r) => r.status !== 'pending').map((r) => ({ kind: 'request' as const, at: r.decidedAt ?? r.createdAt, r })),
      ...db.swaps.filter((s) => s.status !== 'open' && s.status !== 'peer_accepted').map((s) => ({ kind: 'swap' as const, at: s.decidedAt ?? s.createdAt, s })),
    ]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 25)
    return { pendingRequests, awaitingMe, awaitingPeer, history }
  }, [db])

  if (!db || !model) return null
  const evalInput = { weekStart, settings: db.settings, roster: db.roster, shifts: db.shifts, assignments: db.assignments, availability: db.availability }
  const byShift = indexByShift(db.assignments)
  const submittedAvailability = db.availability.filter((a) => a.status === 'submitted' && a.weekStart === weekStart)
  const nothing = model.pendingRequests.length === 0 && model.awaitingMe.length === 0

  async function decideRequest(r: ShiftRequest, approve: boolean, note: string | null, force = false) {
    setBusyId(r.id)
    const name = nameOf(db!, r.staffId, r.staffName)
    const res = await dispatch(
      { type: 'decideRequest', requestId: r.id, approve, note, force },
      { quiet: true, success: approve ? `אושר: ${name} שובצ/ה למשמרת, וקיבל/ה הודעה` : `הבקשה של ${name} נדחתה, והוא/היא קיבל/ה הודעה` }
    )
    setBusyId(null)
    if (res.ok) return
    if (res.reason === 'needs_confirmation') {
      const issues = issuesOf(res.details)
      setConfirm({
        title: 'כדאי לבדוק לפני האישור',
        body: `${issues.map((i) => `• ${i.message}`).join('\n')}\n\nלאשר בכל זאת?`,
        confirmLabel: 'אישור בכל זאת',
        cancelLabel: 'חזרה',
        onYes: () => void decideRequest(r, true, note, true),
      })
      return
    }
    // A refusal that cannot be forced (double-booked, shift gone…) — say exactly why.
    setConfirm({ title: 'אי אפשר לאשר את הבקשה', body: res.message, confirmLabel: 'הבנתי', cancelLabel: 'סגירה', onYes: () => undefined })
  }

  async function decideSwap(s: SwapRequest, approve: boolean, note: string | null) {
    setBusyId(s.id)
    const res = await dispatch(
      { type: 'decideSwap', swapId: s.id, approve, note },
      {
        quiet: true,
        success: approve ? 'ההחלפה אושרה והלוח עודכן. שני העובדים קיבלו הודעה' : 'ההחלפה נדחתה, והלוח לא השתנה. שני העובדים קיבלו הודעה',
      }
    )
    setBusyId(null)
    if (!res.ok) setConfirm({ title: 'אי אפשר לאשר את ההחלפה', body: res.message, confirmLabel: 'הבנתי', cancelLabel: 'סגירה', onYes: () => undefined })
  }

  async function cancelSwap(s: SwapRequest) {
    setBusyId(s.id)
    await dispatch({ type: 'cancelSwap', swapId: s.id }, { success: 'בקשת ההחלפה בוטלה' })
    setBusyId(null)
  }

  return (
    <div className="sch-wrap" style={{ gap: 22 }}>
      {nothing && <EmptyState icon={<Inbox size={30} aria-hidden="true" />} title="אין כרגע בקשות שמחכות לך" hint="כשעובד/ת יבקשו להצטרף למשמרת או יסכימו להחלפה, זה יופיע כאן וגם בעדכונים (הפעמון)." />}

      {/* ---------------------------------------------------------------- waiting on the manager */}
      {(model.pendingRequests.length > 0 || model.awaitingMe.length > 0) && (
        <section className="sch-wrap" aria-label="ממתינות לאישור שלך">
          <h3 className="sch-h">מחכות לאישור שלך ({model.pendingRequests.length + model.awaitingMe.length})</h3>

          {model.awaitingMe.map((s) => {
            const from = s.terms.from
            const to = s.terms.to
            const a = s.assignmentId ? db.assignments.find((x) => x.id === s.assignmentId) : undefined
            const changed = !a || a.staffId !== s.fromStaffId
            const impact = swapImpact(evalInput, { assignmentId: s.assignmentId, returnAssignmentId: s.returnAssignmentId, fromStaffId: s.fromStaffId, toStaffId: s.toStaffId })
            const fromName = nameOf(db, s.fromStaffId, s.fromStaffName)
            const toName = nameOf(db, s.toStaffId, s.toStaffName)
            return (
              <article key={s.id} className="sch-card sch-card--attention" aria-label={`בקשת החלפה בין ${fromName} ל${toName}`}>
                <div className="sch-row" style={{ flexWrap: 'wrap' }}>
                  <Pill tone="swap" icon={<ArrowLeftRight size={13} aria-hidden="true" />}>
                    בקשת החלפה
                  </Pill>
                  <SwapStatusPill status="peer_accepted" />
                  <span className="sch-faint" style={{ fontSize: '0.76rem', marginInlineStart: 'auto' }}>
                    {timeAgoHe(s.createdAt)}
                  </span>
                </div>
                <div className="sch-row">
                  <Avatar name={fromName} large />
                  <ArrowLeftRight size={18} aria-hidden="true" color="var(--text-faint)" />
                  <Avatar name={toName} large />
                  <strong style={{ flex: 1, minWidth: 0 }}>
                    {fromName} ↔ {toName}
                  </strong>
                </div>
                <SwapTerms fromName={fromName} toName={toName} from={from} to={to} />
                {s.reason && <p className="sch-sub">סיבה: ״{s.reason}״</p>}
                {changed && <Notice tone="warn">השיבוץ המקורי השתנה מאז הבקשה, ולכן אי אפשר לאשר אותה. אפשר לדחות אותה.</Notice>}
                {impact.length > 0 && (
                  <Notice tone="warn">
                    אחרי ההחלפה: {impact.map((w) => `${w.message}${w.staffId ? ` (${nameOf(db, w.staffId)})` : ''}`).join(' · ')}. אפשר לאשר בכל זאת.
                  </Notice>
                )}
                <p className="sch-sub">הלוח ישתנה רק אחרי שתאשרו. עד אז כל אחד נשאר במשמרת שלו.</p>
                <div className="sch-row">
                  <button type="button" className="sch-btn sch-btn--ok press" style={{ flex: 2 }} disabled={busyId === s.id || changed} onClick={() => decideSwap(s, true, null)}>
                    <Check size={18} aria-hidden="true" /> אישור ההחלפה
                  </button>
                  <button
                    type="button"
                    className="sch-btn sch-btn--danger press"
                    style={{ flex: 1 }}
                    disabled={busyId === s.id}
                    onClick={() => setPrompt({ kind: 'swap', id: s.id, title: 'לדחות את ההחלפה?', label: 'סיבה (אפשר להשאיר ריק)', submitLabel: 'דחיית ההחלפה', allowEmpty: true })}
                  >
                    <X size={18} aria-hidden="true" /> דחייה
                  </button>
                </div>
              </article>
            )
          })}

          {model.pendingRequests.map((r) => {
            const shift = r.shiftId ? db.shifts.find((s) => s.id === r.shiftId) : undefined
            const on = shift ? (byShift.get(shift.id) ?? []) : []
            const cov = shift ? coverageOf(shift, on) : null
            const impact = requestImpact(evalInput, { shiftId: r.shiftId, staffId: r.staffId })
            const name = nameOf(db, r.staffId, r.staffName)
            const label = shift ? formatShiftLabel(shift.date, shift.startTime, shift.endTime) : requestLabel(r.terms)
            const changed = !!shift && (r.terms.start !== shift.startTime || r.terms.end !== shift.endTime || r.terms.date !== shift.date)
            return (
              <article key={r.id} className="sch-card sch-card--attention" aria-label={`בקשה של ${name} להצטרף למשמרת`}>
                <div className="sch-row" style={{ flexWrap: 'wrap' }}>
                  <Pill tone="info" icon={<UserPlus size={13} aria-hidden="true" />}>
                    בקשה להצטרף למשמרת
                  </Pill>
                  <RequestStatusPill status="pending" />
                  <span className="sch-faint" style={{ fontSize: '0.76rem', marginInlineStart: 'auto' }}>
                    {timeAgoHe(r.createdAt)}
                  </span>
                </div>
                <div className="sch-row">
                  <Avatar name={name} large />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong>{name}</strong> מבקש/ת לעבוד ב:
                    <div style={{ fontWeight: 800, fontSize: '1.02rem', marginTop: 2 }}>{label}</div>
                  </div>
                </div>
                {r.note && <p className="sch-sub">״{r.note}״</p>}
                <div className="sch-wrapflex">
                  {on.length === 0 ? (
                    <Pill tone="warn">עוד אף אחד לא משובץ במשמרת</Pill>
                  ) : (
                    on.map((a) => <Person key={a.id} name={nameOf(db, a.staffId, a.staffName)} />)
                  )}
                  {cov?.state === 'partial' && <Pill tone="warn">חסרים עוד {cov.missing}</Pill>}
                  {cov?.state === 'full' && <Pill tone="ok">כבר מאוישת ({cov.assigned}/{cov.needed})</Pill>}
                </div>
                {changed && <Notice tone="info">המשמרת השתנתה מאז שנשלחה הבקשה (בבקשה: {requestLabel(r.terms)}).</Notice>}
                {impact.length > 0 && (
                  <Notice tone="warn">
                    אחרי האישור: {impact.map((w) => w.message).join(' · ')}.
                  </Notice>
                )}
                <div className="sch-row">
                  <button type="button" className="sch-btn sch-btn--ok press" style={{ flex: 2 }} disabled={busyId === r.id} onClick={() => decideRequest(r, true, null)}>
                    <Check size={18} aria-hidden="true" /> אישור ושיבוץ
                  </button>
                  <button
                    type="button"
                    className="sch-btn sch-btn--danger press"
                    style={{ flex: 1 }}
                    disabled={busyId === r.id}
                    onClick={() => setPrompt({ kind: 'request', id: r.id, title: `לדחות את הבקשה של ${name}?`, label: 'סיבה (אפשר להשאיר ריק)', submitLabel: 'דחיית הבקשה', allowEmpty: true })}
                  >
                    <X size={18} aria-hidden="true" /> דחייה
                  </button>
                </div>
              </article>
            )
          })}
        </section>
      )}

      {/* ---------------------------------------------------------------- waiting on an employee */}
      {model.awaitingPeer.length > 0 && (
        <section className="sch-wrap" aria-label="מחכות לתשובה של עובד/ת">
          <h3 className="sch-h">מחכות לתשובה של עובד/ת ({model.awaitingPeer.length})</h3>
          <p className="sch-sub">אין מה לעשות כאן עדיין — ההחלפה תגיע אליכם אחרי שעובד/ת יסכימו לה.</p>
          {model.awaitingPeer.map((s) => (
            <div key={s.id} className="sch-card">
              <div className="sch-row" style={{ flexWrap: 'wrap' }}>
                <SwapStatusPill status="open" />
                <strong style={{ flex: 1, minWidth: 0 }}>
                  {nameOf(db, s.fromStaffId, s.fromStaffName)} {s.toStaffId ? `← ${nameOf(db, s.toStaffId, s.toStaffName)}` : '← פתוח לכולם'}
                </strong>
              </div>
              <p className="sch-sub">{sideLabel(s.terms.from)}</p>
              <button type="button" className="sch-btn sch-btn--sm sch-btn--danger press" disabled={busyId === s.id} onClick={() => cancelSwap(s)} style={{ alignSelf: 'flex-start' }}>
                ביטול הבקשה
              </button>
            </div>
          ))}
        </section>
      )}

      {/* ---------------------------------------------------------------- availability */}
      <section className="sch-wrap" aria-label="זמינות שהוגשה">
        <h3 className="sch-h">זמינות שהוגשה לשבוע {formatDateLabel(weekStart)}</h3>
        {!db.settings.features.availability ? (
          <p className="sch-sub">הגשת זמינות כבויה בהגדרות.</p>
        ) : submittedAvailability.length === 0 ? (
          <p className="sch-sub">עוד לא הוגשה זמינות לשבוע הזה.</p>
        ) : (
          submittedAvailability.map((a) => (
            <div key={a.id} className="sch-card">
              <strong>{nameOf(db, a.staffId)}</strong>
              <div className="sch-wrapflex">
                {a.entries.map((e, i) => (
                  <Pill key={i} tone={e.kind === 'unavailable' ? 'warn' : e.kind === 'prefer' ? 'ok' : 'neutral'}>
                    {weekdayLabel(parseISODate(e.date).getUTCDay())} {formatDateLabel(e.date)} ·{' '}
                    {e.kind === 'unavailable' ? 'לא זמין/ה' : e.kind === 'partial' ? `חלקי ${e.from ?? ''}–${e.to ?? ''}` : 'מעדיף/ה'}
                  </Pill>
                ))}
                {a.entries.length === 0 && <span className="sch-sub">אין הגבלות — זמין/ה כל השבוע</span>}
              </div>
              {a.note && <p className="sch-sub">״{a.note}״</p>}
            </div>
          ))
        )}
      </section>

      {/* ---------------------------------------------------------------- history */}
      {model.history.length > 0 && (
        <section className="sch-wrap" aria-label="היסטוריה">
          <button type="button" className="sch-btn sch-btn--ghost sch-btn--sm press" aria-expanded={historyOpen} onClick={() => setHistoryOpen((o) => !o)} style={{ justifyContent: 'space-between' }}>
            <span>מה כבר טופל ({model.history.length})</span>
            <ChevronDown size={16} aria-hidden="true" style={{ transform: historyOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s var(--ease)' }} />
          </button>
          {historyOpen &&
            model.history.map((h) =>
              h.kind === 'request' ? (
                <div key={`r${h.r.id}`} className="sch-card" style={{ gap: 6 }}>
                  <div className="sch-row" style={{ flexWrap: 'wrap' }}>
                    <RequestStatusPill status={h.r.status} />
                    <strong style={{ flex: 1, minWidth: 0 }}>{nameOf(db, h.r.staffId, h.r.staffName)} · הצטרפות למשמרת</strong>
                  </div>
                  <p className="sch-sub">{requestLabel(h.r.terms)}</p>
                  {(h.r.decisionNote || h.r.cancelReason) && <p className="sch-sub">{h.r.decisionNote ?? h.r.cancelReason}</p>}
                </div>
              ) : (
                <div key={`s${h.s.id}`} className="sch-card" style={{ gap: 6 }}>
                  <div className="sch-row" style={{ flexWrap: 'wrap' }}>
                    <SwapStatusPill status={h.s.status} />
                    <strong style={{ flex: 1, minWidth: 0 }}>
                      {nameOf(db, h.s.fromStaffId, h.s.fromStaffName)} ↔ {h.s.toStaffId || h.s.toStaffName ? nameOf(db, h.s.toStaffId, h.s.toStaffName) : 'ללא'}
                    </strong>
                  </div>
                  <p className="sch-sub">{sideLabel(h.s.terms.from)}</p>
                  {(h.s.decisionNote || h.s.cancelReason) && <p className="sch-sub">{h.s.decisionNote ?? h.s.cancelReason}</p>}
                </div>
              )
            )}
        </section>
      )}

      <PromptSheet
        request={prompt}
        onCancel={() => setPrompt(null)}
        onSubmit={(value) => {
          const p = prompt
          setPrompt(null)
          if (!p) return
          if (p.kind === 'request') {
            const r = db.requests.find((x) => x.id === p.id)
            if (r) void decideRequest(r, false, value || null)
          } else {
            const s = db.swaps.find((x) => x.id === p.id)
            if (s) void decideSwap(s, false, value || null)
          }
        }}
      />
      <ConfirmSheet
        request={confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm
          setConfirm(null)
          c?.onYes()
        }}
      />
    </div>
  )
}

/** The two shifts of a swap, side by side, in words a manager can verify at a glance. */
function SwapTerms({ fromName, toName, from, to }: { fromName: string; toName: string; from?: SwapSide; to?: SwapSide | null }) {
  const label = sideLabel
  return (
    <div className="sch-card" style={{ background: 'var(--bg-elev-2)', gap: 8 }}>
      <div>
        <div className="sch-faint" style={{ fontSize: '0.76rem', fontWeight: 700 }}>
          {fromName} עובד/ת עכשיו ב:
        </div>
        <div style={{ fontWeight: 800 }}>{label(from)}</div>
        <div className="sch-sub">← {toName} יעבוד/תעבוד בה במקומו/ה</div>
      </div>
      {to ? (
        <div>
          <div className="sch-faint" style={{ fontSize: '0.76rem', fontWeight: 700 }}>
            {toName} עובד/ת עכשיו ב:
          </div>
          <div style={{ fontWeight: 800 }}>{label(to)}</div>
          <div className="sch-sub">← {fromName} יעבוד/תעבוד בה במקומו/ה</div>
        </div>
      ) : (
        <div className="sch-sub">{toName} לוקח/ת את המשמרת, ו{fromName} לא מקבל/ת משמרת בתמורה.</div>
      )}
    </div>
  )
}
