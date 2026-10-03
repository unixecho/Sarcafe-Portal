'use client'

import { useEffect } from 'react'
import { CheckCircle2, X, XCircle } from 'lucide-react'

export type ToastState = { id: number; kind: 'ok' | 'error' | 'info'; text: string }

// The one place feedback after an action appears. A success fades on its own
// after a few seconds; an ERROR stays until dismissed (a person who is reading an
// explanation of what went wrong must not have it vanish mid-sentence). Both are
// announced to screen readers: polite for a success, assertive for a failure.
export default function ScheduleToast({ toast, onDismiss }: { toast: ToastState | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!toast || toast.kind === 'error') return
    const t = window.setTimeout(onDismiss, 4200)
    return () => window.clearTimeout(t)
  }, [toast, onDismiss])

  if (!toast) return null
  const isError = toast.kind === 'error'
  return (
    <div className={`sch-toast sch-toast--${toast.kind}`} role={isError ? 'alert' : 'status'} aria-live={isError ? 'assertive' : 'polite'} key={toast.id}>
      {isError ? <XCircle size={20} aria-hidden="true" /> : <CheckCircle2 size={20} aria-hidden="true" />}
      <span style={{ flex: 1, minWidth: 0 }}>{toast.text}</span>
      <button type="button" onClick={onDismiss} aria-label="סגירת ההודעה">
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  )
}
