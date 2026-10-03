'use client'

// The editor for ONE modifier group: its name, what kind of tweak it is, whether
// the cashier must pick, and the list of options with their price effects.
//
// It edits a LOCAL copy and hands the finished group back through onSave — the
// menu draft is only touched when the owner presses "שמירה", so abandoning the
// sheet changes nothing. Saving an unfinished group is allowed (it is a draft
// like everything else in the editor); what blocks is Publish, which re-checks
// every group in ModifierLibrary's modifierProblems().
//
// Uids: a group and each option get theirs from randomId() ONCE, when created
// here (or by the library for a brand-new group). They are never derived from a
// label and never regenerated, because order lines snapshot them — renaming
// "חלב שיבולת שועל" must not orphan every past order that used it.

import { useEffect, useId, useState } from 'react'
import { ChevronDown, ChevronUp, Languages, Plus, Trash2, X } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import Switch from '@/components/Switch'
import { haptic } from '@/lib/haptics'
import { randomId } from '@/lib/menu/id'
import type { ModifierGroup, ModifierKind, ModifierOption } from '@/lib/menu/types'
import { useT } from '@/lib/pos/useT'
import type { StrKey } from '@/lib/pos/i18n'
import './menu-mods.css'

type OptDraft = {
  uid: string
  he: string
  en: string
  ar: string
  price: string
  isDefault: boolean
  available: boolean
  maxQty: string
}

const KINDS: ModifierKind[] = ['choice', 'add', 'remove', 'substitute', 'prep']

/** What each kind usually wants, so a new group starts sensible. Applied only
 * until the owner touches the switches themselves. */
const KIND_DEFAULTS: Record<ModifierKind, { required: boolean; multiple: boolean }> = {
  choice: { required: true, multiple: false },
  add: { required: false, multiple: true },
  remove: { required: false, multiple: true },
  substitute: { required: false, multiple: false },
  prep: { required: false, multiple: true },
}

export function blankGroup(): ModifierGroup {
  return {
    uid: randomId('g'),
    title: { he: '', en: '', ar: '' },
    kind: 'add',
    ...KIND_DEFAULTS.add,
    options: [],
  }
}

function toDraft(o: ModifierOption): OptDraft {
  return {
    uid: o.uid,
    he: o.he ?? '',
    en: o.en ?? '',
    ar: o.ar ?? '',
    price: o.priceDelta ? String(o.priceDelta) : '',
    isDefault: o.default === true,
    available: o.available !== false,
    maxQty: o.maxQty && o.maxQty > 1 ? String(o.maxQty) : '',
  }
}

/** Blank = 0. Accepts "2,5". null = not a number. */
function parsePrice(text: string): number | null {
  const s = text.trim().replace(',', '.')
  if (s === '') return 0
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null
  return Number(s)
}

function parseWhole(text: string): number | null | undefined {
  const s = text.trim()
  if (s === '') return undefined
  return /^\d{1,3}$/.test(s) ? Number(s) : null
}

