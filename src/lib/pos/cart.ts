// The cashier's cart — pure rules, no React, no DOM (scripts/check-pos.mjs can run it).
//
// WHY A SEPARATE PURE FILE: the register is the one screen where a wrong rule costs
// money (a drink folded into the wrong line, a sold-out item sent, a corrupt draft
// crashing the till at the start of a rush). Everything that decides something lives
// here; the components only draw it and call dispatch().
//
// The browser is never trusted for price, routing or identity. A CartLine carries the
// LineInput (ids and counts — the only thing ever sent) plus a `preview` that exists
// purely so the screen can show a name and a total. The server re-prices every line.

import type { Localized, MenuCategory, MenuItem } from '@/lib/menu/types'
import type { CreateOrderBody } from './api'
import type {
  LineInput, LineProblem, LineProblemCode, ModifierKind, ModifierSelection, ModifierSnapshot, PosOrder, ResolvedLine,
} from './types'
import { findItem, lineMergeKey, priceLine, type PricingContext } from './pricing'
import { blockingGroup, groupsForItem, needsCustomize } from './modifiers'
import { formatAgorot, parseDeltaAgorot, priceChoices } from './money'
import { resolveRoute } from './routing'
import { normalizeCustomerName, normalizeNote, normalizePhone, parsePriceInput } from './validate'
import { LIMITS, OUTBOX } from './vocab'

// ---- Types ---------------------------------------------------------------------------

export type CartPreview = {
  name: Localized
  categoryId: string | null
  /** the point that makes it — display only; the SERVER routes */
  pointId: string
  unitAgorot: number
  baseAgorot: number
  modifiers: ModifierSnapshot[]
  typeLabel: Localized | null
  variantLabel: string | null
}

export type CartLine = {
  /** === lineMergeKey(input). The merge identity AND the React key. */
  key: string
  input: LineInput
  preview: CartPreview
}

export type Draft = {
  customerName: string
  /** as typed; normalised only when sending */
  customerPhone: string
  orderNote: string
  receiptRef: string
  /** as typed ("12,5") */
  slipTotal: string
  lines: CartLine[]
  startedAt: number
}

export type CreateDraftBody = Omit<CreateOrderBody, 'clientKey' | 'branchId'>

export const DRAFT_TTL_MS = 8 * 60 * 60 * 1000
export const SAME_NAME_WINDOW_MS = 30 * 60 * 1000

export function emptyDraft(now: number): Draft {
  return { customerName: '', customerPhone: '', orderNote: '', receiptRef: '', slipTotal: '', lines: [], startedAt: now }
}

// ---- Small helpers ---------------------------------------------------------------------

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Cap by characters (code points), the way the database counts — never split an emoji. */
function clampStr(v: unknown, max: number): string {
  if (typeof v !== 'string') return ''
  const chars = Array.from(v)
  return chars.length > max ? chars.slice(0, max).join('') : v
}

/** A name in the viewer's language, falling back he -> en -> ar so a half-translated menu still shows something. */
export function pickName(l: Localized | null | undefined, lang: 'he' | 'en' | 'ar' = 'he'): string {
  if (!l) return ''
  return l[lang] || l.he || l.en || l.ar || ''
}

/** What a tile shows as its price: "₪14 / ₪16" for a slash range, "" when it has none. */
export function priceLabel(item: Pick<MenuItem, 'price'>): string {
  const choices = priceChoices(item.price)
  return choices ? choices.map(formatAgorot).join(' / ') : ''
}

export function previewOf(line: ResolvedLine): CartPreview {
  return {
    name: line.name,
    categoryId: line.category_id,
    pointId: line.point_id,
    unitAgorot: line.unit_agorot,
    baseAgorot: line.base_agorot,
    modifiers: line.modifiers,
    typeLabel: line.type_label,
    variantLabel: line.variant_label,
  }
}

// ---- Building lines (the same priceLine() the server runs) -------------------------------

