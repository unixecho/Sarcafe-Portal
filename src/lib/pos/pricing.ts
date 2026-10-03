// Money. Pure — used by the SERVER (authoritative) and by the client (a live
// total only; the client's number is never trusted).
//
// Rules, each learnt the hard way in Ayeka's OMS:
//   * Integer agorot everywhere. ₪25.50 is 2550. Floats never reach the database.
//   * The UNIT IS IN THE NAME of every variable (`…Agorot`, `…Shekels`). Ayeka
//     once passed a shekel value to an agorot formatter and showed ₪87 as ₪0.87.
//   * Round the UNIT price to agorot BEFORE multiplying by quantity.
//   * A menu price may be a number, a slash range ("14/16" = two prices, the
//     cashier picks the one on the slip), or text. Non-numeric = not sellable.

import type { LineInput, PriceResult, ResolvedLine, ModifierSelection, LineProblem } from './types'
import type { MenuCategory, MenuItem, MenuItemType, ModifierGroup } from '@/lib/menu/types'
import { LIMITS } from './vocab'
import { groupsForItem, defaultSelections, validateSelections } from './modifiers'
import { resolveRoute, type RoutingContext } from './routing'
import { formatAgorot, parseDeltaAgorot, priceChoices } from './money'

export * from './money'

// ------------------------------------------------------------------------------------

export type PricingContext = {
  categories: MenuCategory[]
  modifierGroups: ModifierGroup[]
  routing: RoutingContext
}

function clampText(s: string | null | undefined, max: number): string | null {
  const t = (s ?? '').trim().replace(/\s+/g, ' ')
  if (!t) return null
  // Cap by CHARACTERS (code points), the way the database's char_length does. A UTF-16
  // `slice` can land inside an emoji and leave half of it behind — a lone surrogate that
  // JSON / Postgres refuse outright, failing a paid-for order over a note.
  const chars = Array.from(t)
  return chars.length > max ? chars.slice(0, max).join('') : t
}

function problem(code: LineProblem['code'], extra: Omit<LineProblem, 'code'> = {}): PriceResult {
  return { ok: false, problem: { code, ...extra } }
}

export function findItem(categories: MenuCategory[], itemUid: string): { item: MenuItem; category: MenuCategory } | null {
  for (const category of categories) {
    for (const item of category.items) {
      if (item.uid === itemUid) return { item, category }
    }
  }
  return null
}

function typeIsSellable(t: MenuItemType): boolean {
  return t.available !== false && t.quantity !== 0
}

/**
 * Prices and routes ONE line from the published menu. Returns the exact shape the
 * pos_create_order / pos_add_items RPCs take, or the first problem found.
 *
 * Never trusts anything in `input` but ids and counts: names, prices, labels, the
 * destination point and every modifier label come from `ctx`.
 */
