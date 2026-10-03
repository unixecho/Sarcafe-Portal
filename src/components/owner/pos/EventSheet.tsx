'use client'

import { useId, useState } from 'react'
import { CalendarPlus } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import { useT } from '@/lib/pos/useT'

// Create the event: a name, and what to start from. The web address of an event is
// made for the owner (nobody should have to invent an English "code" for a one-off
// festival), so there is exactly one thing to type.

export type EventSource = { slug: string; label: string }

export default function EventSheet({
  open,
  onClose,
  sources,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  sources: EventSource[]
  /** resolves with a plain sentence when it failed, null when the event exists now */
  onCreate: (name: string, cloneSlug: string | null) => Promise<string | null>
}) {
  const t = useT()
  const titleId = useId()
  const nameId = useId()
  const errId = useId()
  const [name, setName] = useState('')
  const [from, setFrom] = useState<string>(sources[0]?.slug ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)

  const nameOk = name.trim().length > 0

  async function submit() {
    setTouched(true)
    if (!nameOk || busy) return
    setBusy(true)
    setError(null)
    const failed = await onCreate(name.trim(), from || null)
    setBusy(false)
    if (failed) {
      setError(failed)
      return
    }
    setName('')
    setTouched(false)
    onClose()
  }

  return (
    <SheetShell open={open} onClose={busy ? () => {} : onClose} labelledBy={titleId}>
      <div className="os-sheet__head">
        <span className="os-sheet__badge" aria-hidden="true">
          <CalendarPlus size={20} strokeWidth={2} />
        </span>
        <h2 id={titleId} className="os-sheet__title">
          {t('owner.setup.eventSheet.title')}
        </h2>
      </div>
      <div className="sheet-scroll os-sheet__body">
        <label className="os-field" htmlFor={nameId}>
          <span className="os-field__label">{t('owner.setup.eventSheet.name')}</span>
          <input
            id={nameId}
            className="os-input"
            value={name}
            maxLength={60}
            placeholder={t('owner.setup.eventSheet.namePh')}
            aria-invalid={touched && !nameOk}
            aria-describedby={touched && !nameOk ? errId : undefined}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
          />
        </label>
        {touched && !nameOk && (
          <p id={errId} role="alert" className="os-error">
            {t('owner.setup.eventSheet.nameNeeded')}
          </p>
        )}

        <fieldset className="os-fieldset">
          <legend className="os-field__label">{t('owner.setup.eventSheet.from')}</legend>
          {sources.map((s) => (
            <label key={s.slug} className="os-choice" data-selected={from === s.slug}>
              <input type="radio" name="event-from" className="os-choice__input" checked={from === s.slug} onChange={() => setFrom(s.slug)} />
              <span className="os-choice__text">
                <span className="os-choice__title">{t('owner.setup.eventSheet.fromMenu', { name: s.label })}</span>
                <span className="os-choice__hint">{t('owner.setup.eventSheet.fromMenuHint')}</span>
              </span>
            </label>
          ))}
          <label className="os-choice" data-selected={from === ''}>
            <input type="radio" name="event-from" className="os-choice__input" checked={from === ''} onChange={() => setFrom('')} />
            <span className="os-choice__text">
              <span className="os-choice__title">{t('owner.setup.eventSheet.fromEmpty')}</span>
              <span className="os-choice__hint">{t('owner.setup.eventSheet.fromEmptyHint')}</span>
            </span>
          </label>
        </fieldset>
        <p className="os-note">{t('owner.setup.eventSheet.note')}</p>
        {error && (
          <p role="alert" className="os-error">
            {error}
          </p>
        )}
      </div>
      <div className="os-sheet__foot">
        <button type="button" className="os-btn os-btn--primary press" disabled={busy} onClick={() => void submit()}>
          {busy ? t('owner.setup.eventSheet.submitting') : t('owner.setup.eventSheet.submit')}
        </button>
      </div>
    </SheetShell>
  )
}