export type BuildResult = { ok: true; line: CartLine } | { ok: false; problem: LineProblem }

export function buildLine(input: LineInput, ctx: PricingContext): BuildResult {
  const r = priceLine(input, ctx)
  if (!r.ok) return { ok: false, problem: r.problem }
  return { ok: true, line: { key: lineMergeKey(input), input, preview: previewOf(r.line) } }
}

/** A best-effort line for an input that can no longer be priced (the item sold out, the menu changed) —
 *  so it can still be SHOWN, named, and offered for removal instead of silently vanishing. null when
 *  even the item is gone. Its price is indicative only; the line is flagged and never sent while flagged. */
export function lenientLine(input: LineInput, ctx: PricingContext): CartLine | null {
  if ('custom' in input) {
    return {
      key: lineMergeKey(input),
      input,
      preview: {
        name: { he: input.custom.name, en: input.custom.name, ar: input.custom.name },
        categoryId: null,
        pointId: input.custom.pointId,
        unitAgorot: input.custom.priceAgorot,
        baseAgorot: input.custom.priceAgorot,
        modifiers: [],
        typeLabel: null,
        variantLabel: null,
      },
    }
  }
  const found = findItem(ctx.categories, input.itemUid)
  if (!found) return null
  const { item, category } = found
  const choices = priceChoices(item.price) ?? [0]
  const base = choices[typeof input.priceChoice === 'number' ? input.priceChoice : 0] ?? choices[0] ?? 0
  const type = (item.types ?? []).find((t) => t.uid === input.typeUid)
  const route = resolveRoute(ctx.routing, category.id, item.uid ?? null)
  return {
    key: lineMergeKey(input),
    input,
    preview: {
      name: { he: item.he ?? '', en: item.en ?? '', ar: item.ar ?? '' },
      categoryId: category.id,
      pointId: route.kind === 'point' ? route.pointId : '',
      unitAgorot: base + (type ? parseDeltaAgorot(type.priceDelta) ?? 0 : 0),
      baseAgorot: base,
      modifiers: [],
      typeLabel: type ? { he: type.he ?? '', en: type.en ?? '', ar: type.ar ?? '' } : null,
      variantLabel: null,
    },
  }
}

/** Re-prices every line against the CURRENT menu (a publish mid-event, a stale cached draft) and reports
 *  the lines that can no longer be sold. Lines are never dropped here — the cashier decides. */
export function analyseLines(
  lines: readonly CartLine[],
  ctx: PricingContext | null,
): { lines: CartLine[]; problems: Record<string, LineProblemCode> } {
  if (!ctx) return { lines: [...lines], problems: {} }
  const problems: Record<string, LineProblemCode> = {}
  const out = lines.map((l) => {
    const r = priceLine(l.input, ctx)
    if (r.ok) return { ...l, preview: previewOf(r.line) }
    problems[l.key] = r.problem.code
    return l
  })
  return { lines: out, problems }
}

// ---- Sellability: a tile is disabled WITH a reason, never hidden ----------------------------

export type SellReason = 'sold_out' | 'no_point' | 'not_sold' | 'no_price' | 'modifier_unavailable'
export type Sellability = { sellable: true } | { sellable: false; reason: SellReason }

function typeSellable(t: { available?: boolean; quantity?: number }): boolean {
  return t.available !== false && t.quantity !== 0
}

