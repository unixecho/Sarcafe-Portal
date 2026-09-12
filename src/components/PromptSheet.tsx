'use client'

import { useEffect, useId, useRef, useState } from 'react'
import ModalPortal from '@/components/ModalPortal'
import { useSheetExit } from '@/lib/useSheetExit'

export type PromptRequest = {
  title: string
  label?: string
  initialValue?: string
  submitLabel: string
  cancelLabel?: string
  allowEmpty?: boolean
}

type PromptSheetProps = {
  request: PromptRequest | null
  onSubmit: (value: string) => void
  onCancel: () => void
}

/** Replaces window.prompt(). Ported from AyekaBar. */
export default function PromptSheet({ request, onSubmit, onCancel }: PromptSheetProps) {
  const titleId = useId()
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const [value, setValue] = useState('')
  const { rendered, closing } = useSheetExit(!!request)

  // request goes null the instant the caller closes this, but `rendered`
  // stays true for the ~220ms exit animation — keep rendering the last
  // real request during that window instead of the sheet's own content
  // blanking out mid-close.
  const lastRequest = useRef<PromptRequest | null>(null)
  if (request) lastRequest.current = request
  const shown = request ?? lastRequest.current

  useEffect(() => {
    if (!request) return
    previouslyFocused.current = document.activeElement as HTMLElement | null
    setValue(request.initialValue ?? '')

    const timer = window.setTimeout(() => inputRef.current?.focus(), 50)

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('keydown', onKeyDown, true)
      previouslyFocused.current?.focus?.({ preventScroll: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request])

  if (!rendered || !shown) return null

  const canSubmit = !!request && (request.allowEmpty || value.trim().length > 0)

  function submit() {
    if (!canSubmit) return
    onSubmit(value.trim())
  }

  return (
    <ModalPortal>
      <div className={`sheet-scrim${closing ? ' sheet-scrim--closing' : ''}`} onClick={onCancel}>
        <div
          role="dialog"
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
            <h2 id={titleId} style={{ margin: '0 0 12px', fontSize: '1.05rem', fontWeight: 700 }}>
              {shown.title}
            </h2>
            {shown.label && (
              <label htmlFor={inputId} className="sr-only">
                {shown.label}
              </label>
            )}
            <input
              ref={inputRef}
              id={inputId}
              type="text"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit()
              }}
              style={{
                width: '100%',
                minHeight: 'var(--tap-min)',
                borderRadius: 12,
                border: '1px solid var(--line-strong)',
                background: 'var(--bg)',
                color: 'var(--text)',
                padding: '0 14px',
                fontSize: '0.95rem',
              }}
            />
            <button
              type="button"
              className="press"
              disabled={!canSubmit}
              onClick={submit}
              style={{
                marginTop: 16,
                width: '100%',
                minHeight: 'var(--tap-min)',
                borderRadius: 14,
                border: 'none',
                fontWeight: 700,
                fontSize: '0.95rem',
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                opacity: canSubmit ? 1 : 0.5,
                color: 'var(--bg)',
                background: 'var(--neon)',
              }}
            >
              {shown.submitLabel}
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
