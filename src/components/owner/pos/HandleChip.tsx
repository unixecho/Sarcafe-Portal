'use client'

// A person's nickname as everyone on the floor knows it: a disc in THEIR colour
// carrying the first letter, and the nickname beside it. This is the owner-page
// twin of the register's HandleChip — separate on purpose, because that one reads
// the POS provider and the owner pages do not run one. The colour is validated
// before it reaches a style attribute (it comes from the database), and the letter
// picks whichever house ink reads on it.
//
// With onClick it is a real button (tap to rename); without, an inert span.

import { handleInitial } from '@/lib/pos/colour'
import { inkOn, safeColour } from '@/components/pos/shell/safeColour'
import { useT } from '@/lib/pos/useT'
import './menu-mods.css'

export default function HandleChip({
  handle,
  colour,
  unconfirmed,
  onClick,
  label,
}: {
  handle: string | null | undefined
  /** Already resolved (the person's own, or the automatic round-robin one). */
  colour: string
  /** The person has not chosen their own nickname yet. */
  unconfirmed?: boolean
  onClick?: () => void
  /** Accessible name for the button form. */
  label?: string
}) {
  const t = useT()
  const disc = safeColour(colour, '#888888')
  const name = handle?.trim() || '—'
  const inner = (
    <>
      <span className="mm-avatar" aria-hidden="true" style={{ background: disc, color: inkOn(disc) }}>
        {handleInitial(name)}
      </span>
      <span className="mm-handle-name">{name}</span>
      {unconfirmed && <span className="mm-badge">{t('owner.menu.staff.unconfirmed')}</span>}
    </>
  )
  if (!onClick) return <span className="mm-handle">{inner}</span>
  return (
    <button type="button" className="mm-handle press" onClick={onClick} aria-label={label}>
      {inner}
    </button>
  )
}