export function itemSellability(item: MenuItem, category: MenuCategory, ctx: PricingContext): Sellability {
  if (item.available === false || item.quantity === 0) return { sellable: false, reason: 'sold_out' }
  const types = item.types ?? []
  if (types.length > 0 && !types.some(typeSellable)) return { sellable: false, reason: 'sold_out' }
  // An item without a uid cannot be ordered at all (nothing to snapshot); it reads as "nobody sells it".
  if (!item.uid) return { sellable: false, reason: 'not_sold' }
  const route = resolveRoute(ctx.routing, category.id, item.uid)
  if (route.kind === 'unrouted') return { sellable: false, reason: 'no_point' }
  if (route.kind !== 'point') return { sellable: false, reason: 'not_sold' }
  if (!priceChoices(item.price)) return { sellable: false, reason: 'no_price' }
  const groups = groupsForItem({ categories: ctx.categories, modifierGroups: ctx.modifierGroups }, category.id, item)
  if (blockingGroup(groups)) return { sellable: false, reason: 'modifier_unavailable' }
  return { sellable: true }
}

/** One tap adds it as-is, or it needs the cashier to choose something first. */
export function tileAction(item: MenuItem, category: MenuCategory, ctx: PricingContext): 'add-as-is' | 'needs-choices' {
  if ((item.types ?? []).length > 0) return 'needs-choices'
  const choices = priceChoices(item.price)
  if (choices && choices.length > 1) return 'needs-choices'
  const groups = groupsForItem({ categories: ctx.categories, modifierGroups: ctx.modifierGroups }, category.id, item)
  return needsCustomize(groups) ? 'needs-choices' : 'add-as-is'
}

// ---- The reducer -----------------------------------------------------------------------------

export type CartAction =
  | { type: 'add'; line: CartLine }
  | { type: 'setQty'; key: string; qty: number }
  | { type: 'remove'; key: string }
  | { type: 'setLineNote'; key: string; note: string }
  | { type: 'setForName'; key: string; forName: string }
  | { type: 'replaceLine'; key: string; line: CartLine }
  | { type: 'setCustomer'; name?: string; phone?: string }
  | { type: 'setOrderNote'; note: string }
  | { type: 'setSlip'; receiptRef?: string; slipTotal?: string }
  | { type: 'clear'; now: number }
  | { type: 'replaceLines'; lines: CartLine[] }
  | { type: 'load'; draft: Draft }

// A non-finite quantity (NaN from a half-typed stepper) must never reach a line: NaN survives Math.max/min and would
// poison every total below it, so it reads as 1 (the smallest real quantity) instead.
const clampQty = (q: number) => (Number.isFinite(q) ? Math.max(1, Math.min(LIMITS.qtyMax, Math.floor(q))) : 1)

/** Merges lines that share a key (summing qty), keeping the first one's position and the LAST one's preview. */
function normaliseLines(lines: readonly CartLine[]): CartLine[] {
  const out: CartLine[] = []
  const at = new Map<string, number>()
  for (const l of lines) {
    const i = at.get(l.key)
    if (i === undefined) {
      if (out.length >= LIMITS.linesPerOrderMax) continue
      at.set(l.key, out.length)
      out.push({ ...l, input: { ...l.input, qty: clampQty(l.input.qty) } })
    } else {
      const prev = out[i] as CartLine
      out[i] = { ...l, input: { ...l.input, qty: clampQty(prev.input.qty + l.input.qty) } }
    }
  }
  return out
}

export function atLineCap(draft: Pick<Draft, 'lines'>): boolean {
  return draft.lines.length >= LIMITS.linesPerOrderMax
}

function reinput(line: CartLine, patch: { note?: string | null; forName?: string | null; qty?: number }): CartLine {
  const input = { ...line.input, ...patch } as LineInput
  return { ...line, input, key: lineMergeKey(input) }
}

