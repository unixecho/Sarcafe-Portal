'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, Clock, Layers, Minus, Plus, Trash2, Undo2 } from 'lucide-react'
import Switch from '@/components/Switch'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import { ensureUids } from '@/lib/menu/variants'
import { randomId } from '@/lib/menu/id'
import { resolveCategoryIcon } from '@/lib/menu/icons'
import { useMenuRealtime } from '@/lib/menu/useMenuRealtime'
import type { MenuCategory, MenuDoc, MenuItem, MenuItemType } from '@/lib/menu/types'
import type { BranchSlug } from '@/lib/branches'

const POLL_MS = 20_000 // fallback only — the realtime broadcast (see
// lib/menu/realtime.ts) is what normally makes a change from another
// device show up here without waiting for this interval.

// An item IS a subcategory exactly when it carries a `types` array (even
// empty) — some categories are flat (עוגיות/שייקים: a handful of items,
// done), others need one more level (מאפים -> מאפה רגיל/מאפה שווה -> the
// actual pastries sold under each). No schema flag: PATCH
// /api/owner/menu-items (set_menu_item_container, migration 016) is the
// only thing that adds/removes the `types` key, and it refuses to drop it
// while any types exist.
function isContainer(item: MenuItem): boolean {
  return Array.isArray(item.types)
}

