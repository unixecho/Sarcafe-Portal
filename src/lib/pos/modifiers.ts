// The structured-modifier model (blueprint §1a.3). Pure.
//
// DEFINITIONS live in the menu document (MenuDoc.modifierGroups, referenced from
// categories and items). A SELECTION is `{groupUid, optionUid, qty?}` — ids and a
// count, nothing else, because the client is never trusted with a label or a
// price. validateSelections() turns selections into SNAPSHOTS (labels + price
// deltas copied in at order time) that are stored on the order line forever.
//
// "As-is" means exactly: the defaults. `undefined` selections = as-is; an
// explicit array — even an empty one — is taken verbatim, so un-ticking a default
// sticks.

import type { MenuCategory, MenuItem, ModifierGroup, ModifierOption, Localized } from '@/lib/menu/types'
import { localized } from '@/lib/menu/types'
import type { LineProblem, ModifierSelection, ModifierSnapshot } from './types'
import { parseDeltaAgorot } from './money'
import { LIMITS } from './vocab'

export type ModifierDoc = { categories: MenuCategory[]; modifierGroups?: ModifierGroup[] }

/** The groups that apply to an item: its own list when it has one (an empty
 *  array = "none", an explicit opt-out), else its category's, else none.
 *  Unknown uids and groups with no options are skipped; order follows the list. */
export function groupsForItem(doc: ModifierDoc, categoryId: string, item: MenuItem): ModifierGroup[] {
  const library = new Map((doc.modifierGroups ?? []).map((g) => [g.uid, g] as const))
  const category = doc.categories.find((c) => c.id === categoryId)
  const uids = item.modifierGroupUids ?? category?.modifierGroupUids ?? []
  const out: ModifierGroup[] = []
  const seen = new Set<string>()
  for (const uid of uids) {
    const g = library.get(uid)
    if (!g || seen.has(uid) || !(g.options ?? []).length) continue
    seen.add(uid)
    out.push(g)
  }
  return out
}

/** Options that can be picked right now. */
export function availableOptions(g: ModifierGroup): ModifierOption[] {
  return (g.options ?? []).filter((o) => o.available !== false)
}

/** How many options (distinct, not summed by qty) must / may be picked. */
export function groupBounds(g: ModifierGroup): { min: number; max: number } {
  const total = (g.options ?? []).length
  const min = Math.max(g.min ?? 0, g.required ? 1 : 0)
  const max = g.multiple ? Math.max(g.max ?? total, min) : 1
  return { min, max: Math.max(max, min) }
}

/** The largest quantity one option may carry: only `add` options may repeat (extra shot ×2). */
export function maxOptionQty(g: ModifierGroup, o: ModifierOption): number {
  if (g.kind !== 'add') return 1
  return Math.min(Math.max(Math.floor(o.maxQty ?? 1), 1), LIMITS.modifierQtyMax)
}

/** What "as-is" selects: every available default, at most `max` per group. */
export function defaultSelections(groups: ModifierGroup[]): ModifierSelection[] {
  const out: ModifierSelection[] = []
  for (const g of groups) {
    const { max } = groupBounds(g)
    const defaults = availableOptions(g).filter((o) => o.default === true).slice(0, max)
    for (const o of defaults) out.push({ groupUid: g.uid, optionUid: o.uid, qty: 1 })
  }
  return out
}

/** True when a plain tap cannot add this item: some required group is not
 *  satisfied by the defaults (so the cashier must choose), or one is impossible. */
export function needsCustomize(groups: ModifierGroup[]): boolean {
  const chosen = new Map<string, number>()
  for (const s of defaultSelections(groups)) chosen.set(s.groupUid, (chosen.get(s.groupUid) ?? 0) + 1)
  return groups.some((g) => (chosen.get(g.uid) ?? 0) < groupBounds(g).min)
}

/** A required group with no available option at all = the item cannot be sold right now. */
export function blockingGroup(groups: ModifierGroup[]): ModifierGroup | null {
  return groups.find((g) => groupBounds(g).min >= 1 && availableOptions(g).length < groupBounds(g).min) ?? null
}

const text = (l: Localized | undefined | null): Localized => ({ he: l?.he ?? '', en: l?.en ?? '', ar: l?.ar ?? '' })

export type SelectionResult =
  | { ok: true; snapshots: ModifierSnapshot[]; deltaAgorot: number }
  | { ok: false; problem: LineProblem }

/**
 * Checks `selections` against `groups` and builds the snapshots.
 * Order of the snapshots is the groups' order, then each group's option order —
 * stable, so the same choices always read the same on a card.
 */
