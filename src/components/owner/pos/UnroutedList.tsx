'use client'

import { useId, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import { resolveCategoryIcon } from '@/lib/menu/icons'
import { nameOf } from '@/lib/pos/format'
import type { PointSummary, UnroutedItem } from '@/lib/pos/owner-api'
import { usePosLang, useT } from '@/lib/pos/useT'
import { inkOn, safeColour } from '@/components/pos/shell/safeColour'

// "These items are made by nobody." One tap per item — assign it to a point, or say
// the event does not sell it — and the same two buttons for a whole category, because
// an event menu with a single point set up can leave a hundred items here and nobody
// should tap a hundred times. Rows disappear the instant they are decided (the parent
// removes them optimistically and puts them back if the save is refused).

const OPEN_ALL_UP_TO = 12

type Pick = { uids: string[]; label: string } | null

export default function UnroutedList({
  items,
  points,
  onAssign,
  onUnsold,
}: {
  items: UnroutedItem[]
  points: PointSummary[]
  onAssign: (uids: string[], pointId: string) => void
  onUnsold: (uids: string[]) => void
}) {
  const t = useT()
  const [lang] = usePosLang()
  const titleId = useId()
  const [pick, setPick] = useState<Pick>(null)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})

  const groups = useMemo(() => {
    const map = new Map<string, { id: string; title: UnroutedItem['categoryTitle']; items: UnroutedItem[] }>()
    for (const it of items) {
      const g = map.get(it.categoryId) ?? { id: it.categoryId, title: it.categoryTitle, items: [] }
      g.items.push(it)
      map.set(it.categoryId, g)
    }
    return Array.from(map.values())
  }, [items])

  const defaultOpen = items.length <= OPEN_ALL_UP_TO
  const isOpen = (id: string) => openGroups[id] ?? defaultOpen

  function choose(pointId: string) {
    if (!pick) return
    onAssign(pick.uids, pointId)
    setPick(null)
  }

  return (
    <div className="os-unrouted">
      {groups.map((g) => {
        const Icon = resolveCategoryIcon(null)
        const open = isOpen(g.id)
        const groupName = nameOf(g.title, lang)
        const uids = g.items.map((i) => i.uid)
        return (
          <div key={g.id} className="os-group">
            <div className="os-group__head">
              <button
                type="button"
                className="os-group__toggle press"
                aria-expanded={open}
                aria-label={open ? t('owner.setup.unrouted.collapse', { name: groupName }) : t('owner.setup.unrouted.expand', { name: groupName })}
                onClick={() => setOpenGroups((s) => ({ ...s, [g.id]: !open }))}
              >
                <Icon size={18} strokeWidth={2} aria-hidden="true" />
                <span className="os-group__name">{groupName}</span>
                <span className="os-group__count">{t('owner.setup.unrouted.groupCount', { n: g.items.length })}</span>
                <ChevronDown size={18} strokeWidth={2} aria-hidden="true" className="os-group__chev" data-open={open} />
              </button>
              {g.items.length > 1 && (
                <div className="os-group__bulk">
                  <button type="button" className="os-btn os-btn--sm os-btn--ghost press" onClick={() => setPick({ uids, label: groupName })}>
                    {t('owner.setup.unrouted.assignAll')}
                  </button>
                  <button type="button" className="os-btn os-btn--sm os-btn--quiet press" onClick={() => onUnsold(uids)}>
                    {t('owner.setup.unrouted.unsoldAll')}
                  </button>
                </div>
              )}
            </div>
            {open && (
              <ul className="os-unrouted__rows">
                {g.items.map((it) => {
                  const name = nameOf(it.name, lang)
                  return (
                    <li key={it.uid} className="os-unrouted__row">
                      <span className="os-unrouted__name">{name}</span>
                      <button
                        type="button"
                        className="os-btn os-btn--sm os-btn--ghost press"
                        aria-label={t('owner.setup.unrouted.assignItem', { name })}
                        onClick={() => setPick({ uids: [it.uid], label: name })}
                      >
                        {t('owner.setup.unrouted.assign')}
                      </button>
                      <button
                        type="button"
                        className="os-btn os-btn--sm os-btn--quiet press"
                        aria-label={t('owner.setup.unrouted.unsoldItem', { name })}
                        onClick={() => onUnsold([it.uid])}
                      >
                        {t('owner.setup.unrouted.unsold')}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })}

      <SheetShell open={!!pick} onClose={() => setPick(null)} labelledBy={titleId}>
        <h2 id={titleId} className="os-sheet__title">
          {t('owner.setup.unrouted.pickTitle')}
        </h2>
        <p className="os-sheet__sub">{pick?.label}</p>
        <div className="sheet-scroll os-pick">
          {points.map((p) => {
            const colour = safeColour(p.colour, '#FF7A45')
            const Icon = resolveCategoryIcon(p.icon)
            return (
              <button key={p.id} type="button" className="os-pick__btn press" onClick={() => choose(p.id)}>
                <span className="os-card__icon os-card__icon--sm" aria-hidden="true" style={{ background: colour, color: inkOn(colour) }}>
                  <Icon size={18} strokeWidth={2} />
                </span>
                {p.name}
              </button>
            )
          })}
        </div>
      </SheetShell>
    </div>
  )
}
