'use client'

import { useEffect, useId, useRef } from 'react'
import ModalPortal from '@/components/ModalPortal'

export type ConfirmRequest = {
  title: string
  body?: string
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean
}

type ConfirmSheetProps = {
  request: ConfirmRequest | null
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Replaces window.confirm() — which renders as un-themed, LTR, top-anchored
 * OS chrome, wrong for a dark RTL app. `request === null` unmounts
 * synchronously (no exit animation on the dialog itself, only entrance).
 * Ported from AyekaBar.
 */
export default function ConfirmSheet({ request, onConfirm, onCancel }: ConfirmSheetProps) {
  const titleId = useId()
  const confirmRef = useRef<HTMLButtonElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!request) return
    previouslyFocused.current = document.activeElement as HTMLElement | null
    confirmRef.current?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      previouslyFocused.current?.focus?.({ preventScroll: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request])

  if (!request) return null

  return (
    <ModalPortal>
      <div className="sheet-scrim" onClick={onCancel}>
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="sheet-panel"
          style={{ gap: 14, alignItems: 'stretch' }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="sheet-grabber" aria-hidden="true" />
          <div
            style={{
              background: 'var(--bg-elev)',
              border: '1px solid var(--line-strong)',
              borderRadius: 18,
              padding: '20px 18px',
            }}
          >
            <h2 id={titleId} style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
              {request.title}
            </h2>
            {request.body && (
              <p style={{ margin: '8px 0 0', color: 'var(--text-dim)', fontSize: '0.9rem' }}>{request.body}</p>
            )}
            <button
              ref={confirmRef}
              type="button"
              className="press"
              onClick={onConfirm}
              style={{
                marginTop: 16,
                width: '100%',
                minHeight: 'var(--tap-min)',
                borderRadius: 14,
                border: 'none',
                fontWeight: 700,
                fontSize: '0.95rem',
                cursor: 'pointer',
                color: request.danger ? '#ff6b6b' : 'var(--bg)',
                background: request.danger ? 'transparent' : 'var(--neon)',
              }}
            >
              {request.confirmLabel}
            </button>
          </div>
          <button
            type="button"
            className="press"
            onClick={onCancel}
            style={{
              width: '100%',
              minHeight: 'var(--tap-min)',
              borderRadius: 18,
              border: '1px solid var(--line-strong)',
              background: 'var(--bg-elev)',
              color: 'var(--text)',
              fontWeight: 600,
              fontSize: '0.95rem',
              cursor: 'pointer',
            }}
          >
            {request.cancelLabel ?? 'ביטול'}
          </button>
        </div>
      </div>
    </ModalPortal>
  )
}
