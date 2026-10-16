'use client'

import { useEffect, useState } from 'react'
import { Check, Copy, Link2, MessageSquare, RefreshCw, Share2, X } from 'lucide-react'
import { InlineError } from '@/components/shifts/ui'
import { messageOf } from '@/components/staff/types'
import { expiryLabel, shareLinks, shareText } from '@/lib/staff/onboarding-wizard'
import { haptic } from '@/lib/haptics'

export type GeneratedInvitation = { url: string; expiresAt: string }

export function InvitationLink({ invitation, firstName = null }: { invitation: GeneratedInvitation; firstName?: string | null }) {
  const [copied, setCopied] = useState<false | 'link' | 'message'>(false)
  const [error, setError] = useState<string | null>(null)
  const [canShare, setCanShare] = useState(false)
  useEffect(() => { setCopied(false); setError(null) }, [invitation.url])
  useEffect(() => { setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function') }, [])
  const text = shareText(firstName, invitation.url)
  const links = shareLinks(text)
  return <div className="sch-block" style={{ gap: 12 }}>
    <p className="sch-sub" style={{ color: 'var(--text)', margin: 0 }}>שלחו את הקישור{firstName ? ` ל${firstName}` : ' לעובד/ת'}. בלחיצה עליו בוחרים קוד אישי, מקשרים חשבון Google (אפשר גם אחר כך) ורואים סיור קצר באפליקציה.</p>
    <label>
      <span className="sch-label">קישור אישי להגדרת החשבון</span>
      <input className="sch-input" dir="ltr" readOnly value={invitation.url} aria-label="קישור הזמנה אישי" onFocus={(event) => event.currentTarget.select()} style={{ fontSize: '.8rem' }} />
    </label>
    {/* The way the link is meant to travel: the phone's own share sheet (WhatsApp and the rest), always offered. On a browser
        without one, the whole message is copied instead, so the button is never a dead end. */}
    <button type="button" className="sch-btn sch-btn--primary press" style={{ minHeight: 52 }} onClick={async () => {
      haptic('select')
      setError(null)
      if (canShare) {
        // `text` already ends with the link: passing the link as well made WhatsApp print it twice.
        try { await navigator.share({ title: 'הצטרפות לצוות Sarcafe', text }) } catch { /* cancelled */ }
        return
      }
      try { await navigator.clipboard.writeText(text); setCopied('message'); setError(null) }
      catch { setError('לא הצלחנו להעתיק. אפשר לבחור ולהעתיק את הקישור מהשדה למעלה.') }
    }}><span aria-hidden="true">{copied === 'message' ? <Check size={18} /> : <Share2 size={18} />}</span>{copied === 'message' ? 'ההודעה הועתקה, אפשר להדביק' : 'שיתוף'}</button>
    <div className="sch-wrapflex">
      <button type="button" className="sch-btn press" style={{ flex: 1 }} onClick={async () => {
        try { await navigator.clipboard.writeText(invitation.url); setCopied('link'); setError(null) }
        catch { setError('לא הצלחנו להעתיק. אפשר לבחור ולהעתיק את הקישור מהשדה למעלה.') }
      }}><span aria-hidden="true">{copied === 'link' ? <Check size={17} /> : <Copy size={17} />}</span>{copied === 'link' ? 'הקישור הועתק' : 'העתקת הקישור'}</button>
      <a className="sch-btn press" href={links.sms} style={{ flex: 1, textDecoration: 'none' }} onClick={() => haptic('select')}><MessageSquare size={17} aria-hidden="true" />שליחה בהודעה</a>
    </div>
    <ul className="sch-sub" style={{ margin: 0, paddingInlineStart: 18, display: 'grid', gap: 4 }}>
      <li>הקישור פעיל עד {expiryLabel(invitation.expiresAt)} ונשרף אחרי שימוש אחד.</li>
      <li>הקישור מוצג רק עכשיו. אם הוא אבד, צרו קישור חדש והקודם יפסיק לעבוד.</li>
      <li>הוא מחבר רק את הכרטיס הזה, ולא נותן הרשאות ניהול.</li>
    </ul>
    {error && <InlineError>{error}</InlineError>}
    <span className="sr-only" role="status">{copied === 'link' ? 'הקישור הועתק' : copied === 'message' ? 'ההודעה הועתקה' : ''}</span>
  </div>
}

type InvitationState = { expires_at: string; consumed_at: string | null; revoked_at: string | null }

export default function StaffInvitation({ staffId, completeProfile }: { staffId: string; completeProfile: boolean }) {
  const [status, setStatus] = useState<InvitationState | null>(null)
  const [generated, setGenerated] = useState<GeneratedInvitation | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let current = true
    setGenerated(null); setError(null); setLoading(true)
    fetch(`/api/owner/staff/${staffId}/invite`, { cache: 'no-store' }).then(async (response) => {
      const payload = await response.json()
      if (!response.ok) throw new Error(messageOf(payload, 'לא הצלחנו לטעון את מצב ההזמנה.'))
      if (current) setStatus(payload.invitation)
    }).catch(() => { if (current) setError('לא הצלחנו לטעון את מצב ההזמנה. ניתן לנסות שוב.') })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [staffId])
  const live = !!status && !status.consumed_at && !status.revoked_at && new Date(status.expires_at).getTime() > Date.now()
  async function change(method: 'POST' | 'DELETE') {
    setBusy(true); setError(null)
    try {
      const response = await fetch(`/api/owner/staff/${staffId}/invite`, { method, headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const payload = await response.json()
      if (!response.ok) throw new Error(messageOf(payload, 'לא הצלחנו לעדכן את הקישור.'))
      if (method === 'POST') {
        setGenerated(payload.invitation)
        setStatus({ expires_at: payload.invitation.expiresAt, consumed_at: null, revoked_at: null })
      } else {
        setGenerated(null); setStatus((previous) => previous ? { ...previous, revoked_at: new Date().toISOString() } : null)
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'בעיית חיבור. נסו שוב.') }
    finally { setBusy(false) }
  }
  return <div className="sch-wrap" style={{ gap: 12 }}>
    <p className="sch-sub" style={{ margin: 0 }}>{loading ? 'טוען מצב הזמנה…' : live ? 'קישור הגדרת חשבון ממתין לעובד/ת.' : status?.consumed_at ? 'העובד/ת כבר הגדיר/ה קוד אישי.' : 'קישור אישי מאפשר לעובד/ת להגדיר את החשבון בעצמו/ה.'}</p>
    {!completeProfile && <p className="sch-sub">כדי ליצור קישור, שמרו קודם שם פרטי, שם משפחה ומספר HYP.</p>}
    {generated && <InvitationLink invitation={generated} />}
    <div className="sch-wrapflex">
      <button className="sch-btn sch-btn--sm press" type="button" disabled={busy || !completeProfile || loading} onClick={() => void change('POST')}>
        {live ? <RefreshCw size={16} aria-hidden="true" /> : <Link2 size={16} aria-hidden="true" />}{busy ? 'מעדכן…' : live ? 'יצירת קישור חדש' : 'יצירת קישור אישי'}
      </button>
      {live && <button className="sch-btn sch-btn--sm sch-btn--danger press" type="button" disabled={busy} onClick={() => void change('DELETE')}><X size={16} aria-hidden="true" />ביטול הקישור</button>}
    </div>
    {live && <p className="sch-sub" style={{ margin: 0 }}>יצירת קישור חדש תבטל את הקודם.</p>}
    {error && <InlineError>{error}</InlineError>}
  </div>
}
