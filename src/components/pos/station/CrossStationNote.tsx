'use client'

// "גם ב: עגלה חיצונית · 1 מוכן, 1 בהכנה" — the order is ONE order; this screen only shows the
// lines that are made here. Without this line a cook sees "2 coffees" on a ticket whose food
// is elsewhere and cannot tell whether the order is nearly done or hasn't started. It is
// muted on purpose: context, not a task.

import { Split } from 'lucide-react'
import { useT } from '@/lib/pos/useT'

export type OtherPoint = {
  pointId: string
  name: string
  waiting: number
  preparing: number
  ready: number
  delivered: number
}

export default function CrossStationNote({ others }: { others: OtherPoint[] }) {
  const t = useT()
  if (others.length === 0) return null
  const entries = others.map((o) => {
    const parts: string[] = []
    if (o.waiting) parts.push(o.waiting === 1 ? t('station.cross.waitingOne', { n: o.waiting }) : t('station.cross.waitingMany', { n: o.waiting }))
    if (o.preparing) parts.push(t('station.cross.preparing', { n: o.preparing }))
    if (o.ready) parts.push(o.ready === 1 ? t('station.cross.readyOne', { n: o.ready }) : t('station.cross.readyMany', { n: o.ready }))
    if (o.delivered) parts.push(o.delivered === 1 ? t('station.cross.doneOne', { n: o.delivered }) : t('station.cross.doneMany', { n: o.delivered }))
    return parts.length ? `${o.name} · ${parts.join(', ')}` : o.name
  })
  return (
    <p className="stc-cross">
      <Split size={16} aria-hidden="true" />
      <span>{t('station.cross.also', { list: entries.join(' | ') })}</span>
    </p>
  )
}
