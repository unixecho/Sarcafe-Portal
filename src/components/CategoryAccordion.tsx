'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, Trash2, Plus, Languages, Layers, X } from 'lucide-react'
import Switch from '@/components/Switch'
import IconPicker from '@/components/IconPicker'
import { resolveCategoryIcon, type CategoryIconKey } from '@/lib/menu/icons'
import { randomId } from '@/lib/menu/id'
import type { MenuCategory, MenuItem, MenuItemType } from '@/lib/menu/types'

type CategoryAccordionProps = {
  category: MenuCategory
  index: number
  total: number
  open: boolean
  onToggle: () => void
  onMoveCategory: (dir: -1 | 1) => void
  onDeleteCategory: () => void
  onEditCategoryField: (field: 'icon' | 'he' | 'en' | 'ar', value: string) => void
  onToggleLiveOnTablet: () => void
  onAddItem: () => void
  onMoveItem: (itemIndex: number, dir: -1 | 1) => void
  onRequestDeleteItem: (itemIndex: number, itemLabel: string) => void
  onEditItem: (itemIndex: number, patch: Partial<MenuItem>) => void
}

/**
 * A single category, collapsed by default — the owner-friendly rebuild of
 * the old always-expanded CategoryCard. Collapsed state shows only what's
 * needed to scan the menu (icon, name, item count); everything editable
 * lives behind the tap, same "grouped list" shape as an iOS Settings
 * section.
 */
export default function CategoryAccordion({
  category,
  index,
  total,
  open,
  onToggle,
  onMoveCategory,
  onDeleteCategory,
  onEditCategoryField,
  onToggleLiveOnTablet,
  onAddItem,
  onMoveItem,
  onRequestDeleteItem,
  onEditItem,
}: CategoryAccordionProps) {
  const CategoryIcon = resolveCategoryIcon(category.icon)
  const bodyId = `category-editor-body-${category.id}`

  return (
    <section
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-lg)',
        marginBottom: 10,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        className="press"
        onClick={onToggle}
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
        <span
          aria-hidden="true"
          style={{
            width: 34,
            height: 34,
            flexShrink: 0,
            borderRadius: 10,
            background: 'rgba(255,122,69,0.12)',
            color: 'var(--neon-soft)',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <CategoryIcon size={18} strokeWidth={2} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 700, fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {category.title.he || 'קטגוריה ללא שם'}
          </span>
          <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-faint)' }}>
            {category.items.length} פריטים
          </span>
        </span>
        <ChevronDown
          size={18}
          aria-hidden="true"
          style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s var(--ease)', color: 'var(--text-faint)' }}
        />
      </button>

      <div id={bodyId} inert={!open} className={`accordion-body${open ? ' is-open' : ''}`}>
        {/* .accordion-inner carries no padding of its own — see the same
            note in MenuView.tsx. A border-box element can't render
            shorter than its own padding, which pinned every collapsed
            category to a permanent 14px instead of 0. */}
        <div className="accordion-inner">
        <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <IconPicker
              value={(category.icon as CategoryIconKey) ?? 'utensils'}
              onChange={(key) => onEditCategoryField('icon', key)}
              label="סמל הקטגוריה"
            />
            <input
              value={category.title.he ?? ''}
              placeholder="שם הקטגוריה"
              onChange={(e) => onEditCategoryField('he', e.target.value)}
              style={{ ...smallInputStyle, fontWeight: 700 }}
            />

            <TranslationsDisclosure
              en={category.title.en}
              ar={category.title.ar}
              onChangeEn={(v) => onEditCategoryField('en', v)}
              onChangeAr={(v) => onEditCategoryField('ar', v)}
            />

            <button
              type="button"
              className="press"
              onClick={onToggleLiveOnTablet}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                width: '100%',
                background: 'var(--bg)',
                border: '1px solid var(--line-strong)',
                borderRadius: 10,
                padding: '10px 12px',
                cursor: 'pointer',
                color: 'var(--text)',
                textAlign: 'start',
              }}
            >
              <span>
                <span style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600 }}>מנוהל מהטאבלט</span>
                <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-faint)' }}>
                  זמינות וכמות לקטגוריה הזו יתעדכנו מ&quot;זמינות בזמן אמת&quot;
                </span>
              </span>
              <Switch on={category.liveOnTablet === true} />
            </button>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <IconButton label="הזזת הקטגוריה למעלה" disabled={index === 0} onClick={() => onMoveCategory(-1)}>
                <ChevronUp size={16} />
              </IconButton>
              <IconButton label="הזזת הקטגוריה למטה" disabled={index === total - 1} onClick={() => onMoveCategory(1)}>
                <ChevronDown size={16} />
              </IconButton>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                className="press"
                onClick={onDeleteCategory}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  minHeight: 36,
                  padding: '0 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,107,107,0.3)',
                  background: 'transparent',
                  color: '#ff6b6b',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <Trash2 size={15} aria-hidden="true" /> מחיקת קטגוריה
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {category.items.map((item, itemIndex) => (
              <ItemRow
                key={item.uid ?? itemIndex}
                item={item}
                index={itemIndex}
                total={category.items.length}
                onMove={(dir) => onMoveItem(itemIndex, dir)}
                onRequestDelete={() => onRequestDeleteItem(itemIndex, item.he || 'פריט זה')}
                onEdit={(patch) => onEditItem(itemIndex, patch)}
              />
            ))}
          </div>

          <button type="button" className="press" onClick={onAddItem} style={dashedButtonStyle}>
            <Plus size={16} aria-hidden="true" /> הוספת פריט
          </button>
        </div>
        </div>
      </div>
    </section>
  )
}

