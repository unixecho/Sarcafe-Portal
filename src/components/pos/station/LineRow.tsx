'use client'

// One line of an order card. Each line keeps its OWN lifecycle (a burger can be ready beside a
// toast nobody started), so each can be advanced on its own with its small chip; the card's big
// button is the shortcut for "everything at the least-advanced stage".
//
// Pure presentation + two callbacks. It never decides what is allowed: lineAction() from
// lifecycle.ts says which control exists, so a button is never offered that the server would refuse.

import { memo } from 'react'
import { BellRing, CheckCheck, Flame, Hourglass, Undo2 } from 'lucide-react'
import { haptic } from '@/lib/haptics'
import { lineAction } from '@/lib/pos/lifecycle'
import { nameOf, type PosLang } from '@/lib/pos/format'
import { useT } from '@/lib/pos/useT'
import type { StrKey } from '@/lib/pos/i18n'
import type { PosItem, PosPoint } from '@/lib/pos/types'
import ModifierChips from './ModifierChips'

const ACTION_KEY = {
  accept: 'station.act.accept',
  ready: 'station.act.ready',
  handover: 'station.act.handover',
} as const satisfies Record<string, StrKey>

const STATUS_ICON = { sent: Hourglass, preparing: Flame, ready: BellRing, delivered: CheckCheck, voided: Hourglass } as const
const STATUS_WORD: Record<string, StrKey> = {
  sent: 'station.line.sent',
  preparing: 'station.line.preparing',
  ready: 'station.line.ready',
  delivered: 'station.line.delivered',
}

function LineRow({
  line,
  handsOver,
  mine,
  later,
  fresh,
  lang,
  onAdvance,
  onRevert,
}: {
  line: PosItem
  handsOver: boolean
  /** this person accepted it — Ayeka shipped the `is-mine` class with no CSS; station.css has the rule */
  mine: boolean
  /** arrived in a later batch than the order's first */
  later: boolean
  /** arrived since this screen opened — plays its entrance once */
  fresh: boolean
  lang: PosLang
  onAdvance: (line: PosItem) => void
  onRevert: (line: PosItem) => void
}) {
  const t = useT()
  const point: Pick<PosPoint, 'hands_over'> = { hands_over: handsOver }
  const action = lineAction(line, point)
  const canRevert = line.status === 'ready' || line.status === 'preparing'
  const Icon = STATUS_ICON[line.status]
  const name = nameOf(line.name, lang)
  const title = [name, nameOf(line.type_label, lang), line.variant_label].filter(Boolean).join(' · ')
  const label = `${line.qty}× ${name}`

  return (
    <li className={`stl stl--${line.status}${mine ? ' is-mine' : ''}${fresh ? ' is-fresh' : ''}`}>
      <span className="stl-icon" aria-hidden="true">
        <Icon size={22} />
      </span>
      <div className="stl-main">
        <div className="stl-title">
          <span className="stl-qty ltr-isolate">{line.qty}×</span>
          <span className="stl-name">{title}</span>
          {later ? <span className="stl-badge">{t('station.line.later')}</span> : null}
          {mine ? <span className="stl-mine">{t('station.line.mine')}</span> : null}
          <span className="sr-only">{STATUS_WORD[line.status] ? t(STATUS_WORD[line.status] as StrKey) : ''}</span>
        </div>
        <ModifierChips modifiers={line.modifiers} lang={lang} />
        {line.note ? <p className="stl-note">{line.note}</p> : null}
        {line.for_name ? <p className="stl-for">{t('station.line.for', { name: line.for_name })}</p> : null}
      </div>
      <div className="stl-actions">
        {canRevert ? (
          <button
            type="button"
            className="stl-revert press"
            aria-label={t('station.line.revert', { what: label })}
            onClick={() => {
              haptic('tick')
              onRevert(line)
            }}
          >
            <Undo2 size={22} aria-hidden="true" />
          </button>
        ) : null}
        {action ? (
          <button
            type="button"
            className="stl-go press"
            aria-label={t('station.line.advance', { what: label, action: t(ACTION_KEY[action.kind]) })}
            onClick={() => {
              haptic('select')
              onAdvance(line)
            }}
          >
            {t(ACTION_KEY[action.kind])}
          </button>
        ) : null}
      </div>
    </li>
  )
}

export default memo(LineRow)
