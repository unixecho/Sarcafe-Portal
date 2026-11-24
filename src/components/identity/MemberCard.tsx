'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from 'glisse'
import { CircleAlert, EyeOff, QrCode, RefreshCw } from 'lucide-react'
import QRCode from 'qrcode'
import { CARD_RENEW_BEFORE_SECONDS } from '@/lib/identity/verification'
import { identityApi, refusalText, when } from './api'

// The employee's card (FABLE-004): a QR that carries an opaque, short-lived token and nothing else (no name, no organization, no
// photo, no URL). It is made fresh when the card is opened, renews itself a minute before it expires while it is on screen, and is
// gone (and its token with it) the moment the card is hidden, the page goes to the background or the person leaves. Every new card
// makes the earlier ones useless, so a screenshot cannot be used later. The token is drawn on a canvas; it is in no text, no
// storage and no URL. Showing the card is not the benefit: the staff member compares the person with the private photo.
type Card = { token: string; expiresAt: string }

export default function MemberCard({ membershipId, onClose }: { membershipId: string; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const [card, setCard] = useState<Card | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [left, setLeft] = useState<number>(0)
  const generation = useRef(0)

  const fetchCard = useCallback(async () => {
    const mine = ++generation.current
    setProblem(null)
    const result = await identityApi<Card>(`/api/benefits/me/${membershipId}/card`, { method: 'POST', body: {} })
    if (mine !== generation.current) return
    if (result.ok) setCard(result.data)
    else { setCard(null); setProblem(refusalText(result)) }
  }, [membershipId])

  // made fresh when the card opens; forgotten (and drawn over) when the page is hidden; fresh again when it is back
  useEffect(() => {
    void fetchCard()
    const visibility = () => {
      if (document.visibilityState === 'hidden') { generation.current++; setCard(null) }
      else void fetchCard()
    }
    document.addEventListener('visibilitychange', visibility)
    return () => { generation.current++; document.removeEventListener('visibilitychange', visibility) }
  }, [fetchCard])

  // draw the token (only the token) as a QR; clear the canvas when there is no card
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    if (!card) { c.getContext('2d')?.clearRect(0, 0, c.width, c.height); return }
    void QRCode.toCanvas(c, card.token, { width: 240, margin: 2, errorCorrectionLevel: 'M' })
  }, [card])

  // count down; renew a minute before the end
  useEffect(() => {
    if (!card) return
    const tick = () => {
      const seconds = Math.max(0, Math.round((Date.parse(card.expiresAt) - Date.now()) / 1000))
      setLeft(seconds)
      if (seconds <= CARD_RENEW_BEFORE_SECONDS) void fetchCard()
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [card, fetchCard])

  const hide = async () => {
    generation.current++
    setCard(null)
    await identityApi(`/api/benefits/me/${membershipId}/card`, { method: 'DELETE' })
    onClose()
  }

  return (
    <div className="gl-inset" data-identity="member-card">
      <span className="gl-field__label" style={{ color: 'var(--text)' }}><QrCode size={15} aria-hidden="true" />הכרטיס שלי</span>
      {problem
        ? <p className="gl-note gl-note--bad" role="alert"><CircleAlert size={16} aria-hidden="true" />{problem}</p>
        : <p className="gl-note">הציגו את הקוד בקופה. הקוד מתחלף מעצמו, ואינו מספיק לבדו: הצוות משווה אתכם לתמונה המאושרת.</p>}
      <div style={{ display: 'grid', placeItems: 'center' }}>
        <canvas ref={canvas} width={240} height={240} role="img" aria-label="קוד הכרטיס לסריקה בקופה" data-identity="member-card-qr" hidden={!card} style={{ borderRadius: 12 }} />
        {!card && !problem && <span className="sk" aria-hidden="true" style={{ display: 'block', width: 240, height: 240, borderRadius: 12 }} />}
      </div>
      {card && <p className="gl-note" aria-live="polite">מתחלף בעוד <bdi dir="ltr">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</bdi> · בתוקף עד <bdi dir="ltr">{when(card.expiresAt)}</bdi></p>}
      <div className="gl-card__actions">
        {problem && <Button icon={<RefreshCw size={16} />} onClick={() => void fetchCard()}>לנסות שוב</Button>}
        <Button icon={<EyeOff size={16} />} onClick={() => void hide()} data-identity="member-card-hide">הסתרת הכרטיס</Button>
      </div>
    </div>
  )
}
