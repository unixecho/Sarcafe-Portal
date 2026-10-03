'use client'

// The Done tray and the slim chip a finished card collapses into.
//
// The tray lives on the PHYSICAL left edge (like every pinned widget it does not flip with RTL)
// and is NEVER permanent furniture: hidden until asked for. It can be asked two ways, either at
// any time (owner decision 2026-10-02): tap the small always-there edge tab, or hold a card and
// drag it toward the edge. The tab exists because a gesture nobody discovers is not a feature:
// a person who never learns the drag must still be able to find an order from five minutes ago.
// It is portalled to <body> (fixed UI must be: an ancestor's transform would otherwise become its
// containing block) and uses no backdrop-filter, so sliding it costs nothing.

import { useEffect, useState } from 'react'
import { Check, ChevronsLeft, Undo2, X } from 'lucide-react'
import ModalPortal from '@/components/ModalPortal'
import { haptic } from '@/lib/haptics'
import { canUndoDelivered } from '@/lib/pos/lifecycle'
import { lineSummary, ticketLabel, timeLabel, type PosLang } from '@/lib/pos/format'
import { useT } from '@/lib/pos/useT'
import type { PosItem } from '@/lib/pos/types'
import { HandleChip } from '../shell/HandleChip'
import type { StationCard } from './OrderCard'

/** Where the tray's right edge is on screen right now (0 when it is closed): the drop target. */
export function trayRight(): number {
  if (typeof document === 'undefined') return 0
  const el = document.querySelector<HTMLElement>('[data-station-tray]')
  if (!el || el.dataset.open !== 'true') return 0
  return el.getBoundingClientRect().right
}

/** A clock that ticks every second ONLY while something on screen counts down (the undo window). */
function useNowWhile(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [active])
  return active ? now : Date.now()
}

function undoableLines(card: StationCard, meId: string, isManager: boolean, now: number): PosItem[] {
  return card.lines.filter((l) => canUndoDelivered(l, meId, now, isManager))
}

function latestDelivered(card: StationCard): PosItem | null {
  let best: PosItem | null = null
  for (const l of card.lines) if (l.delivered_at && (!best || (best.delivered_at ?? '') < l.delivered_at)) best = l
  return best
}

/** A fully handed-over card, collapsed. Lingers STATION.doneLingerMs, then the parent files it away. */
export function DoneChip({
  card,
  meId,
  isManager,
  onUndo,
}: {
  card: StationCard
  meId: string
  isManager: boolean
  onUndo: (card: StationCard, ids: string[]) => void
}) {
  const t = useT()
  // Cheap check first so a chip nobody can undo never starts a timer.
  const anyMine = card.lines.some((l) => isManager || l.delivered_by === meId)
  const now = useNowWhile(anyMine)
  const undo = anyMine ? undoableLines(card, meId, isManager, now) : []
  return (
    <div className="std-chip">
      <Check size={22} aria-hidden="true" />
      <span className="std-chip-text">
        <span className="ltr-isolate">{ticketLabel(card.order.ticket_no)}</span>
        {card.order.customer_name ? ` · ${card.order.customer_name}` : ''}
        {' · '}
        {t('station.done.handed')}
      </span>
      {undo.length ? (
        <button
          type="button"
          className="std-undo press"
          onClick={() => {
            haptic('tick')
            onUndo(card, undo.map((l) => l.id))
          }}
        >
          <Undo2 size={20} aria-hidden="true" />
          {t('station.done.undo')}
        </button>
      ) : null}
    </div>
  )
}

function TrayEntry({
  card,
  meId,
  isManager,
  lang,
  onUndo,
}: {
  card: StationCard
  meId: string
  isManager: boolean
  lang: PosLang
  onUndo: (card: StationCard, ids: string[]) => void
}) {
  const t = useT()
  const last = latestDelivered(card)
  const anyMine = card.lines.some((l) => isManager || l.delivered_by === meId)
  const now = useNowWhile(anyMine)
  const undo = anyMine ? undoableLines(card, meId, isManager, now) : []
  return (
    <li className="std-entry">
      <div className="std-entry-head">
        <strong className="std-entry-title">
          <span className="ltr-isolate">{ticketLabel(card.order.ticket_no)}</span>
          {card.order.customer_name ? ` · ${card.order.customer_name}` : ''}
        </strong>
        {last?.delivered_at ? (
          <span className="std-entry-time">
            {t('station.done.at')} <span className="ltr-isolate">{timeLabel(last.delivered_at)}</span>
          </span>
        ) : null}
      </div>
      <ul className="std-entry-lines">
        {card.lines.map((l) => (
          <li key={l.id}>{lineSummary(l, lang)}</li>
        ))}
      </ul>
      <div className="std-entry-foot">
        {last?.delivered_by ? (
          <span className="std-entry-by">
            {t('station.done.by')} <HandleChip staffId={last.delivered_by} />
          </span>
        ) : null}
        {undo.length ? (
          <button
            type="button"
            className="std-undo press"
            onClick={() => {
              haptic('tick')
              onUndo(card, undo.map((l) => l.id))
            }}
          >
            <Undo2 size={20} aria-hidden="true" />
            {t('station.done.undo')}
          </button>
        ) : null}
      </div>
    </li>
  )
}

export function DoneTray({
  open,
  onToggle,
  onClose,
  cards,
  count,
  dragging,
  meId,
  isManager,
  lang,
  onUndo,
}: {
  open: boolean
  onToggle: () => void
  onClose: () => void
  cards: StationCard[]
  count: number
  /** a card is being dragged: the tab/panel show that dropping here files it */
  dragging: boolean
  meId: string
  isManager: boolean
  lang: PosLang
  onUndo: (card: StationCard, ids: string[]) => void
}) {
  const t = useT()

  // Escape closes it, for anyone with a keyboard.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <ModalPortal>
      <div className="std-root">
        <button
          type="button"
          className={`std-tab press${open ? ' is-open' : ''}${dragging ? ' is-drop' : ''}`}
          aria-expanded={open}
          aria-controls="station-done-tray"
          onClick={() => {
            haptic('tick')
            onToggle()
          }}
        >
          <ChevronsLeft size={20} aria-hidden="true" className="std-tab-icon" />
          <span className="std-tab-text">{t('station.done.tab', { n: count })}</span>
        </button>
        <aside
          id="station-done-tray"
          className={`std-panel${open ? ' is-open' : ''}${dragging ? ' is-drop' : ''}`}
          data-station-tray
          data-open={open ? 'true' : 'false'}
          aria-label={t('station.done.title')}
          {...(open ? {} : { inert: true })}
        >
          <div className="std-panel-head">
            <h2 className="std-panel-title">{t('station.done.title')}</h2>
            <button type="button" className="std-close press" onClick={onClose} aria-label={t('station.done.close')}>
              <X size={24} aria-hidden="true" />
            </button>
          </div>
          {dragging ? <p className="std-drophint">{t('station.done.dropHere')}</p> : null}
          {cards.length === 0 ? (
            <p className="std-empty">{t('station.done.empty')}</p>
          ) : (
            <ul className="std-list">
              {cards.map((c) => (
                <TrayEntry key={c.order.id} card={c} meId={meId} isManager={isManager} lang={lang} onUndo={onUndo} />
              ))}
            </ul>
          )}
        </aside>
      </div>
    </ModalPortal>
  )
}
