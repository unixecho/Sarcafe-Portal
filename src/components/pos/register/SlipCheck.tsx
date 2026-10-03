'use client'

// The slip check: the cashier is transcribing a printed card-terminal slip, so the total must be
// checkable against it at a glance. Optional receipt number + the slip's total; a green tick when
// they agree, an amber difference when they do not.
//
// A mismatch NEVER blocks (a discount applied at the terminal is legitimate); sending asks one
// confirmation and the order records that it differed. The status is colour AND icon AND words.

import { AlertTriangle, Check } from 'lucide-react'
import type { SlipStatus } from '@/lib/pos/cart'
import { formatAgorot } from '@/lib/pos/money'
import { LIMITS } from '@/lib/pos/vocab'
import { useT } from '@/lib/pos/useT'

type Props = {
  receiptRef: string
  slipTotal: string
  status: SlipStatus
  onChange: (patch: { receiptRef?: string; slipTotal?: string }) => void
}

export function SlipCheck({ receiptRef, slipTotal, status, onChange }: Props) {
  const t = useT()
  return (
    <section className="reg-slip" aria-label={t('register.slip.title')}>
      <h3 className="reg-slip-h">{t('register.slip.title')}</h3>
      <div className="reg-slip-row">
        <div className="reg-slip-field">
          <label className="reg-label" htmlFor="reg-slip-ref">{t('register.slip.ref')}</label>
          <input
            id="reg-slip-ref"
            className="pos-input reg-in ltr-isolate"
            type="text"
            inputMode="numeric"
            dir="ltr"
            autoComplete="off"
            maxLength={LIMITS.receiptRefMax}
            value={receiptRef}
            onChange={(e) => onChange({ receiptRef: e.target.value })}
          />
        </div>
        <div className="reg-slip-field">
          <label className="reg-label" htmlFor="reg-slip-total">{t('register.slip.total')}</label>
          <input
            id="reg-slip-total"
            className="pos-input reg-in ltr-isolate"
            type="text"
            inputMode="decimal"
            dir="ltr"
            autoComplete="off"
            placeholder="0"
            aria-invalid={status.kind === 'invalid'}
            value={slipTotal}
            onChange={(e) => onChange({ slipTotal: e.target.value })}
          />
        </div>
      </div>
      <p className="reg-slip-status" aria-live="polite">
        {status.kind === 'match' && (
          <span className="reg-slip-ok">
            <Check size={18} aria-hidden="true" />
            {t('register.slip.match')}
          </span>
        )}
        {status.kind === 'diff' && (
          <span className="reg-slip-diff">
            <AlertTriangle size={18} aria-hidden="true" />
            {t('register.slip.diff', { amount: formatAgorot(Math.abs(status.diffAgorot)) })}
            <span className="reg-slip-dir">
              {status.diffAgorot > 0 ? t('register.slip.higher') : t('register.slip.lower')}
            </span>
          </span>
        )}
        {status.kind === 'invalid' && <span className="reg-slip-bad">{t('register.slip.invalid')}</span>}
      </p>
    </section>
  )
}
