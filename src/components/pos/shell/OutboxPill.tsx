'use client'

// "Orders that have not reached the stations yet" — the other half of the cashier's
// promise that a paid-for order is never lost (the queue itself is lib/pos/outbox.ts;
// this is the window onto it). Silent when the queue is empty. When it is not, it
// says how many and whether any NEED a person:
//
//   waiting / sending  -> amber: nothing to do, the device is retrying by itself
//   needs attention    -> red:   the server refused it (sold out, event closed …)
//
// Tapping opens a sheet listing each order by CUSTOMER NAME (never the phone — that
// number is personal data and has no business on a shared screen) with the reason in
// plain Hebrew, "send again" and "delete". Deleting asks first, in a ConfirmSheet,
// and says what it means: the order will not exist anywhere, so if the customer has
// already paid it has to be typed again. Nothing leaves this queue silently.

import { useState } from 'react'
import { AlertTriangle, Clock, Send } from 'lucide-react'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import SheetShell from '@/components/SheetShell'
import { timeLabel } from '@/lib/pos/format'
import { useOutbox, type OutboxEntry } from '@/lib/pos/outbox'
import { useT } from '@/lib/pos/useT'
import { usePos } from '../PosProvider'
import { errorText } from './errorText'

function itemCount(entry: OutboxEntry): number {
  return entry.body.lines.reduce((n, l) => n + (typeof l.qty === 'number' ? l.qty : 1), 0)
}

export function OutboxPill() {
  const t = useT()
  const { branchId } = usePos()
  const { entries, pendingCount, attentionCount, retry, discard } = useOutbox(branchId)
  const [open, setOpen] = useState(false)
  const [asking, setAsking] = useState<OutboxEntry | null>(null)

  const nameOf = (e: OutboxEntry) => e.body.customerName.trim() || t('core.outbox.unnamed')

  const confirm: ConfirmRequest | null = asking
    ? {
        title: t('core.outbox.discardTitle', { name: nameOf(asking) }),
        body: t('core.outbox.discardBody'),
        confirmLabel: t('core.outbox.discardYes'),
        cancelLabel: t('core.outbox.discardNo'),
        danger: true,
      }
    : null

  const needsAttention = attentionCount > 0
  const label = needsAttention
    ? t(attentionCount === 1 ? 'core.outbox.attentionOne' : 'core.outbox.attentionMany', { n: attentionCount })
    : t(pendingCount === 1 ? 'core.outbox.pendingOne' : 'core.outbox.pendingMany', { n: pendingCount })

  return (
    <>
      {entries.length > 0 && (
        <button
          type="button"
          className={`pos-pill ${needsAttention ? 'pos-pill--danger' : 'pos-pill--warn'} press`}
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
        >
          {needsAttention ? <AlertTriangle size={16} aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
          <span>{label}</span>
        </button>
      )}

      <SheetShell open={open} onClose={() => setOpen(false)} labelledBy="pos-outbox-title" suspended={!!asking}>
        <h2 id="pos-outbox-title" className="pos-sheet-title">
          {t('core.outbox.title')}
        </h2>
        <p className="pos-sheet-sub">{t('core.outbox.sub')}</p>

        <div className="sheet-scroll" style={{ marginBlockStart: 14 }}>
          {entries.length === 0 ? (
            <p className="pos-sheet-sub">{t('core.outbox.empty')}</p>
          ) : (
            <ul className="pos-ob-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {entries.map((e) => {
                const attention = e.state === 'attention'
                const sending = e.state === 'sending'
                const reason = e.lastError ? errorText(t, e.lastError.code) : null
                return (
                  <li key={e.clientKey} className={`pos-ob-row${attention ? ' pos-ob-row--attention' : ''}`}>
                    <div className="pos-ob-head">
                      <span>{nameOf(e)}</span>
                      <span className="pos-ob-meta">
                        <Clock size={14} aria-hidden="true" />
                        <span className="ltr-isolate">{timeLabel(new Date(e.queuedAt).toISOString())}</span>
                        <span>·</span>
                        <span>{t('core.outbox.items', { n: itemCount(e) })}</span>
                      </span>
                    </div>
                    <p className="pos-ob-reason">
                      {attention
                        ? `${t('core.outbox.problem')}. ${reason ?? ''}`.trim()
                        : sending
                          ? t('core.outbox.sending')
                          : `${t('core.outbox.waiting')}${reason ? `. ${reason}` : ''}`}
                    </p>
                    <div className="pos-ob-actions">
                      <button
                        type="button"
                        className="pos-btn press"
                        onClick={() => retry(e.clientKey)}
                        disabled={sending}
                      >
                        {sending ? t('core.outbox.sending') : t('core.outbox.retry')}
                      </button>
                      <button type="button" className="pos-btn press" onClick={() => setAsking(e)} disabled={sending}>
                        {t('core.outbox.discard')}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <button type="button" className="pos-btn press" style={{ marginBlockStart: 12 }} onClick={() => setOpen(false)}>
          {t('core.close')}
        </button>
      </SheetShell>

      <ConfirmSheet
        request={confirm}
        onCancel={() => setAsking(null)}
        onConfirm={() => {
          if (asking) discard(asking.clientKey)
          setAsking(null)
        }}
      />
    </>
  )
}
