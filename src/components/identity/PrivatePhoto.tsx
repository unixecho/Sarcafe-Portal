'use client'

import { useEffect, useState } from 'react'
import { ImageOff } from 'lucide-react'
import type { MembershipState } from '@/lib/identity/registration'
import Pill from '@/components/glass/Pill'

// A private photo (FABLE-003). It is fetched from the server proxy with no-store (the proxy rechecks the viewer and writes an audit row
// each time), shown from an object URL that is revoked the moment the photo leaves the screen (closed, another person, unmount), and
// never put in a cache, in storage, in a transition or in the page's HTML. A late answer for a photo that is no longer asked for is
// dropped (the generation check), so one person's photo can never appear on the next person's row.
export default function PrivatePhoto({ url, label }: { url: string | null; label: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setSrc(null)
    setFailed(false)
    if (!url) return
    const controller = new AbortController()
    let objectUrl: string | null = null
    let live = true
    void (async () => {
      try {
        const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
        if (!response.ok || !(response.headers.get('content-type') ?? '').startsWith('image/jpeg')) throw new Error('photo')
        const blob = await response.blob()
        if (!live) return
        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
      } catch {
        if (live) setFailed(true)
      }
    })()
    const hide = () => { if (document.visibilityState === 'hidden' && objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; setSrc(null) } }
    document.addEventListener('visibilitychange', hide)
    return () => {
      live = false
      controller.abort()
      document.removeEventListener('visibilitychange', hide)
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url])

  if (!url) return null
  if (failed) {
    return <p className="gl-note gl-note--bad" data-identity="photo-failed"><ImageOff size={18} aria-hidden="true" />לא הצלחנו להציג את התמונה.</p>
  }
  if (!src) return <span className="sk" aria-hidden="true" style={{ display: 'block', width: 150, height: 188, borderRadius: 16 }} data-identity="photo-loading" />
  // eslint-disable-next-line @next/next/no-img-element -- a private blob URL: next/image would try to fetch and cache it
  return <img src={src} alt={label} width={150} height={188} draggable={false} data-identity="photo" style={{ display: 'block', width: 150, height: 188, objectFit: 'cover', borderRadius: 16 }} />
}

/** Words and tone for a membership state (never colour alone: the pill always carries the words). */
export const STATE_TEXT: Record<MembershipState, string> = { pending: 'ממתין לאישור', approved: 'מאושר', rejected: 'נדחה', inactive: 'מושבת' }
export function StatePill({ state }: { state: MembershipState }) {
  return <Pill tiny tone={state === 'approved' ? 'ok' : state === 'rejected' ? 'bad' : state === 'inactive' ? 'quiet' : undefined}>{STATE_TEXT[state]}</Pill>
}
