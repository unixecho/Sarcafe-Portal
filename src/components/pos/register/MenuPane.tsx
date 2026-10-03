'use client'

// The menu column: search, the sticky category strip, the item grid, and the "other item"
// tile. Without a search it shows ONE category (fastest to scan on a tablet); with text in
// the search box it shows every category's matches under their own heading — "forces all
// categories visible while it has text".

import { useMemo, type RefObject } from 'react'
import { PencilLine, Search, X } from 'lucide-react'
import type { MenuCategory } from '@/lib/menu/types'
import { matchesQuery, pickName } from '@/lib/pos/cart'
import { useT } from '@/lib/pos/useT'
import { CategoryStrip } from './CategoryStrip'
import { ItemTile, type TileEntry } from './ItemTile'

export type CategoryEntries = { category: MenuCategory; items: TileEntry[] }

type Props = {
  entries: CategoryEntries[]
  itemCounts: ReadonlyMap<string, number>
  categoryCounts: ReadonlyMap<string, number>
  lang: 'he' | 'en'
  isManager: boolean
  query: string
  onQuery: (q: string) => void
  activeId: string | null
  onActive: (id: string) => void
  searchRef: RefObject<HTMLInputElement | null>
  onAdd: (uid: string) => void
  onCustomize: (uid: string, full: boolean) => void
  onCustom: () => void
}

export function MenuPane({
  entries, itemCounts, categoryCounts, lang, isManager, query, onQuery, activeId, onActive, searchRef,
  onAdd, onCustomize, onCustom,
}: Props) {
  const t = useT()
  const searching = query.trim() !== ''

  const shown = useMemo(() => {
    if (searching) {
      return entries
        .map((e) => ({ ...e, items: e.items.filter((i) => matchesQuery(i.item, e.category, query)) }))
        .filter((e) => e.items.length > 0)
    }
    const active = entries.find((e) => e.category.id === activeId) ?? entries[0]
    return active ? [active] : []
  }, [entries, query, searching, activeId])

  const categories = useMemo(() => entries.map((e) => e.category), [entries])

  return (
    <section className="reg-menu" aria-label={t('register.menu.label')}>
      <div className="reg-search">
        <Search size={18} aria-hidden="true" className="reg-search-icon" />
        <label className="sr-only" htmlFor="reg-search">
          {t('register.search.label')}
        </label>
        <input
          id="reg-search"
          ref={searchRef}
          className="reg-search-input"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          placeholder={t('register.search.placeholder')}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
        {searching && (
          <button type="button" className="reg-search-clear press" aria-label={t('register.search.clear')} onClick={() => onQuery('')}>
            <X size={18} aria-hidden="true" />
          </button>
        )}
      </div>

      <CategoryStrip
        categories={categories}
        activeId={activeId ?? categories[0]?.id ?? null}
        counts={categoryCounts}
        lang={lang}
        searching={searching}
        onPick={(id) => {
          if (searching) onQuery('')
          onActive(id)
        }}
      />

      <div className="reg-grid-scroll pos-pane-scroll">
        {searching && shown.length === 0 && (
          <p className="reg-empty" role="status">
            {t('register.search.none', { q: query.trim() })}
          </p>
        )}
        {shown.map((e) => (
          <div key={e.category.id} className="reg-cat-block">
            {searching && <h2 className="reg-cat-title">{pickName(e.category.title, lang)}</h2>}
            <ul className="reg-grid" role="list">
              {e.items.map((entry) => (
                <li key={entry.id}>
                  <ItemTile
                    entry={entry}
                    count={entry.item.uid ? (itemCounts.get(entry.item.uid) ?? 0) : 0}
                    lang={lang}
                    isManager={isManager}
                    onAdd={onAdd}
                    onCustomize={onCustomize}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
        <ul className="reg-grid reg-grid--other" role="list">
          <li>
            <button type="button" className="reg-tile-other press" onClick={onCustom}>
              <PencilLine size={20} aria-hidden="true" />
              <span>{t('register.custom.tile')}</span>
            </button>
          </li>
        </ul>
      </div>
    </section>
  )
}
