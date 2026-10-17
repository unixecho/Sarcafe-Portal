'use client'

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { X } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import { InlineError } from '@/components/shifts/ui'
import '@/components/shifts/schedule.css'

// The one way to fix a missing or wrong field WITHOUT leaving the screen you are on (owner, 2026-10-17: no redundant redirections, they
// make the app feel sluggish). A small dialog with only the field(s) that are needed, a save button, and the answer in place. `onSave`
// returns an error sentence to show, or null when it worked (the dialog then closes). Pass `hideSave` for a dialog whose content has its
// own buttons (a choice, an invitation link, switches that apply at once).
export default function FieldSheet({ open, title, lead, onClose, onSave, saveLabel = 'שמירה', hideSave = false, children }: {
  open: boolean
  title: string
  lead?: string
  onClose: () => void
  onSave?: () => Promise<string | null>
  saveLabel?: string
  hideSave?: boolean
  children: ReactNode
}) {
  const titleId = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  // The field that is needed gets the cursor (the sheet itself puts focus on its first button after its slide-in, so this runs after that).
  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => bodyRef.current?.querySelector<HTMLElement>('input, textarea, select')?.focus(), 160)
    return () => window.clearTimeout(timer)
  }, [open])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!onSave || busy) return
    setBusy(true)
    setError(null)
    const problem = await onSave()
    setBusy(false)
    if (problem) { setError(problem); return }
    onClose()
  }
  function close() {
    setError(null)
    onClose()
  }

  return (
    <SheetShell open={open} onClose={close} labelledBy={titleId} className="sch-sheet">
      <form onSubmit={(event) => void submit(event)} style={{ display: 'contents' }}>
        <div className="sch-sheet__head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id={titleId} className="sch-sheet__title">{title}</h2>
            {lead && <p className="sch-sheet__sub">{lead}</p>}
          </div>
          <button type="button" className="sch-iconbtn press" onClick={close} aria-label="סגירה"><X size={20} aria-hidden="true" /></button>
        </div>
        <div className="sheet-scroll" style={{ gap: 14 }} ref={bodyRef}>
          {children}
          {error && <InlineError>{error}</InlineError>}
        </div>
        {!hideSave && (
          <div className="sch-sheet__foot">
            <button type="button" className="sch-btn press" style={{ flex: 1 }} onClick={close}>ביטול</button>
            <button type="submit" className="sch-btn sch-btn--primary press" style={{ flex: 2 }} disabled={busy}>{busy ? 'שומר…' : saveLabel}</button>
          </div>
        )}
      </form>
    </SheetShell>
  )
}
