'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, CameraOff } from 'lucide-react'
import { haptic } from '@/lib/haptics'

// The token in a receipt QR is 40 hex chars (migration 018's
// issue_order_access). Matched ANYWHERE in the decoded text rather than
// parsed as a URL on purpose: the receipt may have been printed under a
// different host than the one being scanned from (vercel.app vs a custom
// domain), and the token — not the origin — is the credential.
const TOKEN_IN_QR = /\/order\/([0-9a-f]{40})/

/** Scanning a QR hands us arbitrary attacker-controllable text, so the
 *  decoded string is NEVER navigated to. Only a token matching the shape
 *  above is extracted, and the app then routes to its OWN /order/<token>
 *  — a QR pointing anywhere else simply doesn't match and is ignored. */
function extractToken(decoded: string): string | null {
  return TOKEN_IN_QR.exec(decoded)?.[1] ?? null
}

// Decoding runs on a downscaled copy of each frame. Full sensor
// resolution costs far more per frame than it buys in accuracy for a
// code held at arm's length, and this loop runs on whatever phone a
// customer happens to own.
const SCAN_WIDTH = 400

type Stage = 'idle' | 'starting' | 'scanning' | 'denied' | 'unavailable' | 'found'

const STAGE_TEXT: Partial<Record<Stage, string>> = {
  denied: 'אין גישה למצלמה. אפשר לאשר אותה בהגדרות הדפדפן — או פשוט להקליד את הקוד למעלה.',
  unavailable: 'המצלמה לא זמינה במכשיר הזה. הקלידו את הקוד בן 6 הספרות למעלה.',
  found: 'נמצא! מעבירים אתכם להזמנה…',
}

export default function QrScanner() {
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const frameRef = useRef<number | null>(null)
  const [stage, setStage] = useState<Stage>('idle')

  const stop = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  // Releasing the camera when the component goes away is not optional —
  // a stream left running keeps the phone's camera indicator lit and the
  // hardware powered, which reads as the app spying after you've left.
  useEffect(() => stop, [stop])

  const start = useCallback(async () => {
    haptic('select')
    setStage('starting')

    // getUserMedia only exists in a secure context; on plain HTTP it's
    // simply absent rather than throwing something diagnosable.
    if (!navigator.mediaDevices?.getUserMedia) {
      setStage('unavailable')
      return
    }

    try {
      // Loaded on demand so the decoder never lands in the bundle of a
      // visitor who only ever types their code.
      const { default: jsQR } = await import('jsqr')

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      })
      streamRef.current = stream

      const video = videoRef.current
      if (!video) {
        stop()
        return
      }
      video.srcObject = stream
      await video.play()
      setStage('scanning')

      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d', { willReadFrequently: true })
      if (!canvas || !ctx) {
        setStage('unavailable')
        stop()
        return
      }

      const tick = () => {
        if (!streamRef.current) return

        if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
          const scale = SCAN_WIDTH / video.videoWidth
          canvas.width = SCAN_WIDTH
          canvas.height = Math.round(video.videoHeight * scale)
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

          const frame = ctx.getImageData(0, 0, canvas.width, canvas.height)
          // dontInvert: a printed receipt is always dark-on-light, and
          // the inverted passes double the per-frame cost for nothing.
          const result = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' })
          const token = result ? extractToken(result.data) : null

          if (token) {
            haptic('impact')
            setStage('found')
            stop()
            router.push(`/order/${token}`)
            return
          }
        }

        frameRef.current = requestAnimationFrame(tick)
      }

      frameRef.current = requestAnimationFrame(tick)
    } catch (err) {
      stop()
      // NotAllowedError is a refusal (recoverable via browser settings);
      // anything else means there's no usable camera to offer at all.
      const name = (err as { name?: string } | null)?.name
      setStage(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable')
    }
  }, [router, stop])

  const message = STAGE_TEXT[stage]

  return (
    <section style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
      <div style={dividerRowStyle}>
        <span style={dividerLineStyle} />
        <span style={{ fontSize: '0.78rem', color: 'var(--text-faint)', fontWeight: 600 }}>או סרקו את הקוד מהקבלה</span>
        <span style={dividerLineStyle} />
      </div>

      {stage === 'idle' && (
        <button type="button" className="press" onClick={start} style={scanBtnStyle}>
          <Camera size={18} aria-hidden="true" />
          פתיחת המצלמה לסריקה
        </button>
      )}

      {(stage === 'starting' || stage === 'scanning' || stage === 'found') && (
        <>
          <div style={viewportStyle}>
            <video
              ref={videoRef}
              // playsInline is required on iOS: without it Safari hijacks
              // the video into its own fullscreen player the moment it
              // plays, which would replace this whole screen.
              playsInline
              muted
              aria-label="תצוגת מצלמה לסריקת ברקוד"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
            <div aria-hidden="true" style={reticleStyle}>
              <span className="qr-scan-line" style={scanLineStyle} />
            </div>
          </div>
          <p style={hintStyle}>
            {stage === 'found' ? STAGE_TEXT.found : stage === 'starting' ? 'מפעיל מצלמה…' : 'כוונו את המצלמה אל הריבוע שעל הקבלה'}
          </p>
        </>
      )}

      {(stage === 'denied' || stage === 'unavailable') && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', ...noticeStyle }}>
          <CameraOff size={18} aria-hidden="true" style={{ color: 'var(--text-faint)', flexShrink: 0, marginTop: 2 }} />
          <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>{message}</p>
        </div>
      )}

      {/* Announces the outcome to a screen reader without the decoding
          loop's per-frame churn ever reaching the accessibility tree. */}
      <p role="status" aria-live="polite" className="sr-only">
        {message ?? (stage === 'scanning' ? 'המצלמה פעילה, מחפש ברקוד' : '')}
      </p>

      <canvas ref={canvasRef} aria-hidden="true" style={{ display: 'none' }} />
    </section>
  )
}

const dividerRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', marginTop: 4 }
const dividerLineStyle: CSSProperties = { flex: 1, height: 1, background: 'var(--line)' }

const scanBtnStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  width: '100%',
  minHeight: 'var(--tap-min)',
  borderRadius: 999,
  border: '1px solid var(--line-strong)',
  background: 'transparent',
  color: 'var(--text)',
  fontWeight: 700,
  fontSize: '0.9rem',
  cursor: 'pointer',
}

const viewportStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  aspectRatio: '1 / 1',
  maxHeight: 300,
  borderRadius: 20,
  overflow: 'hidden',
  background: '#000',
  border: '1px solid var(--line-strong)',
}

const reticleStyle: CSSProperties = {
  position: 'absolute',
  inset: '14%',
  borderRadius: 14,
  border: '2px solid rgba(255,255,255,0.85)',
  boxShadow: '0 0 0 100vmax rgba(0,0,0,0.35)',
  overflow: 'hidden',
}

const scanLineStyle: CSSProperties = {
  position: 'absolute',
  insetInline: 0,
  height: 2,
  background: 'linear-gradient(90deg, transparent, var(--neon), transparent)',
}

const hintStyle: CSSProperties = { margin: 0, fontSize: '0.82rem', color: 'var(--text-dim)', textAlign: 'center' }

const noticeStyle: CSSProperties = {
  width: '100%',
  padding: '12px 12px',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-elev)',
  border: '1px solid var(--line)',
}
