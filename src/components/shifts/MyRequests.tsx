'use client'

import { useState } from 'react'
import { ArrowLeftRight, Check, Inbox, X } from 'lucide-react'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { Avatar, EmptyState, Notice, Pill, RequestStatusPill, SwapStatusPill } from '@/components/shifts/ui'
import { clashesFor, employeeInbox, isActiveSwap, nameOf, requestLabel, sideLabel } from '@/lib/shifts/view'
import { formatShiftLabel, timeAgoHe, weekStartOf } from '@/lib/shifts/time'
import type { ShiftRequest, SwapRequest, SwapSide } from '@/lib/shifts/types'

// Everything that involves THIS employee besides the schedule itself, in the
// order they should care about it:
//   1. colleagues waiting for MY answer (swap proposals aimed at me)
//   2. open offers anyone may take
//   3. what I asked for, with its status and the outcome — pending / approved /
//      rejected / cancelled — each in plain words, never a code.
export default function MyRequests() {
  const { db, dispatch } = useShifts()
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<(ConfirmRequest & { onYes: () => void }) | null>(null)
  if (!db) return null

  const me = db.viewerStaffId
  const inbox = employeeInbox(db)
  const openOffers = db.swaps.filter((s) => s.status === 'open' && s.toStaffId === null && s.fromStaffId !== me)
  const myRequests = db.requests.filter((r) => r.staffId === me)
  const mySwaps = db.swaps.filter((s) => s.fromStaffId === me || (s.toStaffId === me && s.status !== 'open'))

  const active = [
    ...myRequests.filter((r) => r.status === 'pending').map((r) => ({ kind: 'request' as const, at: r.createdAt, r })),
    ...mySwaps.filter(isActiveSwap).map((s) => ({ kind: 'swap' as const, at: s.createdAt, s })),
  ].sort((a, b) => b.at.localeCompare(a.at))
  const done = [
    ...myRequests.filter((r) => r.status !== 'pending').map((r) => ({ kind: 'request' as const, at: r.decidedAt ?? r.createdAt, r })),
    ...mySwaps.filter((s) => !isActiveSwap(s)).map((s) => ({ kind: 'swap' as const, at: s.decidedAt ?? s.createdAt, s })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 12)

  async function respond(s: SwapRequest, accept: boolean) {
    setBusy(s.id)
    const from = nameOf(db!, s.fromStaffId, s.fromStaffName)
    const res = await dispatch(
      { type: 'respondSwap', swapId: s.id, accept },
      { quiet: true, success: accept ? 'הסכמתם ✓ הבקשה עברה למנהל/ת. הלוח ישתנה רק אחרי שיאשרו.' : `סירבתם. ${from} קיבל/ה הודעה.` }
    )
    setBusy(null)
    if (!res.ok) setConfirm({ title: 'לא הצלחנו', body: res.message, confirmLabel: 'הבנתי', cancelLabel: 'סגירה', onYes: () => undefined })
  }

  async function cancelRequest(r: ShiftRequest) {
    setBusy(r.id)
    await dispatch({ type: 'cancelRequest', requestId: r.id }, { success: 'הבקשה בוטלה' })
    setBusy(null)
  }
  async function cancelSwap(s: SwapRequest) {
    setBusy(s.id)
    await dispatch({ type: 'cancelSwap', swapId: s.id }, { success: 'בקשת ההחלפה בוטלה — המשמרת נשארה שלכם' })
    setBusy(null)
  }

  const clashOf = (side?: SwapSide) =>
    side && me ? clashesFor(me, { date: side.date, startTime: side.start, endTime: side.end }, weekStartOf(side.date), db.shifts, db.assignments)[0] : undefined

  const nothing = inbox.count === 0 && openOffers.length === 0 && active.length === 0 && done.length === 0

  return (
    <div className="sch-wrap" style={{ gap: 22 }}>
      {nothing && (
        <EmptyState
          icon={<Inbox size={30} aria-hidden="true" />}
          title="אין עדיין בקשות"
          hint='כדי לבקש להצטרף למשמרת — פתחו אותה בלוח (תחת "כולם"). כדי להחליף משמרת שלכם — פתחו אותה ולחצו "בקשת החלפה".'
        />
      )}

      {inbox.proposals.length > 0 && (
        <section className="sch-wrap" aria-label="מחכים לתשובה שלכם">
          <h3 className="sch-h">מחכים לתשובה שלכם ({inbox.proposals.length})</h3>
          {inbox.proposals.map((s) => {
            const from = s.terms.from
            const to = s.terms.to
            const fromName = nameOf(db, s.fromStaffId, s.fromStaffName)
            const clash = clashOf(from)
            return (
              <article key={s.id} className="sch-card sch-card--attention">
                <div className="sch-row">
                  <Avatar name={fromName} large />
                  <strong style={{ flex: 1 }}>{fromName} מבקש/ת להחליף איתכם</strong>
                </div>
                <div className="sch-card" style={{ background: 'var(--bg-elev-2)', gap: 6 }}>
                  <div>
                    <span className="sch-faint" style={{ fontSize: '0.76rem', fontWeight: 700 }}>
                      {fromName} נותן/ת לכם:
                    </span>
                    <div style={{ fontWeight: 800 }}>{sideLabel(from)}</div>
                  </div>
                  <div>
                    <span className="sch-faint" style={{ fontSize: '0.76rem', fontWeight: 700 }}>
                      ובתמורה:
                    </span>
                    <div style={{ fontWeight: 800 }}>{to ? `אתם נותנים ל${fromName}: ${sideLabel(to)}` : 'כלום — רק מעבירים לכם את המשמרת'}</div>
                  </div>
                </div>
                {s.reason && <p className="sch-sub">״{s.reason}״</p>}
                {clash && !to && <Notice tone="warn">אתם כבר עובדים בשעות האלה ({formatShiftLabel(clash.date, clash.startTime, clash.endTime)}).</Notice>}
                <p className="sch-sub">אחרי שתסכימו — המנהל/ת צריכים לאשר. עד אז כל אחד נשאר במשמרת שלו.</p>
                <div className="sch-row">
                  <button type="button" className="sch-btn sch-btn--ok press" style={{ flex: 2 }} disabled={busy === s.id} onClick={() => respond(s, true)}>
                    <Check size={18} aria-hidden="true" /> אני מסכים/ה
                  </button>
                  <button type="button" className="sch-btn sch-btn--danger press" style={{ flex: 1 }} disabled={busy === s.id} onClick={() => respond(s, false)}>
                    <X size={18} aria-hidden="true" /> לא יכול/ה
                  </button>
                </div>
              </article>
            )
          })}
        </section>
      )}

      {openOffers.length > 0 && db.settings.features.swaps && (
        <section className="sch-wrap" aria-label="משמרות שמחפשים להן מחליף">
          <h3 className="sch-h">משמרות שמחפשים להן מחליף/ה ({openOffers.length})</h3>
          <p className="sch-sub">עמיתים שלא יכולים להגיע. אם אתם יכולים לקחת — לחצו, ואז המנהל/ת יחליטו.</p>
          {openOffers.map((s) => {
            const clash = clashOf(s.terms.from)
            return (
              <article key={s.id} className="sch-card">
                <div className="sch-row">
                  <Avatar name={nameOf(db, s.fromStaffId, s.fromStaffName)} />
                  <strong style={{ flex: 1 }}>{nameOf(db, s.fromStaffId, s.fromStaffName)}</strong>
                  <Pill tone="info" icon={<ArrowLeftRight size={13} aria-hidden="true" />}>
                    פתוח לכולם
                  </Pill>
                </div>
                <div style={{ fontWeight: 800 }}>{sideLabel(s.terms.from)}</div>
                {s.reason && <p className="sch-sub">״{s.reason}״</p>}
                {clash ? (
                  <Notice tone="warn">חופפת למשמרת שלכם ({formatShiftLabel(clash.date, clash.startTime, clash.endTime)}).</Notice>
                ) : (
                  <button type="button" className="sch-btn sch-btn--primary press" disabled={busy === s.id} onClick={() => respond(s, true)}>
                    אני אקח את המשמרת
                  </button>
                )}
              </article>
            )
          })}
        </section>
      )}

      {active.length > 0 && (
        <section className="sch-wrap" aria-label="הבקשות שלי">
          <h3 className="sch-h">הבקשות הפתוחות שלי ({active.length})</h3>
          {active.map((x) => (x.kind === 'request' ? <RequestRow key={x.r.id} r={x.r} busy={busy === x.r.id} onCancel={() => cancelRequest(x.r)} /> : <SwapRow key={x.s.id} s={x.s} busy={busy === x.s.id} onCancel={() => cancelSwap(x.s)} />))}
        </section>
      )}

      {done.length > 0 && (
        <section className="sch-wrap" aria-label="מה שכבר טופל">
          <h3 className="sch-h">מה שכבר טופל</h3>
          {done.map((x) => (x.kind === 'request' ? <RequestRow key={x.r.id} r={x.r} /> : <SwapRow key={x.s.id} s={x.s} />))}
        </section>
      )}

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

function RequestRow({ r, busy, onCancel }: { r: ShiftRequest; busy?: boolean; onCancel?: () => void }) {
  const text: Record<ShiftRequest['status'], string> = {
    pending: 'מחכה לאישור המנהל/ת. תקבלו הודעה כשיענו.',
    approved: 'אושרה. נוספתם לשיבוץ; הלוח הסופי יוצג לאחר פרסום המנהל/ת.',
    rejected: 'לא אושרה.',
    cancelled: 'בוטלה.',
  }
  return (
    <article className="sch-card">
      <div className="sch-row" style={{ flexWrap: 'wrap' }}>
        <RequestStatusPill status={r.status} />
        <span className="sch-faint" style={{ fontSize: '0.76rem', marginInlineStart: 'auto' }}>
          {timeAgoHe(r.decidedAt ?? r.createdAt)}
        </span>
      </div>
      <div style={{ fontWeight: 800 }}>{requestLabel(r.terms)}</div>
      <p className="sch-sub">בקשה להצטרף למשמרת · {text[r.status]}</p>
      {r.note && <p className="sch-sub">ההערה שלכם: ״{r.note}״</p>}
      {r.decisionNote && <p className="sch-sub">תשובת המנהל/ת: ״{r.decisionNote}״</p>}
      {r.cancelReason && r.status === 'cancelled' && <p className="sch-sub">{r.cancelReason}</p>}
      {onCancel && (
        <button type="button" className="sch-btn sch-btn--sm sch-btn--danger press" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={onCancel}>
          ביטול הבקשה
        </button>
      )}
    </article>
  )
}

function SwapRow({ s, busy, onCancel }: { s: SwapRequest; busy?: boolean; onCancel?: () => void }) {
  const { db } = useShifts()
  if (!db) return null
  const me = db.viewerStaffId
  const iAmRequester = s.fromStaffId === me
  const other = iAmRequester ? (s.toStaffId ? nameOf(db, s.toStaffId, s.toStaffName) : null) : nameOf(db, s.fromStaffId, s.fromStaffName)
  const text: Record<SwapRequest['status'], string> = {
    open: other ? `מחכים לתשובה מ${other}.` : 'פתוח לכולם — מחכים שמישהו יתנדב.',
    peer_accepted: `${other ?? 'עמית/ה'} הסכים/ה. מחכים לאישור המנהל/ת.`,
    approved: iAmRequester ? `אושרה ✓ המשמרת עברה ל${other}.` : 'אושרה ✓ הלוח עודכן.',
    rejected: 'המנהל/ת לא אישרו. הלוח לא השתנה.',
    declined: `${other ?? 'העמית/ה'} לא יכול/ה להחליף.`,
    cancelled: 'בוטלה.',
  }
  return (
    <article className="sch-card">
      <div className="sch-row" style={{ flexWrap: 'wrap' }}>
        <SwapStatusPill status={s.status} />
        <span className="sch-faint" style={{ fontSize: '0.76rem', marginInlineStart: 'auto' }}>
          {timeAgoHe(s.decidedAt ?? s.createdAt)}
        </span>
      </div>
      <div style={{ fontWeight: 800 }}>{sideLabel(s.terms.from)}</div>
      {s.terms.to && <div className="sch-sub">בתמורה: {sideLabel(s.terms.to)}</div>}
      <p className="sch-sub">החלפת משמרת · {text[s.status]}</p>
      {s.reason && <p className="sch-sub">ההערה: ״{s.reason}״</p>}
      {s.decisionNote && <p className="sch-sub">תשובת המנהל/ת: ״{s.decisionNote}״</p>}
      {s.cancelReason && s.status === 'cancelled' && <p className="sch-sub">{s.cancelReason}</p>}
      {onCancel && iAmRequester && (
        <button type="button" className="sch-btn sch-btn--sm sch-btn--danger press" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={onCancel}>
          ביטול הבקשה
        </button>
      )}
    </article>
  )
}
