'use client'

// Fixing a typo in an order's customer details: name, phone, receipt number, note.
//
// The old name is shown under the field because the name is what the other stations
// and the Ready board call the customer by — changing it is a visible act, and the
// audit records both names. The form is its own component so it mounts fresh every
// time the sheet opens: values start from the order as it is NOW, never from whatever
// was typed into a previous visit.

import { useId, useState } from 'react'
import SheetShell from '@/components/SheetShell'
import { posApi } from '@/lib/pos/client'
import { LIMITS } from '@/lib/pos/vocab'
import { ticketLabel } from '@/lib/pos/format'
import { normalizeCustomerName, normalizeNote, normalizePhone } from '@/lib/pos/validate'
import { useT } from '@/lib/pos/useT'
import type { PosOrder } from '@/lib/pos/types'
import { usePos } from '../PosProvider'
import { useLive } from '../live/LiveStore'
import { usePosToast } from '../shell/Toast'
import { errorText } from '../shell/errorText'
import './orders.css'

type Props = { open: boolean; order: PosOrder; onClose: () => void }

export default function EditCustomerSheet({ open, order, onClose }: Props) {
  const titleId = useId()
  return (
    <SheetShell open={open} onClose={onClose} labelledBy={titleId}>
      <EditForm titleId={titleId} order={order} onClose={onClose} />
    </SheetShell>
  )
}

function EditForm({ titleId, order, onClose }: { titleId: string; order: PosOrder; onClose: () => void }) {
  const t = useT()
  const { branchId } = usePos()
  const { refreshNow } = useLive()
  const { toast } = usePosToast()
  const uid = useId()

  const [name, setName] = useState(order.customer_name)
  const [phone, setPhone] = useState(order.customer_phone ?? '')
  const [receipt, setReceipt] = useState(order.receipt_ref ?? '')
  const [note, setNote] = useState(order.note ?? '')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const cleanName = normalizeCustomerName(name)
  const cleanPhone = normalizePhone(phone)
  const cleanReceipt = receipt.trim().slice(0, LIMITS.receiptRefMax) || null
  const cleanNote = normalizeNote(note, LIMITS.orderNoteMax)

  const nameBad = cleanName === null
  const phoneBad = cleanPhone === 'invalid'
  const changed =
    cleanName !== order.customer_name ||
    (cleanPhone === 'invalid' ? true : cleanPhone) !== (order.customer_phone ?? null) ||
    cleanReceipt !== (order.receipt_ref ?? null) ||
    cleanNote !== (order.note ?? null)

  // The line under the buttons always says why "save" is off.
  let hint: string | null = null
  if (failure) hint = failure
  else if (nameBad) hint = t('orders.edit.nameBad')
  else if (phoneBad) hint = t('orders.edit.phoneBad')
  else if (!changed) hint = t('orders.edit.noChange')
  const canSave = !nameBad && !phoneBad && changed && !busy

  async function save() {
    if (!canSave || cleanName === null || cleanPhone === 'invalid') return
    setBusy(true)
    setFailure(null)
    const r = await posApi.editOrder(order.id, {
      branchId,
      customerName: cleanName,
      customerPhone: cleanPhone,
      receiptRef: cleanReceipt,
      note: cleanNote,
    })
    setBusy(false)
    if (!r.ok) {
      setFailure(errorText(t, r.code))
      return
    }
    toast(t('orders.edit.done'), { tone: 'ok' })
    refreshNow()
    onClose()
  }

  const bad = !!failure || nameBad || phoneBad

  return (
    <form
      className="ord-form"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <h2 id={titleId} className="pos-sheet-title">
        {t('orders.edit.title')}
      </h2>
      <p className="pos-sheet-sub">{t('orders.edit.sub', { ticket: ticketLabel(order.ticket_no) })}</p>

      <div className="ord-field">
        <label htmlFor={`${uid}-name`}>{t('orders.edit.name')}</label>
        <input
          id={`${uid}-name`}
          className="pos-input"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setFailure(null)
          }}
          maxLength={LIMITS.customerNameMax + 20}
          autoComplete="off"
          enterKeyHint="next"
          aria-invalid={nameBad}
        />
        {order.customer_name && cleanName !== order.customer_name ? (
          <span className="ord-field-note">{t('orders.edit.oldName', { name: order.customer_name })}</span>
        ) : null}
      </div>

      <div className="ord-field">
        <label htmlFor={`${uid}-phone`}>{t('orders.edit.phone')}</label>
        <input
          id={`${uid}-phone`}
          className="pos-input ltr-isolate"
          type="tel"
          inputMode="tel"
          dir="ltr"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value)
            setFailure(null)
          }}
          autoComplete="off"
          enterKeyHint="next"
          aria-invalid={phoneBad}
        />
      </div>

      <div className="ord-field">
        <label htmlFor={`${uid}-receipt`}>{t('orders.edit.receipt')}</label>
        <input
          id={`${uid}-receipt`}
          className="pos-input ltr-isolate"
          dir="ltr"
          value={receipt}
          onChange={(e) => setReceipt(e.target.value)}
          maxLength={LIMITS.receiptRefMax + 10}
          autoComplete="off"
          enterKeyHint="next"
        />
      </div>

      <div className="ord-field">
        <label htmlFor={`${uid}-note`}>{t('orders.edit.note')}</label>
        <input
          id={`${uid}-note`}
          className="pos-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={LIMITS.orderNoteMax + 20}
          autoComplete="off"
          enterKeyHint="done"
        />
      </div>

      <p className={`pos-hint${bad ? ' pos-hint--bad' : ''}`} role={bad ? 'alert' : undefined}>
        {hint}
      </p>

      <div className="ord-sheet-actions">
        <button type="button" className="pos-btn press" onClick={onClose} disabled={busy}>
          {t('orders.edit.cancel')}
        </button>
        <button type="submit" className="pos-btn pos-btn--primary press" disabled={!canSave}>
          {busy ? t('orders.edit.saving') : t('orders.edit.save')}
        </button>
      </div>
    </form>
  )
}
