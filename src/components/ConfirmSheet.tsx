'use client'

import { useEffect, useId, useRef } from 'react'
import ModalPortal from '@/components/ModalPortal'
import { useSheetExit } from '@/lib/useSheetExit'

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
 * OS chrome, wrong for a dark RTL app. `request === null` starts the close
 * animation (see useSheetExit) rather than unmounting instantly.
 * Ported from AyekaBar.
 */
export default function ConfirmSheet({ request, onConfirm, onCancel }: ConfirmSheetProps) {
  const titleId = useId()
  const confirmRef = useRef<HTMLButtonElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const { rendered, closing } = useSheetExit(!!request)

  // See PromptSheet.tsx for why this sticky-last-request pattern exists.
  const lastRequest = useRef<ConfirmRequest | null>(null)
  if (request) lastRequest.current = request
  const shown = request ?? lastRequest.current

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

  if (!rendered || !shown) return null

  return (
    <ModalPortal>
      <div className={`sheet-scrim${closing ? ' sheet-scrim--closing' : ''}`} onClick={onCancel}>
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
              {shown.title}
            </h2>
            {shown.body && (
              <p style={{ margin: '8px 0 0', color: 'var(--text-dim)', fontSize: '0.9rem' }}>{shown.body}</p>
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
                color: shown.danger ? '#ff6b6b' : 'var(--bg)',
                background: shown.danger ? 'transparent' : 'var(--neon)',
              }}
            >
              {shown.confirmLabel}
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
            {shown.cancelLabel ?? 'ביטול'}
          </button>
        </div>
      </div>
    </ModalPortal>
  )
}