export function cartReducer(state: Draft, action: CartAction): Draft {
  switch (action.type) {
    case 'add': {
      // A brand-new distinct line past the cap is refused (the caller checks atLineCap() to say why).
      if (atLineCap(state) && !state.lines.some((l) => l.key === action.line.key)) return state
      return { ...state, lines: normaliseLines([...state.lines, action.line]) }
    }
    case 'setQty': {
      if (action.qty <= 0) return { ...state, lines: state.lines.filter((l) => l.key !== action.key) }
      return {
        ...state,
        lines: state.lines.map((l) => (l.key === action.key ? reinput(l, { qty: clampQty(action.qty) }) : l)),
      }
    }
    case 'remove':
      return { ...state, lines: state.lines.filter((l) => l.key !== action.key) }
    case 'setLineNote': {
      const note = normalizeNote(action.note, LIMITS.lineNoteMax)
      return { ...state, lines: normaliseLines(state.lines.map((l) => (l.key === action.key ? reinput(l, { note }) : l))) }
    }
    case 'setForName': {
      const forName = normalizeNote(action.forName, LIMITS.forNameMax)
      return { ...state, lines: normaliseLines(state.lines.map((l) => (l.key === action.key ? reinput(l, { forName }) : l))) }
    }
    case 'replaceLine': {
      const at = state.lines.findIndex((l) => l.key === action.key)
      if (at < 0) return cartReducer(state, { type: 'add', line: action.line })
      const next = [...state.lines]
      next[at] = action.line
      return { ...state, lines: normaliseLines(next) }
    }
    case 'setCustomer':
      return {
        ...state,
        customerName: action.name === undefined ? state.customerName : clampStr(action.name, LIMITS.customerNameMax),
        customerPhone: action.phone === undefined ? state.customerPhone : clampStr(action.phone, 24),
      }
    case 'setOrderNote':
      return { ...state, orderNote: clampStr(action.note, LIMITS.orderNoteMax) }
    case 'setSlip':
      return {
        ...state,
        receiptRef: action.receiptRef === undefined ? state.receiptRef : clampStr(action.receiptRef, LIMITS.receiptRefMax),
        slipTotal: action.slipTotal === undefined ? state.slipTotal : clampStr(action.slipTotal, 12),
      }
    case 'clear':
      return emptyDraft(action.now)
    case 'replaceLines':
      return { ...state, lines: normaliseLines(action.lines) }
    case 'load':
      return action.draft
  }
}

// ---- Totals, the slip check -----------------------------------------------------------------------

export function lineTotal(line: CartLine): number {
  return line.preview.unitAgorot * line.input.qty
}

export function totalAgorot(draft: Pick<Draft, 'lines'>): number {
  return draft.lines.reduce((sum, l) => sum + lineTotal(l), 0)
}

export function itemCount(draft: Pick<Draft, 'lines'>): number {
  return draft.lines.reduce((n, l) => n + l.input.qty, 0)
}

export type SlipStatus =
  | { kind: 'none' }
  | { kind: 'invalid' }
  | { kind: 'match' }
  /** slip minus system: positive = the slip is higher */
  | { kind: 'diff'; diffAgorot: number }

/** A mismatch is information, never a block: a discount at the card terminal is legitimate. */
export function slipStatus(draft: Pick<Draft, 'slipTotal' | 'lines'>): SlipStatus {
  const raw = draft.slipTotal.trim()
  if (raw === '') return { kind: 'none' }
  const slip = parsePriceInput(raw)
  if (slip === null) return { kind: 'invalid' }
  const diff = slip - totalAgorot(draft)
  return diff === 0 ? { kind: 'match' } : { kind: 'diff', diffAgorot: diff }
}

// ---- May it be sent? -----------------------------------------------------------------------------------

export type SendGate =
  | { ok: true }
  | { ok: false; reason: 'closed' | 'no_lines' | 'no_name' | 'bad_phone' | 'line_problem' | 'offline' }

