'use client'

import { Pencil, Power } from 'lucide-react'
import { resolveCategoryIcon } from '@/lib/menu/icons'
import { nameOf } from '@/lib/pos/format'
import type { PersonRow, PointSummary } from '@/lib/pos/owner-api'
import { PREP_PRESETS } from '@/lib/pos/vocab'
import { usePosLang, useT } from '@/lib/pos/useT'
import { inkOn, safeColour } from '@/components/pos/shell/safeColour'

// One selling point on the checklist: icon, colour, one line of what it makes, and
// who usually works there. The one-line summary is built from the SAME summaries the
// wizard's review sentence uses (PointSummary), so the card and the wizard can never
// describe a point differently.

const SHOWN_NAMES = 4

export function speedKeyOf(minutes: number): (typeof PREP_PRESETS)[number]['key'] {
  let best: (typeof PREP_PRESETS)[number] = PREP_PRESETS[0]
  for (const p of PREP_PRESETS) if (Math.abs(p.minutes - minutes) < Math.abs(best.minutes - minutes)) best = p
  return best.key
}

export default function PointCard({
  point,
  people,
  onEdit,
  onStop,
  delay = 0,
}: {
  point: PointSummary
  people: PersonRow[]
  onEdit: () => void
  onStop: () => void
  delay?: number
}) {
  const t = useT()
  const [lang] = usePosLang()
  const Icon = resolveCategoryIcon(point.icon)
  const colour = safeColour(point.colour, '#FF7A45')

  const names = [...point.categories.map((c) => nameOf(c.title, lang)), ...point.extraItems.map((i) => nameOf(i.name, lang))].filter(Boolean)
  const shown = names.slice(0, SHOWN_NAMES)
  const rest = names.length - shown.length
  const count = point.itemCount === 1 ? t('owner.setup.card.itemOne') : t('owner.setup.card.items', { n: point.itemCount })
  const what = names.length ? shown.join(' · ') + (rest > 0 ? ` ${t('owner.setup.card.more', { n: rest })}` : '') : ''
  const summary = names.length ? t('owner.setup.card.summary', { what, count }) : t('owner.setup.card.empty')

  const who = point.config.staffIds
    .map((id) => people.find((p) => p.id === id))
    .filter((p): p is PersonRow => !!p)

  return (
    <li className="os-card rise" style={{ animationDelay: `${delay}ms`, ['--os-point' as string]: colour }}>
      <div className="os-card__top">
        <span className="os-card__icon" aria-hidden="true" style={{ background: colour, color: inkOn(colour) }}>
          <Icon size={22} strokeWidth={2} />
        </span>
        <div className="os-card__text">
          <h3 className="os-card__name">{point.name}</h3>
          <p className="os-card__summary">{summary}</p>
        </div>
      </div>

      <div className="os-card__chips">
        <span className="os-chip">{t(`owner.setup.s4.speed.${speedKeyOf(point.prepMinutes)}`)}</span>
        <span className="os-chip">{point.handsOver ? t('owner.setup.card.hands') : t('owner.setup.card.noHands')}</span>
        {point.liveItems > 0 && <span className="os-chip os-chip--warn">{t('owner.setup.card.busy', { n: point.liveItems })}</span>}
      </div>

      <div className="os-card__who">
        <span className="os-card__whoLabel">{t('owner.setup.card.who')}</span>
        {who.length === 0 ? (
          <span className="os-card__none">{t('owner.setup.card.noWho')}</span>
        ) : (
          <ul className="os-handles">
            {who.map((p) => (
              <li key={p.id} className="os-handle">
                <span className="os-handle__dot" aria-hidden="true" style={{ background: safeColour(p.colour, '#B9ADA0') }} />
                <span className="ltr-isolate">{p.handle}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="os-card__actions">
        <button type="button" className="os-btn os-btn--ghost press" onClick={onEdit} aria-label={t('owner.setup.card.editNamed', { name: point.name })}>
          <Pencil size={18} strokeWidth={2} aria-hidden="true" />
          {t('owner.setup.card.edit')}
        </button>
        <button type="button" className="os-btn os-btn--quiet press" onClick={onStop} aria-label={t('owner.setup.card.stopNamed', { name: point.name })}>
          <Power size={18} strokeWidth={2} aria-hidden="true" />
          {t('owner.setup.card.stop')}
        </button>
      </div>
    </li>
  )
}
