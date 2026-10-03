'use client'

import { Check } from 'lucide-react'

// A list of products with real checkboxes (a real <label>, so the whole row is the
// target). Used twice in the wizard: to untick products a chosen category should NOT
// bring (ticked = made here), and to add products from OTHER categories one by one
// (ticked = added). A row that belongs to another point carries a note and, when the
// parent says so, cannot be ticked from here — conflicts are explained, not stolen.

export type ChecklistItem = {
  uid: string
  name: string
  checked: boolean
  /** shown under the name: where it lives, or who else sells it */
  note?: string | null
  disabled?: boolean
}

export default function ItemChecklist({ items, onToggle, label }: { items: ChecklistItem[]; onToggle: (uid: string) => void; label: string }) {
  return (
    <ul className="os-checklist" aria-label={label}>
      {items.map((it) => (
        <li key={it.uid}>
          <label className="os-check" data-disabled={it.disabled ? 'true' : undefined}>
            <input
              type="checkbox"
              className="os-check__input"
              checked={it.checked}
              disabled={it.disabled}
              onChange={() => onToggle(it.uid)}
            />
            <span className="os-check__box" aria-hidden="true">
              <Check size={16} strokeWidth={3} />
            </span>
            <span className="os-check__text">
              <span className="os-check__name">{it.name}</span>
              {it.note && <span className="os-check__note">{it.note}</span>}
            </span>
          </label>
        </li>
      ))}
    </ul>
  )
}
