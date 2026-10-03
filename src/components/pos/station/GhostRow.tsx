'use client'

// A line that was cancelled AFTER it reached this point. It stays, grey and struck through,
// so nobody cooks a cancelled order — and it is a real <button> to dismiss (Ayeka's was a
// non-focusable <li onClick>, unreachable by keyboard and invisible to assistive tech).

import { Ban, X } from 'lucide-react'
import { nameOf, ticketLabel, type PosLang } from '@/lib/pos/format'
import { useT } from '@/lib/pos/useT'
import type { PosItem } from '@/lib/pos/types'

export default function GhostRow({
  line,
  lang,
  ticketNo,
  customerName,
  onDismiss,
}: {
  line: PosItem
  lang: PosLang
  /** given when the ghost is shown on its own (its order has no card here any more) */
  ticketNo?: number
  customerName?: string
  onDismiss: (lineId: string) => void
}) {
  const t = useT()
  const what = `${line.qty}× ${nameOf(line.name, lang)}`
  return (
    <li className="stg">
      <Ban size={20} aria-hidden="true" className="stg-icon" />
      <span className="stg-text">
        {ticketNo != null ? (
          <span className="stg-ticket">
            <span className="ltr-isolate">{ticketLabel(ticketNo)}</span>
            {customerName ? ` · ${customerName}` : ''}
            {' — '}
          </span>
        ) : null}
        <span className="stg-what">{what}</span>
        <span className="stg-note">{t('station.ghost.text')}</span>
      </span>
      <button
        type="button"
        className="stg-x press"
        onClick={() => onDismiss(line.id)}
        aria-label={t('station.ghost.dismiss', { what })}
      >
        <X size={20} aria-hidden="true" />
        <span className="stg-x-text">{t('station.ghost.ok')}</span>
      </button>
    </li>
  )
}
