'use client'

// A person, as everyone on the floor knows them: a disc in THEIR colour carrying
// the first letter of their nickname, and the nickname beside it. Used wherever a
// screen says who did something ("נוצרה ע״י מאיה"). The colour comes from the
// shared directory (never the email, never the full name), is validated before it
// reaches a style attribute, and the disc's letter picks whichever house ink
// reads on it — so an owner who picks a dark colour does not make the letter vanish.
//
//   <HandleChip staffId={order.created_by} />                  // resolves the name
//   <HandleChip staffId={id} handle={order.created_by_handle} /> // a snapshot wins
//
// Purely presentational and inert: it is a <span>, never a control. (The top bar
// wraps it in a real button when it needs to be tappable.)

import { handleInitial } from '@/lib/pos/colour'
import { usePos } from '../PosProvider'
import { inkOn } from './safeColour'

export function HandleChip({
  staffId,
  handle,
  size = 'sm',
  showName = true,
}: {
  staffId?: string | null
  /** A name captured when the thing happened (e.g. created_by_handle). Preferred over the directory. */
  handle?: string | null
  size?: 'sm' | 'md'
  showName?: boolean
}) {
  const { colourOf, handleOf } = usePos()
  const name = handle?.trim() || handleOf(staffId)
  const colour = colourOf(staffId)
  return (
    <span className={`pos-handle${size === 'md' ? ' pos-handle--md' : ''}`}>
      <span className="pos-avatar" aria-hidden="true" style={{ background: colour, color: inkOn(colour) }}>
        {handleInitial(name)}
      </span>
      {showName ? (
        <span className="pos-handle-name">{name}</span>
      ) : (
        <span className="sr-only">{name}</span>
      )}
    </span>
  )
}
