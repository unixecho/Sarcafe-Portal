'use client'

import { useEffect, useState } from 'react'
import { DoorClosed, DoorOpen, FlaskConical, Trash2 } from 'lucide-react'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import { timeLabel } from '@/lib/pos/format'
import type { SessionAction, SessionActionOk, SessionActionRefused, SessionRowSetup } from '@/lib/pos/owner-api'
import { usePosLang, useT } from '@/lib/pos/useT'
import { errorText } from '@/components/pos/shell/errorText'
import type { Reply } from './SetupWorkspace'

// Opening and closing the event. The employee-facing vocabulary is "the event is
// open / closed"; the practice mode is "practice", with a plain promise: nothing in
// it counts and it can all be wiped.
//
// Closing is guarded from both ends. The server refuses while items are still being
// made (nothing for us to offer — finish them), and when ready orders sit uncollected
// it answers with a count so we can ask "cancel them as not collected?" instead of
// leaving the owner stuck. Every close asks first: it cannot be undone from here.

type Pending = 'close' | 'endTraining' | 'wipe' | { uncollected: number } | null

export default function SessionButton({
  row,
  canOpen,
  blockedText,
  run,
  onDone,
}: {
  row: SessionRowSetup
  canOpen: boolean
  /** why the open buttons are off, in words (null when they are on) */
  blockedText: string | null
  run: (action: SessionAction) => Promise<Reply<SessionActionOk | SessionActionRefused>>
  onDone: (message: string, tone?: 'ok' | 'bad') => void
}) {
  const t = useT()
  const [lang] = usePosLang()
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<Pending>(null)
  const [error, setError] = useState<string | null>(null)

  const active = row.active
  const training = active?.kind === 'training'

  // The clock reads the browser's time zone, which the server's first paint does not
  // know — formatting it in an effect keeps both renders identical (no hydration warning).
  const startedAt = active?.started_at ?? null
  const [clock, setClock] = useState('—')
  useEffect(() => setClock(startedAt ? timeLabel(startedAt) || '—' : '—'), [startedAt])

  async function go(action: SessionAction) {
    if (busy) return
    setBusy(true)
    setError(null)
    setPending(null)
    const r = await run(action)
    setBusy(false)
    if (!r.ok) {
      setError(errorText(t, r.code))
      return
    }
    const body = r.body
    if (body.ok) {
      const message =
        action === 'open'
          ? t('owner.setup.session.opened')
          : action === 'open_training'
            ? t('owner.setup.session.trainingOpened')
            : action === 'wipe_training'
              ? body.wipedOrders
                ? t('owner.setup.wipe.done', { n: body.wipedOrders })
                : t('owner.setup.wipe.doneNone')
              : training
                ? t('owner.setup.session.trainingEnded')
                : t('owner.setup.session.closedDone')
      onDone(message)
      return
    }
    // A refusal is an ordinary answer. Ready-but-uncollected has a way forward; the
    // others are said in the server's own plain words.
    if (body.reason === 'uncollected' && (body.uncollected ?? 0) > 0) {
      setPending({ uncollected: body.uncollected ?? 0 })
      return
    }
    setError(body.message[lang])
  }

  const confirm: ConfirmRequest | null =
    pending === 'close'
      ? { title: t('owner.setup.close.title'), body: t('owner.setup.close.body'), confirmLabel: t('owner.setup.close.confirm'), cancelLabel: t('owner.setup.wiz.cancel'), danger: true }
      : pending === 'endTraining'
        ? { title: t('owner.setup.endTraining.title'), body: t('owner.setup.endTraining.body'), confirmLabel: t('owner.setup.endTraining.confirm'), cancelLabel: t('owner.setup.wiz.cancel') }
        : pending === 'wipe'
          ? { title: t('owner.setup.wipe.title'), body: t('owner.setup.wipe.body'), confirmLabel: t('owner.setup.wipe.confirm'), cancelLabel: t('owner.setup.wiz.cancel'), danger: true }
          : pending && typeof pending === 'object'
            ? {
                title: t('owner.setup.uncollected.title'),
                body: t('owner.setup.uncollected.body', { n: pending.uncollected }),
                confirmLabel: t('owner.setup.uncollected.confirm'),
                cancelLabel: t('owner.setup.wiz.cancel'),
                danger: true,
              }
            : null

  function onConfirm() {
    if (pending === 'close' || pending === 'endTraining') void go('close')
    else if (pending === 'wipe') void go('wipe_training')
    else if (pending && typeof pending === 'object') void go('close_void_uncollected')
  }

  return (
    <div className="os-session">
      {active ? (
        <>
          <p className="os-note" data-training={training ? 'true' : undefined}>
            {training
              ? t('owner.setup.session.openTraining', { time: clock })
              : t('owner.setup.session.openLive', { time: clock })}
          </p>
          <div className="os-session__buttons">
            <button type="button" className="os-btn os-btn--big os-btn--danger press" disabled={busy} onClick={() => setPending(training ? 'endTraining' : 'close')}>
              <DoorClosed size={22} strokeWidth={2} aria-hidden="true" />
              {training ? t('owner.setup.session.endTraining') : t('owner.setup.session.close')}
            </button>
            {training && (
              <button type="button" className="os-btn os-btn--ghost press" disabled={busy} onClick={() => setPending('wipe')}>
                <Trash2 size={18} strokeWidth={2} aria-hidden="true" />
                {t('owner.setup.session.wipe')}
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="os-session__buttons">
            <button type="button" className="os-btn os-btn--big os-btn--primary press" disabled={!canOpen || busy} onClick={() => void go('open')}>
              <DoorOpen size={22} strokeWidth={2} aria-hidden="true" />
              {t('owner.setup.session.open')}
            </button>
            <button type="button" className="os-btn os-btn--big os-btn--ghost press" disabled={!canOpen || busy} onClick={() => void go('open_training')}>
              <FlaskConical size={22} strokeWidth={2} aria-hidden="true" />
              {t('owner.setup.session.training')}
            </button>
          </div>
          {!canOpen && blockedText && <p className="os-note os-note--why">{blockedText}</p>}
          <p className="os-note">{t('owner.setup.session.trainingHint')}</p>
          <div>
            <button type="button" className="os-btn os-btn--quiet press" disabled={busy} onClick={() => setPending('wipe')}>
              <Trash2 size={18} strokeWidth={2} aria-hidden="true" />
              {t('owner.setup.session.wipe')}
            </button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="os-error">
          {error}
        </p>
      )}
      <ConfirmSheet request={confirm} onConfirm={onConfirm} onCancel={() => setPending(null)} />
    </div>
  )
}