export default function ModifierGroupSheet({
  open,
  group,
  isNew,
  onSave,
  onRequestDelete,
  onClose,
}: {
  open: boolean
  group: ModifierGroup | null
  isNew: boolean
  onSave: (group: ModifierGroup) => void
  onRequestDelete: () => void
  onClose: () => void
}) {
  const t = useT()
  const titleId = useId()
  const [titleHe, setTitleHe] = useState('')
  const [titleEn, setTitleEn] = useState('')
  const [titleAr, setTitleAr] = useState('')
  const [kind, setKind] = useState<ModifierKind>('add')
  const [required, setRequired] = useState(false)
  const [multiple, setMultiple] = useState(true)
  const [touchedFlags, setTouchedFlags] = useState(false)
  const [minText, setMinText] = useState('')
  const [maxText, setMaxText] = useState('')
  const [sourceHe, setSourceHe] = useState('')
  const [options, setOptions] = useState<OptDraft[]>([])
  const [showTitleTr, setShowTitleTr] = useState(false)

  // Re-seed from the group each time the sheet opens. Keyed on `open` alone so a
  // parent re-render while the owner is typing can never reset their work.
  useEffect(() => {
    if (!open || !group) return
    setTitleHe(group.title.he ?? '')
    setTitleEn(group.title.en ?? '')
    setTitleAr(group.title.ar ?? '')
    setKind(group.kind)
    setRequired(group.required)
    setMultiple(group.multiple)
    setTouchedFlags(!isNew)
    setMinText(group.min !== undefined ? String(group.min) : '')
    setMaxText(group.max !== undefined ? String(group.max) : '')
    setSourceHe(group.source?.he ?? '')
    setOptions((group.options ?? []).map(toDraft))
    setShowTitleTr(!!group.title.en || !!group.title.ar)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function pickKind(next: ModifierKind) {
    setKind(next)
    if (!touchedFlags) {
      setRequired(KIND_DEFAULTS[next].required)
      setMultiple(KIND_DEFAULTS[next].multiple)
    }
  }

  function updateOption(index: number, patch: Partial<OptDraft>) {
    setOptions((prev) => prev.map((o, i) => (i === index ? { ...o, ...patch } : o)))
  }

  function setDefault(index: number, on: boolean) {
    setOptions((prev) =>
      prev.map((o, i) => {
        if (i === index) return { ...o, isDefault: on }
        // One pick only: turning a default on turns the others off, so the
        // library never holds a single-choice group with two pre-selected answers.
        return on && !multiple ? { ...o, isDefault: false } : o
      })
    )
  }

  function moveOption(index: number, dir: -1 | 1) {
    setOptions((prev) => {
      const target = index + dir
      if (target < 0 || target >= prev.length) return prev
      const next = prev.slice()
      const tmp = next[index]!
      next[index] = next[target]!
      next[target] = tmp
      return next
    })
  }

  function addOption() {
    haptic()
    setOptions((prev) => [
      ...prev,
      { uid: randomId('o'), he: '', en: '', ar: '', price: '', isDefault: false, available: true, maxQty: '' },
    ])
  }

  // ---- what blocks Save (shown as words, never a silent disabled button) ----
  const minParsed = parseWhole(minText)
  const maxParsed = parseWhole(maxText)
  let whyNot: string | null = null
  if (options.some((o) => parsePrice(o.price) === null)) whyNot = t('owner.menu.group.badPrice')
  else if (kind === 'add' && options.some((o) => parseWhole(o.maxQty) === null || parseWhole(o.maxQty) === 0 || (parseWhole(o.maxQty) ?? 0) > 9))
    whyNot = t('owner.menu.group.badQty')
  else if (
    multiple &&
    (minParsed === null ||
      maxParsed === null ||
      (minParsed !== undefined && maxParsed !== undefined && minParsed > maxParsed))
  )
    whyNot = t('owner.menu.group.badRange')

  function save() {
    if (!group || whyNot) return
    const next: ModifierGroup = {
      uid: group.uid,
      title: { he: titleHe.trim(), en: titleEn.trim(), ar: titleAr.trim() },
      kind,
      required,
      multiple,
      options: options.map((o): ModifierOption => {
        const qty = kind === 'add' ? parseWhole(o.maxQty) : undefined
        const price = parsePrice(o.price) ?? 0
        return {
          uid: o.uid,
          he: o.he.trim(),
          en: o.en.trim(),
          ar: o.ar.trim(),
          ...(price !== 0 ? { priceDelta: price } : {}),
          ...(o.isDefault ? { default: true } : {}),
          ...(o.available ? {} : { available: false }),
          ...(typeof qty === 'number' && qty > 1 ? { maxQty: qty } : {}),
        }
      }),
    }
    if (multiple && typeof minParsed === 'number') next.min = minParsed
    if (multiple && typeof maxParsed === 'number') next.max = maxParsed
    if (kind === 'substitute' && sourceHe.trim()) next.source = { he: sourceHe.trim() }
    haptic()
    onSave(next)
  }

  return (
    <SheetShell open={open} onClose={onClose} labelledBy={titleId}>
      <div style={{ padding: '0 2px 10px' }}>
        <h2 id={titleId} style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
          {isNew ? t('owner.menu.group.titleNew') : t('owner.menu.group.titleEdit')}
        </h2>
      </div>

      <div className="sheet-scroll" style={{ gap: 14, paddingBottom: 8 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={labelStyle}>{t('owner.menu.group.name')}</span>
          <input
            className="mm-field"
            value={titleHe}
            placeholder={t('owner.menu.group.namePlaceholder')}
            onChange={(e) => setTitleHe(e.target.value)}
          />
        </label>
        <Translations
          open={showTitleTr}
          onOpen={() => setShowTitleTr(true)}
          en={titleEn}
          ar={titleAr}
          onEn={setTitleEn}
          onAr={setTitleAr}
          openLabel={t('owner.menu.group.addTranslation')}
        />

        <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <legend style={{ ...labelStyle, padding: 0, marginBottom: 6 }}>{t('owner.menu.group.kind')}</legend>
          {KINDS.map((k) => (
            <label key={k} className="mm-kind">
              <input type="radio" name={`${titleId}-kind`} checked={kind === k} onChange={() => pickKind(k)} />
              <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>{t(`owner.menu.group.kind.${k}` as StrKey)}</span>
              <span style={{ fontSize: '0.74rem', color: 'var(--text-faint)' }}>
                {t(`owner.menu.group.kind.${k}.hint` as StrKey)}
              </span>
            </label>
          ))}
        </fieldset>

        <ToggleRow
          label={t('owner.menu.group.required')}
          hint={t('owner.menu.group.required.hint')}
          on={required}
          onToggle={() => {
            setTouchedFlags(true)
            setRequired((v) => !v)
          }}
        />
        <ToggleRow
          label={t('owner.menu.group.multiple')}
          hint={t('owner.menu.group.multiple.hint')}
          on={multiple}
          onToggle={() => {
            setTouchedFlags(true)
            setMultiple((v) => !v)
          }}
        />

        {multiple && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={labelStyle}>{t('owner.menu.group.min')}</span>
              <input
                className="mm-field ltr-isolate"
                inputMode="numeric"
                value={minText}
                placeholder={required ? '1' : '0'}
                onChange={(e) => setMinText(e.target.value)}
                style={{ textAlign: 'center' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={labelStyle}>{t('owner.menu.group.max')}</span>
              <input
                className="mm-field ltr-isolate"
                inputMode="numeric"
                value={maxText}
                placeholder={String(Math.max(options.length, 1))}
                onChange={(e) => setMaxText(e.target.value)}
                style={{ textAlign: 'center' }}
              />
            </label>
          </div>
        )}

        {kind === 'substitute' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={labelStyle}>{t('owner.menu.group.source')}</span>
            <input
              className="mm-field"
              value={sourceHe}
              placeholder={t('owner.menu.group.sourcePlaceholder')}
              onChange={(e) => setSourceHe(e.target.value)}
            />
          </label>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: '0.88rem', fontWeight: 700 }}>{t('owner.menu.group.options')}</h3>
          {options.map((o, index) => (
            <OptionEditor
              key={o.uid}
              option={o}
              index={index}
              total={options.length}
              kind={kind}
              onChange={(patch) => updateOption(index, patch)}
              onDefault={(on) => setDefault(index, on)}
              onMove={(dir) => moveOption(index, dir)}
              onRemove={() => setOptions((prev) => prev.filter((_, i) => i !== index))}
            />
          ))}
          <button type="button" className="press mm-row" onClick={addOption} style={{ justifyContent: 'center', borderStyle: 'dashed' }}>
            <Plus size={16} aria-hidden="true" /> {t('owner.menu.group.addOption')}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 10 }}>
        {whyNot && (
          <p role="alert" style={{ margin: 0, fontSize: '0.8rem', color: 'var(--danger)' }}>
            {t('owner.menu.group.cantSave', { why: whyNot })}
          </p>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          {!isNew && (
            <button type="button" className="press" onClick={onRequestDelete} style={dangerButtonStyle}>
              <Trash2 size={15} aria-hidden="true" /> {t('owner.menu.group.delete')}
            </button>
          )}
          <button
            type="button"
            className="press"
            onClick={save}
            disabled={!!whyNot}
            style={{ ...primaryStyle, flex: 1, opacity: whyNot ? 0.5 : 1 }}
          >
            {t('owner.menu.group.save')}
          </button>
        </div>
      </div>
    </SheetShell>
  )
}

function OptionEditor({
  option,
  index,
  total,
  kind,
  onChange,
  onDefault,
  onMove,
  onRemove,
}: {
  option: OptDraft
  index: number
  total: number
  kind: ModifierKind
  onChange: (patch: Partial<OptDraft>) => void
  onDefault: (on: boolean) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
}) {
  const t = useT()
  const [trOpen, setTrOpen] = useState(!!option.en || !!option.ar)
  const name = option.he || t('owner.menu.group.optionLabel')
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 10,
        borderRadius: 12,
        border: '1px solid var(--line)',
        background: 'var(--bg)',
      }}
    >
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          className="mm-field"
          aria-label={t('owner.menu.group.optionLabel')}
          value={option.he}
          placeholder={t('owner.menu.group.optionPlaceholder')}
          onChange={(e) => onChange({ he: e.target.value })}
          style={{ flex: 1, background: 'var(--bg-elev)' }}
        />
        <SmallIcon label={t('owner.menu.group.optionUp')} disabled={index === 0} onClick={() => onMove(-1)}>
          <ChevronUp size={15} />
        </SmallIcon>
        <SmallIcon label={t('owner.menu.group.optionDown')} disabled={index === total - 1} onClick={() => onMove(1)}>
          <ChevronDown size={15} />
        </SmallIcon>
        <SmallIcon label={t('owner.menu.group.removeOption', { name })} onClick={onRemove}>
          <X size={15} />
        </SmallIcon>
      </div>

      <Translations
        open={trOpen}
        onOpen={() => setTrOpen(true)}
        en={option.en}
        ar={option.ar}
        onEn={(v) => onChange({ en: v })}
        onAr={(v) => onChange({ ar: v })}
        openLabel={t('owner.menu.group.addTranslation')}
      />

      <div style={{ display: 'grid', gridTemplateColumns: kind === 'add' ? '1fr 1fr' : '1fr', gap: 8 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ ...labelStyle, fontSize: '0.74rem' }}>{t('owner.menu.group.price')}</span>
          <input
            className="mm-field ltr-isolate"
            inputMode="decimal"
            value={option.price}
            placeholder={t('owner.menu.group.pricePlaceholder')}
            onChange={(e) => onChange({ price: e.target.value })}
            style={{ background: 'var(--bg-elev)', textAlign: 'center' }}
          />
        </label>
        {kind === 'add' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ ...labelStyle, fontSize: '0.74rem' }}>{t('owner.menu.group.maxQty')}</span>
            <input
              className="mm-field ltr-isolate"
              inputMode="numeric"
              value={option.maxQty}
              placeholder="1"
              onChange={(e) => onChange({ maxQty: e.target.value })}
              style={{ background: 'var(--bg-elev)', textAlign: 'center' }}
            />
          </label>
        )}
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <InlineSwitch label={t('owner.menu.group.default')} on={option.isDefault} onToggle={() => onDefault(!option.isDefault)} />
        <InlineSwitch label={t('owner.menu.group.available')} on={option.available} onToggle={() => onChange({ available: !option.available })} />
      </div>
    </div>
  )
}