export function canSend(
  draft: Draft,
  opts: {
    sessionActive: boolean
    online?: boolean
    /** add-to-order: the customer is the existing order's and is locked; the call is not queued, so it needs a connection */
    addMode?: boolean
    problemCount?: number
  },
): SendGate {
  if (!opts.sessionActive) return { ok: false, reason: 'closed' }
  if (draft.lines.length === 0) return { ok: false, reason: 'no_lines' }
  if (!opts.addMode) {
    if (normalizeCustomerName(draft.customerName) === null) return { ok: false, reason: 'no_name' }
    if (normalizePhone(draft.customerPhone) === 'invalid') return { ok: false, reason: 'bad_phone' }
  }
  if ((opts.problemCount ?? 0) > 0) return { ok: false, reason: 'line_problem' }
  // A new order is queued on the device and survives a dead connection; an add-to-order call is not queued.
  if (opts.addMode && opts.online === false) return { ok: false, reason: 'offline' }
  return { ok: true }
}

// ---- The wire bodies -------------------------------------------------------------------------------------

/** The body for outbox.enqueueCreate, or null when the draft cannot be sent (check canSend first).
 *  `modifiers` stays undefined for an as-is line — that is what "as-is" means on the wire. */
export function buildCreateBody(draft: Draft): CreateDraftBody | null {
  const name = normalizeCustomerName(draft.customerName)
  const phone = normalizePhone(draft.customerPhone)
  if (name === null || phone === 'invalid' || draft.lines.length === 0) return null
  const slipRaw = draft.slipTotal.trim()
  const slip = slipRaw === '' ? null : parsePriceInput(slipRaw)
  return {
    customerName: name,
    customerPhone: phone,
    receiptRef: normalizeNote(draft.receiptRef, LIMITS.receiptRefMax),
    slipTotalAgorot: slip,
    note: normalizeNote(draft.orderNote, LIMITS.orderNoteMax),
    lines: draft.lines.map((l) => l.input),
  }
}

/** For add-to-order: just the lines (the order's customer, note and slip are already the order's). */
export function buildAddBody(draft: Draft): { lines: LineInput[] } | null {
  return draft.lines.length === 0 ? null : { lines: draft.lines.map((l) => l.input) }
}

// ---- Persistence --------------------------------------------------------------------------------------------

/** Per branch AND person: two cashiers sharing a tablet must never see each other's half-typed order.
 *  `scope` separates an add-to-order draft from the main one. */
export function draftStorageKey(branchId: string, staffId: string, scope?: string): string {
  return `${OUTBOX.draftKeyPrefix}${branchId}.${staffId}${scope ? `.add.${scope}` : ''}`
}

const KINDS: readonly ModifierKind[] = ['choice', 'add', 'remove', 'substitute', 'prep']

function sanitizeLocalized(raw: unknown): Localized | null {
  if (!isRec(raw)) return null
  const out: Localized = {}
  for (const k of ['he', 'en', 'ar'] as const) {
    const v = raw[k]
    if (typeof v === 'string') out[k] = clampStr(v, 120)
  }
  return out
}

const isCents = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max

function sanitizeSnapshot(raw: unknown): ModifierSnapshot | null {
  if (!isRec(raw)) return null
  const label = sanitizeLocalized(raw.label)
  if (
    !label || typeof raw.group_uid !== 'string' || typeof raw.option_uid !== 'string' ||
    !KINDS.includes(raw.kind as ModifierKind) || typeof raw.price_delta_agorot !== 'number' ||
    !Number.isInteger(raw.price_delta_agorot) || typeof raw.qty !== 'number' || !Number.isInteger(raw.qty) || raw.qty < 1
  ) {
    return null
  }
  return {
    group_uid: clampStr(raw.group_uid, 80),
    group: sanitizeLocalized(raw.group),
    kind: raw.kind as ModifierKind,
    option_uid: clampStr(raw.option_uid, 80),
    label,
    price_delta_agorot: raw.price_delta_agorot,
    qty: raw.qty,
    source: sanitizeLocalized(raw.source),
  }
}

