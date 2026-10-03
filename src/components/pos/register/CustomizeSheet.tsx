'use client'

// Customize: the choices that cannot be one tap. Two ways in —
//   * a tile that NEEDS choices (types, a slash price, a required group the defaults do not
//     satisfy): the sheet shows ONLY those first, behind a "more options" expander for the rest;
//   * the small "adjust" affordance / a ticket line: everything open (`full`).
//
// What it sends is an EXPLICIT modifiers array (even if it equals the defaults): the cashier
// looked at these choices, so an un-ticked default must stay un-ticked on the server too.
// The live price is the SAME priceLine() the server runs — one rule, two callers — so the
// number on the button is the number the order will carry.

import { useMemo, useRef, useState } from 'react'
import { Check, Minus, Plus } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import type { ModifierGroup, ModifierKind, MenuItemType } from '@/lib/menu/types'
import { pickName, priceLabel } from '@/lib/pos/cart'
import { availableOptions, defaultSelections, groupBounds, groupsForItem, maxOptionQty } from '@/lib/pos/modifiers'
import { formatAgorot, formatDelta, parseDeltaAgorot, priceChoices } from '@/lib/pos/money'
import { findItem, priceLine, type PricingContext } from '@/lib/pos/pricing'
import type { LineInput, LineProblem, ModifierSelection } from '@/lib/pos/types'
import { LIMITS } from '@/lib/pos/vocab'
import { normalizeNote } from '@/lib/pos/validate'
import { useT } from '@/lib/pos/useT'
import type { StrKey } from '@/lib/pos/i18n'
import { haptic } from '@/lib/haptics'
import { errorText } from '../shell/errorText'

export type CustomizeRequest = {
  /** bumps on every open so the body's state resets */
  seq: number
  itemUid: string
  initial?: Extract<LineInput, { itemUid: string }>
  /** set when re-opening an existing ticket line: submit replaces it */
  editKey?: string
  /** open every section (the adjust affordance, a ticket line) */
  full: boolean
}

type Props = {
  request: CustomizeRequest | null
  ctx: PricingContext
  lang: 'he' | 'en'
  onSubmit: (input: LineInput, editKey?: string) => void
  onClose: () => void
}

type Sel = Record<string, Record<string, number>>

const KIND_ORDER: readonly ModifierKind[] = ['choice', 'substitute', 'add', 'remove', 'prep']
const byKind = (a: ModifierGroup, b: ModifierGroup) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)

const typeSellable = (t: MenuItemType) => t.available !== false && t.quantity !== 0

function sizeKey(i: number, n: number): StrKey {
  if (n === 2) return i === 0 ? 'register.cz.sizeS' : 'register.cz.sizeL'
  if (n === 3) return (['register.cz.sizeS', 'register.cz.sizeM', 'register.cz.sizeL'] as const)[i] ?? 'register.cz.sizeN'
  return 'register.cz.sizeN'
}

export default function CustomizeSheet({ request, ctx, lang, onSubmit, onClose }: Props) {
  // Keep the last request so the closing animation still has content to show (ConfirmSheet's pattern).
  const last = useRef<CustomizeRequest | null>(null)
  if (request) last.current = request
  const shown = request ?? last.current
  return (
    <SheetShell open={!!request} onClose={onClose} labelledBy="reg-cz-title" className="reg-sheet">
      {shown && <CustomizeBody key={shown.seq} req={shown} ctx={ctx} lang={lang} onSubmit={onSubmit} onClose={onClose} />}
    </SheetShell>
  )
}