export function priceLine(input: LineInput, ctx: PricingContext): PriceResult {
  if (!Number.isInteger(input.qty) || input.qty < 1 || input.qty > LIMITS.qtyMax) return problem('bad_qty')
  const note = clampText(input.note, LIMITS.lineNoteMax)
  const forName = clampText(input.forName, LIMITS.forNameMax)

  // ---- hand-typed item -------------------------------------------------------------
  if ('custom' in input) {
    const name = clampText(input.custom.name, LIMITS.pointNameMax + 20)
    const price = input.custom.priceAgorot
    const point = ctx.routing.points.find((p) => p.id === input.custom.pointId && p.active)
    if (!name || !Number.isInteger(price) || price < 0 || price > LIMITS.customUnitAgorotMax || !point) {
      return problem('bad_custom')
    }
    const line: ResolvedLine = {
      point_id: point.id,
      item_uid: null,
      category_id: null,
      category_title: null,
      name: { he: name, en: name, ar: name },
      type_uid: null,
      type_label: null,
      variant_label: null,
      unit_agorot: price,
      base_agorot: price,
      modifiers: [],
      qty: input.qty,
      for_name: forName,
      note,
      is_custom: true,
    }
    return { ok: true, line }
  }

  // ---- catalogue item ----------------------------------------------------------------
  const found = findItem(ctx.categories, input.itemUid)
  if (!found) return problem('unknown_item', { itemUid: input.itemUid })
  const { item, category } = found

  if (item.available === false || item.quantity === 0) return problem('sold_out', { itemUid: input.itemUid })

  const route = resolveRoute(ctx.routing, category.id, item.uid ?? null)
  if (route.kind === 'unrouted') return problem('no_point', { itemUid: input.itemUid })
  if (route.kind !== 'point') return problem('not_sold', { itemUid: input.itemUid })

  const choices = priceChoices(item.price)
  if (!choices) return problem('no_price', { itemUid: input.itemUid })
  let baseChoice = choices[0] as number
  let variantLabel: string | null = null
  if (choices.length > 1) {
    const idx = input.priceChoice
    if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= choices.length) {
      return problem('needs_price_choice', { itemUid: input.itemUid })
    }
    baseChoice = choices[idx] as number
    variantLabel = formatAgorot(baseChoice)
  }

  // `types` are an item's own REQUIRED single choice, with their own stock.
  let typeUid: string | null = null
  let typeLabel: ResolvedLine['type_label'] = null
  let typeDelta = 0
  const types = item.types ?? []
  if (types.length > 0) {
    if (!types.some(typeIsSellable)) return problem('sold_out', { itemUid: input.itemUid })
    if (!input.typeUid) return problem('needs_type', { itemUid: input.itemUid })
    const t = types.find((x) => x.uid === input.typeUid)
    if (!t) return problem('unknown_type', { itemUid: input.itemUid })
    if (!typeIsSellable(t)) return problem('type_sold_out', { itemUid: input.itemUid })
    const d = parseDeltaAgorot(t.priceDelta)
    if (d === null) return problem('no_price', { itemUid: input.itemUid })
    typeDelta = d
    typeUid = t.uid
    typeLabel = { he: t.he ?? '', en: t.en ?? '', ar: t.ar ?? '' }
  } else if (input.typeUid) {
    return problem('unknown_type', { itemUid: input.itemUid })
  }

  const baseAgorot = baseChoice + typeDelta
  if (baseAgorot < 0 || baseAgorot > LIMITS.unitAgorotMax) return problem('no_price', { itemUid: input.itemUid })

  // Structured modifiers. `undefined` means AS-IS (the defaults); an explicit
  // array — even an empty one — is taken exactly, so un-ticking a default sticks.
  const groups = groupsForItem({ categories: ctx.categories, modifierGroups: ctx.modifierGroups }, category.id, item)
  const selections: ModifierSelection[] = input.modifiers === undefined ? defaultSelections(groups) : input.modifiers
  const mods = validateSelections(groups, selections)
  if (!mods.ok) return { ok: false, problem: { ...mods.problem, itemUid: input.itemUid } }

  const unitAgorot = baseAgorot + mods.deltaAgorot
  if (unitAgorot < 0 || unitAgorot > LIMITS.unitAgorotMax) return problem('no_price', { itemUid: input.itemUid })

  const line: ResolvedLine = {
    point_id: route.pointId,
    item_uid: item.uid ?? null,
    category_id: category.id,
    category_title: { he: category.title.he ?? '', en: category.title.en ?? '', ar: category.title.ar ?? '' },
    name: { he: item.he ?? '', en: item.en ?? '', ar: item.ar ?? '' },
    type_uid: typeUid,
    type_label: typeLabel,
    variant_label: variantLabel,
    unit_agorot: unitAgorot,
    base_agorot: baseAgorot,
    modifiers: mods.snapshots,
    qty: input.qty,
    for_name: forName,
    note,
    is_custom: false,
  }
  return { ok: true, line }
}

/** Merge identity of a cart line. PRICE is part of it (via the price choice and
 *  the type), as are the modifiers, note and "for whom": the same drink added at
 *  two different prices — or one with oat milk and one without — must never
 *  collapse into a single line. */
export function lineMergeKey(input: LineInput): string {
  if ('custom' in input) {
    return ['custom', input.custom.name.trim().toLowerCase(), input.custom.priceAgorot, input.custom.pointId, input.note ?? '', input.forName ?? ''].join('|')
  }
  const mods = (input.modifiers ?? [])
    .map((m) => `${m.groupUid}:${m.optionUid}x${m.qty ?? 1}`)
    .sort()
    .join(',')
  return [
    input.itemUid,
    input.typeUid ?? '',
    input.priceChoice ?? '',
    input.modifiers === undefined ? 'as-is' : mods,
    (input.note ?? '').trim(),
    (input.forName ?? '').trim(),
  ].join('|')
}