function Translations({
  open,
  onOpen,
  en,
  ar,
  onEn,
  onAr,
  openLabel,
}: {
  open: boolean
  onOpen: () => void
  en: string
  ar: string
  onEn: (v: string) => void
  onAr: (v: string) => void
  openLabel: string
}) {
  if (!open) {
    return (
      <button
        type="button"
        className="press"
        onClick={onOpen}
        style={{
          alignSelf: 'flex-start',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          minHeight: 32,
          background: 'none',
          border: 'none',
          color: 'var(--text-dim)',
          fontSize: '0.78rem',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        <Languages size={14} aria-hidden="true" /> {openLabel}
      </button>
    )
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
      <input className="mm-field" dir="ltr" lang="en" placeholder="English" aria-label="English" value={en} onChange={(e) => onEn(e.target.value)} />
      <input className="mm-field" lang="ar" placeholder="العربية" aria-label="العربية" value={ar} onChange={(e) => onAr(e.target.value)} />
    </div>
  )
}

function ToggleRow({ label, hint, on, onToggle }: { label: string; hint: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className="press mm-row"
      onClick={() => {
        haptic()
        onToggle()
      }}
      style={{ justifyContent: 'space-between' }}
    >
      <span>
        <span style={{ display: 'block', fontSize: '0.86rem', fontWeight: 600 }}>{label}</span>
        <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-faint)' }}>{hint}</span>
      </span>
      <Switch on={on} />
    </button>
  )
}

function InlineSwitch({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className="press"
      onClick={onToggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        minHeight: 44,
        background: 'none',
        border: 'none',
        color: 'var(--text)',
        fontSize: '0.82rem',
        cursor: 'pointer',
        padding: 0,
      }}
    >
      <Switch on={on} /> {label}
    </button>
  )
}

function SmallIcon({
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
      className="press"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 40,
        height: 44,
        minWidth: 40,
        borderRadius: 10,
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

const labelStyle: React.CSSProperties = { fontSize: '0.82rem', color: 'var(--text-dim)' }

const primaryStyle: React.CSSProperties = {
  minHeight: 'var(--tap-min)',
  borderRadius: 14,
  border: 'none',
  background: 'var(--neon)',
  color: 'var(--bg)',
  fontWeight: 700,
  cursor: 'pointer',
}

const dangerButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minHeight: 'var(--tap-min)',
  padding: '0 14px',
  borderRadius: 14,
  border: '1px solid rgba(255,107,107,0.3)',
  background: 'transparent',
  color: '#ff6b6b',
  fontWeight: 600,
  fontSize: '0.82rem',
  cursor: 'pointer',
}