// Three screens deep, one at a time, each taking the full width — no
// category CRUD, no translations, just the owner's own vocabulary. Scoped
// to only the categories flagged `liveOnTablet` in the editor — everything
// else is accounted for elsewhere and doesn't belong on a screen meant to
// be updated in a hurry mid-service. Every change POSTs to one of the
// /api/owner/menu-* tablet routes, which update draft (always) and
// published (only during operating hours — see lib/shifts/hours.ts)
// atomically so it's live on the public menu immediately, not gated behind
// the next Publish.
export default function TabletAvailability({ branchSlug, isOwner }: { branchSlug: BranchSlug; isOwner: boolean }) {
  const [doc, setDoc] = useState<MenuDoc | null>(null)
  const [withinOperatingHours, setWithinOperatingHours] = useState(true)
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [confirmRequest, setConfirmRequest] = useState<(ConfirmRequest & { onYes: () => void }) | null>(null)

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
    setSelectedItemId(null)
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

  function openCategory(id: string) {
    setSelectedCategoryId(id)
    setSelectedItemId(null)
  }

  function backToCategories() {
    setSelectedCategoryId(null)
    setSelectedItemId(null)
  }

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

  // Structural changes (add/remove an item or a type, convert item<->
  // subcategory) — same live, operating-hours-gated write paths as patch()
  // above, just for the tree shape instead of one entry's fields.
  // Optimistic the same way: update local state immediately, only
  // reconcile against the server via load() if the request actually fails.
  async function addItem(categoryId: string, name: string, price: string) {
    const uid = randomId('i')
    const newItem: MenuItem = { uid, he: name, ...(price ? { price } : {}) }

    setDoc((prev) => {
      if (!prev) return prev
      const next = structuredClone(prev)
      next.categories.find((c) => c.id === categoryId)?.items.push(newItem)
      return next
    })

    try {
      const res = await fetch('/api/owner/menu-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: branchSlug, categoryId, uid, name, price: price || undefined }),
      })
      if (!res.ok) throw new Error('request failed')
    } catch {
      load()
    }
  }

  async function removeItem(itemUid: string) {
    setDoc((prev) => {
      if (!prev) return prev
      const next = structuredClone(prev)
      for (const category of next.categories) {
        category.items = category.items.filter((i) => i.uid !== itemUid)
      }
      return next
    })

    try {
      const res = await fetch('/api/owner/menu-items', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: branchSlug, itemUid }),
      })
      if (!res.ok) throw new Error('request failed')
    } catch {
      load()
    }
  }

  // A removed item's price/translations/notes (if it has any, from the full
  // desktop editor) go with it — that's a real loss, not just an
  // availability flip, so this asks first instead of acting on one tap.
  function requestRemoveItem(itemUid: string, label: string) {
    setConfirmRequest({
      title: 'הסרת פריט?',
      body: `"${label}" יוסר מהתפריט אצל הלקוחות.`,
      confirmLabel: 'הסרה',
      danger: true,
      onYes: () => removeItem(itemUid),
    })
  }

  async function addType(itemUid: string, name: string, priceDelta: string) {
    const uid = randomId('t')
    const newType: MenuItemType = { uid, he: name, ...(priceDelta ? { priceDelta } : {}) }

    setDoc((prev) => {
      if (!prev) return prev
      const next = structuredClone(prev)
      for (const category of next.categories) {
        const item = category.items.find((i) => i.uid === itemUid)
        if (item) item.types = [...(item.types ?? []), newType]
      }
      return next
    })

    try {
      const res = await fetch('/api/owner/menu-item-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: branchSlug, itemUid, uid, name, priceDelta: priceDelta || undefined }),
      })
      if (!res.ok) throw new Error('request failed')
    } catch {
      load()
    }
  }

  async function removeType(typeUid: string) {
    setDoc((prev) => {
      if (!prev) return prev
      const next = structuredClone(prev)
      for (const category of next.categories) {
        for (const item of category.items) {
          if (item.types) item.types = item.types.filter((t) => t.uid !== typeUid)
        }
      }
      return next
    })

    try {
      const res = await fetch('/api/owner/menu-item-types', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: branchSlug, typeUid }),
      })
      if (!res.ok) throw new Error('request failed')
    } catch {
      load()
    }
  }

  function requestRemoveType(typeUid: string, label: string) {
    setConfirmRequest({
      title: 'הסרת פריט?',
      body: `"${label}" יוסר מהתפריט אצל הלקוחות.`,
      confirmLabel: 'הסרה',
      danger: true,
      onYes: () => removeType(typeUid),
    })
  }

  // Turning ON is always safe (idempotent — the route/RPC just ensure
  // `types` exists). Turning OFF is only ever offered by the UI when
  // `types` is already empty, so the optimistic update below can't discard
  // anything either.
  async function setContainer(itemUid: string, container: boolean) {
    setDoc((prev) => {
      if (!prev) return prev
      const next = structuredClone(prev)
      for (const category of next.categories) {
        const item = category.items.find((i) => i.uid === itemUid)
        if (!item) continue
        if (container) item.types = item.types ?? []
        else delete item.types
      }
      return next
    })

    try {
      const res = await fetch('/api/owner/menu-items', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: branchSlug, itemUid, isContainer: container }),
      })
      if (!res.ok) throw new Error('request failed')
    } catch {
      load()
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
  const activeItem = activeCategory?.items.find((i) => i.uid === selectedItemId && isContainer(i)) ?? null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {isOwner && !withinOperatingHours && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 16px',
            borderRadius: 'var(--radius-lg)',
            background: 'rgba(255,138,92,0.12)',
            border: '1px solid rgba(255,138,92,0.35)',
            color: '#ff8a5c',
            fontSize: '0.88rem',
            fontWeight: 600,
          }}
        >
          <Clock size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
          מחוץ לשעות הפעילות — שינויים כאן לא יופיעו אצל הלקוחות עד לפתיחה.
        </div>
      )}

      {!activeCategory ? (
        <CategoryGrid categories={tabletCategories} onSelect={openCategory} />
      ) : activeItem ? (
        <ItemDetail
          item={activeItem}
          pending={pending}
          onPatch={patch}
          onBack={() => setSelectedItemId(null)}
          onAddType={(name, priceDelta) => addType(activeItem.uid!, name, priceDelta)}
          onRequestRemoveType={requestRemoveType}
          onConvertToItem={() => setContainer(activeItem.uid!, false)}
        />
      ) : (
        <CategoryDetail
          category={activeCategory}
          pending={pending}
          onPatch={patch}
          onBack={backToCategories}
          onOpenItem={setSelectedItemId}
          onAddItem={(name, price) => addItem(activeCategory.id, name, price)}
          onRequestRemove={requestRemoveItem}
          onMakeContainer={(itemUid) => setContainer(itemUid, true)}
        />
      )}

      <ConfirmSheet
        request={confirmRequest}
        onCancel={() => setConfirmRequest(null)}
        onConfirm={() => {
          confirmRequest?.onYes()
          setConfirmRequest(null)
        }}
      />
    </div>
  )
}

