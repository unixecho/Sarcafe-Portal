'use client'

// The toast host. A toast is for the small, passing thing that is NOT worth a
// dialog — "someone already updated this" — so it must be (a) announced to a
// screen reader, (b) readable for long enough on a busy till, and (c) never in the
// way of the primary action.
//
// Two live regions, created once and never torn down (a region that appears at the
// same moment as its text is often not announced): polite for info/ok/warn,
// assertive (role="alert") for errors. Both sit in a portal on <body> — this is
// fixed chrome, and the page's transformed ancestor would otherwise become its
// containing block (see ModalPortal).
//
//   const { toast } = usePosToast()
//   toast(errorText(t, result.code), { tone: 'error' })
//
// No provider above you (a screen rendered on its own)? usePosToast() hands back a
// no-op rather than throwing: a missing toast must never crash a till.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import ModalPortal from '@/components/ModalPortal'
import { useT } from '@/lib/pos/useT'

export type ToastTone = 'info' | 'ok' | 'warn' | 'error'
export type ToastOptions = {
  tone?: ToastTone
  /** how long it stays; defaults by tone (errors linger longer) */
  ms?: number
  /** one optional button, e.g. an undo */
  action?: { label: string; onClick: () => void }
}

type ToastItem = {
  id: number
  message: string
  tone: ToastTone
  ms: number
  action?: ToastOptions['action']
}

export type PosToastApi = {
  toast: (message: string, options?: ToastOptions) => void
  dismiss: (id?: number) => void
}

const NOOP: PosToastApi = { toast: () => {}, dismiss: () => {} }
const ToastContext = createContext<PosToastApi>(NOOP)

export function usePosToast(): PosToastApi {
  return useContext(ToastContext)
}

const MAX_VISIBLE = 3
const DEFAULT_MS: Record<ToastTone, number> = { info: 4000, ok: 3500, warn: 5000, error: 6500 }

const ICONS = { info: Info, ok: CheckCircle2, warn: AlertTriangle, error: XCircle } as const

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  // The ref is the truth; state is its mirror for rendering. Keeping the
  // bookkeeping (ids, timers) out of a setState updater means Strict Mode's
  // double-invoked updaters can never arm a timer twice or mint two ids.
  const itemsRef = useRef<ToastItem[]>([])
  const seq = useRef(0)
  const timers = useRef(new Map<number, number>())

  const commit = useCallback((next: ToastItem[]) => {
    itemsRef.current = next
    setItems(next)
  }, [])

  const clearTimer = useCallback((id: number) => {
    const h = timers.current.get(id)
    if (h !== undefined) window.clearTimeout(h)
    timers.current.delete(id)
  }, [])

  const dismiss = useCallback(
    (id?: number) => {
      if (id === undefined) {
        timers.current.forEach((h) => window.clearTimeout(h))
        timers.current.clear()
        commit([])
        return
      }
      clearTimer(id)
      commit(itemsRef.current.filter((x) => x.id !== id))
    },
    [commit, clearTimer],
  )

  const arm = useCallback(
    (id: number, ms: number) => {
      clearTimer(id)
      timers.current.set(id, window.setTimeout(() => dismiss(id), ms))
    },
    [dismiss, clearTimer],
  )

  const toast = useCallback(
    (message: string, options?: ToastOptions) => {
      const tone = options?.tone ?? 'info'
      const ms = options?.ms ?? (options?.action ? Math.max(DEFAULT_MS[tone], 7000) : DEFAULT_MS[tone])
      const cur = itemsRef.current
      // The same sentence twice in a row (five rapid taps on a card somebody
      // else already advanced) is ONE toast with a fresh timer, not a stack.
      const dup = cur.find((x) => x.message === message && x.tone === tone)
      if (dup) {
        arm(dup.id, ms)
        return
      }
      const id = ++seq.current
      const next = [...cur, { id, message, tone, ms, action: options?.action }]
      // Oldest ones make room; their timers must not outlive them.
      while (next.length > MAX_VISIBLE) {
        const gone = next.shift()
        if (gone) clearTimer(gone.id)
      }
      arm(id, ms)
      commit(next)
    },
    [arm, clearTimer, commit],
  )

  useEffect(() => {
    const map = timers.current
    return () => {
      map.forEach((h) => window.clearTimeout(h))
      map.clear()
    }
  }, [])

  const api = useMemo<PosToastApi>(() => ({ toast, dismiss }), [toast, dismiss])
  const polite = items.filter((x) => x.tone !== 'error')
  const urgent = items.filter((x) => x.tone === 'error')

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ModalPortal>
        <div className="pos-toasts">
          <div role="status" aria-live="polite" aria-atomic="false" className="pos-toasts-col">
            {polite.map((x) => (
              <ToastCard key={x.id} item={x} onDismiss={dismiss} />
            ))}
          </div>
          <div role="alert" aria-atomic="false" className="pos-toasts-col">
            {urgent.map((x) => (
              <ToastCard key={x.id} item={x} onDismiss={dismiss} />
            ))}
          </div>
        </div>
      </ModalPortal>
    </ToastContext.Provider>
  )
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id?: number) => void }) {
  const t = useT()
  const Icon = ICONS[item.tone]
  return (
    <div className={`pos-toast pos-toast--${item.tone}`}>
      <Icon size={20} aria-hidden="true" className="pos-toast-icon" />
      <span className="pos-toast-text">{item.message}</span>
      {item.action && (
        <button
          type="button"
          className="pos-toast-action press"
          onClick={() => {
            item.action?.onClick()
            onDismiss(item.id)
          }}
        >
          {item.action.label}
        </button>
      )}
      <button type="button" className="pos-toast-x press" aria-label={t('core.toast.dismiss')} onClick={() => onDismiss(item.id)}>
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  )
}
