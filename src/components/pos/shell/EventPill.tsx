'use client'

// Is the event open? One glance, always visible (unlike the connection pill, this
// one is not a warning — it is the single most useful fact about the day).
// Open / closed / practice, each with its own icon AND word: never colour alone.
// In practice mode it also says, in plain words, that the orders are not real.

import { CircleCheck, CircleSlash, GraduationCap } from 'lucide-react'
import { timeLabel } from '@/lib/pos/format'
import { useT } from '@/lib/pos/useT'
import { usePos } from '../PosProvider'

export function EventPill() {
  const t = useT()
  const { session, isTraining } = usePos()

  if (!session) {
    return (
      <span className="pos-pill pos-pill--event pos-pill--warn" role="status" aria-label={t('core.event.closedHint')}>
        <CircleSlash size={16} aria-hidden="true" />
        <span className="pos-pill-text">{t('core.event.closed')}</span>
      </span>
    )
  }
  if (isTraining) {
    return (
      <span className="pos-pill pos-pill--event pos-pill--warn" role="status" aria-label={t('core.event.trainingHint')}>
        <GraduationCap size={16} aria-hidden="true" />
        <span className="pos-pill-text">{t('core.event.training')}</span>
      </span>
    )
  }
  const since = timeLabel(session.started_at)
  return (
    <span
      className="pos-pill pos-pill--event pos-pill--ok"
      role="status"
      aria-label={since ? t('core.event.openSince', { time: since }) : t('core.event.open')}
    >
      <CircleCheck size={16} aria-hidden="true" />
      <span className="pos-pill-text">{t('core.event.open')}</span>
    </span>
  )
}