function summarize(category: MenuCategory): { total: number; soldOut: number } {
  let total = 0
  let soldOut = 0
  for (const item of category.items) {
    // A subcategory contributes its OWN types' count, not "1" for itself —
    // it isn't a sellable unit on its own, even while still empty.
    const units = isContainer(item) ? (item.types ?? []) : [item]
    for (const unit of units) {
      total += 1
      if (unit.available === false) soldOut += 1
    }
  }
  return { total, soldOut }
}

function typeSummary(item: MenuItem): { total: number; soldOut: number } {
  const types = item.types ?? []
  return { total: types.length, soldOut: types.filter((t) => t.available === false).length }
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
        gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
        gap: 16,
        minHeight: 'calc(100dvh - 260px)',
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
              gap: 12,
              minHeight: 200,
              padding: '24px 16px',
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
                width: 64,
                height: 64,
                borderRadius: 18,
                background: 'var(--bg-elev-2)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--neon-soft)',
              }}
            >
              <Icon size={32} aria-hidden="true" />
            </span>
            <span style={{ fontWeight: 800, fontSize: '1.3rem' }}>{category.title.he || 'קטגוריה'}</span>
            <span style={{ fontSize: '0.85rem', color: soldOut > 0 ? '#ff8a5c' : 'var(--text-faint)', fontWeight: 600 }}>
              {total} פריטים{soldOut > 0 ? ` · ${soldOut} אזלו` : ''}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// Shared header row for both drill-down levels (category detail, item
// detail) — back button + icon + title, kept identical so the two screens
// read as the same kind of place at different depth, not two different UIs.
function DetailHeader({
  icon,
  title,
  onBack,
  trailing,
}: {
  icon: React.ReactNode
  title: string
  onBack: () => void
  trailing?: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <button
        type="button"
        onClick={onBack}
        aria-label="חזרה"
        className="press dir-flip"
        style={{
          width: 48,
          height: 48,
          minWidth: 48,
          borderRadius: '50%',
          background: 'var(--bg-elev-2)',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--text)',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        <ChevronLeft size={22} strokeWidth={2.25} aria-hidden="true" />
      </button>
      {icon}
      <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800, flex: 1 }}>{title}</h2>
      {trailing}
    </div>
  )
}

// One category, full screen. Items that are themselves subcategories
// (isContainer) render as tappable tiles leading one level deeper; plain
// items render as the editable card they always were. A responsive grid
// (not a single column) so a landscape tablet actually uses its width.
function CategoryDetail({
  category,
  pending,
  onPatch,
  onBack,
  onOpenItem,
  onAddItem,
  onRequestRemove,
  onMakeContainer,
}: {
  category: MenuCategory
  pending: Set<string>
  onPatch: (itemUid: string, typeUid: string | null, patch: { available?: boolean; quantity?: number }) => void
  onBack: () => void
  onOpenItem: (itemUid: string) => void
  onAddItem: (name: string, price: string) => Promise<void>
  onRequestRemove: (itemUid: string, label: string) => void
  onMakeContainer: (itemUid: string) => void
}) {
  const Icon = resolveCategoryIcon(category.icon)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minHeight: 'calc(100dvh - 260px)' }}>
      <DetailHeader
        icon={<Icon size={24} aria-hidden="true" style={{ color: 'var(--neon-soft)', flexShrink: 0 }} />}
        title={category.title.he || 'קטגוריה'}
        onBack={onBack}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12, alignContent: 'start' }}>
        <AddEntryCard onAdd={onAddItem} namePlaceholder="שם פריט או תת-קטגוריה חדשה" />
        {category.items.map((item, itemIndex) =>
          isContainer(item) ? (
            <SubcategoryTile key={item.uid ?? itemIndex} item={item} onOpen={() => item.uid && onOpenItem(item.uid)} />
          ) : (
            <ItemCard
              key={item.uid ?? itemIndex}
              item={item}
              pending={pending}
              onPatch={onPatch}
              onRequestRemove={onRequestRemove}
              onMakeContainer={onMakeContainer}
            />
          )
        )}
      </div>
    </div>
  )
}