export function validateSelections(groups: ModifierGroup[], selections: ModifierSelection[]): SelectionResult {
  if (selections.length > LIMITS.modifiersPerLineMax) return { ok: false, problem: { code: 'modifier_too_many' } }

  const picked = new Map<string, Map<string, number>>() // group -> option -> qty
  for (const s of selections) {
    const g = groups.find((x) => x.uid === s.groupUid)
    if (!g) return { ok: false, problem: { code: 'unknown_modifier', groupUid: s.groupUid, optionUid: s.optionUid } }
    const o = (g.options ?? []).find((x) => x.uid === s.optionUid)
    if (!o) return { ok: false, problem: { code: 'unknown_modifier', groupUid: g.uid, optionUid: s.optionUid } }
    if (o.available === false) return { ok: false, problem: { code: 'modifier_unavailable', groupUid: g.uid, optionUid: o.uid } }
    const qty = s.qty ?? 1
    if (!Number.isInteger(qty) || qty < 1 || qty > maxOptionQty(g, o)) {
      return { ok: false, problem: { code: 'modifier_qty', groupUid: g.uid, optionUid: o.uid } }
    }
    const inGroup = picked.get(g.uid) ?? new Map<string, number>()
    if (inGroup.has(o.uid)) return { ok: false, problem: { code: 'modifier_too_many', groupUid: g.uid, optionUid: o.uid } }
    inGroup.set(o.uid, qty)
    picked.set(g.uid, inGroup)
  }

  const snapshots: ModifierSnapshot[] = []
  let deltaAgorot = 0
  for (const g of groups) {
    const inGroup = picked.get(g.uid) ?? new Map<string, number>()
    const { min, max } = groupBounds(g)
    if (inGroup.size < min) {
      return { ok: false, problem: { code: min >= 1 ? 'modifier_required' : 'modifier_too_few', groupUid: g.uid } }
    }
    if (inGroup.size > max) return { ok: false, problem: { code: 'modifier_too_many', groupUid: g.uid } }

    for (const o of g.options ?? []) {
      const qty = inGroup.get(o.uid)
      if (qty === undefined) continue
      const delta = parseDeltaAgorot(o.priceDelta)
      // The database also bounds EACH snapshot's delta (015: |delta| <= 500000), separately from
      // the line's final price — so +₪6000 in one group and -₪6000 in another would net out to a
      // priceable unit yet be refused as `bad_line`. Refuse it here, with a code the cashier can see.
      if (delta === null || Math.abs(delta) > LIMITS.unitAgorotMax) {
        return { ok: false, problem: { code: 'modifier_unavailable', groupUid: g.uid, optionUid: o.uid } }
      }
      snapshots.push({
        group_uid: g.uid,
        group: text(g.title),
        kind: g.kind,
        option_uid: o.uid,
        label: text(o),
        price_delta_agorot: delta,
        qty,
        source: g.kind === 'substitute' && g.source ? text(g.source) : null,
      })
      deltaAgorot += delta * qty
    }
  }
  return { ok: true, snapshots, deltaAgorot }
}

/** Σ price_delta × qty — the same arithmetic the database enforces (015). */
export function snapshotsDelta(snapshots: ModifierSnapshot[]): number {
  return snapshots.reduce((sum, m) => sum + m.price_delta_agorot * (m.qty || 1), 0)
}

// ---- Reading a snapshot back (station cards, receipts, the timeline) ------------

const WORDS = {
  he: { without: 'בלי', instead: 'במקום' },
  en: { without: 'No', instead: 'instead of' },
  ar: { without: 'بدون', instead: 'بدلاً من' },
} as const

/** One human line per snapshot — "+ extra shot ×2", "no sugar", "oat milk instead of milk".
 *  Built from the SNAPSHOT only, so a historical order reads the way it was sold. */
export function describeModifier(m: ModifierSnapshot, lang: 'he' | 'en' | 'ar' = 'he'): string {
  const label = localized(m.label, lang)
  const w = WORDS[lang]
  switch (m.kind) {
    case 'add':
      return `+ ${label}${m.qty > 1 ? ` ×${m.qty}` : ''}`
    case 'remove':
      return `${w.without} ${label}`
    case 'substitute': {
      const source = m.source ? localized(m.source, lang) : ''
      return source ? `${label} ${w.instead} ${source}` : label
    }
    default:
      return label
  }
}

/** Order-stable signature of a selection list — for cart merge identity. */
export function selectionSignature(selections: ModifierSelection[] | undefined): string {
  if (selections === undefined) return 'as-is'
  return selections
    .map((s) => `${s.groupUid}:${s.optionUid}x${s.qty ?? 1}`)
    .sort()
    .join(',')
}
