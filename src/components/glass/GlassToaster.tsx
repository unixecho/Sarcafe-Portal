'use client'

import { useEffect, useState } from 'react'
import { CircleAlert, CircleCheck, Info } from 'lucide-react'
import { TOAST_EVENT, type ToastDetail } from './toast'

type Item = ToastDetail & { id: number }
const SHOW_MS = 3200

/** Draws glassToast() messages above the dock. Good news green, errors red (and read out at once), the rest neutral. */
export default function GlassToaster() {
  const [items, setItems] = useState<Item[]>([])
  useEffect(() => {
    let seq = 0
    const timers = new Set<number>()
    const onToast = (event: Event) => {
      const detail = (event as CustomEvent<ToastDetail>).detail
      if (!detail?.message) return
      const id = ++seq
      setItems((list) => [...list.slice(-1), { ...detail, id }])
      const timer = window.setTimeout(() => { setItems((list) => list.filter((item) => item.id !== id)); timers.delete(timer) }, detail.tone === 'bad' ? SHOW_MS + 1800 : SHOW_MS)
      timers.add(timer)
    }
    window.addEventListener(TOAST_EVENT, onToast)
    return () => { window.removeEventListener(TOAST_EVENT, onToast); timers.forEach((t) => window.clearTimeout(t)) }
  }, [])
  const polite = items.filter((item) => item.tone !== 'bad')
  const urgent = items.filter((item) => item.tone === 'bad')
  return (
    <div className="gl-toasts">
      <div role="status" aria-live="polite" style={{ display: 'contents' }}>
        {polite.map((item) => <span key={item.id} className={`gl-toast gl-toast--${item.tone}`}>{item.tone === 'ok' ? <CircleCheck size={18} aria-hidden="true" /> : <Info size={18} aria-hidden="true" />}{item.message}</span>)}
      </div>
      <div role="alert" style={{ display: 'contents' }}>
        {urgent.map((item) => <span key={item.id} className="gl-toast gl-toast--bad"><CircleAlert size={18} aria-hidden="true" />{item.message}</span>)}
      </div>
    </div>
  )
}
