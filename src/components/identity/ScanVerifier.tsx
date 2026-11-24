'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input } from 'glisse'
import { Building2, Camera, CameraOff, Check, CircleAlert, Keyboard, ScanLine, ShieldAlert, Users, X } from 'lucide-react'
import { displayName, parseScannedCredential } from '@/lib/identity/verification'
import Seg from '@/components/glass/Seg'
import { glassToast } from '@/components/glass/toast'
import { identityApi, refusalText } from './api'
import { reauthReason, type ReauthReason } from './BenefitsReauth'
import PrivatePhoto from './PrivatePhoto'

// /staff/benefits/scan (FABLE-004): a staff member with a scanner grant verifies an employee's card.
//   - The camera runs only while the operator is scanning: it stops on a find, on cancel, when the page is hidden, on leaving.
//   - The decoded text is never navigated to or shown: only an exact card token is sent (parseScannedCredential).
//   - The result shows the minimum (name, organization, department) and the private photo, for TWO minutes; the operator compares the
//     person with the photo and decides. No face recognition. Then everything about that person leaves the screen and the photo's
//     object URL is revoked; a late answer for an earlier person is dropped (the generation check).
type Scope = { branches: Array<{ branchId: string; name: string }> }
type View = { verificationId: string; expiresAt: string; firstName: string; lastName: string | null; nickname: string | null; organizationName: string; departmentName: string }
type Stage = { kind: 'loading' } | { kind: 'no-access' } | { kind: 'reauth'; reason: ReauthReason } | { kind: 'problem'; text: string } | { kind: 'ready' }

const SCAN_WIDTH = 400