function sanitizeInput(raw: unknown): LineInput | null {
  if (!isRec(raw)) return null
  const qty = raw.qty
  if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > LIMITS.qtyMax) return null
  const note = normalizeNote(typeof raw.note === 'string' ? raw.note : null, LIMITS.lineNoteMax)
  const forName = normalizeNote(typeof raw.forName === 'string' ? raw.forName : null, LIMITS.forNameMax)
  const common = { qty, ...(note ? { note } : {}), ...(forName ? { forName } : {}) }

  if (isRec(raw.custom)) {
    const c = raw.custom
    const name = normalizeNote(typeof c.name === 'string' ? c.name : null, 80)
    if (!name || !isCents(c.priceAgorot, LIMITS.customUnitAgorotMax) || typeof c.pointId !== 'string' || !c.pointId) return null
    return { custom: { name, priceAgorot: c.priceAgorot, pointId: clampStr(c.pointId, 64) }, ...common }
  }

  if (typeof raw.itemUid !== 'string' || !raw.itemUid || raw.itemUid.length > 80) return null
  const out: Extract<LineInput, { itemUid: string }> = { itemUid: raw.itemUid, ...common }
  if (typeof raw.typeUid === 'string' && raw.typeUid) out.typeUid = clampStr(raw.typeUid, 80)
  if (typeof raw.priceChoice === 'number' && Number.isInteger(raw.priceChoice) && raw.priceChoice >= 0 && raw.priceChoice <= 9) {
    out.priceChoice = raw.priceChoice
  }
  // undefined = as-is. An array — even an empty one — is taken exactly. Anything else is read as as-is.
  if (Array.isArray(raw.modifiers)) {
    const mods: ModifierSelection[] = []
    for (const m of raw.modifiers.slice(0, LIMITS.modifiersPerLineMax)) {
      if (!isRec(m) || typeof m.groupUid !== 'string' || typeof m.optionUid !== 'string' || !m.groupUid || !m.optionUid) continue
      const q = typeof m.qty === 'number' && Number.isInteger(m.qty) && m.qty >= 1 && m.qty <= LIMITS.modifierQtyMax ? m.qty : 1
      mods.push({ groupUid: clampStr(m.groupUid, 80), optionUid: clampStr(m.optionUid, 80), qty: q })
    }
    out.modifiers = mods
  }
  return out
}

function sanitizePreview(raw: unknown): CartPreview | null {
  if (!isRec(raw)) return null
  const name = sanitizeLocalized(raw.name)
  if (!name || !isCents(raw.unitAgorot, LIMITS.unitAgorotMax) || !isCents(raw.baseAgorot, LIMITS.unitAgorotMax)) return null
  const mods = Array.isArray(raw.modifiers) ? raw.modifiers.map(sanitizeSnapshot) : []
  return {
    name,
    categoryId: typeof raw.categoryId === 'string' ? clampStr(raw.categoryId, 80) : null,
    pointId: typeof raw.pointId === 'string' ? clampStr(raw.pointId, 64) : '',
    unitAgorot: raw.unitAgorot,
    baseAgorot: raw.baseAgorot,
    // one malformed snapshot and the whole list is dropped: a half-described line is worse than a re-priced one
    modifiers: mods.every((m) => m !== null) ? (mods as ModifierSnapshot[]) : [],
    typeLabel: sanitizeLocalized(raw.typeLabel),
    variantLabel: typeof raw.variantLabel === 'string' ? clampStr(raw.variantLabel, 40) : null,
  }
}

/** Anything -> a usable Draft. NEVER throws: a corrupt localStorage value at the start of a shift must
 *  cost an empty cart, not a white screen. A draft older than 8 h is a leftover from yesterday and is dropped. */
