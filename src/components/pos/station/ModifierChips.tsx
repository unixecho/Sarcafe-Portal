'use client'

// A line's structured modifiers as chips, built from the SNAPSHOT on the line (never from
// today's menu), so a cook reads the order exactly as it was sold even after a menu change.
// Colour carries the kind (extra = green, without = red, swap = accent, prep = italic) but
// never alone: describeModifier() already puts a "+" / "בלי" / "במקום" in the words.

import { describeModifier } from '@/lib/pos/modifiers'
import type { ModifierSnapshot } from '@/lib/pos/types'
import type { PosLang } from '@/lib/pos/format'

export default function ModifierChips({ modifiers, lang }: { modifiers: ModifierSnapshot[] | null | undefined; lang: PosLang }) {
  const list = modifiers ?? []
  if (list.length === 0) return null
  return (
    <ul className="stm">
      {list.map((m, i) => (
        <li key={`${m.group_uid}:${m.option_uid}:${i}`} className={`stm-chip stm-chip--${m.kind}`}>
          {describeModifier(m, lang)}
        </li>
      ))}
    </ul>
  )
}