function ItemRow({
  item,
  index,
  total,
  onMove,
  onRequestDelete,
  onEdit,
}: {
  item: MenuItem
  index: number
  total: number
  onMove: (dir: -1 | 1) => void
  onRequestDelete: () => void
  onEdit: (patch: Partial<MenuItem>) => void
}) {
  const [showNote, setShowNote] = useState(!!item.note)

  return (
    <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
        <button
          type="button"
          role="switch"
          aria-checked={item.available !== false}
          aria-label="זמין במלאי"
          title="זמין במלאי"
          className="press"
          onClick={() => onEdit({ available: item.available === false ? true : false })}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0 }}
        >
          <Switch on={item.available !== false} />
        </button>
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <BadgeToggle label="חדש" active={item.isNew === true} onClick={() => onEdit({ isNew: item.isNew !== true })} />
        <BadgeToggle
          label="כדאי לטעום"
          active={item.recommended === true}
          onClick={() => onEdit({ recommended: item.recommended !== true })}
        />
      </div>

      <TranslationsDisclosure
        en={item.en}
        ar={item.ar}
        onChangeEn={(v) => onEdit({ en: v })}
        onChangeAr={(v) => onEdit({ ar: v })}
      />

      <ItemTypesEditor types={item.types ?? []} onChange={(types) => onEdit({ types })} />

      {showNote ? (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            placeholder="הערה (לדוגמה: חריף, ללא גלוטן)"
            value={item.note?.he ?? ''}
            onChange={(e) => onEdit({ note: { ...item.note, he: e.target.value } })}
            style={{ ...smallInputStyle, flex: 1 }}
          />
          <IconButton
            label="הסרת ההערה"
            onClick={() => {
              setShowNote(false)
              onEdit({ note: undefined })
            }}
          >
            <X size={14} />
          </IconButton>
        </div>
      ) : (
        <button
          type="button"
          className="press"
          onClick={() => setShowNote(true)}
          style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: 'var(--neon-2)', fontSize: '0.78rem', cursor: 'pointer', padding: 0 }}
        >
          + הוספת הערה
        </button>
      )}

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <IconButton label="הזזת הפריט למעלה" small disabled={index === 0} onClick={() => onMove(-1)}>
          <ChevronUp size={14} />
        </IconButton>
        <IconButton label="הזזת הפריט למטה" small disabled={index === total - 1} onClick={() => onMove(1)}>
          <ChevronDown size={14} />
        </IconButton>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="press"
          onClick={onRequestDelete}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            background: 'none',
            border: 'none',
            color: 'var(--text-faint)',
            fontSize: '0.76rem',
            cursor: 'pointer',
            padding: '4px 2px',
          }}
        >
          <Trash2 size={13} aria-hidden="true" /> מחיקת פריט
        </button>
      </div>
    </div>
  )
}

/** Hebrew stays the always-visible primary field everywhere in the editor
 * (matches the site's default language); English/Arabic collapse behind
 * this toggle instead of two permanently-open inputs, so a category/item
 * row isn't three text fields deep by default. */
