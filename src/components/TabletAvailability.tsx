'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, Clock, Minus, Plus } from 'lucide-react'
import Switch from '@/components/Switch'
import { ensureUids } from '@/lib/menu/variants'
import { resolveCategoryIcon } from '@/lib/menu/icons'
import { useMenuRealtime } from '@/lib/menu/useMenuRealtime'
import type { MenuCategory, MenuDoc, MenuItem, MenuItemType } from '@/lib/menu/types'
import type { BranchSlug } from '@/lib/branches'

const POLL_MS = 20_000 // fallback only — the realtime broadcast (see
// lib/menu/realtime.ts) is what normally makes a change from another
// device show up here without waiting for this interval.

// One main category at a time, full screen — no category CRUD, no
// translations, just the owner's own vocabulary (Shakes/Pastries/
// Sandwiches/Cookies). Scoped to only the categories flagged `liveOnTablet`
// in the editor — everything else is accounted for elsewhere (the cart's
// own stock, the outside fridge, coffee/ices) and doesn't belong on a
// screen meant to be updated in a hurry mid-service. Every change POSTs to
// /api/owner/menu-availability, which updates draft (always) and published
// (only during operating hours — see lib/shifts/hours.ts) atomically so
// it's live on the public menu immediately, not gated behind the next
// Publish.
export default function TabletAvailability({ branchSlug, isOwner }: { branchSlug: BranchSlug; isOwner: boolean }) {
  const [doc, setDoc] = useState<MenuDoc | null>(null)
  const [withinOperatingHours, setWithinOperatingHours] = useState(true)
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/owner/menu-variants?branch=${branchSlug}`)
    if (!res.ok) return
    const payload = (await res.json()) as { draft: MenuDoc; withinOperatingHours: boolean }
    setDoc(ensureUids(payload.draft))
    setWithinOperatingHours(payload.withinOperatingHours)
  }, [branchSlug])

  useEffect(() => {
    setDoc(null)
    setSelectedCategoryId(null)
    load()
  }, [load])

  useMenuRealtime(branchSlug, load)

  useEffect(() => {
    const interval = window.setInterval(load, POLL_MS)
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [load])

  async function patch(itemUid: string, typeUid: string | null, patch: { available?: boolean; quantity?: number }) {
    const key = `${itemUid}:${typeUid ?? ''}`
    setPending((prev) => new Set(prev).add(key))

    // Optimistic — a tablet change should feel instant, not wait on a round
    // trip. Rolled back by re-fetching the real state if the write fails.
    setDoc((prev) => {
      if (!prev) return prev
      const next = structuredClone(prev)
      for (const category of next.categories) {
        const item = category.items.find((i) => i.uid === itemUid)
        if (!item) continue
        const target: MenuItem | MenuItemType | undefined = typeUid ? item.types?.find((t) => t.uid === typeUid) : item
        if (!target) continue
        if (patch.available !== undefined) target.available = patch.available
        if (patch.quantity !== undefined) {
          target.quantity = patch.quantity
          if (patch.quantity === 0) target.available = false
        }
      }
      return next
    })

    try {
      const res = await fetch('/api/owner/menu-availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: branchSlug, itemUid, typeUid, ...patch }),
      })
      if (!res.ok) throw new Error('request failed')
    } catch {
      load()
    } finally {
      setPending((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  if (!doc) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="sk" style={{ height: 64 }} />
        ))}
      </div>
    )
  }

  // Outside operating hours, only the owner may use this tool at all (to
  // test it) — a non-owner reaching this state (a multi-branch general
  // manager who switched to a branch that's currently closed; the common
  // single-branch case is already blocked a level up, in page.tsx) sees a
  // plain closed message instead of the editor.
  if (!isOwner && !withinOperatingHours) {
    return (
      <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-faint)' }}>
        <Clock size={22} strokeWidth={2} aria-hidden="true" style={{ marginBottom: 8 }} />
        <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.6 }}>
          הכלי זמין רק בשעות הפעילות של הסניף.
        </p>
      </div>
    )
  }

  const tabletCategories = doc.categories.filter((c) => c.liveOnTablet === true)

  if (tabletCategories.length === 0) {
    return (
      <p style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '32px 16px', lineHeight: 1.6 }}>
        אין עדיין קטגוריות מסומנות לניהול מהטאבלט.
        <br />
        סמנו קטגוריה כ&quot;מנוהלת מהטאבלט&quot; בעריכת התפריט (למשל שייקים, מאפים, כריכים, עוגיות).
      </p>
    )
  }

  const activeCategory = tabletCategories.find((c) => c.id === selectedCategoryId) ?? null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {isOwner && !withinOperatingHours && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            borderRadius: 'var(--radius-lg)',
            background: 'rgba(255,138,92,0.12)',
            border: '1px solid rgba(255,138,92,0.35)',
            color: '#ff8a5c',
            fontSize: '0.82rem',
            fontWeight: 600,
          }}
        >
          <Clock size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
          מחוץ לשעות הפעילות — שינויים כאן לא יופיעו אצל הלקוחות עד לפתיחה.
        </div>
      )}

      {!activeCategory ? (
        <CategoryGrid categories={tabletCategories} onSelect={setSelectedCategoryId} />
      ) : (
        <CategoryDetail category={activeCategory} pending={pending} onPatch={patch} onBack={() => setSelectedCategoryId(null)} />
      )}
    </div>
  )
}

function summarize(category: MenuCategory): { total: number; soldOut: number } {
  let total = 0
  let soldOut = 0
  for (const item of category.items) {
    const units = item.types?.length ? item.types : [item]
    for (const unit of units) {
      total += 1
      if (unit.available === false) soldOut += 1
    }
  }
  return { total, soldOut }
}

// The landing view — each liveOnTablet category as its own large tile.
// Deliberately a grid of destinations, not a shared scroll list: picking
// one is the "container taking up the entire screen" this feature is built
// around, so two categories' items are never visible (or scrollable into
// each other) at the same time.
function CategoryGrid({ categories, onSelect }: { categories: MenuCategory[]; onSelect: (id: string) => void }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 12,
        minHeight: 'calc(100dvh - 220px)',
        alignContent: 'start',
      }}
    >
      {categories.map((category) => {
        const Icon = resolveCategoryIcon(category.icon)
        const { total, soldOut } = summarize(category)
        return (
          <button
            key={category.id}
            type="button"
            className="press"
            onClick={() => onSelect(category.id)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              minHeight: 160,
              padding: '20px 14px',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--line-strong)',
              background: 'var(--bg-elev)',
              color: 'var(--text)',
              cursor: 'pointer',
              textAlign: 'center',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 52,
                height: 52,
                borderRadius: 16,
                background: 'var(--bg-elev-2)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--neon-soft)',
              }}
            >
              <Icon size={26} aria-hidden="true" />
            </span>
            <span style={{ fontWeight: 800, fontSize: '1.1rem' }}>{category.title.he || 'קטגוריה'}</span>
            <span style={{ fontSize: '0.78rem', color: soldOut > 0 ? '#ff8a5c' : 'var(--text-faint)', fontWeight: 600 }}>
              {total} פריטים{soldOut > 0 ? ` · ${soldOut} אזלו` : ''}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// One category, full screen — the "container" itself. A responsive grid
// (not a single column) so a landscape tablet actually uses its width
// instead of one narrow phone-shaped strip down the middle.
function CategoryDetail({
  category,
  pending,
  onPatch,
  onBack,
}: {
  category: MenuCategory
  pending: Set<string>
  onPatch: (itemUid: string, typeUid: string | null, patch: { available?: boolean; quantity?: number }) => void
  onBack: () => void
}) {
  const Icon = resolveCategoryIcon(category.icon)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minHeight: 'calc(100dvh - 220px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          onClick={onBack}
          aria-label="חזרה לקטגוריות"
          className="press dir-flip"
          style={{
            width: 40,
            height: 40,
            minWidth: 40,
            borderRadius: '50%',
            background: 'var(--bg-elev-2)',
            display: 'grid',
            placeItems: 'center',
            color: 'var(--text)',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          <ChevronLeft size={20} strokeWidth={2.25} aria-hidden="true" />
        </button>
        <Icon size={20} aria-hidden="true" style={{ color: 'var(--neon-soft)', flexShrink: 0 }} />
        <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>{category.title.he || 'קטגוריה'}</h2>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 10, alignContent: 'start' }}>
        {category.items.map((item, itemIndex) => (
          <ItemCard key={item.uid ?? itemIndex} item={item} pending={pending} onPatch={onPatch} />
        ))}
      </div>
    </div>
  )
}

function ItemCard({
  item,
  pending,
  onPatch,
}: {
  item: MenuItem
  pending: Set<string>
  onPatch: (itemUid: string, typeUid: string | null, patch: { available?: boolean; quantity?: number }) => void
}) {
  return (
    <div style={{ padding: '14px 16px', borderRadius: 'var(--radius-lg)', background: 'var(--bg-elev)', border: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>{item.he || 'פריט'}</p>
        </div>
        {!item.types?.length && (
          <QuantityStepper
            value={item.quantity}
            disabled={!item.uid || pending.has(`${item.uid}:`)}
            onChange={(q) => item.uid && onPatch(item.uid, null, { quantity: q })}
          />
        )}
        <TabletSwitch
          on={item.available !== false}
          disabled={!item.uid || pending.has(`${item.uid}:`)}
          onClick={() => item.uid && onPatch(item.uid, null, { available: item.available === false })}
        />
      </div>

      {!!item.types?.length && (
        <div
          style={{
            marginTop: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            borderTop: '1px solid var(--line)',
            paddingTop: 10,
          }}
        >
          {item.types.map((type) => (
            <div key={type.uid} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ flex: 1, fontSize: '0.92rem', color: 'var(--text-dim)' }}>{type.he || 'סוג'}</span>
              <QuantityStepper
                value={type.quantity}
                disabled={!item.uid || pending.has(`${item.uid}:${type.uid}`)}
                onChange={(q) => item.uid && onPatch(item.uid, type.uid!, { quantity: q })}
              />
              <TabletSwitch
                on={type.available !== false}
                disabled={!item.uid || pending.has(`${item.uid}:${type.uid}`)}
                onClick={() => item.uid && onPatch(item.uid, type.uid!, { available: type.available === false })}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Bigger tap target than the editor's own inline switch — this page is
// meant for a mounted tablet, tapped in a hurry mid-service.
function TabletSwitch({ on, disabled, onClick }: { on: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={on ? 'זמין' : 'אזל ממלאי'}
      disabled={disabled}
      onClick={onClick}
      className="press"
      style={{
        background: 'none',
        border: 'none',
        padding: 10,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        flexShrink: 0,
      }}
    >
      <span style={{ display: 'inline-block', transform: 'scale(1.3)' }}>
        <Switch on={on} />
      </span>
    </button>
  )
}

/** The live-count control — shown to customers on the public menu
 * (MenuView.tsx) when set, so unlike TabletSwitch this isn't decoration:
 * `undefined` means "not tracked," 0 means "tracked and empty," and the
 * two read very differently to a customer deciding what to order. */
function QuantityStepper({ value, disabled, onChange }: { value: number | undefined; disabled?: boolean; onChange: (next: number) => void }) {
  const n = value ?? 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
      <StepButton label="הפחתת כמות" disabled={disabled || n <= 0} onClick={() => onChange(Math.max(0, n - 1))}>
        <Minus size={16} aria-hidden="true" />
      </StepButton>
      <span
        className="ltr-isolate"
        style={{
          minWidth: 30,
          textAlign: 'center',
          fontSize: '1rem',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          color: value === undefined ? 'var(--text-faint)' : n === 0 ? '#ff6b6b' : 'var(--text)',
        }}
      >
        {value ?? '—'}
      </span>
      <StepButton label="הוספת כמות" disabled={disabled} onClick={() => onChange(n + 1)}>
        <Plus size={16} aria-hidden="true" />
      </StepButton>
    </div>
  )
}

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="press"
      style={{
        width: 34,
        height: 34,
        borderRadius: 9,
        border: '1px solid var(--line-strong)',
        background: 'var(--bg-elev-2)',
        color: 'var(--text)',
        display: 'grid',
        placeItems: 'center',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  )
}