export function sanitizeDraft(raw: unknown, now: number = Date.now()): Draft {
  if (!isRec(raw)) return emptyDraft(now)
  const startedAt = typeof raw.startedAt === 'number' && Number.isFinite(raw.startedAt) ? raw.startedAt : now
  if (now - startedAt > DRAFT_TTL_MS || startedAt > now + 60_000) return emptyDraft(now)

  const lines: CartLine[] = []
  if (Array.isArray(raw.lines)) {
    for (const r of raw.lines.slice(0, LIMITS.linesPerOrderMax * 2)) {
      if (!isRec(r)) continue
      const input = sanitizeInput(r.input)
      const preview = sanitizePreview(r.preview)
      if (!input || !preview) continue
      lines.push({ key: lineMergeKey(input), input, preview })
    }
  }
  return {
    customerName: clampStr(raw.customerName, LIMITS.customerNameMax),
    customerPhone: clampStr(raw.customerPhone, 24),
    orderNote: clampStr(raw.orderNote, LIMITS.orderNoteMax),
    receiptRef: clampStr(raw.receiptRef, LIMITS.receiptRefMax),
    slipTotal: clampStr(raw.slipTotal, 12),
    lines: normaliseLines(lines),
    startedAt,
  }
}

/** True when there is nothing worth keeping (so the order-start sheet opens by itself). */
export function isBlank(draft: Draft): boolean {
  return draft.lines.length === 0 && draft.customerName.trim() === ''
}

// ---- Display helpers -------------------------------------------------------------------------------------------

/** Lines grouped by the point that makes them, in the point order given; unknown points last. */
export function groupByPoint(lines: readonly CartLine[], pointOrder: readonly string[]): { pointId: string; lines: CartLine[] }[] {
  const by = new Map<string, CartLine[]>()
  for (const l of lines) {
    const arr = by.get(l.preview.pointId) ?? []
    arr.push(l)
    by.set(l.preview.pointId, arr)
  }
  const out: { pointId: string; lines: CartLine[] }[] = []
  for (const id of pointOrder) {
    const arr = by.get(id)
    if (arr) {
      out.push({ pointId: id, lines: arr })
      by.delete(id)
    }
  }
  by.forEach((arr, id) => out.push({ pointId: id, lines: arr }))
  return out
}

/** units per item uid / per category id — the tile's and the strip's count badges */
export function countsOf(lines: readonly CartLine[]): { byItem: Map<string, number>; byCategory: Map<string, number> } {
  const byItem = new Map<string, number>()
  const byCategory = new Map<string, number>()
  for (const l of lines) {
    if ('itemUid' in l.input) byItem.set(l.input.itemUid, (byItem.get(l.input.itemUid) ?? 0) + l.input.qty)
    const c = l.preview.categoryId
    if (c) byCategory.set(c, (byCategory.get(c) ?? 0) + l.input.qty)
  }
  return { byItem, byCategory }
}

/** Search across Hebrew / English / Arabic names (item and category), case-insensitive. */
export function matchesQuery(item: MenuItem, category: MenuCategory, query: string): boolean {
  const q = query.trim().toLocaleLowerCase()
  if (!q) return true
  const hay = [item.he, item.en, item.ar, category.title.he, category.title.en, category.title.ar]
  return hay.some((s) => typeof s === 'string' && s.toLocaleLowerCase().includes(q))
}

/** An OPEN order for the same customer name, made in the last 30 minutes — offered as a hint, never forced
 *  (two Danas happen). Newest first wins. Uses the name only; the phone is never read here. */
export function sameNameOrder<T extends Pick<PosOrder, 'customer_name' | 'status' | 'created_at'>>(
  orders: readonly T[],
  name: string,
  now: number,
): T | null {
  const wanted = (normalizeCustomerName(name) ?? '').toLocaleLowerCase()
  if (!wanted) return null
  let best: T | null = null
  let bestAt = -Infinity
  for (const o of orders) {
    if (o.status !== 'open') continue
    if (o.customer_name.trim().replace(/\s+/g, ' ').toLocaleLowerCase() !== wanted) continue
    const at = Date.parse(o.created_at)
    if (!Number.isFinite(at) || now - at > SAME_NAME_WINDOW_MS || at > now + 60_000) continue
    if (at > bestAt) {
      best = o
      bestAt = at
    }
  }
  return best
}
