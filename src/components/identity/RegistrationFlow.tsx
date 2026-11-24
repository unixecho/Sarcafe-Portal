'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input } from 'glisse'
import { Building2, Camera, Check, CircleAlert, Clock, FileText, Lock, MailQuestion, RefreshCw, ShieldCheck, UserRound, Users } from 'lucide-react'
import { NAME_MAX, NICKNAME_MAX, PHOTO_ACCEPT, PHOTO_UPLOAD_MAX_BYTES, isRegistrationToken, normalizeName } from '@/lib/identity/registration'
import { glassToast } from '@/components/glass/toast'
import { identityApi, refusalText, uploadPhoto, when } from './api'
import BenefitsReauth, { reauthReason, type ReauthReason } from './BenefitsReauth'
import BenefitsSignIn from './BenefitsSignIn'

// /benefits/register (FABLE-003): an organization's employee registers with the link their department head gave them.
//   1. The link carries its token in the URL FRAGMENT. The page takes it out of the address bar at once and trades it for an HttpOnly
//      cookie; the token is in no script-readable place after that.
//   2. Nothing about the link is shown before a proven Google sign-in. Then the link is opened into a one-hour registration session
//      for this person (another HttpOnly cookie).
//   3. First and last name, a nickname, a photo and the published notice. The photo is checked and re-encoded by the server; the
//      preview here is the person's own file, from an object URL that is revoked when it is replaced or the page goes away.
//   4. The application waits for a reviewer. It gives nothing until it is approved.

const ICON_ROW = { display: 'flex', alignItems: 'center', gap: 6 } as const
type Notice = { id: string; version: string; language: string; body: string }
type Ready = { state: 'ready'; organizationName: string; departmentName: string; expiresAt: string; notice: Notice }
type Status = { state: 'none' | 'link' | 'unavailable' | 'closed' } | Ready
type View =
  | { kind: 'working' } | { kind: 'sign-in' } | { kind: 'reauth'; reason: ReauthReason } | { kind: 'problem'; text: string }
  | { kind: 'none' } | { kind: 'unavailable' } | { kind: 'closed' } | { kind: 'conflict' } | { kind: 'form'; ready: Ready } | { kind: 'sent' }

export type Details = { firstName: string; lastName: string; nickname: string }

/**
 * The details an employee gives (first and last name, a nickname, a photo) and the notice they accept. Shared by the registration
 * and by a later change of one's own details. `requirePhoto`: a first application needs one; a change may keep the approved photo.
 */