// One subcategory (e.g. מאפה רגיל), full screen — the actual sellable
// pastries live here as types, added/removed/quantified exactly like a
// flat category's items are one level up.
function ItemDetail({
  item,
  pending,
  onPatch,
  onBack,
  onAddType,
  onRequestRemoveType,
  onConvertToItem,
}: {
  item: MenuItem
  pending: Set<string>
  onPatch: (itemUid: string, typeUid: string | null, patch: { available?: boolean; quantity?: number }) => void
  onBack: () => void
  onAddType: (name: string, priceDelta: string) => Promise<void>
  onRequestRemoveType: (typeUid: string, label: string) => void
  onConvertToItem: () => void
}) {
  const types = item.types ?? []
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minHeight: 'calc(100dvh - 260px)' }}>
      <DetailHeader
        icon={<Layers size={22} aria-hidden="true" style={{ color: 'var(--neon-soft)', flexShrink: 0 }} />}
        title={item.he || 'תת-קטגוריה'}
        onBack={onBack}
        trailing={
          types.length === 0 ? (
            <button
              type="button"
              onClick={onConvertToItem}
              className="press"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                borderRadius: 10,
                border: '1px solid var(--line-strong)',
                background: 'var(--bg-elev-2)',
                color: 'var(--text-dim)',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <Undo2 size={15} aria-hidden="true" /> הפוך לפריט רגיל
            </button>
          ) : null
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12, alignContent: 'start' }}>
        <AddEntryCard onAdd={onAddType} namePlaceholder="שם פריט חדש" pricePlaceholder="תוספת מחיר (לא חובה)" />
        {types.map((type, typeIndex) => (
          <TypeCard
            key={type.uid ?? typeIndex}
            itemUid={item.uid!}
            type={type}
            pending={pending}
            onPatch={onPatch}
            onRequestRemove={onRequestRemoveType}
          />
        ))}
      </div>
    </div>
  )
}

// A container item, shown as a destination rather than something with its
// own switch/quantity — it has none; only its types do.
function SubcategoryTile({ item, onOpen }: { item: MenuItem; onOpen: () => void }) {
  const { total, soldOut } = typeSummary(item)
  return (
    <button
      type="button"
      className="press"
      onClick={onOpen}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '18px 18px',
        borderRadius: 'var(--radius-lg)',
        border: '1px dashed var(--line-strong)',
        background: 'var(--bg-elev)',
        color: 'var(--text)',
        cursor: 'pointer',
        textAlign: 'start',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          background: 'var(--bg-elev-2)',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--neon-soft)',
          flexShrink: 0,
        }}
      >
        <Layers size={22} aria-hidden="true" />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 800, fontSize: '1.1rem' }}>{item.he || 'תת-קטגוריה'}</span>
        <span style={{ display: 'block', fontSize: '0.8rem', color: soldOut > 0 ? '#ff8a5c' : 'var(--text-faint)', fontWeight: 600 }}>
          {total > 0 ? `${total} פריטים${soldOut > 0 ? ` · ${soldOut} אזלו` : ''}` : 'ריק — הוספת פריטים בפנים'}
        </span>
      </span>
      <ChevronLeft size={20} className="dir-flip" aria-hidden="true" style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
    </button>
  )
}

// Deliberately just a name and an optional price — fast enough to fill in
// between transactions. Renaming, translations, notes, and images stay in
// the full desktop editor; this is the tablet's own fast path for "a new
// sandwich filling just became a thing," not a second menu editor. Shared
// by both drill-down levels (adding an item/subcategory, adding a type).
function AddEntryCard({
  onAdd,
  namePlaceholder,
  pricePlaceholder = 'מחיר (לא חובה)',
}: {
  onAdd: (name: string, price: string) => Promise<void>
  namePlaceholder: string
  pricePlaceholder?: string
}) {
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      await onAdd(trimmed, price.trim())
      setName('')
      setPrice('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      style={{
        padding: '16px 18px',
        borderRadius: 'var(--radius-lg)',
        border: '1px dashed var(--line-strong)',
        background: 'var(--bg-elev)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder={namePlaceholder} disabled={busy} style={addInputStyle} />
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          placeholder={pricePlaceholder}
          inputMode="decimal"
          disabled={busy}
          style={{ ...addInputStyle, flex: 1 }}
        />
        <button
          type="submit"
          className="press"
          disabled={!name.trim() || busy}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '0 18px',
            borderRadius: 12,
            border: 'none',
            background: 'var(--neon)',
            color: 'var(--bg)',
            fontWeight: 700,
            fontSize: '0.9rem',
            cursor: !name.trim() || busy ? 'default' : 'pointer',
            opacity: !name.trim() || busy ? 0.6 : 1,
            flexShrink: 0,
          }}
        >
          <Plus size={17} aria-hidden="true" /> הוספה
        </button>
      </div>
    </form>
  )
}

const addInputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 'var(--tap-min)',
  borderRadius: 10,
  border: '1px solid var(--line-strong)',
  background: 'var(--bg)',
  color: 'var(--text)',
  padding: '0 14px',
  fontSize: '0.95rem',
}

function ItemCard({
  item,
  pending,
  onPatch,
  onRequestRemove,
  onMakeContainer,
}: {
  item: MenuItem
  pending: Set<string>
  onPatch: (itemUid: string, typeUid: string | null, patch: { available?: boolean; quantity?: number }) => void
  onRequestRemove: (itemUid: string, label: string) => void
  onMakeContainer: (itemUid: string) => void
}) {
  return (
    <div style={{ padding: '16px 18px', borderRadius: 'var(--radius-lg)', background: 'var(--bg-elev)', border: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700 }}>{item.he || 'פריט'}</p>
        </div>
        <QuantityStepper
          value={item.quantity}
          disabled={!item.uid || pending.has(`${item.uid}:`)}
          onChange={(q) => item.uid && onPatch(item.uid, null, { quantity: q })}
        />
        <TabletSwitch
          on={item.available !== false}
          disabled={!item.uid || pending.has(`${item.uid}:`)}
          onClick={() => item.uid && onPatch(item.uid, null, { available: item.available === false })}
        />
        <IconButton label="הפיכה לתת-קטגוריה" onClick={() => item.uid && onMakeContainer(item.uid)} disabled={!item.uid}>
          <Layers size={17} aria-hidden="true" />
        </IconButton>
        <IconButton label="הסרת פריט" onClick={() => item.uid && onRequestRemove(item.uid, item.he || 'פריט')} disabled={!item.uid}>
          <Trash2 size={17} aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  )
}

function TypeCard({
  itemUid,
  type,
  pending,
  onPatch,
  onRequestRemove,
}: {
  itemUid: string
  type: MenuItemType
  pending: Set<string>
  onPatch: (itemUid: string, typeUid: string | null, patch: { available?: boolean; quantity?: number }) => void
  onRequestRemove: (typeUid: string, label: string) => void
}) {
  return (
    <div style={{ padding: '16px 18px', borderRadius: 'var(--radius-lg)', background: 'var(--bg-elev)', border: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700 }}>{type.he || 'פריט'}</p>
        </div>
        <QuantityStepper
          value={type.quantity}
          disabled={pending.has(`${itemUid}:${type.uid}`)}
          onChange={(q) => onPatch(itemUid, type.uid, { quantity: q })}
        />
        <TabletSwitch
          on={type.available !== false}
          disabled={pending.has(`${itemUid}:${type.uid}`)}
          onClick={() => onPatch(itemUid, type.uid, { available: type.available === false })}
        />
        <IconButton label="הסרת פריט" onClick={() => onRequestRemove(type.uid, type.he || 'פריט')}>
          <Trash2 size={17} aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  )
}

function IconButton({
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
        background: 'none',
        border: 'none',
        padding: 8,
        color: 'var(--text-faint)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        flexShrink: 0,
      }}
    >
      {children}
    </button>
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
      <span style={{ display: 'inline-block', transform: 'scale(1.45)' }}>
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      <StepButton label="הפחתת כמות" disabled={disabled || n <= 0} onClick={() => onChange(Math.max(0, n - 1))}>
        <Minus size={18} aria-hidden="true" />
      </StepButton>
      <span
        className="ltr-isolate"
        style={{
          minWidth: 34,
          textAlign: 'center',
          fontSize: '1.1rem',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          color: value === undefined ? 'var(--text-faint)' : n === 0 ? '#ff6b6b' : 'var(--text)',
        }}
      >
        {value ?? '—'}
      </span>
      <StepButton label="הוספת כמות" disabled={disabled} onClick={() => onChange(n + 1)}>
        <Plus size={18} aria-hidden="true" />
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
        width: 40,
        height: 40,
        borderRadius: 10,
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
