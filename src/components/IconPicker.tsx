'use client'

import { CATEGORY_ICON_KEYS, resolveCategoryIcon, type CategoryIconKey } from '@/lib/menu/icons'

/**
 * Replaces the old free-typed emoji input for a category's icon — a
 * curated, tap-to-pick set instead of hunting through an emoji keyboard
 * (and getting an inconsistent glyph across phones when you do). See
 * lib/menu/icons.tsx for the full key→icon map and the note on why old
 * emoji values already saved don't break.
 */
export default function IconPicker({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (key: CategoryIconKey) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '2px' }}>
      {CATEGORY_ICON_KEYS.map((key) => {
        const Icon = resolveCategoryIcon(key)
        const selected = value === key
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={selected}
            className="press"
            onClick={() => onChange(key)}
            style={{
              flexShrink: 0,
              width: 40,
              height: 40,
              borderRadius: 12,
              border: `1px solid ${selected ? 'var(--neon)' : 'var(--line-strong)'}`,
              background: selected ? 'rgba(255,122,69,0.16)' : 'var(--bg)',
              color: selected ? 'var(--neon-soft)' : 'var(--text-dim)',
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
            }}
          >
            <Icon size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}
