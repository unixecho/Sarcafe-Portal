'use client'

// The confirmation chip after a send: `#42 · דנה · נשלח ✓`.
//
// The form clears the instant the cashier taps send, so this is the only evidence the order is
// on its way. Until the server answers it reads "sending" with the customer's name (never the
// ticket number, which does not exist yet); then the number appears. For UNDO.sendWindowS seconds
// it offers "ביטול" — safe, because nothing has been accepted at a station yet — and always
// "הוספה להזמנה" (re-enter the register in add-to-order mode).
//
// Cancel and add need the order's id, which the outbox's answer does not carry; it arrives with
// the live orders (matched by the idempotency key), normally well under a second. Until then the
// buttons are replaced by a short line saying so, not left disabled and unexplained.

import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Clock, Plus, RotateCcw, Undo2, X } from 'lucide-react'
import { UNDO } from '@/lib/pos/vocab'
import { useT } from '@/lib/pos/useT'
import { errorText } from '../shell/errorText'

export type SentChipModel = {
  clientKey: string
  name: string
  ticketNo: number | null
  state: 'pending' | 'sent' | 'cancelled' | 'attention'
  sentAt: number | null
  errorCode?: string
}

/** A ticking "now" that only runs while `active` — a chip row with nothing to count down costs nothing. */
export function useTick(active: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(id)
  }, [active, ms])
  return now
}

type Props = {
  chip: SentChipModel
  /** the live order this chip is about, once it has arrived */
  orderKnown: boolean
  now: number
  onUndo: (clientKey: string) => void
  onAdd: (clientKey: string) => void
  onDismiss: (clientKey: string) => void
  onRetry: (clientKey: string) => void
  onEdit: (clientKey: string) => void
}

export function SentChip({ chip, orderKnown, now, onUndo, onAdd, onDismiss, onRetry, onEdit }: Props) {
  const t = useT()
  const withinWindow = chip.sentAt !== null && now - chip.sentAt < UNDO.sendWindowS * 1000
  const number = chip.ticketNo !== null ? `#${chip.ticketNo}` : ''

  if (chip.state === 'attention') {
    return (
      <div className="reg-chipbar reg-chipbar--bad" role="alert">
        <AlertTriangle size={18} aria-hidden="true" />
        <span className="reg-chipbar-text">
          {t('register.sent.failed', { name: chip.name })} {errorText(t, chip.errorCode)}
        </span>
        <button type="button" className="reg-chipbar-btn press" onClick={() => onRetry(chip.clientKey)}>
          <RotateCcw size={16} aria-hidden="true" />
          {t('register.sent.retry')}
        </button>
        <button type="button" className="reg-chipbar-btn press" onClick={() => onEdit(chip.clientKey)}>
          {t('register.sent.edit')}
        </button>
      </div>
    )
  }

  if (chip.state === 'pending') {
    return (
      <div className="reg-chipbar" role="status">
        <Clock size={18} aria-hidden="true" />
        <span className="reg-chipbar-text">{t('register.sent.pending', { name: chip.name })}</span>
      </div>
    )
  }

  if (chip.state === 'cancelled') {
    return (
      <div className="reg-chipbar" role="status">
        <Undo2 size={18} aria-hidden="true" />
        <span className="reg-chipbar-text">
          <span className="ltr-isolate">{number}</span> · {chip.name} · {t('register.sent.cancelled')}
        </span>
        <button type="button" className="reg-chipbar-x press" aria-label={t('register.sent.dismiss')} onClick={() => onDismiss(chip.clientKey)}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>
    )
  }

  return (
    <div className="reg-chipbar reg-chipbar--ok" role="status">
      <Check size={18} aria-hidden="true" />
      <span className="reg-chipbar-text">
        <span className="ltr-isolate">{number}</span> · {chip.name} · {t('register.sent.ok')}
      </span>
      {orderKnown ? (
        <>
          {withinWindow && (
            <button type="button" className="reg-chipbar-btn press" onClick={() => onUndo(chip.clientKey)}>
              <Undo2 size={16} aria-hidden="true" />
              {t('register.sent.cancel')}
            </button>
          )}
          <button type="button" className="reg-chipbar-btn press" onClick={() => onAdd(chip.clientKey)}>
            <Plus size={16} aria-hidden="true" />
            {t('register.sent.add')}
          </button>
        </>
      ) : (
        <span className="reg-chipbar-wait">{t('register.sent.updating')}</span>
      )}
      <button type="button" className="reg-chipbar-x press" aria-label={t('register.sent.dismiss')} onClick={() => onDismiss(chip.clientKey)}>
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  )
}
