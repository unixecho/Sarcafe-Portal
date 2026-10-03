'use client'

// The "התאמות" card at the top of the menu editor: the library of modifier groups
// ("Milk", "Extras", "Remove"…), defined once and attached to categories / items
// below. Collapsible like the out-of-stock panel beside it.
//
// This component owns only the sheet's open state; the groups themselves live in
// the menu draft (MenuEditor), so save / publish / versions / the audit trail all
// cover them with no extra plumbing.

import { useEffect, useState } from 'react'
import { ChevronDown, Plus, SlidersHorizontal, AlertTriangle } from 'lucide-react'
import ModifierGroupSheet, { blankGroup } from './ModifierGroupSheet'
import type { ConfirmRequest } from '@/components/ConfirmSheet'
import type { MenuCategory, ModifierGroup } from '@/lib/menu/types'
import { useT } from '@/lib/pos/useT'
import type { StrKey } from '@/lib/pos/i18n'
import './menu-mods.css'

type Translate = (key: StrKey, params?: Record<string, string | number>) => string

export type ModifierProblems = {
  /** Block Publish. */
  errors: { key: string; text: string }[]
  /** A friendly heads-up, never blocks. */
  warnings: { key: string; text: string }[]
}

/** The checks run before Publish. Pure; text comes in through `t` so the owner's
 * language is the only place wording lives. */
export function modifierProblems(groups: readonly ModifierGroup[] | undefined, t: Translate): ModifierProblems {
  const errors: ModifierProblems['errors'] = []
  const warnings: ModifierProblems['warnings'] = []
  for (const g of groups ?? []) {
    const name = g.title.he?.trim() || ''
    if (!name) errors.push({ key: `${g.uid}:title`, text: t('owner.menu.mods.err.noTitle') })
    const shown = name || t('owner.menu.mods.untitled')
    if (g.options.length === 0) errors.push({ key: `${g.uid}:none`, text: t('owner.menu.mods.err.noOptions', { name: shown }) })
    if (g.options.some((o) => !o.he?.trim())) errors.push({ key: `${g.uid}:label`, text: t('owner.menu.mods.err.noLabel', { name: shown }) })
    const defaults = g.options.filter((o) => o.default && o.available !== false).length
    if (!g.multiple && defaults > 1) errors.push({ key: `${g.uid}:defaults`, text: t('owner.menu.mods.err.twoDefaults', { name: shown }) })
    // required + single with no pre-selected answer: the one-tap "as-is" add can never
    // happen, so every order of this item opens the customise sheet.
    if (g.required && !g.multiple && defaults === 0 && g.options.length > 0) {
      warnings.push({ key: `${g.uid}:nodefault`, text: t('owner.menu.mods.warn.noDefault', { name: shown }) })
    }
  }
  return { errors, warnings }
}

export function groupUsage(groupUid: string, categories: readonly MenuCategory[]): { items: number; cats: number } {
  let items = 0
  let cats = 0
  for (const c of categories) {
    if (c.modifierGroupUids?.includes(groupUid)) cats++
    for (const i of c.items) if (i.modifierGroupUids?.includes(groupUid)) items++
  }
  return { items, cats }
}

