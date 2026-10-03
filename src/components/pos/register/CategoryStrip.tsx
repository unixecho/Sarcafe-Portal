'use client'

// The sticky category chips. The active one is scrolled into view (a long menu on a narrow
// tablet otherwise leaves the selected chip off-screen). Each chip carries the count of what
// is already on the ticket from that category, so the cashier can see where they have been
// without looking right.

import { useEffect, useRef } from 'react'
import { resolveCategoryIcon } from '@/lib/menu/icons'
import type { MenuCategory } from '@/lib/menu/types'
import { pickName } from '@/lib/pos/cart'
import { useT } from '@/lib/pos/useT'

type Props = {
  categories: MenuCategory[]
  activeId: string | null
  counts: ReadonlyMap<string, number>
  lang: 'he' | 'en'
  /** a search is running: no chip is "the" category */
  searching: boolean
  onPick: (id: string) => void
}

export function CategoryStrip({ categories, activeId, counts, lang, searching, onPick }: Props) {
  const t = useT()
  const activeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const el = activeRef.current
    if (!el) return
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: calm ? 'auto' : 'smooth' })
  }, [activeId])

  return (
    <nav className="reg-strip" aria-label={t('register.strip.label')}>
      {categories.map((c) => {
        const Icon = resolveCategoryIcon(c.icon)
        const active = !searching && c.id === activeId
        const n = counts.get(c.id) ?? 0
        return (
          <button
            key={c.id}
            ref={active ? activeRef : undefined}
            type="button"
            className={`reg-cat press${active ? ' is-active' : ''}`}
            aria-current={active ? 'true' : undefined}
            onClick={() => onPick(c.id)}
          >
            <Icon size={18} aria-hidden="true" />
            <span>{pickName(c.title, lang)}</span>
            {n > 0 && (
              <span className="reg-cat-count ltr-isolate">
                <span className="sr-only">{t('register.tile.inOrder', { n })}</span>
                <span aria-hidden="true">{n}</span>
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
