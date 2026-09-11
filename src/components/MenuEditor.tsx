'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import MenuVersionBar from '@/components/MenuVersionBar'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import Switch from '@/components/Switch'
import { ensureUids } from '@/lib/menu/variants'
import type { MenuCategory, MenuDoc, MenuItem, MenuVariant } from '@/lib/menu/types'

type LoadedMenu = { menuId: string; activeVariantId: string | null; draft: MenuDoc; variants: MenuVariant[] }

function randomId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
}

function normalizePrice(value: unknown): number | string {
  const text = String(value ?? '').trim()
  if (text === '') return 0
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text)
  return text // e.g. "20/24" range — kept as a literal string
}

export default function MenuEditor({ branchSlug, branchLabel }: { branchSlug: string; branchLabel: string }) {
  const [loaded, setLoaded] = useState<LoadedMenu | null>(null)
  const [draft, setDraft] = useState<MenuDoc | null>(null)
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [confirmRequest, setConfirmRequest] = useState<(ConfirmRequest & { onYes: () => void }) | null>(null)
  const [showOutOfStock, setShowOutOfStock] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/owner/menu-variants?branch=${branchSlug}`)
    if (!res.ok) return
    const payload = (await res.json()) as LoadedMenu
    const withUids = ensureUids(payload.draft)
    setLoaded({ ...payload, draft: withUids })
    setDraft(withUids)
    setDirty(false)
  }, [branchSlug])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  function edit(mutate: (doc: MenuDoc) => void) {
    setDraft((prev) => {
      if (!prev) return prev
      const next: MenuDoc = structuredClone(prev)
      mutate(next)
      return next
    })
    setDirty(true)
  }

  function flash(message: string, isError = false) {
    setStatus(isError ? 'error' : 'saved')
    setStatusMessage(message)
    window.setTimeout(() => setStatus('idle'), 1800)
  }

  // Normalizes free-typed prices ("30" -> 30, "30/34" kept as a literal
  // range string) into a fresh copy — never mutates the live draft, so
  // editing can continue with the raw typed values still in the inputs.
  function buildPayload(source: MenuDoc): MenuDoc {
    return {
      categories: source.categories.map((category) => ({
        ...category,
        items: category.items.map((item) => ({ ...item, price: normalizePrice(item.price) })),
      })),
    }
  }

  async function saveDoc(doc: MenuDoc): Promise<boolean> {
    if (!loaded) return false
    setStatus('saving')
    const supabase = createClient()
    const { error } = await supabase
      .from('menus')
      .update({ draft: doc, updated_at: new Date().toISOString() })
      .eq('id', loaded.menuId)

    if (error) {
      flash('שגיאה בשמירה: ' + error.message, true)
      return false
    }
    setDirty(false)
    return true
  }

  async function save() {
    if (!draft) return
    const ok = await saveDoc(buildPayload(draft))
    if (ok) flash('נשמר ✓')
  }

  async function publish() {
    if (!loaded || !draft) return
    const payload = buildPayload(draft)
    const ok = await saveDoc(payload)
    if (!ok) return
    setDraft(payload)

    const supabase = createClient()
    const { error } = await supabase.rpc('publish_menu', { p_menu_id: loaded.menuId })
    if (error) {
      flash('שגיאה בפרסום: ' + error.message, true)
      return
    }
    flash('פורסם ✓')
  }

  function addCategory() {
    edit((doc) => {
      doc.categories.push({ id: randomId('c'), icon: '🍽️', title: { he: '', en: '', ar: '' }, items: [] })
    })
  }

  function deleteCategory(index: number) {
    setConfirmRequest({
      title: 'מחיקת קטגוריה?',
      body: 'כל הפריטים בקטגוריה יימחקו יחד איתה.',
      confirmLabel: 'מחיקה',
      danger: true,
      onYes: () => edit((doc) => void doc.categories.splice(index, 1)),
    })
  }

  function moveCategory(index: number, direction: -1 | 1) {
    edit((doc) => {
      const target = index + direction
      if (target < 0 || target >= doc.categories.length) return
      const list = doc.categories
      const tmp = list[index]!
      list[index] = list[target]!
      list[target] = tmp
    })
  }

  function addItem(categoryIndex: number) {
    edit((doc) => {
      doc.categories[categoryIndex]?.items.push({ uid: randomId('i'), he: '', en: '', ar: '', price: '' })
    })
  }

  function deleteItem(categoryIndex: number, itemIndex: number) {
    edit((doc) => void doc.categories[categoryIndex]?.items.splice(itemIndex, 1))
  }

  function moveItem(categoryIndex: number, index: number, direction: -1 | 1) {
    edit((doc) => {
      const items = doc.categories[categoryIndex]?.items
      if (!items) return
      const target = index + direction
      if (target < 0 || target >= items.length) return
      const tmp = items[index]!
      items[index] = items[target]!
      items[target] = tmp
    })
  }

  function returnToStock(uid: string) {
    edit((doc) => {
      for (const category of doc.categories) {
        const item = category.items.find((i) => i.uid === uid)
        if (item) item.available = true
      }
    })
  }

  if (!loaded || !draft) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="sk" style={{ height: 120 }} />
        ))}
      </div>
    )
  }

  const outOfStock = draft.categories.flatMap((c) => c.items.filter((i) => i.available === false))

  return (
    <div style={{ paddingBottom: 88 }}>
      <MenuVersionBar
        branchSlug={branchSlug}
        draft={draft}
        variants={loaded.variants}
        activeVariantId={loaded.activeVariantId}
        onChanged={load}
      />

      <p style={{ fontSize: '0.78rem', color: 'var(--text-faint)', margin: '0 0 16px' }}>
        עריכת התפריט של {branchLabel}. השינויים נשמרים כטיוטה — לחיצה על &quot;פרסום&quot; היא מה שהלקוחות רואים בפועל.
      </p>

      {outOfStock.length > 0 && (
        <section style={{ marginBottom: 20 }}>
          <button
            type="button"
            onClick={() => setShowOutOfStock((v) => !v)}
            aria-expanded={showOutOfStock}
            style={{
              width: '100%',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'var(--bg-elev)',
              border: '1px solid var(--line-strong)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 14px',
              color: 'var(--text)',
              cursor: 'pointer',
            }}
          >
            <span>📦 {outOfStock.length} פריטים אזלו מהמלאי</span>
            <span aria-hidden="true">{showOutOfStock ? '▲' : '▼'}</span>
          </button>
          {showOutOfStock && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              {outOfStock.map((item) => (
                <div
                  key={item.uid}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 12px',
                    borderRadius: 10,
                    background: 'var(--bg-elev)',
                  }}
                >
                  <span style={{ fontSize: '0.85rem' }}>{item.he}</span>
                  <button
                    type="button"
                    className="press"
                    onClick={() => item.uid && returnToStock(item.uid)}
                    style={{
                      minHeight: 36,
                      padding: '0 12px',
                      borderRadius: 999,
                      border: 'none',
                      background: 'var(--neon)',
                      color: 'var(--bg)',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    החזרה למלאי
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {draft.categories.map((category, categoryIndex) => (
        <CategoryCard
          key={category.id}
          category={category}
          index={categoryIndex}
          total={draft.categories.length}
          onMove={(dir) => moveCategory(categoryIndex, dir)}
          onDelete={() => deleteCategory(categoryIndex)}
          onEditField={(field, lang, value) =>
            edit((doc) => {
              const cat = doc.categories[categoryIndex]
              if (!cat) return
              if (field === 'icon') cat.icon = value
              else cat.title[lang] = value
            })
          }
          onAddItem={() => addItem(categoryIndex)}
          renderItem={(item, itemIndex) => (
            <ItemRow
              key={item.uid ?? itemIndex}
              item={item}
              index={itemIndex}
              total={category.items.length}
              onMove={(dir) => moveItem(categoryIndex, itemIndex, dir)}
              onDelete={() => deleteItem(categoryIndex, itemIndex)}
              onEdit={(patch) =>
                edit((doc) => {
                  const target = doc.categories[categoryIndex]?.items[itemIndex]
                  if (target) Object.assign(target, patch)
                })
              }
            />
          )}
        />
      ))}

      <button
        type="button"
        className="press"
        onClick={addCategory}
        style={{
          width: '100%',
          minHeight: 'var(--tap-min)',
          borderRadius: 'var(--radius-md)',
          border: '1px dashed var(--line-strong)',
          background: 'transparent',
          color: 'var(--text-dim)',
          fontWeight: 600,
          cursor: 'pointer',
          marginBottom: 24,
        }}
      >
        ＋ הוספת קטגוריה
      </button>

      <div
        style={{
          position: 'sticky',
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 0',
          background: 'linear-gradient(0deg, var(--bg) 60%, transparent)',
        }}
      >
        <span
          role="status"
          style={{
            fontSize: '0.8rem',
            color: status === 'error' ? '#ff6b6b' : dirty ? 'var(--neon-soft)' : 'var(--text-faint)',
          }}
        >
          {status === 'saving' ? 'שומר…' : status !== 'idle' ? statusMessage : dirty ? 'יש שינויים שלא נשמרו' : 'נשמר'}
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="press"
          onClick={save}
          style={{
            minHeight: 'var(--tap-min)',
            padding: '0 18px',
            borderRadius: 999,
            border: '1px solid var(--line-strong)',
            background: 'var(--bg-elev)',
            color: 'var(--text)',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          שמירת טיוטה
        </button>
        <button
          type="button"
          className="press"
          onClick={publish}
          style={{
            minHeight: 'var(--tap-min)',
            padding: '0 18px',
            borderRadius: 999,
            border: 'none',
            background: 'var(--neon)',
            color: 'var(--bg)',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          פרסום
        </button>
      </div>

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

function CategoryCard({
  category,
  index,
  total,
  onMove,
  onDelete,
  onEditField,
  onAddItem,
  renderItem,
}: {
  category: MenuCategory
  index: number
  total: number
  onMove: (dir: -1 | 1) => void
  onDelete: () => void
  onEditField: (field: 'icon' | 'he' | 'en' | 'ar', lang: 'he' | 'en' | 'ar', value: string) => void
  onAddItem: () => void
  renderItem: (item: MenuItem, index: number) => React.ReactNode
}) {
  return (
    <section
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-lg)',
        padding: 14,
        marginBottom: 12,
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <CtrlButton label="הזזה למעלה" glyph="▲" disabled={index === 0} onClick={() => onMove(-1)} />
        <CtrlButton label="הזזה למטה" glyph="▼" disabled={index === total - 1} onClick={() => onMove(1)} />
        <input
          value={category.icon ?? ''}
          maxLength={4}
          aria-label="אייקון"
          onChange={(e) => onEditField('icon', 'he', e.target.value)}
          style={{ ...smallInputStyle, width: 44, textAlign: 'center' }}
        />
        <input
          value={category.title.he ?? ''}
          placeholder="שם הקטגוריה"
          onChange={(e) => onEditField('he', 'he', e.target.value)}
          style={{ ...smallInputStyle, flex: 1, fontWeight: 700 }}
        />
        <CtrlButton label="מחיקת קטגוריה" glyph="🗑" danger onClick={onDelete} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
        <input
          dir="ltr"
          placeholder="English"
          value={category.title.en ?? ''}
          onChange={(e) => onEditField('en', 'en', e.target.value)}
          style={smallInputStyle}
        />
        <input
          placeholder="العربية"
          value={category.title.ar ?? ''}
          onChange={(e) => onEditField('ar', 'ar', e.target.value)}
          style={smallInputStyle}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {category.items.map((item, itemIndex) => renderItem(item, itemIndex))}
      </div>

      <button
        type="button"
        onClick={onAddItem}
        style={{
          marginTop: 10,
          width: '100%',
          minHeight: 40,
          borderRadius: 10,
          border: '1px dashed var(--line-strong)',
          background: 'transparent',
          color: 'var(--text-dim)',
          fontSize: '0.85rem',
          cursor: 'pointer',
        }}
      >
        ＋ הוספת פריט
      </button>
    </section>
  )
}

function ItemRow({
  item,
  index,
  total,
  onMove,
  onDelete,
  onEdit,
}: {
  item: MenuItem
  index: number
  total: number
  onMove: (dir: -1 | 1) => void
  onDelete: () => void
  onEdit: (patch: Partial<MenuItem>) => void
}) {
  const [showNote, setShowNote] = useState(!!item.note)

  return (
    <div style={{ display: 'flex', gap: 8, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <CtrlButton label="הזזה למעלה" glyph="▲" disabled={index === 0} onClick={() => onMove(-1)} small />
        <CtrlButton label="הזזה למטה" glyph="▼" disabled={index === total - 1} onClick={() => onMove(1)} small />
        <CtrlButton label="מחיקת פריט" glyph="🗑" danger small onClick={onDelete} />
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            placeholder="שם הפריט"
            value={item.he ?? ''}
            onChange={(e) => onEdit({ he: e.target.value })}
            style={{ ...smallInputStyle, flex: 1 }}
          />
          <input
            inputMode="decimal"
            placeholder="מחיר"
            value={String(item.price ?? '')}
            onChange={(e) => onEdit({ price: e.target.value })}
            className="ltr-isolate"
            style={{ ...smallInputStyle, width: 72, textAlign: 'center' }}
          />
          <label
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.7rem', color: 'var(--text-faint)' }}
          >
            <button
              type="button"
              role="switch"
              aria-checked={item.available !== false}
              aria-label="זמין"
              onClick={() => onEdit({ available: item.available === false ? true : false })}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
            >
              <Switch on={item.available !== false} />
            </button>
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <input dir="ltr" placeholder="English" value={item.en ?? ''} onChange={(e) => onEdit({ en: e.target.value })} style={smallInputStyle} />
          <input placeholder="العربية" value={item.ar ?? ''} onChange={(e) => onEdit({ ar: e.target.value })} style={smallInputStyle} />
        </div>

        {showNote ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              placeholder="הערה"
              value={item.note?.he ?? ''}
              onChange={(e) => onEdit({ note: { ...item.note, he: e.target.value } })}
              style={{ ...smallInputStyle, flex: 1 }}
            />
            <button
              type="button"
              onClick={() => {
                setShowNote(false)
                onEdit({ note: undefined })
              }}
              style={{ background: 'none', border: 'none', color: 'var(--text-faint)', fontSize: '0.78rem', cursor: 'pointer' }}
            >
              × הסרה
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowNote(true)}
            style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: 'var(--neon-2)', fontSize: '0.78rem', cursor: 'pointer' }}
          >
            ＋ הוספת הערה
          </button>
        )}
      </div>
    </div>
  )
}

function CtrlButton({
  label,
  glyph,
  onClick,
  disabled,
  danger,
  small,
}: {
  label: string
  glyph: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  small?: boolean
}) {
  const size = small ? 28 : 34
  return (
    <button
      type="button"
      className="press"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: size,
        height: size,
        minWidth: size,
        borderRadius: 8,
        border: '1px solid var(--line-strong)',
        background: 'var(--bg-elev-2)',
        color: danger ? '#ff6b6b' : 'var(--text)',
        opacity: disabled ? 0.35 : 1,
        cursor: disabled ? 'default' : 'pointer',
        fontSize: small ? '0.7rem' : '0.8rem',
      }}
    >
      {glyph}
    </button>
  )
}

const smallInputStyle: React.CSSProperties = {
  minHeight: 40,
  borderRadius: 10,
  border: '1px solid var(--line-strong)',
  background: 'var(--bg)',
  color: 'var(--text)',
  padding: '0 10px',
  fontSize: '0.85rem',
}