export function DetailsForm({ notice, initial, requirePhoto, busy, submitLabel, onSubmit, onCancel }: {
  notice: Notice; initial?: Details; requirePhoto: boolean; busy: boolean; submitLabel: string
  onSubmit: (details: Details, photo: File | null) => void; onCancel?: () => void
}) {
  const [details, setDetails] = useState<Details>(initial ?? { firstName: '', lastName: '', nickname: '' })
  const [photo, setPhoto] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [accepted, setAccepted] = useState(false)
  const [tried, setTried] = useState(false)

  // the preview is the person's own file; its object URL lives exactly as long as it is on screen
  useEffect(() => {
    if (!photo) { setPreview(null); return }
    const url = URL.createObjectURL(photo)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [photo])

  const first = normalizeName(details.firstName, NAME_MAX)
  const last = normalizeName(details.lastName, NAME_MAX)
  const nickOk = details.nickname.trim() === '' || !!normalizeName(details.nickname, NICKNAME_MAX)
  const photoOk = !requirePhoto || !!photo
  const ready = !!first && !!last && nickOk && photoOk && accepted

  const pick = (file: File | undefined) => {
    if (!file) return
    if (file.size > PHOTO_UPLOAD_MAX_BYTES) { glassToast('הקובץ גדול מדי. אפשר להעלות תמונה עד 8MB.', 'bad'); return }
    setPhoto(file)
  }
  const send = () => {
    setTried(true)
    if (!ready) { glassToast(!accepted ? 'כדי להמשיך צריך לאשר את ההודעה.' : 'בדקו את הפרטים שסומנו.', 'bad'); return }
    onSubmit(details, photo)
  }

  return (
    <div className="gl-list" data-identity="details-form">
      <div className="gl-field">
        <span className="gl-field__label" id="reg-first">שם פרטי</span>
        <Input aria-labelledby="reg-first" aria-invalid={tried && !first} icon={<UserRound size={17} />} maxLength={NAME_MAX} autoComplete="given-name" value={details.firstName} onValueChange={(firstName) => setDetails((d) => ({ ...d, firstName }))} data-identity="first-name" />
      </div>
      <div className="gl-field">
        <span className="gl-field__label" id="reg-last">שם משפחה</span>
        <Input aria-labelledby="reg-last" aria-invalid={tried && !last} icon={<UserRound size={17} />} maxLength={NAME_MAX} autoComplete="family-name" value={details.lastName} onValueChange={(lastName) => setDetails((d) => ({ ...d, lastName }))} data-identity="last-name" />
      </div>
      <div className="gl-field">
        <span className="gl-field__label" id="reg-nick">כינוי (לא חובה)</span>
        <Input aria-labelledby="reg-nick" aria-invalid={tried && !nickOk} icon={<UserRound size={17} />} maxLength={NICKNAME_MAX} autoComplete="nickname" value={details.nickname} onValueChange={(nickname) => setDetails((d) => ({ ...d, nickname }))} data-identity="nickname" />
      </div>

      <div className="gl-inset">
        <span className="gl-field__label" id="reg-photo-label" style={{ color: 'var(--text)' }}><Camera size={15} aria-hidden="true" />תמונת פנים{!requirePhoto && ' (לא חובה: בלי תמונה חדשה נשארת התמונה המאושרת)'}</span>
        <p className="gl-note">תמונה ברורה של הפנים, כמו בתעודה. היא נשמרת באופן פרטי ומוצגת רק למי שמאשר את ההטבה. השרת יוצר ממנה עותק חדש בלי מיקום ובלי פרטי מצלמה.</p>
        <div className="gl-wrap" style={{ alignItems: 'center' }}>
          {preview
            // eslint-disable-next-line @next/next/no-img-element -- the person's own local file, never uploaded through next/image
            ? <img src={preview} alt="התמונה שבחרתם" width={120} height={150} style={{ display: 'block', width: 120, height: 150, objectFit: 'cover', borderRadius: 16 }} data-identity="photo-preview" />
            : <span className="gl-summary" aria-hidden="true" style={{ display: 'grid', placeItems: 'center', width: 120, height: 150, borderRadius: 16 }}><Camera size={28} /></span>}
          <label className="gl-chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: busy ? 'default' : 'pointer' }} data-identity="photo-pick">
            <Camera size={16} aria-hidden="true" />{photo ? 'בחירת תמונה אחרת' : 'בחירת תמונה'}
            <input type="file" accept={PHOTO_ACCEPT} capture="user" className="sr-only" aria-labelledby="reg-photo-label" disabled={busy} onChange={(event) => { pick(event.target.files?.[0]); event.target.value = '' }} />
          </label>
        </div>
        {tried && !photoOk && <p className="gl-note gl-note--bad"><CircleAlert size={16} aria-hidden="true" />צריך לבחור תמונה.</p>}
      </div>

      <div className="gl-inset" data-identity="notice">
        <span className="gl-field__label" style={{ color: 'var(--text)' }}><FileText size={15} aria-hidden="true" />הודעה על איסוף הפרטים <small>(גרסה <bdi dir="ltr">{notice.version}</bdi>)</small></span>
        {/* the whole text, never in a scroll box: it is read before it is accepted */}
        <p className="gl-note" style={{ whiteSpace: 'pre-wrap' }} data-identity="notice-body">{notice.body}</p>
        <button type="button" role="checkbox" aria-checked={accepted} className={`gl-chip${accepted ? ' is-on' : ''}`} style={{ justifySelf: 'start', display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => setAccepted((a) => !a)} disabled={busy} data-identity="notice-accept">
          {accepted ? <Check size={16} aria-hidden="true" /> : <Lock size={16} aria-hidden="true" />}קראתי את ההודעה ואני מאשר/ת
        </button>
      </div>

      <div className="gl-card__actions">
        <Button variant="filled" icon={<Check size={16} />} disabled={busy} onClick={send} data-identity="details-submit">{busy ? 'שולחים…' : submitLabel}</Button>
        {onCancel && <Button disabled={busy} onClick={onCancel}>ביטול</Button>}
      </div>
    </div>
  )
}

export default function RegistrationFlow() {
  const [view, setView] = useState<View>({ kind: 'working' })
  const [busy, setBusy] = useState(false)
  const started = useRef(false)

  const fromStatus = useCallback(async (status: Status) => {
    if (status.state === 'ready') { setView({ kind: 'form', ready: status }); return }
    if (status.state === 'link') {
      const opened = await identityApi<Ready>('/api/benefits/register/open', { method: 'POST', body: {} })
      if (opened.ok) { setView({ kind: 'form', ready: opened.data }); return }
      const reason = reauthReason(opened)
      if (reason) { setView({ kind: 'reauth', reason }); return }
      if (opened.code === 'closed') { setView({ kind: 'closed' }); return }
      if (opened.code === 'conflict') { setView({ kind: 'conflict' }); return }
      if (opened.status === 403) { setView({ kind: 'unavailable' }); return }
      setView({ kind: 'problem', text: refusalText(opened) })
      return
    }
    setView({ kind: status.state })
  }, [])

  const check = useCallback(async () => {
    const result = await identityApi<Status>('/api/benefits/register/status')
    if (result.ok) { await fromStatus(result.data); return }
    if (result.status === 401) { setView({ kind: 'sign-in' }); return }
    const reason = reauthReason(result)
    setView(reason ? { kind: 'reauth', reason } : { kind: 'problem', text: refusalText(result) })
  }, [fromStatus])

  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      const token = window.location.hash.slice(1)
      // out of the address bar (and of the history entry) before anything else happens, whatever it was
      if (window.location.hash) window.history.replaceState(null, '', window.location.pathname)
      if (isRegistrationToken(token)) {
        const traded = await identityApi<{ ok: true }>('/api/benefits/register/exchange', { method: 'POST', body: { token } })
        if (!traded.ok) { setView({ kind: 'problem', text: traded.status === 429 ? refusalText(traded) : 'לא הצלחנו לפתוח את הקישור. פתחו שוב את הקישור שקיבלתם.' }); return }
      }
      await check()
    })()
  }, [check])

  const submit = async (ready: Ready, details: Details, photo: File | null) => {
    if (!photo) return
    setBusy(true)
    const uploaded = await uploadPhoto('/api/benefits/register/photo', photo)
    if (!uploaded.ok) {
      setBusy(false)
      if (uploaded.code === 'registration_unavailable') { setView({ kind: 'unavailable' }); return }
      glassToast(uploaded.message && uploaded.status >= 400 && uploaded.status < 500 && uploaded.status !== 403 ? uploaded.message : refusalText(uploaded), 'bad')
      return
    }
    const sent = await identityApi<{ ok: true }>('/api/benefits/register/submit', {
      method: 'POST', body: { firstName: details.firstName, lastName: details.lastName, nickname: details.nickname, photoId: uploaded.data.photoId, noticeId: ready.notice.id, accept: true },
    })
    setBusy(false)
    if (sent.ok) { setView({ kind: 'sent' }); glassToast('הבקשה נשלחה לאישור.', 'ok'); return }
    if (sent.code === 'registration_unavailable') { setView({ kind: 'unavailable' }); return }
    if (sent.code === 'stale') { glassToast('נוסח ההודעה התעדכן. קראו אותו שוב.', 'bad'); setView({ kind: 'working' }); void check(); return }
    if (sent.code === 'conflict') { setView({ kind: 'conflict' }); return }
    const reason = reauthReason(sent)
    if (reason) { setView({ kind: 'reauth', reason }); return }
    glassToast(refusalText(sent), 'bad')
  }
  const notNow = async () => {
    setBusy(true)
    await identityApi('/api/benefits/register/exchange', { method: 'DELETE' })
    setBusy(false)
    setView({ kind: 'none' })
  }

  if (view.kind === 'working') {
    return (
      <div className="gl-surf gl-card gl-sk-card" aria-busy="true" data-identity="register-working">
        <p className="sr-only" role="status">פותח את הקישור…</p>
        <span className="sk gl-sk-line gl-sk-line--title" /><span className="sk gl-sk-line" /><span className="sk gl-sk-line gl-sk-line--short" />
      </div>
    )
  }
  if (view.kind === 'problem') {
    return (
      <section className="gl-surf gl-surf--bad gl-card" role="alert" data-identity="register-problem">
        <p className="gl-note gl-note--bad"><CircleAlert size={18} aria-hidden="true" />{view.text}</p>
        <div className="gl-card__actions"><Button icon={<RefreshCw size={16} />} onClick={() => { setView({ kind: 'working' }); void check() }}>לנסות שוב</Button></div>
      </section>
    )
  }
  if (view.kind === 'sign-in') {
    return (
      <section className="gl-surf gl-card" data-identity="register-sign-in">
        <h1 className="gl-card__title"><ShieldCheck size={18} aria-hidden="true" />הרשמה להטבה של מקום העבודה</h1>
        <p className="gl-note">קיבלתם קישור הרשמה ממקום העבודה. כדי להמשיך, התחברו עם חשבון Google. ההתחברות רק אומרת מי אתם: הבקשה תאושר על ידי ראש המחלקה.</p>
        <BenefitsSignIn returnTo="/benefits/register" />
      </section>
    )
  }
  if (view.kind === 'reauth') return <BenefitsReauth returnTo="/benefits/register" reason={view.reason} />
  if (view.kind === 'sent') {
    return (
      <section className="gl-surf gl-surf--ok gl-card" role="status" data-identity="register-sent">
        <h1 className="gl-card__title"><Clock size={18} aria-hidden="true" />הבקשה נשלחה וממתינה לאישור</h1>
        <p className="gl-note">ראש המחלקה יבדוק את הפרטים והתמונה. עד שהבקשה תאושר אין עדיין הטבה. אפשר לראות את מצב הבקשה ולתקן פרטים בעמוד "הבקשות שלי".</p>
        <div className="gl-card__actions"><Button variant="filled" onClick={() => window.location.assign('/benefits/manage')}>הבקשות שלי</Button></div>
      </section>
    )
  }
  if (view.kind === 'form') {
    const ready = view.ready
    return (
      <section className="gl-surf gl-card" aria-label="הרשמה" data-identity="register-form">
        <h1 className="gl-card__title"><ShieldCheck size={18} aria-hidden="true" />הרשמה להטבה</h1>
        <p className="gl-note" style={ICON_ROW}><Building2 size={15} aria-hidden="true" /><span>מקום העבודה: <strong>{ready.organizationName}</strong></span></p>
        <p className="gl-note" style={ICON_ROW}><Users size={15} aria-hidden="true" /><span>המחלקה: <strong>{ready.departmentName}</strong></span></p>
        <p className="gl-note">החלון הזה פתוח עד <bdi dir="ltr">{when(ready.expiresAt)}</bdi>. אחרי השליחה הבקשה תמתין לאישור.</p>
        <DetailsForm notice={ready.notice} requirePhoto busy={busy} submitLabel="שליחת הבקשה" onSubmit={(details, photo) => void submit(ready, details, photo)} onCancel={() => void notNow()} />
      </section>
    )
  }
  const TEXT = {
    none: ['אין כאן קישור פתוח', 'כדי להירשם, פתחו את הקישור המלא שקיבלתם ממקום העבודה. אם כבר נרשמתם, מצב הבקשה מופיע בעמוד "הבקשות שלי".'],
    unavailable: ['הקישור אינו זמין', 'ייתכן שפג תוקפו, שכבר נעשה בו שימוש או שבוטל. בקשו קישור חדש ממי ששלח לכם אותו.'],
    closed: ['ההרשמה עדיין לא נפתחה', 'מקום העבודה עוד לא פתח את ההרשמה. נסו שוב מאוחר יותר.'],
    conflict: ['כבר שלחתם בקשה במקום העבודה הזה', 'אפשר לראות את מצבה ולתקן פרטים בעמוד "הבקשות שלי".'],
  } as const
  const [title, body] = TEXT[view.kind]
  return (
    <section className="gl-surf gl-card" data-identity={`register-${view.kind}`}>
      <h1 className="gl-card__title"><MailQuestion size={18} aria-hidden="true" />{title}</h1>
      <p className="gl-note">{body}</p>
      <div className="gl-card__actions"><Button onClick={() => window.location.assign('/benefits/manage')}>הבקשות שלי</Button></div>
    </section>
  )
}
