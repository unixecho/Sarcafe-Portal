'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import ModalPortal from '@/components/ModalPortal'
import { useSheetExit } from '@/lib/useSheetExit'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

type SheetShellProps = {
  open: boolean
  onClose: () => void
  children: ReactNode
  labelledBy?: string
  /** True while a nested overlay (e.g. a ConfirmSheet opened from inside
   * this sheet) should own the keyboard — this sheet's Escape/Tab handling
   * is skipped so the nested one gets it instead. Each overlay layer keeps
   * its own portal/z-index tier rather than trying to coordinate through
   * shared state. */
  suspended?: boolean
  className?: string
}

/**
 * The real reusable sheet primitive — full dialog semantics (focus trap,
 * focus restore, scroll lock, Escape/scrim-click to close) on top of the
 * shared .sheet-scrim/.sheet-panel CSS shell. Ported from AyekaBar.
 */
export default function SheetShell({ open, onClose, children, labelledBy, suspended, className }: SheetShellProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const { rendered, closing } = useSheetExit(open)

  useEffect(() => {
    if (!open) return

    previouslyFocused.current = document.activeElement as HTMLElement | null
    document.body.style.overflow = 'hidden'

    // The panel is still mid-slide-up on first paint; focusing immediately
    // makes iOS scroll the (still-animating) sheet into view awkwardly.
    const focusTimer = window.setTimeout(() => {
      const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      first?.focus()
    }, 60)

    function getFocusable(): HTMLElement[] {
      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []
      return Array.from(nodes).filter((el) => el.offsetParent !== null)
    }

    function onKeyDown(event: KeyboardEvent) {
      if (suspended) return

      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }

      if (event.key !== 'Tab') return

      const focusable = getFocusable()
      if (!focusable.length) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement

      if (event.shiftKey && (active === first || !panelRef.current?.contains(active))) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first?.focus()
      } else if (!panelRef.current?.contains(active)) {
        event.preventDefault()
        first?.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = ''

      const active = document.activeElement
      const stillInsideOrBody =
        active === document.body || (panelRef.current?.contains(active) ?? false)
      if (stillInsideOrBody) {
        previouslyFocused.current?.focus?.({ preventScroll: true })
      }
    }
  }, [open, onClose, suspended])

  if (!rendered) return null

  return (
    <ModalPortal>
      <div
        className={`sheet-scrim${closing ? ' sheet-scrim--closing' : ''}`}
        onClick={onClose}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          className={`sheet-panel${className ? ` ${className}` : ''}`}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="sheet-grabber" aria-hidden="true" />
          {children}
        </div>
      </div>
    </ModalPortal>
  )
}
