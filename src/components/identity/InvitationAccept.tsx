'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from 'glisse'
import { Building2, Check, CircleAlert, MailQuestion, RefreshCw, ShieldCheck, Users } from 'lucide-react'
import { isInvitationToken } from '@/lib/identity/invitations'
import { glassToast } from '@/components/glass/toast'
import { identityApi, refusalText, when } from './api'
import BenefitsSignIn from './BenefitsSignIn'

// /benefits/invite (FABLE-002): accepting a department-head invitation.
//   1. The link carries its token in the URL FRAGMENT (never sent to a server, never in a log or a Referer). The first thing this
//      page does is take it out of the address bar and trade it for an HttpOnly cookie; the token is in no script-readable place
//      after that (not in state, not in storage).
//   2. Nothing about the invitation is shown before a verified Google sign-in.
//   3. Only the intended recipient (the verified Google address, never one that was typed) sees what it is for and can accept, once.
// Every other case gets one sentence that says nothing about why.

/** An icon beside its words, on one line. */
const ICON_ROW = { display: 'flex', alignItems: 'center', gap: 6 } as const
type Status =
  | { state: 'none' | 'unverified' | 'unavailable' }
  | { state: 'ready'; organizationName: string; departmentName: string; expiresAt: string }
type View = { kind: 'working' } | { kind: 'sign-in' } | { kind: 'status'; status: Status } | { kind: 'accepted' } | { kind: 'problem'; text: string }

