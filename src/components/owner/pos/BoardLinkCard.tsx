'use client'

import { useEffect, useState } from 'react'
import { Copy, ExternalLink, RefreshCw } from 'lucide-react'
import ConfirmSheet from '@/components/ConfirmSheet'
import type { BoardRow } from '@/lib/pos/owner-api'
import { useT } from '@/lib/pos/useT'

// The Ready-board link. This is the ONE place its secret token is ever shown: it is
// the board's only credential, so it is displayed here, copied from here, and replaced
// from here ("create a new link" kills the old one). Nothing else in the app prints it.

export default function BoardLinkCard({
  row,
  enabled,
  onRotate,
  notify,
}: {
  row: BoardRow
  /** the register is switched on for this event */
  enabled: boolean
  /** resolves true when the new link exists */
  onRotate: () => Promise<boolean>
  notify: (text: string, tone?: 'ok' | 'bad') => void
}) {
  const t = useT()
  const [origin, setOrigin] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)

  // The origin only exists in the browser; reading it in an effect keeps the server's
  // first paint and the client's first render identical.
  useEffect(() => setOrigin(window.location.origin), [])

  const url = row.path ? `${origin}${row.path}` : ''

  async function copy() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      notify(t('owner.setup.board.copied'))
    } catch {
      notify(t('owner.setup.board.copyFailed'), 'bad')
    }
  }

  async function rotate() {
    setConfirm(false)
    if (busy) return
    setBusy(true)
    const ok = await onRotate()
    setBusy(false)
    if (ok) notify(row.hasToken ? t('owner.setup.board.rotated') : t('owner.setup.board.created'))
  }

  if (!row.hasToken) {
    return (
      <div className="os-board">
        <p className="os-note">{enabled ? t('owner.setup.board.none') : t('owner.setup.board.blocked')}</p>
        <button type="button" className="os-btn os-btn--primary press" disabled={!enabled || busy} onClick={() => void rotate()}>
          {t('owner.setup.board.create')}
        </button>
      </div>
    )
  }

  return (
    <div className="os-board">
      <label className="os-field">
        <span className="os-field__label">{t('owner.setup.board.link')}</span>
        <input
          className="os-input os-input--link ltr-isolate"
          dir="ltr"
          readOnly
          value={url || row.path || ''}
          onFocus={(e) => e.currentTarget.select()}
        />
      </label>
      <div className="os-board__actions">
        <button type="button" className="os-btn os-btn--primary press" onClick={() => void copy()} disabled={!url}>
          <Copy size={18} strokeWidth={2} aria-hidden="true" />
          {t('owner.setup.board.copy')}
        </button>
        <a className="os-btn os-btn--ghost press" href={row.path ?? '#'} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={18} strokeWidth={2} aria-hidden="true" />
          {t('owner.setup.board.open')}
        </a>
        <button type="button" className="os-btn os-btn--quiet press" disabled={busy} onClick={() => setConfirm(true)}>
          <RefreshCw size={18} strokeWidth={2} aria-hidden="true" />
          {t('owner.setup.board.new')}
        </button>
      </div>
      <ConfirmSheet
        request={
          confirm
            ? {
                title: t('owner.setup.board.rotateTitle'),
                body: t('owner.setup.board.rotateBody'),
                confirmLabel: t('owner.setup.board.rotateConfirm'),
                cancelLabel: t('owner.setup.wiz.cancel'),
                danger: true,
              }
            : null
        }
        onConfirm={() => void rotate()}
        onCancel={() => setConfirm(false)}
      />
    </div>
  )
}
