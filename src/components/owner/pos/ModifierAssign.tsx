'use client'

// A compact "התאמות" chip row that attaches library groups to a category or an item.
//
// The model (lib/menu/types.ts): a CATEGORY's list is the default for every item in
// it. An ITEM's own list REPLACES that default entirely — and an empty list means
// "none", which is how one item opts out. So an item has three states:
//   inherit  (modifierGroupUids absent)   -> the category's groups
//   own      (a list of its own)          -> only those
//   none     (an empty list)              -> no tweaks at all
// `undefined` is therefore a meaningful value to hand back to onChange: it removes
// the key, restoring "inherit".

import { useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import type { ModifierGroup } from '@/lib/menu/types'
import { useT } from '@/lib/pos/useT'
import './menu-mods.css'

type Mode = 'inherit' | 'own' | 'none'

function groupName(g: ModifierGroup, fallback: string) {
  return g.title.he?.trim() || fallback
}

export default function ModifierAssign({
  scope,
  groups,
  value,
  inherited,
  onChange,
}: {
  scope: 'category' | 'item'
  groups: readonly ModifierGroup[]
  /** This row's own list; undefined = not set. */
  value: string[] | undefined
  /** Items only: the category's list, shown as what "like the category" means. */
  inherited?: string[]
  onChange: (next: string[] | undefined) => void
}) {
  const t = useT()
  const [open, setOpen] = useState(value !== undefined && value.length > 0)
  const [ownMode, setOwnMode] = useState(false)

  const mode: Mode =
    scope === 'category' ? 'own' : value === undefined ? 'inherit' : value.length === 0 && !ownMode ? 'none' : 'own'
  const effective = scope === 'item' && value === undefined ? inherited ?? [] : value ?? []
  // A uid whose group was deleted can linger in an old list; never count or show it.
  const live = effective.filter((uid) => groups.some((g) => g.uid === uid))

  // Nothing to attach until the library has a group — and a row with no groups and
  // nothing attached stays out of the way entirely.
  if (groups.length === 0 && live.length === 0) return null

  const summary = live.length > 0 ? t('owner.menu.assign.count', { n: live.length }) : t('owner.menu.assign.none')

  if (!open) {
    return (
      <button
        type="button"
        className="press"
        onClick={() => setOpen(true)}
        style={{
          alignSelf: 'flex-start',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          minHeight: 32,
          background: 'none',
          border: 'none',
          color: live.length > 0 ? 'var(--neon-soft)' : 'var(--text-faint)',
          fontSize: '0.76rem',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        <SlidersHorizontal size={13} aria-hidden="true" /> {t('owner.menu.assign.label')}: {summary}
        {scope === 'item' && mode === 'inherit' && live.length > 0 ? ` (${t('owner.menu.assign.fromCategory')})` : ''}
      </button>
    )
  }

  function toggle(uid: string) {
    const base = scope === 'item' && value === undefined ? (inherited ?? []).filter((u) => groups.some((g) => g.uid === u)) : value ?? []
    const next = base.includes(uid) ? base.filter((u) => u !== uid) : [...base, uid]
    onChange(next)
  }

  function setMode(next: Mode) {
    if (next === 'inherit') {
      setOwnMode(false)
      onChange(undefined)
    } else if (next === 'none') {
      setOwnMode(false)
      onChange([])
    } else {
      setOwnMode(true)
      // Start from what the item has today, so "own list" is an edit, not a blank slate.
      onChange(value !== undefined ? value : (inherited ?? []).slice())
    }
  }

  const chipsEditable = scope === 'category' || mode === 'own'

  return (
    <div
      className="rise"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 8,
        borderRadius: 10,
        background: 'var(--bg)',
        border: '1px dashed var(--line-strong)',
      }}
    >
      <p style={{ margin: 0, fontSize: '0.74rem', color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 5 }}>
        <SlidersHorizontal size={13} aria-hidden="true" />
        {scope === 'category' ? t('owner.menu.assign.categoryHint') : t('owner.menu.assign.itemMode')}
      </p>

      {scope === 'item' && (
        <div role="radiogroup" aria-label={t('owner.menu.assign.itemMode')} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(
            [
              ['inherit', t('owner.menu.assign.fromCategory')],
              ['own', t('owner.menu.assign.own')],
              ['none', t('owner.menu.assign.noneMode')],
            ] as [Mode, string][]
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              className="press mm-chip"
              onClick={() => setMode(m)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {groups.length === 0 ? (
        <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--text-dim)' }}>{t('owner.menu.assign.noLibrary')}</p>
      ) : (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', opacity: chipsEditable ? 1 : 0.6 }}>
          {groups.map((g) => (
            <button
              key={g.uid}
              type="button"
              className="press mm-chip"
              aria-pressed={live.includes(g.uid)}
              disabled={!chipsEditable}
              onClick={() => toggle(g.uid)}
            >
              {groupName(g, t('owner.menu.mods.untitled'))}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