function TranslationsDisclosure({
  en,
  ar,
  onChangeEn,
  onChangeAr,
}: {
  en?: string
  ar?: string
  onChangeEn: (value: string) => void
  onChangeAr: (value: string) => void
}) {
  const [open, setOpen] = useState(!!en || !!ar)

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
          background: 'none',
          border: 'none',
          color: 'var(--text-faint)',
          fontSize: '0.76rem',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        <Languages size={13} aria-hidden="true" /> הוספת תרגום
      </button>
    )
  }

  return (
    <div className="rise" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
      <input dir="ltr" placeholder="English" value={en ?? ''} onChange={(e) => onChangeEn(e.target.value)} style={smallInputStyle} />
      <input placeholder="العربية" value={ar ?? ''} onChange={(e) => onChangeAr(e.target.value)} style={smallInputStyle} />
    </div>
  )
}

/** Selectable types/flavors for one item (e.g. a pastry's fillings, a
 * shake's flavors, a cookie's varieties) — each with its own out-of-stock
 * switch, same interaction as the item-level Switch above. Collapsed by
 * default (matches TranslationsDisclosure's shape) unless the item already
 * has types. */
function ItemTypesEditor({ types, onChange }: { types: MenuItemType[]; onChange: (next: MenuItemType[]) => void }) {
  const [open, setOpen] = useState(types.length > 0)

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
          background: 'none',
          border: 'none',
          color: 'var(--text-faint)',
          fontSize: '0.76rem',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        <Layers size={13} aria-hidden="true" /> הוספת סוגים/טעמים
      </button>
    )
  }

  function addType() {
    onChange([...types, { uid: randomId('t'), he: '', en: '', ar: '' }])
  }
  function updateType(index: number, patch: Partial<MenuItemType>) {
    onChange(types.map((t, i) => (i === index ? { ...t, ...patch } : t)))
  }
  function removeType(index: number) {
    onChange(types.filter((_, i) => i !== index))
  }

  return (
    <div
      className="rise"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 8,
        borderRadius: 10,
        background: 'var(--bg)',
        border: '1px dashed var(--line-strong)',
      }}
    >
      <p style={{ margin: '0 0 2px', fontSize: '0.72rem', color: 'var(--text-faint)' }}>
        סוגים/טעמים — לכל אחד זמינות נפרדת במלאי
      </p>
      {types.map((type, index) => (
        <div key={type.uid} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            placeholder="שם הסוג (לדוגמה: שוקולד)"
            value={type.he ?? ''}
            onChange={(e) => updateType(index, { he: e.target.value })}
            style={{ ...smallInputStyle, flex: 1 }}
          />
          <button
            type="button"
            role="switch"
            aria-checked={type.available !== false}
            aria-label="זמין במלאי"
            title="זמין במלאי"
            className="press"
            onClick={() => updateType(index, { available: type.available === false ? true : false })}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0 }}
          >
            <Switch on={type.available !== false} />
          </button>
          <IconButton label="מחיקת הסוג" small onClick={() => removeType(index)}>
            <X size={13} />
          </IconButton>
        </div>
      ))}
      <button
        type="button"
        className="press"
        onClick={addType}
        style={{ ...dashedButtonStyle, minHeight: 34, fontSize: '0.78rem' }}
      >
        <Plus size={14} aria-hidden="true" /> הוספת סוג
      </button>
    </div>
  )
}

/** A pill toggle for a menu badge ("חדש"/"כדאי לטעום") — a labeled chip
 * rather than a Switch, since the label itself IS the badge shown on the
 * public menu, and showing it here doubles as a preview of it. */
function BadgeToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="press"
      aria-pressed={active}
      onClick={onClick}
      style={{
        minHeight: 30,
        padding: '0 10px',
        borderRadius: 999,
        border: `1px solid ${active ? 'var(--neon)' : 'var(--line-strong)'}`,
        background: active ? 'rgba(255,122,69,0.14)' : 'transparent',
        color: active ? 'var(--neon-soft)' : 'var(--text-faint)',
        fontSize: '0.74rem',
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}

function IconButton({
  label,
  onClick,
  disabled,
  small,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  small?: boolean
  children: React.ReactNode
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
        color: 'var(--text)',
        opacity: disabled ? 0.35 : 1,
        cursor: disabled ? 'default' : 'pointer',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      {children}
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

const dashedButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  width: '100%',
  minHeight: 40,
  borderRadius: 10,
  border: '1px dashed var(--line-strong)',
  background: 'transparent',
  color: 'var(--text-dim)',
  fontSize: '0.85rem',
  cursor: 'pointer',
}