export default function ModifierLibrary({
  groups,
  categories,
  onSave,
  onDelete,
  confirm,
  openSignal,
}: {
  groups: ModifierGroup[]
  categories: MenuCategory[]
  /** Upsert by uid. */
  onSave: (group: ModifierGroup) => void
  /** Removes the group AND every reference to it (the editor does both in one edit). */
  onDelete: (uid: string) => void
  confirm: (request: ConfirmRequest & { onYes: () => void }) => void
  /** Bumped by the editor when Publish was refused, so the problems are on screen. */
  openSignal: number
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState<ModifierGroup | null>(null)
  const [isNew, setIsNew] = useState(false)

  useEffect(() => {
    if (openSignal > 0) setOpen(true)
  }, [openSignal])

  const problems = modifierProblems(groups, t)
  const bodyId = 'modifier-library-body'

  function openNew() {
    setEditing(blankGroup())
    setIsNew(true)
    setSheetOpen(true)
  }
  function openEdit(g: ModifierGroup) {
    setEditing(g)
    setIsNew(false)
    setSheetOpen(true)
  }

  function requestDelete() {
    if (!editing) return
    const group = editing
    const usage = groupUsage(group.uid, categories)
    const name = group.title.he?.trim() || t('owner.menu.mods.untitled')
    setSheetOpen(false)
    confirm({
      title: t('owner.menu.mods.del.title'),
      body:
        usage.items + usage.cats > 0
          ? t('owner.menu.mods.del.bodyUsed', { name, items: usage.items, cats: usage.cats })
          : t('owner.menu.mods.del.bodyUnused', { name }),
      confirmLabel: t('owner.menu.mods.del.confirm'),
      danger: true,
      onYes: () => onDelete(group.uid),
    })
  }

  return (
    <section id="modifier-library" style={{ marginBottom: 20 }}>
      <div className="mm-card">
        <button
          type="button"
          className="press"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={bodyId}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            minHeight: 'var(--tap-min)',
            padding: '10px 14px',
            background: 'none',
            border: 'none',
            color: 'var(--text)',
            cursor: 'pointer',
            textAlign: 'start',
          }}
        >
          <SlidersHorizontal size={17} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--neon-soft)' }} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontWeight: 700, fontSize: '0.92rem' }}>{t('owner.menu.mods.title')}</span>
            <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-faint)' }}>
              {groups.length > 0 ? t('owner.menu.mods.count', { n: groups.length }) : t('owner.menu.mods.subtitle')}
            </span>
          </span>
          {problems.errors.length > 0 && (
            <span className="mm-badge" style={{ color: 'var(--danger)', background: 'var(--danger-bg)' }}>
              <AlertTriangle size={11} aria-hidden="true" style={{ verticalAlign: '-1px' }} /> {problems.errors.length}
            </span>
          )}
          <ChevronDown
            size={16}
            aria-hidden="true"
            style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s var(--ease)', color: 'var(--text-faint)' }}
          />
        </button>

        <div id={bodyId} hidden={!open}>
          <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            {groups.length === 0 && (
              <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-dim)' }}>{t('owner.menu.mods.empty')}</p>
            )}

            {groups.map((g) => {
              const usage = groupUsage(g.uid, categories)
              const name = g.title.he?.trim() || t('owner.menu.mods.untitled')
              return (
                <button
                  key={g.uid}
                  type="button"
                  className="press mm-row"
                  onClick={() => openEdit(g)}
                  aria-label={t('owner.menu.mods.edit', { name })}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 700, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {name}
                    </span>
                    <span style={{ display: 'block', fontSize: '0.74rem', color: 'var(--text-faint)' }}>
                      {t(`owner.menu.group.kind.${g.kind}` as StrKey).replace(/\s*\(.*\)\s*$/, '')} ·{' '}
                      {t('owner.menu.mods.optionsCount', { n: g.options.length })} ·{' '}
                      {usage.items + usage.cats > 0
                        ? t('owner.menu.mods.usedBy', { items: usage.items, cats: usage.cats })
                        : t('owner.menu.mods.unused')}
                    </span>
                  </span>
                </button>
              )
            })}

            <button type="button" className="press mm-row" onClick={openNew} style={{ justifyContent: 'center', borderStyle: 'dashed' }}>
              <Plus size={16} aria-hidden="true" /> {t('owner.menu.mods.add')}
            </button>

            {problems.errors.length > 0 && (
              <div role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <strong style={{ fontSize: '0.8rem', color: 'var(--danger)' }}>{t('owner.menu.mods.problems')}</strong>
                {problems.errors.map((p) => (
                  <span key={p.key} style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                    {p.text}
                  </span>
                ))}
              </div>
            )}
            {problems.warnings.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <strong style={{ fontSize: '0.8rem', color: 'var(--warn)' }}>{t('owner.menu.mods.warnings')}</strong>
                {problems.warnings.map((p) => (
                  <span key={p.key} style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                    {p.text}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <ModifierGroupSheet
        open={sheetOpen}
        group={editing}
        isNew={isNew}
        onClose={() => setSheetOpen(false)}
        onRequestDelete={requestDelete}
        onSave={(g) => {
          onSave(g)
          setSheetOpen(false)
        }}
      />
    </section>
  )
}
