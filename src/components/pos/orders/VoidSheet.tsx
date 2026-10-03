'use client'

// Cancelling an item or a whole order: a reason first, then one more "are you sure".
//
// The reason is a fixed list (VOID_REASONS) and the HEBREW string is what is sent and
// stored, so the owner's audit reads naturally in their own language whatever language
// the cashier's screen is in. Typing is not offered: free text here would become an
// unsearchable pile.
//
// Not optimistic on purpose: the person has just confirmed a destructive action and is
// waiting for the answer anyway, and a cancellation that appears done but was refused
// is worse than a half-second wait. A refusal is shown INSIDE this sheet, in words.

import { useEffect, useId, useState } from 'react'
import { Check } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import { haptic } from '@/lib/haptics'
import { VOID_REASONS } from '@/lib/pos/vocab'
import { ticketLabel } from '@/lib/pos/format'
import { useT, usePosLang } from '@/lib/pos/useT'
import { useLive } from '../live/LiveStore'
import { usePosToast } from '../shell/Toast'
import { errorText } from '../shell/errorText'
import './orders.css'

export type VoidTarget = {
  orderId: string
  ticketNo: number
  /** null = the whole order (everything not yet handed over) */
  itemIds: string[] | null
  /** what is being cancelled, in the cashier's words: "2× קפה הפוך" */
  label: string
}

export default function VoidSheet({ target, onClose }: { target: VoidTarget | null; onClose: () => void }) {
  const t = useT()
  const [lang] = usePosLang()
  const { voidItems } = useLive()
  const { toast } = usePosToast()
  const groupId = useId()
  // The sheet keeps its last target while it animates out, so the title does not flash empty.
  const [last, setLast] = useState<VoidTarget | null>(null)
  const [reason, setReason] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    if (!target) return
    // A fresh target starts from a clean sheet: a reason picked for one line must not carry to the next.
    setLast(target)
    setReason(null)
    setAsking(false)
    setBusy(false)
    setFailure(null)
  }, [target])

  const shown = target ?? last
  const whole = shown?.itemIds === null
  const reasonHe = VOID_REASONS.find((r) => r.key === reason)?.he ?? null

  const confirm: ConfirmRequest | null =
    asking && reasonHe
      ? {
          title: t(whole ? 'orders.void.confirmTitleOrder' : 'orders.void.confirmTitleItem'),
          body: t('orders.void.confirmBody', { reason: reasonHe }),
          confirmLabel: t('orders.void.confirmYes'),
          cancelLabel: t('orders.void.confirmNo'),
          danger: true,
        }
      : null

  async function run() {
    if (!reasonHe || !target) return
    setAsking(false)
    setBusy(true)
    setFailure(null)
    const r = await voidItems(target.orderId, target.itemIds, reasonHe)
    setBusy(false)
    if (!r.ok) {
      setFailure(errorText(t, r.code))
      return
    }
    haptic('impact')
    // The server may skip lines that were handed over a moment ago; say so rather than claim a full success.
    if (r.data.voided.length === 0) toast(t('orders.void.nothing'), { tone: 'warn' })
    else toast(t(whole ? 'orders.void.doneOrder' : 'orders.void.doneItem'), { tone: 'ok' })
    onClose()
  }

  return (
    <>
      <SheetShell open={!!target} onClose={busy ? () => {} : onClose} labelledBy="ord-void-title" suspended={asking}>
        {shown ? (
          <>
            <h2 id="ord-void-title" className="pos-sheet-title">
              {t(whole ? 'orders.void.titleOrder' : 'orders.void.titleItem')}
            </h2>
            <p className="pos-sheet-sub">
              {whole ? t('orders.void.subOrder', { ticket: ticketLabel(shown.ticketNo) }) : shown.label}
            </p>

            <div className="ord-reasons" role="group" aria-labelledby={groupId}>
              <p id={groupId} className="ord-section-title">
                {t('orders.void.reasonLabel')}
              </p>
              <div className="ord-reason-chips">
                {VOID_REASONS.map((r) => {
                  const on = reason === r.key
                  return (
                    <button
                      key={r.key}
                      type="button"
                      className={`ord-reason press${on ? ' is-on' : ''}`}
                      aria-pressed={on}
                      onClick={() => {
                        haptic('select')
                        setReason(r.key)
                        setFailure(null)
                      }}
                    >
                      {on ? <Check size={18} aria-hidden="true" /> : null}
                      <span>{lang === 'en' ? r.en : r.he}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {failure ? (
              <p className="pos-hint pos-hint--bad" role="alert">
                {failure}
              </p>
            ) : !reasonHe ? (
              <p className="pos-hint">{t('orders.void.needReason')}</p>
            ) : null}

            <div className="ord-sheet-actions">
              <button type="button" className="pos-btn press" onClick={onClose} disabled={busy}>
                {t('orders.void.back')}
              </button>
              <button
                type="button"
                className="pos-btn ord-danger press"
                disabled={!reasonHe || busy}
                onClick={() => setAsking(true)}
              >
                {busy ? t('orders.void.sending') : t(whole ? 'orders.act.voidOrder' : 'orders.act.voidItem')}
              </button>
            </div>
          </>
        ) : null}
      </SheetShell>
      <ConfirmSheet request={confirm} onConfirm={() => void run()} onCancel={() => setAsking(false)} />
    </>
  )
}
