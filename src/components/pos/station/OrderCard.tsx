'use client'

// One order's lines AT THIS POINT, as a large card readable from across the counter.
//
// The order is ONE order: this card is filtered to the lines made here, and CrossStationNote
// says what the rest of it is doing. It is keyed by order id by the parent and never re-sorted,
// so a status change repaints it in place — a card that moves under a finger is the "whack-a-mole"
// bug Ayeka never explained. The entrance animation is a class the parent sets only for a card
// that arrived after the screen opened.
//
// Aging colours the card by the WORST stage among its unaccepted lines: warming is a still amber
// tint (a quiet first stage makes escalation read as time passing), late flashes, critical glows.
// Under reduced motion late/critical keep a still tint + border + the icon so they stay distinct.

import { memo, type PointerEvent } from 'react'
import { AlertTriangle, Hourglass, Timer } from 'lucide-react'
import { haptic } from '@/lib/haptics'
import { lineAge, waitingSeconds, worstStage } from '@/lib/pos/aging'
import { clockLabel, ticketLabel, type PosLang } from '@/lib/pos/format'
import { cardAction } from '@/lib/pos/lifecycle'
import { useT } from '@/lib/pos/useT'
import type { StrKey } from '@/lib/pos/i18n'
import type { PosItem, PosOrder, PosPoint } from '@/lib/pos/types'
import { HandleChip } from '../shell/HandleChip'
import CrossStationNote, { type OtherPoint } from './CrossStationNote'
import GhostRow from './GhostRow'
import LineRow from './LineRow'

export type StationCard = {
  order: Pick<PosOrder, 'id' | 'ticket_no' | 'customer_name' | 'created_by' | 'created_by_handle' | 'created_at'>
  /** this point's live + delivered lines, in the order they were sent */
  lines: PosItem[]
  /** the live ones (sent / preparing / ready) */
  live: PosItem[]
  /** every line here is delivered */
  done: boolean
  /** lines cancelled after they reached this point and not yet dismissed on this device */
  ghosts: PosItem[]
  others: OtherPoint[]
  /** the lowest batch number among this point's lines — anything above it is a later addition */
  firstBatch: number
}

const ACTION_KEY = {
  accept: 'station.act.accept',
  ready: 'station.act.ready',
  handover: 'station.act.handover',
} as const satisfies Record<string, StrKey>

function OrderCard({
  card,
  point,
  now,
  meId,
  lang,
  fresh,
  freshLines,
  shaking,
  dragging,
  onAdvanceCard,
  onAdvanceLine,
  onRevertLine,
  onDismissGhost,
  onCardPointerDown,
}: {
  card: StationCard
  point: PosPoint
  now: number
  meId: string
  lang: PosLang
  fresh: boolean
  freshLines: ReadonlySet<string>
  shaking: boolean
  dragging: boolean
  onAdvanceCard: (ids: string[], from: 'sent' | 'preparing' | 'ready', to: 'preparing' | 'ready' | 'delivered') => void
  onAdvanceLine: (line: PosItem) => void
  onRevertLine: (line: PosItem) => void
  onDismissGhost: (lineId: string) => void
  onCardPointerDown: (e: PointerEvent<HTMLElement>, orderId: string) => void
}) {
  const t = useT()
  const { order, live } = card
  const action = cardAction(live, point)
  const stage = worstStage(live.map((l) => lineAge(l, now)))
  const oldestSent = live.reduce<string | null>((o, l) => (!o || l.sent_at < o ? l.sent_at : o), null)
  const waited = oldestSent ? waitingSeconds(oldestSent, now) : 0
  // the clock's colour is the card's aging stage (unaccepted lines only): once accepted the time is prep time, not a warning
  const clockStage = stage
  const allReady = live.length > 0 && live.every((l) => l.status === 'ready')
  const waitingForHandover = !action && live.some((l) => l.status === 'ready') && !point.hands_over
  const titleId = `stc-${order.id}`
  const partial = action && action.ids.length < live.length

  const cls = [
    'stc',
    stage !== 'fresh' ? `stc--age-${stage}` : '',
    allReady ? 'stc--ready' : '',
    fresh ? 'is-new' : '',
    shaking ? 'is-shake' : '',
    dragging ? 'is-dragging' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <article
      className={cls}
      data-station-card
      data-order-id={order.id}
      tabIndex={0}
      aria-labelledby={titleId}
      onPointerDown={(e) => onCardPointerDown(e, order.id)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <header className="stc-head">
        <h2 id={titleId} className="stc-title">
          <span className="ltr-isolate">{ticketLabel(order.ticket_no)}</span>
          {order.customer_name ? <span className="stc-name"> · {order.customer_name}</span> : null}
        </h2>
        {oldestSent ? (
          <span className={`stc-clock stc-clock--${clockStage}`}>
            {clockStage === 'late' || clockStage === 'critical' ? <AlertTriangle size={20} aria-hidden="true" /> : <Timer size={20} aria-hidden="true" />}
            <span className="ltr-isolate">{clockLabel(waited)}</span>
            <span className="sr-only">{t('station.card.waited')}</span>
          </span>
        ) : null}
      </header>

      <p className="stc-by">
        <span>{t('station.card.createdBy')}</span>
        <HandleChip staffId={order.created_by} handle={order.created_by_handle} />
      </p>

      <CrossStationNote others={card.others} />

      <ul className="stc-lines">
        {card.lines.map((l) => (
          <LineRow
            key={l.id}
            line={l}
            handsOver={point.hands_over}
            mine={l.claimed_by === meId && (l.status === 'preparing' || l.status === 'ready')}
            later={l.batch_no > card.firstBatch}
            fresh={freshLines.has(l.id)}
            lang={lang}
            onAdvance={onAdvanceLine}
            onRevert={onRevertLine}
          />
        ))}
        {card.ghosts.map((g) => (
          <GhostRow key={g.id} line={g} lang={lang} onDismiss={onDismissGhost} />
        ))}
      </ul>

      {action ? (
        <button
          type="button"
          className={`stc-go stc-go--${action.kind} press`}
          onClick={() => {
            haptic('impact')
            onAdvanceCard(action.ids, action.from as 'sent' | 'preparing' | 'ready', action.to as 'preparing' | 'ready' | 'delivered')
          }}
        >
          <span className="stc-go-label">{t(ACTION_KEY[action.kind])}</span>
          {partial ? <span className="stc-go-sub">{t('station.card.someOf', { n: action.ids.length, total: live.length })}</span> : null}
        </button>
      ) : waitingForHandover ? (
        <p className="stc-wait">
          <Hourglass size={22} aria-hidden="true" />
          <span>{t('station.card.waitingHandover')}</span>
        </p>
      ) : null}
    </article>
  )
}

export default memo(OrderCard)
