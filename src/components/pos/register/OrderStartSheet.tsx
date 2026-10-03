'use client'

// The order-start sheet (blueprint §1a.1): who is the customer? Name is required and focused;
// Enter moves to the phone; Enter again (or the one primary button) starts the order.
//
// The phone is optional and only "recommended". It is personal data, so the sheet states in one
// line what it is for and, in the same breath, that nobody gets a text message — no SMS exists.
// Nothing is committed to the draft until the sheet is submitted, so closing it with Escape
// leaves a clean slate rather than a half-named order.

import { useRef, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import { normalizeCustomerName, normalizePhone } from '@/lib/pos/validate'
import { LIMITS } from '@/lib/pos/vocab'
import { useT } from '@/lib/pos/useT'
import { haptic } from '@/lib/haptics'

type Props = {
  open: boolean
  initialName: string
  initialPhone: string
  /** bumps on every open so the fields reset */
  seq: number
  onSubmit: (name: string, phone: string) => void
  onClose: () => void
}

export default function OrderStartSheet({ open, initialName, initialPhone, seq, onSubmit, onClose }: Props) {
  return (
    <SheetShell open={open} onClose={onClose} labelledBy="reg-start-title" className="reg-sheet reg-sheet--start">
      <Body key={seq} initialName={initialName} initialPhone={initialPhone} onSubmit={onSubmit} />
    </SheetShell>
  )
}

function Body({ initialName, initialPhone, onSubmit }: Pick<Props, 'initialName' | 'initialPhone' | 'onSubmit'>) {
  const t = useT()
  const [name, setName] = useState(initialName)
  const [phone, setPhone] = useState(initialPhone)
  const [touched, setTouched] = useState(false)
  const phoneRef = useRef<HTMLInputElement>(null)

  const cleanName = normalizeCustomerName(name)
  const phoneState = normalizePhone(phone)
  const phoneBad = phoneState === 'invalid'
  const ready = cleanName !== null && !phoneBad

  function submit() {
    if (!ready || cleanName === null) {
      setTouched(true)
      return
    }
    haptic('select')
    onSubmit(cleanName, phone.trim())
  }

  const nameHint = touched && cleanName === null ? t('register.start.needName') : ''

  return (
    <form
      className="reg-form"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <header className="reg-cz-head">
        <div>
          <h2 id="reg-start-title" className="pos-sheet-title">{t('register.start.title')}</h2>
          <p className="pos-sheet-sub">{t('register.start.sub')}</p>
        </div>
      </header>

      <div className="sheet-scroll reg-cz-body">
        <label className="reg-label" htmlFor="reg-start-name">{t('register.start.name')}</label>
        <input
          id="reg-start-name"
          className="pos-input reg-in"
          type="text"
          autoFocus
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="next"
          maxLength={LIMITS.customerNameMax}
          aria-invalid={nameHint !== ''}
          aria-describedby="reg-start-name-hint"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            // Enter in the name moves on to the phone; it must not submit a half-filled form.
            if (e.key === 'Enter') {
              e.preventDefault()
              if (cleanName === null) setTouched(true)
              else phoneRef.current?.focus()
            }
          }}
        />
        <p id="reg-start-name-hint" className={`pos-hint${nameHint ? ' pos-hint--bad' : ''}`} role={nameHint ? 'alert' : undefined}>
          {nameHint}
        </p>

        <label className="reg-label" htmlFor="reg-start-phone">{t('register.start.phone')}</label>
        <input
          id="reg-start-phone"
          ref={phoneRef}
          className="pos-input reg-in ltr-isolate"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          enterKeyHint="go"
          dir="ltr"
          maxLength={24}
          placeholder={t('register.start.phonePlaceholder')}
          aria-invalid={phoneBad}
          aria-describedby="reg-start-phone-hint"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <p id="reg-start-phone-hint" className={`pos-hint${phoneBad ? ' pos-hint--bad' : ''}`} role={phoneBad ? 'alert' : undefined}>
          {phoneBad ? t('register.start.badPhone') : t('register.start.privacy')}
        </p>
      </div>

      <footer className="reg-cz-foot">
        <button type="submit" className="pos-btn pos-btn--primary reg-cz-add press" disabled={!ready}>
          <span>{t('register.start.go')}</span>
          <ArrowLeft size={20} aria-hidden="true" className="reg-flip" />
        </button>
        {!ready && !phoneBad && <p className="reg-why" role="status">{t('register.start.needName')}</p>}
      </footer>
    </form>
  )
}
