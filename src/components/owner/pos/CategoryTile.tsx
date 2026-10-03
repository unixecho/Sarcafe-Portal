'use client'

import { Check } from 'lucide-react'
import { resolveCategoryIcon } from '@/lib/menu/icons'
import { useT } from '@/lib/pos/useT'

// A big tile for one menu category in the wizard's "what is sold here?" step. The
// state is carried by words and a tick as well as colour: "included", "sold at
// another point", "moves here from another point". A category another point already
// makes is never silently stolen — tapping it asks first (the wizard does the asking).

export default function CategoryTile({
  icon,
  title,
  count,
  selected,
  soldAt,
  movesFrom,
  unsold,
  onClick,
}: {
  icon: string | null
  title: string
  count: number
  selected: boolean
  /** the name of ANOTHER point that makes this category now (and it is not selected here) */
  soldAt: string | null
  /** selected here after the owner agreed to take it from another point */
  movesFrom: string | null
  unsold: boolean
  onClick: () => void
}) {
  const t = useT()
  const Icon = resolveCategoryIcon(icon)
  const countText = count === 1 ? t('owner.setup.s2.itemOne') : t('owner.setup.s2.items', { n: count })
  const note = movesFrom
    ? t('owner.setup.s2.movesHere', { point: movesFrom })
    : soldAt
      ? t('owner.setup.s2.soldAt', { point: soldAt })
      : unsold
        ? t('owner.setup.s2.unsold')
        : null

  return (
    <button
      type="button"
      className="os-tile press"
      aria-pressed={selected}
      data-selected={selected}
      data-taken={soldAt ? 'true' : undefined}
      onClick={onClick}
    >
      <span className="os-tile__icon" aria-hidden="true">
        <Icon size={26} strokeWidth={2} />
      </span>
      <span className="os-tile__title">{title}</span>
      <span className="os-tile__count">{countText}</span>
      {note && <span className="os-tile__note">{note}</span>}
      {selected && (
        <span className="os-tile__tick" aria-hidden="true">
          <Check size={16} strokeWidth={3} />
        </span>
      )}
    </button>
  )
}
