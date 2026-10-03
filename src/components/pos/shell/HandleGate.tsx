'use client'

// "איך נקרא לך?" — the nickname gate. Until a person has confirmed the name their
// team will see next to everything they do, NOTHING else in the app is usable:
// PosApp does not even mount the screens, and this sheet cannot be dismissed
// (no Escape, no tap outside — SheetShell is handed a no-op onClose on purpose).
//
// The field starts with the suggestion the system picked, so the common case is a
// single tap on "המשך". Validation is live and specific (handleProblem), the
// button says WHY it is disabled in the line beneath the field rather than
// silently doing nothing, and "taken" is answered by the server (the database owns
// case-insensitive uniqueness) in words an employee can act on.
//
// The server's answers, from /api/pos/handle: a 409 `conflict` with details.reason
// 'taken' for a name somebody has; a 400 `bad_request` for a malformed one.

import { useEffect, useId, useRef, useState } from 'react'
import SheetShell from '@/components/SheetShell'
import { posApi } from '@/lib/pos/client'
import { handleProblem } from '@/lib/pos/validate'
import { LIMITS } from '@/lib/pos/vocab'
import { useT } from '@/lib/pos/useT'
import type { StrKey } from '@/lib/pos/i18n'
import { usePos, usePosActions } from '../PosProvider'
import { errorText } from './errorText'

const PROBLEM_KEY: Record<'too_short' | 'too_long' | 'bad_chars', StrKey> = {
  too_short: 'core.handle.tooShort',
  too_long: 'core.handle.tooLong',
  bad_chars: 'core.handle.badChars',
}

const noop = () => {}

export function HandleGate() {
  const t = useT()
  const { me } = usePos()
  const { patchMe, refreshAll } = usePosActions()
  const titleId = useId()
  const hintId = useId()
  const inputRef = useRef<HTMLInputElement>(null)

  const open = !me.handleConfirmed
  // The suggestion is what the server already stored as the person's handle.
  const [value, setValue] = useState(me.handle)
  const [busy, setBusy] = useState(false)
  const [takenFor, setTakenFor] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const edited = useRef(false)

  // If the first read arrives after mount with a different suggestion and the person has not typed yet, follow it.
  useEffect(() => {
    if (!edited.current) setValue(me.handle)
  }, [me.handle])

  const trimmed = value.trim()
  const problem = handleProblem(trimmed)
  const taken = takenFor !== null && takenFor.toLowerCase() === trimmed.toLowerCase()
  const canSave = !problem && !taken && !busy

  let message: string
  let bad = true
  if (problem) message = t(PROBLEM_KEY[problem])
  else if (taken) message = t('core.handle.taken')
  else if (failure) message = failure
  else {
    bad = false
    message = edited.current ? t('core.handle.hint') : t('core.handle.suggested')
  }

  async function save() {
    if (!canSave) return
    setBusy(true)
    setFailure(null)
    const r = await posApi.setHandle({ handle: trimmed })
    setBusy(false)
    if (r.ok) {
      // Reflect it at once, then let the shell re-read: the directory everyone else sees changes too.
      patchMe({ handle: r.data.handle, handleConfirmed: true })
      refreshAll()
      return
    }
    if (r.code === 'conflict' || r.details?.reason === 'taken') {
      setTakenFor(trimmed)
      inputRef.current?.focus()
      return
    }
    setFailure(r.code === 'network' ? errorText(t, 'network') : t('core.handle.failed'))
  }

  return (
    <SheetShell open={open} onClose={noop} labelledBy={titleId}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
      >
        <h2 id={titleId} className="pos-sheet-title">
          {t('core.handle.title')}
        </h2>
        <p className="pos-sheet-sub">{t('core.handle.sub')}</p>

        <label htmlFor={`${titleId}-input`} className="sr-only">
          {t('core.handle.label')}
        </label>
        <input
          id={`${titleId}-input`}
          ref={inputRef}
          className="pos-input"
          style={{ marginBlockStart: 14 }}
          value={value}
          onChange={(e) => {
            edited.current = true
            setValue(e.target.value)
            setFailure(null)
          }}
          maxLength={LIMITS.handleMax + 8}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          aria-invalid={bad}
          aria-describedby={hintId}
        />
        <p id={hintId} className={`pos-hint${bad ? ' pos-hint--bad' : ''}`} role={bad ? 'alert' : undefined}>
          {message}
        </p>

        <button
          type="submit"
          className="pos-btn pos-btn--primary press"
          style={{ marginBlockStart: 10 }}
          disabled={!canSave}
        >
          {busy ? t('core.handle.saving') : t('core.handle.save')}
        </button>
      </form>
    </SheetShell>
  )
}
