'use client'

import type { ReactNode } from 'react'
import { Check, CircleAlert, Lock } from 'lucide-react'
import type { ReadinessStatus } from '@/lib/pos/owner-api'
import { useT } from '@/lib/pos/useT'

// One row of the readiness checklist: a number, a state, a plain sentence, ONE big
// button. The state is carried by an icon AND a word (never colour alone), and a row
// whose read failed says so with a retry instead of a confident tick — a green mark
// on something we could not read would tell the owner the event is ready when we
// do not know that.

type Props = {
  n: number
  title: string
  status: ReadinessStatus
  /** false => the read behind this row failed */
  known?: boolean
  /** this is the step to do next — drawn with a stronger edge */
  isNext?: boolean
  /** the one plain sentence about where this stands */
  summary: ReactNode
  /** why a blocked row is waiting, in words */
  reason?: string | null
  /** the row's one big button (or buttons) */
  action?: ReactNode
  onRetry?: () => void
  /** the row's own content (the point cards, the unrouted list …) */
  children?: ReactNode
  delay?: number
}

export default function ReadinessRow({ n, title, status, known = true, isNext, summary, reason, action, onRetry, children, delay = 0 }: Props) {
  const t = useT()
  const state = known ? status : 'attention'
  const word = !known
    ? t('owner.setup.status.unknown')
    : status === 'done'
      ? t('owner.setup.status.done')
      : status === 'blocked'
        ? t('owner.setup.status.blocked')
        : t('owner.setup.status.attention')
  const Icon = !known ? CircleAlert : status === 'done' ? Check : status === 'blocked' ? Lock : CircleAlert

  return (
    <li className="os-row rise" data-status={state} data-next={isNext ? 'true' : undefined} style={{ animationDelay: `${delay}ms` }}>
      <section aria-label={t('owner.setup.rowLabel', { n, title })}>
        <header className="os-row__head">
          <span className="os-row__mark" aria-hidden="true">
            <Icon size={18} strokeWidth={2.5} />
          </span>
          <div className="os-row__titles">
            <h2 className="os-row__title">
              <span className="os-row__n ltr-isolate">{n}</span> {title}
            </h2>
            <p className="os-row__state">{word}</p>
          </div>
        </header>
        <div className="os-row__summary">{known ? summary : t('owner.setup.loadFailed')}</div>
        {known && status === 'blocked' && reason && <p className="os-row__reason">{reason}</p>}
        {children}
        {!known && onRetry && (
          <div className="os-row__action">
            <button type="button" className="os-btn os-btn--ghost press" onClick={onRetry}>
              {t('owner.setup.retry')}
            </button>
          </div>
        )}
        {action && <div className="os-row__action">{action}</div>}
      </section>
    </li>
  )
}