export default function InvitationAccept() {
  const [view, setView] = useState<View>({ kind: 'working' })
  const [busy, setBusy] = useState(false)
  const started = useRef(false)

  const check = useCallback(async () => {
    const result = await identityApi<Status>('/api/benefits/invite/status')
    if (result.ok) setView({ kind: 'status', status: result.data })
    else if (result.status === 401) setView({ kind: 'sign-in' })
    else setView({ kind: 'problem', text: result.status === 403 ? 'כדי לאשר הזמנה צריך להתחבר התחברות מלאה עם Google.' : refusalText(result) })
  }, [])

  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      const token = window.location.hash.slice(1)
      // out of the address bar (and of the history entry) before anything else happens, whatever it was
      if (window.location.hash) window.history.replaceState(null, '', window.location.pathname)
      if (isInvitationToken(token)) {
        const traded = await identityApi<{ ok: true }>('/api/benefits/invite/exchange', { method: 'POST', body: { token } })
        if (!traded.ok) { setView({ kind: 'problem', text: traded.status === 429 ? refusalText(traded) : 'לא הצלחנו לפתוח את ההזמנה. פתחו שוב את הקישור שקיבלתם.' }); return }
      }
      await check()
    })()
  }, [check])

  const accept = async () => {
    setBusy(true)
    const result = await identityApi<{ ok: true }>('/api/benefits/invite/accept', { method: 'POST', body: {} })
    setBusy(false)
    if (result.ok) { setView({ kind: 'accepted' }); glassToast('ההזמנה אושרה.', 'ok'); return }
    if (result.status === 403) { setView({ kind: 'status', status: { state: 'unavailable' } }); return }
    glassToast(refusalText(result), 'bad')
  }
  const decline = async () => {
    setBusy(true)
    await identityApi('/api/benefits/invite/exchange', { method: 'DELETE' })
    setBusy(false)
    setView({ kind: 'status', status: { state: 'none' } })
  }

  if (view.kind === 'working') {
    return (
      <div className="gl-surf gl-card gl-sk-card" aria-busy="true" data-identity="invite-working">
        <p className="sr-only" role="status">פותח את ההזמנה…</p>
        <span className="sk gl-sk-line gl-sk-line--title" /><span className="sk gl-sk-line" /><span className="sk gl-sk-line gl-sk-line--short" />
      </div>
    )
  }
  if (view.kind === 'problem') {
    return (
      <section className="gl-surf gl-surf--bad gl-card" role="alert" data-identity="invite-problem">
        <p className="gl-note gl-note--bad"><CircleAlert size={18} aria-hidden="true" />{view.text}</p>
        <div className="gl-card__actions"><Button icon={<RefreshCw size={16} />} onClick={() => { setView({ kind: 'working' }); void check() }}>לנסות שוב</Button></div>
      </section>
    )
  }
  if (view.kind === 'sign-in') {
    return (
      <section className="gl-surf gl-card" data-identity="invite-sign-in">
        <h2 className="gl-card__title"><ShieldCheck size={18} aria-hidden="true" />קיבלתם הזמנה</h2>
        <p className="gl-note">כדי לראות את ההזמנה ולאשר אותה, התחברו עם חשבון ה־Google שאליו היא נשלחה. הזמנה פועלת רק לכתובת שאליה נועדה, פעם אחת.</p>
        <BenefitsSignIn returnTo="/benefits/invite" />
      </section>
    )
  }
  if (view.kind === 'accepted') {
    return (
      <section className="gl-surf gl-surf--ok gl-card" role="status" data-identity="invite-accepted">
        <h2 className="gl-card__title"><Check size={18} aria-hidden="true" />ההזמנה אושרה</h2>
        <p className="gl-note">מעכשיו אתם ראש המחלקה. ההרשאה חלה על המחלקה הזו בלבד.</p>
        <div className="gl-card__actions"><Button variant="filled" onClick={() => window.location.assign('/benefits/manage')}>למחלקה שלי</Button></div>
      </section>
    )
  }

  const status = view.status
  if (status.state === 'ready') {
    return (
      <section className="gl-surf gl-card" data-identity="invite-ready">
        <h2 className="gl-card__title"><ShieldCheck size={18} aria-hidden="true" />הזמנה לנהל מחלקה</h2>
        <p className="gl-note" style={ICON_ROW}><Building2 size={15} aria-hidden="true" /><span>הארגון: <strong>{status.organizationName}</strong></span></p>
        <p className="gl-note" style={ICON_ROW}><Users size={15} aria-hidden="true" /><span>המחלקה: <strong>{status.departmentName}</strong></span></p>
        <p className="gl-note">באישור תהפכו לראש המחלקה הזו בלבד. ההזמנה בתוקף עד <bdi dir="ltr">{when(status.expiresAt)}</bdi> ואפשר לאשר אותה פעם אחת.</p>
        <div className="gl-card__actions">
          <Button variant="filled" icon={<Check size={16} />} disabled={busy} onClick={() => void accept()} data-identity="invite-accept">{busy ? 'מאשרים…' : 'אישור ההזמנה'}</Button>
          <Button disabled={busy} onClick={() => void decline()}>לא עכשיו</Button>
        </div>
      </section>
    )
  }
  if (status.state === 'unverified') {
    return (
      <section className="gl-surf gl-surf--bad gl-card" role="alert" data-identity="invite-unverified">
        <p className="gl-note gl-note--bad"><CircleAlert size={18} aria-hidden="true" />לחשבון הזה אין כתובת שאומתה על ידי Google, ולכן אי אפשר לאשר איתו הזמנה.</p>
      </section>
    )
  }
  return (
    <section className="gl-surf gl-card" data-identity={status.state === 'none' ? 'invite-none' : 'invite-unavailable'}>
      <h2 className="gl-card__title"><MailQuestion size={18} aria-hidden="true" />{status.state === 'none' ? 'אין כאן הזמנה פתוחה' : 'ההזמנה אינה זמינה לחשבון הזה'}</h2>
      <p className="gl-note">{status.state === 'none'
        ? 'כדי לאשר הזמנה, פתחו את הקישור המלא שקיבלתם.'
        : 'ייתכן שפג תוקפה, שכבר נעשה בה שימוש, שבוטלה, או שנועדה לכתובת Google אחרת. בקשו ממי שהזמין אתכם קישור חדש.'}</p>
      <div className="gl-card__actions"><Button onClick={() => window.location.assign('/benefits/manage')}>לעמוד הניהול</Button></div>
    </section>
  )
}