export default function ScanVerifier() {
  const [stage, setStage] = useState<Stage>({ kind: 'loading' })
  const [scope, setScope] = useState<Scope | null>(null)
  const [branch, setBranch] = useState('')
  const [camera, setCamera] = useState<'off' | 'starting' | 'on' | 'denied' | 'unavailable'>('off')
  const [manual, setManual] = useState('')
  const [view, setView] = useState<View | null>(null)
  const [left, setLeft] = useState(0)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const video = useRef<HTMLVideoElement | null>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const frame = useRef<number | null>(null)
  const generation = useRef(0)

  const stopCamera = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
    if (video.current) video.current.srcObject = null
    setCamera((c) => (c === 'on' || c === 'starting' ? 'off' : c))
  }, [])
  const clearPerson = useCallback(() => { generation.current++; setView(null); setManual('') }, [])

  useEffect(() => {
    void (async () => {
      const result = await identityApi<Scope>('/api/benefits/verify/scope')
      if (result.ok) {
        setScope(result.data)
        setBranch(result.data.branches[0]?.branchId ?? '')
        setStage(result.data.branches.length ? { kind: 'ready' } : { kind: 'no-access' })
        return
      }
      const reason = reauthReason(result)
      if (reason) setStage({ kind: 'reauth', reason })
      else if (result.status === 403) setStage({ kind: 'no-access' })
      else setStage({ kind: 'problem', text: refusalText(result) })
    })()
  }, [])

  // leaving, or the page going to the background, ends the camera and takes the person off the screen
  useEffect(() => {
    const hidden = () => { if (document.visibilityState === 'hidden') { stopCamera(); clearPerson() } }
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('pagehide', hidden)
    return () => { document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', hidden); stopCamera(); generation.current++ }
  }, [stopCamera, clearPerson])

  // the result lives two minutes at most
  useEffect(() => {
    if (!view) return
    const tick = () => {
      const seconds = Math.max(0, Math.round((Date.parse(view.expiresAt) - Date.now()) / 1000))
      setLeft(seconds)
      if (seconds === 0) { clearPerson(); setNotice({ tone: 'bad', text: 'עבר הזמן. סרקו שוב.' }) }
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [view, clearPerson])

  const submit = useCallback(async (code: string) => {
    const token = parseScannedCredential(code)
    if (!token) { setNotice({ tone: 'bad', text: 'זה לא כרטיס הטבה.' }); return }
    if (!branch) return
    const mine = ++generation.current
    setBusy(true)
    setNotice(null)
    const result = await identityApi<View>('/api/benefits/verify/scan', { method: 'POST', body: { branchId: branch, code: token } })
    setBusy(false)
    if (mine !== generation.current) return
    if (result.ok) { setView(result.data); setManual(''); return }
    const reason = reauthReason(result)
    if (reason) { setStage({ kind: 'reauth', reason }); return }
    setNotice({ tone: 'bad', text: result.code === 'card_unavailable' ? 'הכרטיס אינו בתוקף כאן. אין לתת את ההטבה.' : refusalText(result) })
  }, [branch])

  const startCamera = useCallback(async () => {
    clearPerson()
    setNotice(null)
    if (!navigator.mediaDevices?.getUserMedia) { setCamera('unavailable'); return }
    setCamera('starting')
    try {
      const { default: jsQR } = await import('jsqr')
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false })
      stream.current = media
      const el = video.current
      if (!el) { media.getTracks().forEach((t) => t.stop()); return }
      el.srcObject = media
      await el.play().catch(() => null)
      setCamera('on')
      const loop = () => {
        const c = canvas.current
        if (!stream.current || !c || !el.videoWidth) { frame.current = requestAnimationFrame(loop); return }
        const scale = SCAN_WIDTH / el.videoWidth
        c.width = SCAN_WIDTH
        c.height = Math.round(el.videoHeight * scale)
        const ctx = c.getContext('2d', { willReadFrequently: true })
        if (!ctx) return
        ctx.drawImage(el, 0, 0, c.width, c.height)
        const found = jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts: 'dontInvert' })
        if (found?.data) {
          stopCamera()
          void submit(found.data)
          return
        }
        frame.current = requestAnimationFrame(loop)
      }
      frame.current = requestAnimationFrame(loop)
    } catch (error) {
      stopCamera()
      setCamera((error as { name?: string })?.name === 'NotAllowedError' ? 'denied' : 'unavailable')
    }
  }, [clearPerson, stopCamera, submit])

  const decide = async (decision: 'match' | 'mismatch' | 'cancel') => {
    if (!view) return
    const current = view
    setBusy(true)
    const result = await identityApi<{ state: string }>(`/api/benefits/verify/${current.verificationId}/decide`, { method: 'POST', body: { decision } })
    setBusy(false)
    clearPerson()
    if (!result.ok) { setNotice({ tone: 'bad', text: result.code === 'stale' ? 'החברות השתנתה בינתיים. אין לתת את ההטבה.' : refusalText(result) }); return }
    if (decision === 'match') { setNotice({ tone: 'ok', text: 'אומת: האדם תואם לתמונה. האימות תקף חמש דקות להטבה אחת.' }); glassToast('אומת.', 'ok') }
    else setNotice({ tone: 'bad', text: decision === 'mismatch' ? 'סומן "לא תואם". אין לתת את ההטבה.' : 'בוטל.' })
  }

  if (stage.kind === 'loading') return <div className="gl-surf gl-card gl-sk-card" aria-busy="true" data-identity="scan-loading"><span className="sk gl-sk-line gl-sk-line--title" /><span className="sk gl-sk-line" /></div>
  if (stage.kind === 'reauth') {
    // the staff app's own sign-in (Google), returning here; a code or quick session cannot verify anyone
    return (
      <section className="gl-surf gl-card" role="alert" data-identity="scan-reauth" data-reason={stage.reason}>
        <h1 className="gl-card__title"><ShieldAlert size={18} aria-hidden="true" />צריך להתחבר עם Google</h1>
        <p className="gl-note">אימות הטבות דורש התחברות מלאה עם Google. כניסה עם קוד עובד או קוד מהיר אינה מספיקה.</p>
        <div className="gl-card__actions"><Button variant="filled" onClick={() => window.location.assign('/login?next=/staff/benefits/scan')}>התחברות עם Google</Button></div>
      </section>
    )
  }
  if (stage.kind === 'problem') return <section className="gl-surf gl-surf--bad gl-card" role="alert" data-identity="scan-problem"><p className="gl-note gl-note--bad"><CircleAlert size={18} aria-hidden="true" />{stage.text}</p></section>
  if (stage.kind === 'no-access') {
    return (
      <section className="gl-surf gl-card" data-identity="scan-no-access">
        <h1 className="gl-card__title"><ShieldAlert size={18} aria-hidden="true" />אין הרשאת סריקה</h1>
        <p className="gl-note">אימות הטבות של עובדי ארגונים דורש הרשאה מפורשת מהבעלים. להיות עובד או מנהל אינו מספיק.</p>
      </section>
    )
  }

  return (
    <div className="gl-list" data-identity="scan">
      <section className="gl-surf gl-card" aria-label="סריקה">
        <h1 className="gl-card__title"><ScanLine size={18} aria-hidden="true" />אימות הטבת עובד</h1>
        {scope && scope.branches.length > 1 && <Seg label="הסניף" fill items={scope.branches.map((b) => ({ value: b.branchId, label: b.name }))} value={branch} onChange={(value) => { setBranch(value); clearPerson() }} />}
        {scope && scope.branches.length === 1 && <p className="gl-note" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Building2 size={15} aria-hidden="true" />{scope.branches[0]?.name}</p>}
        <div style={{ position: 'relative', display: camera === 'on' || camera === 'starting' ? 'block' : 'none' }}>
          {/* the camera picture is the operator's live view only; it is never recorded, uploaded or kept */}
          <video ref={video} muted playsInline aria-label="תצוגת המצלמה" data-identity="scan-video" style={{ width: '100%', maxHeight: 320, objectFit: 'cover', borderRadius: 16 }} />
          <canvas ref={canvas} hidden />
        </div>
        {camera === 'denied' && <p className="gl-note gl-note--bad"><CameraOff size={16} aria-hidden="true" />אין גישה למצלמה. אפשר לאשר בהגדרות הדפדפן, או להקליד את הקוד.</p>}
        {camera === 'unavailable' && <p className="gl-note gl-note--bad"><CameraOff size={16} aria-hidden="true" />המצלמה אינה זמינה כאן. אפשר להקליד את הקוד.</p>}
        <div className="gl-card__actions">
          {camera === 'on' || camera === 'starting'
            ? <Button icon={<X size={16} />} onClick={stopCamera} data-identity="scan-camera-stop">עצירת המצלמה</Button>
            : <Button variant="filled" icon={<Camera size={16} />} disabled={busy || !!view} onClick={() => void startCamera()} data-identity="scan-camera">סריקה במצלמה</Button>}
        </div>
        <div className="gl-field">
          <span className="gl-field__label" id="scan-manual"><Keyboard size={15} aria-hidden="true" />או הקלדת הקוד</span>
          <Input aria-labelledby="scan-manual" dir="ltr" autoComplete="off" spellCheck={false} maxLength={80} value={manual} onValueChange={setManual} disabled={busy || !!view}
            onKeyDown={(event) => { if (event.key === 'Enter' && manual.trim()) void submit(manual) }} data-identity="scan-manual" />
          <div className="gl-card__actions"><Button disabled={busy || !manual.trim() || !!view} onClick={() => void submit(manual)} data-identity="scan-manual-send">בדיקה</Button></div>
        </div>
        {notice && <p className={`gl-note${notice.tone === 'bad' ? ' gl-note--bad' : ''}`} role="status" data-identity="scan-notice" data-tone={notice.tone}>{notice.tone === 'bad' ? <CircleAlert size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}{notice.text}</p>}
      </section>

      {view && (
        <section className="gl-surf gl-card" aria-label="תוצאת הסריקה" data-identity="scan-result">
          <h2 className="gl-card__title"><Users size={18} aria-hidden="true" />{displayName(view)}</h2>
          <p className="gl-note" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Building2 size={15} aria-hidden="true" />{view.organizationName} · {view.departmentName}</p>
          <PrivatePhoto key={view.verificationId} url={`/api/benefits/verify/${view.verificationId}/photo`} label={`התמונה המאושרת של ${displayName(view)}`} />
          <p className="gl-note">השוו בעצמכם: האם האדם שמולכם הוא האדם שבתמונה? אין כאן זיהוי אוטומטי. נותרו <bdi dir="ltr">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</bdi>.</p>
          <div className="gl-card__actions">
            <Button variant="filled" icon={<Check size={16} />} disabled={busy} onClick={() => void decide('match')} data-identity="scan-match">תואם</Button>
            <Button destructive icon={<X size={16} />} disabled={busy} onClick={() => void decide('mismatch')} data-identity="scan-mismatch">לא תואם</Button>
            <Button disabled={busy} onClick={() => void decide('cancel')} data-identity="scan-cancel">ביטול</Button>
          </div>
        </section>
      )}
    </div>
  )
}