function CustomizeBody({
  req, ctx, lang, onSubmit, onClose,
}: { req: CustomizeRequest; ctx: PricingContext; lang: 'he' | 'en'; onSubmit: Props['onSubmit']; onClose: () => void }) {
  const t = useT()
  const found = findItem(ctx.categories, req.itemUid)
  const item = found?.item
  const category = found?.category
  const groups = useMemo(
    () =>
      found
        ? groupsForItem({ categories: ctx.categories, modifierGroups: ctx.modifierGroups }, found.category.id, found.item)
        : [],
    [found, ctx.categories, ctx.modifierGroups],
  )
  const types = item?.types ?? []
  const choices = item ? priceChoices(item.price) : null
  const showPrice = !!choices && choices.length > 1
  const initial = req.initial

  const [typeUid, setTypeUid] = useState<string | null>(() => {
    if (initial?.typeUid) return initial.typeUid
    const ok = types.filter(typeSellable)
    return types.length === 1 && ok.length === 1 ? (ok[0]?.uid ?? null) : null
  })
  const [priceChoice, setPriceChoice] = useState<number | null>(() => initial?.priceChoice ?? null)
  const [sel, setSel] = useState<Sel>(() => {
    const src: ModifierSelection[] = initial?.modifiers ?? defaultSelections(groups)
    const out: Sel = {}
    for (const s of src) (out[s.groupUid] ??= {})[s.optionUid] = s.qty ?? 1
    return out
  })
  const [qty, setQty] = useState(initial?.qty ?? 1)
  const [note, setNote] = useState(initial?.note ?? '')
  const [forName, setForName] = useState(initial?.forName ?? '')

  // A group is "necessary" when the as-is path could not satisfy it — those are the only ones shown first.
  const defaultsCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of defaultSelections(groups)) m.set(s.groupUid, (m.get(s.groupUid) ?? 0) + 1)
    return m
  }, [groups])
  const isNecessary = (g: ModifierGroup) => g.required && (defaultsCount.get(g.uid) ?? 0) < groupBounds(g).min
  const necessary = groups.filter(isNecessary).sort(byKind)
  const optional = groups.filter((g) => !isNecessary(g)).sort(byKind)
  const hasNecessary = types.length > 0 || showPrice || necessary.length > 0
  const [more, setMore] = useState(req.full || !hasNecessary)

  const modifiers: ModifierSelection[] = []
  for (const g of groups) {
    for (const o of g.options ?? []) {
      const q = sel[g.uid]?.[o.uid]
      if (q) modifiers.push({ groupUid: g.uid, optionUid: o.uid, qty: q })
    }
  }

  const input: LineInput = {
    itemUid: req.itemUid,
    ...(typeUid ? { typeUid } : {}),
    ...(priceChoice !== null ? { priceChoice } : {}),
    modifiers,
    qty,
    note: normalizeNote(note, LIMITS.lineNoteMax),
    forName: normalizeNote(forName, LIMITS.forNameMax),
  }
  const priced = priceLine(input, ctx)

  function problemText(p: LineProblem): string {
    switch (p.code) {
      case 'needs_type':
        return t('register.cz.needType')
      case 'needs_price_choice':
        return t('register.cz.needSize')
      case 'modifier_required':
      case 'modifier_too_few':
        return t('register.cz.needGroup', { name: pickName(groups.find((g) => g.uid === p.groupUid)?.title, lang) })
      default:
        return errorText(t, p.code)
    }
  }
  const why = priced.ok ? null : problemText(priced.problem)

  // ---- selection handlers ------------------------------------------------------------------

  function toggle(g: ModifierGroup, optionUid: string) {
    haptic('select')
    setSel((prev) => {
      const cur = prev[g.uid] ?? {}
      const has = cur[optionUid] !== undefined
      const { max } = groupBounds(g)
      let next: Record<string, number>
      if (!g.multiple) {
        // Single choice: picking another replaces; tapping the picked one clears it unless the group is required.
        next = has ? (g.required ? cur : {}) : { [optionUid]: 1 }
      } else if (has) {
        next = { ...cur }
        delete next[optionUid]
      } else if (Object.keys(cur).length >= max) {
        next = cur
      } else {
        next = { ...cur, [optionUid]: 1 }
      }
      return { ...prev, [g.uid]: next }
    })
  }

  function step(g: ModifierGroup, optionUid: string, max: number, delta: number) {
    haptic('tick')
    setSel((prev) => {
      const cur = { ...(prev[g.uid] ?? {}) }
      const q = (cur[optionUid] ?? 0) + delta
      if (q < 1) delete cur[optionUid]
      else cur[optionUid] = Math.min(q, max)
      return { ...prev, [g.uid]: cur }
    })
  }

  function submit() {
    if (!priced.ok) return
    haptic('impact')
    onSubmit(input, req.editKey)
  }

  // ---- rendering -----------------------------------------------------------------------------

  function renderGroup(g: ModifierGroup) {
    const { min, max } = groupBounds(g)
    const cur = sel[g.uid] ?? {}
    const chosen = Object.keys(cur).length
    const atMax = g.multiple && chosen >= max
    const hint = !g.multiple
      ? g.required ? t('register.cz.pickOne') : t('register.cz.pickOneOpt')
      : g.required && min > 0
        ? t('register.cz.pickMin', { n: min })
        : t('register.cz.pickUpTo', { n: max })
    const titleId = `reg-g-${g.uid}`
    return (
      <section key={g.uid} className={`reg-cz-sec reg-kind--${g.kind}`} aria-labelledby={titleId}>
        <h3 id={titleId} className="reg-cz-h">
          <span>{pickName(g.title, lang)}</span>
          {g.required && <span className="reg-req">{t('register.cz.required')}</span>}
        </h3>
        <p className="reg-cz-hint">
          {g.kind === 'substitute' && g.source ? `${t('register.cz.instead', { name: pickName(g.source, lang) })} · ` : ''}
          {hint}
        </p>
        <div className="reg-chips" role={g.multiple ? 'group' : 'radiogroup'} aria-labelledby={titleId}>
          {(g.options ?? []).map((o) => {
            const on = cur[o.uid] !== undefined
            const out = o.available === false || !availableOptions(g).some((x) => x.uid === o.uid)
            const blocked = out || (!on && atMax)
            const delta = parseDeltaAgorot(o.priceDelta) ?? 0
            const omax = maxOptionQty(g, o)
            return (
              <div key={o.uid} className="reg-chip-wrap">
                <button
                  type="button"
                  role={g.multiple ? 'checkbox' : 'radio'}
                  aria-checked={on}
                  aria-disabled={blocked || undefined}
                  className={`reg-chip press${on ? ' is-on' : ''}${blocked ? ' is-blocked' : ''}`}
                  onClick={() => !blocked && toggle(g, o.uid)}
                >
                  {on && <Check size={16} aria-hidden="true" />}
                  <span>{pickName(o, lang)}</span>
                  {delta !== 0 && <span className="reg-chip-delta ltr-isolate">{formatDelta(delta)}</span>}
                  {out && <span className="reg-chip-out">{t('register.tile.soldOut')}</span>}
                </button>
                {on && omax > 1 && (
                  <span className="reg-mini-step" role="group" aria-label={pickName(o, lang)}>
                    <button type="button" className="press" aria-label={t('register.cz.less')} onClick={() => step(g, o.uid, omax, -1)}>
                      <Minus size={16} aria-hidden="true" />
                    </button>
                    <span className="ltr-isolate" aria-live="polite">{cur[o.uid]}</span>
                    <button
                      type="button"
                      className="press"
                      aria-label={t('register.cz.more')}
                      aria-disabled={(cur[o.uid] ?? 1) >= omax || undefined}
                      onClick={() => step(g, o.uid, omax, +1)}
                    >
                      <Plus size={16} aria-hidden="true" />
                    </button>
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </section>
    )
  }

  const itemName = pickName(item, lang)
  const unitText = priced.ok ? formatAgorot(priced.line.unit_agorot) : item ? priceLabel(item) : ''
  const totalText = priced.ok ? formatAgorot(priced.line.unit_agorot * qty) : ''

  return (
    <form
      className="reg-form"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <header className="reg-cz-head">
        <div>
          <h2 id="reg-cz-title" className="pos-sheet-title">{itemName}</h2>
          {category && <p className="pos-sheet-sub">{pickName(category.title, lang)}</p>}
        </div>
        <span className="reg-cz-unit ltr-isolate" aria-label={t('register.cz.unitPrice')}>{unitText}</span>
      </header>

      <div className="sheet-scroll reg-cz-body">
        {!found && <p className="reg-hint-bad" role="alert">{errorText(t, 'unknown_item')}</p>}

        {types.length > 0 && (
          <section className="reg-cz-sec" aria-labelledby="reg-types">
            <h3 id="reg-types" className="reg-cz-h">
              <span>{t('register.cz.type')}</span>
              <span className="reg-req">{t('register.cz.required')}</span>
            </h3>
            <div className="reg-chips" role="radiogroup" aria-labelledby="reg-types">
              {types.map((ty) => {
                const ok = typeSellable(ty)
                const on = typeUid === ty.uid
                const delta = parseDeltaAgorot(ty.priceDelta) ?? 0
                const left = typeof ty.quantity === 'number' && ty.quantity > 0 ? ty.quantity : null
                return (
                  <button
                    key={ty.uid}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-disabled={!ok || undefined}
                    className={`reg-chip press${on ? ' is-on' : ''}${!ok ? ' is-blocked' : ''}`}
                    onClick={() => {
                      if (!ok) return
                      haptic('select')
                      setTypeUid(ty.uid)
                    }}
                  >
                    {on && <Check size={16} aria-hidden="true" />}
                    <span>{pickName(ty, lang)}</span>
                    {delta !== 0 && <span className="reg-chip-delta ltr-isolate">{formatDelta(delta)}</span>}
                    {!ok ? (
                      <span className="reg-chip-out">{t('register.tile.soldOut')}</span>
                    ) : left !== null ? (
                      <span className="reg-chip-left">{t('register.cz.left', { n: left })}</span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </section>
        )}

        {showPrice && choices && (
          <section className="reg-cz-sec" aria-labelledby="reg-sizes">
            <h3 id="reg-sizes" className="reg-cz-h">
              <span>{t('register.cz.size')}</span>
              <span className="reg-req">{t('register.cz.required')}</span>
            </h3>
            <div className="reg-chips" role="radiogroup" aria-labelledby="reg-sizes">
              {choices.map((c, i) => (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={priceChoice === i}
                  className={`reg-chip press${priceChoice === i ? ' is-on' : ''}`}
                  onClick={() => {
                    haptic('select')
                    setPriceChoice(i)
                  }}
                >
                  {priceChoice === i && <Check size={16} aria-hidden="true" />}
                  <span>{t(sizeKey(i, choices.length), { n: i + 1 })}</span>
                  <span className="reg-chip-delta ltr-isolate">{formatAgorot(c)}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {necessary.map(renderGroup)}

        {!more && (
          <button type="button" className="reg-more press" aria-expanded={false} onClick={() => setMore(true)}>
            <Plus size={18} aria-hidden="true" />
            {t('register.cz.moreOptions')}
          </button>
        )}

        {more && (
          <>
            {optional.map(renderGroup)}
            <section className="reg-cz-sec">
              <label className="reg-label" htmlFor="reg-cz-note">{t('register.cz.note')}</label>
              <input
                id="reg-cz-note"
                className="pos-input reg-in"
                type="text"
                maxLength={LIMITS.lineNoteMax}
                autoComplete="off"
                placeholder={t('register.cz.notePlaceholder')}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <label className="reg-label" htmlFor="reg-cz-for">{t('register.cz.forName')}</label>
              <input
                id="reg-cz-for"
                className="pos-input reg-in"
                type="text"
                maxLength={LIMITS.forNameMax}
                autoComplete="off"
                placeholder={t('register.cz.forPlaceholder')}
                value={forName}
                onChange={(e) => setForName(e.target.value)}
              />
            </section>
          </>
        )}
      </div>

      <footer className="reg-cz-foot">
        {why && (
          <p id="reg-cz-why" className="reg-why" role="status">
            {why}
          </p>
        )}
        <div className="reg-cz-actions">
          <div className="reg-stepper" role="group" aria-label={t('register.cz.qty')}>
            <button type="button" className="press" aria-label={t('register.cz.less')} aria-disabled={qty <= 1 || undefined} onClick={() => { haptic('tick'); setQty((q) => Math.max(1, q - 1)) }}>
              <Minus size={20} aria-hidden="true" />
            </button>
            <output className="ltr-isolate" aria-live="polite">{qty}</output>
            <button type="button" className="press" aria-label={t('register.cz.more')} aria-disabled={qty >= LIMITS.qtyMax || undefined} onClick={() => { haptic('tick'); setQty((q) => Math.min(LIMITS.qtyMax, q + 1)) }}>
              <Plus size={20} aria-hidden="true" />
            </button>
          </div>
          <button
            type="submit"
            className="pos-btn pos-btn--primary reg-cz-add press"
            disabled={!priced.ok}
            aria-describedby={why ? 'reg-cz-why' : undefined}
          >
            <span>{req.editKey ? t('register.cz.update') : t('register.cz.add')}</span>
            {totalText && <span className="ltr-isolate">{totalText}</span>}
          </button>
        </div>
        <button type="button" className="reg-cancel press" onClick={onClose}>
          {t('register.cancel')}
        </button>
      </footer>
    </form>
  )
}
