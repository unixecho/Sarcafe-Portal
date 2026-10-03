// Server-only. Writes to menu_audit (RLS-enabled, zero policies — only a
// service-role client can ever insert here) and builds the human-readable
// summary/diff that goes with each row. Ported in spirit from AyekaBar's
// shift_audit writer (log_shift_audit()): an audit entry describes what a
// person did in one line, with the field-level detail available on demand,
// not the other way around.

import type { createServiceRoleClient } from '@/lib/supabase/server'
import type { MenuDoc, MenuItem, ModifierGroup } from '@/lib/menu/types'

export type MenuAuditAction =
  | 'menu.save'
  | 'menu.publish'
  | 'menu.availability'
  | 'variant.create'
  | 'variant.update'
  | 'variant.delete'
  | 'variant.activate'

type ActorLike = {
  auth_user_id?: string | null
  email?: string | null
  display_name?: string | null
  first_name?: string | null
  last_name?: string | null
}

export function actorName(actor: ActorLike): string {
  return (
    actor.display_name ||
    [actor.first_name, actor.last_name].filter(Boolean).join(' ').trim() ||
    actor.email ||
    'לא ידוע'
  )
}

/** Never let a logging failure fail the real mutation it's describing —
 *  the same posture AyekaBar's log_shift_audit() takes by swallowing its
 *  own exceptions. */
export async function logMenuAudit(
  service: ReturnType<typeof createServiceRoleClient>,
  params: {
    actor: ActorLike
    branchId: string
    menuId?: string | null
    action: MenuAuditAction
    summary: string
    detail?: Record<string, unknown>
  }
): Promise<void> {
  try {
    await service.from('menu_audit').insert({
      actor_id: params.actor.auth_user_id ?? null,
      actor_name: actorName(params.actor),
      actor_email: params.actor.email ?? null,
      branch_id: params.branchId,
      menu_id: params.menuId ?? null,
      action: params.action,
      summary: params.summary,
      detail: params.detail ?? {},
    })
  } catch (err) {
    console.error('menu_audit insert failed:', err)
  }
}

function flatItems(doc: MenuDoc): Map<string, MenuItem> {
  const map = new Map<string, MenuItem>()
  for (const category of doc.categories) {
    for (const item of category.items) {
      if (item.uid) map.set(item.uid, item)
    }
  }
  return map
}

function itemLabel(item: MenuItem): string {
  return item.he || item.en || item.ar || 'פריט'
}

/** Resolves a set of item uids (e.g. a variant's excluded_uids) to their
 *  display names against a menu doc, for an audit entry that must read as
 *  "which items," not a bare count or a uid list. Silently drops any uid
 *  no longer in the doc (an item deleted after the variant referencing it
 *  was created) rather than showing a raw id nobody can act on. */
export function resolveItemNames(doc: MenuDoc, uids: string[]): string[] {
  const items = flatItems(doc)
  return uids.map((uid) => items.get(uid)).filter((item): item is MenuItem => !!item).map(itemLabel)
}

function priceLabel(price: MenuItem['price']): string {
  if (price === null || price === undefined || price === '') return '—'
  return String(price)
}

const groupLabel = (g: ModifierGroup) => g.title.he || g.title.en || g.title.ar || 'קבוצה'
const optionLabel = (o: { he?: string; en?: string; ar?: string }) => o.he || o.en || o.ar || 'אפשרות'

/** What changed in the modifier library, as short signed tokens ("+חלב שיבולת שועל",
 *  "-בלי בצל"), plus whether any group was attached to / detached from a category or
 *  item. Options are named, not counted, because "which milk did she add" is the
 *  question an owner asks of this log. Groups are matched by uid, never by name, so a
 *  rename reads as an edit rather than a delete plus an add. */
function summarizeModifierDiff(before: MenuDoc, after: MenuDoc): { tokens: string[]; assignmentsChanged: boolean } {
  const tokens: string[] = []
  const prev = new Map((before.modifierGroups ?? []).map((g) => [g.uid, g]))
  const next = new Map((after.modifierGroups ?? []).map((g) => [g.uid, g]))
  for (const [uid, g] of next) {
    const old = prev.get(uid)
    if (!old) {
      tokens.push(`+קבוצה ${groupLabel(g)}`)
      continue
    }
    const oldOpts = new Map(old.options.map((o) => [o.uid, o]))
    const newOpts = new Map(g.options.map((o) => [o.uid, o]))
    for (const [ou, o] of newOpts) if (!oldOpts.has(ou)) tokens.push(`+${optionLabel(o)}`)
    for (const [ou, o] of oldOpts) if (!newOpts.has(ou)) tokens.push(`-${optionLabel(o)}`)
    // Anything else about the group or its surviving options (price, default, name,
    // required…) — one token per group, not per field.
    const strip = (x: ModifierGroup) => JSON.stringify({ ...x, options: x.options.filter((o) => oldOpts.has(o.uid) && newOpts.has(o.uid)) })
    if (strip(old) !== strip(g)) tokens.push(`~${groupLabel(g)}`)
  }
  for (const [uid, g] of prev) if (!next.has(uid)) tokens.push(`-קבוצה ${groupLabel(g)}`)

  const assigned = (doc: MenuDoc) =>
    JSON.stringify(
      doc.categories.map((c) => [c.id, c.modifierGroupUids ?? null, c.items.map((i) => [i.uid, i.modifierGroupUids ?? null])])
    )
  return { tokens, assignmentsChanged: assigned(before) !== assigned(after) }
}

/** A short summary + structured detail for a draft save/publish — item
 *  add/remove counts, availability flips (name + before/after), price and
 *  name edits on items untouched otherwise, category count delta. Never
 *  the full before/after doc: that's what raw jsonb detail is for on the
 *  rare occasion someone opens it, not what a summary line should try to
 *  be.
 *
 *  Price/name are checked specifically (not a generic deep-equal over
 *  every field) because they're the two edits an owner actually makes
 *  without touching availability or the item list — before this, a plain
 *  price tweak produced an empty diff, fell back to the "עדכון קל בתפריט"
 *  placeholder summary, AND had nothing for auditRows() to expand: the
 *  entry looked like an alert with no way to see what it was an alert
 *  about. */
export function summarizeMenuDiff(before: MenuDoc, after: MenuDoc): { summary: string; detail: Record<string, unknown> } {
  const beforeItems = flatItems(before)
  const afterItems = flatItems(after)

  const added = [...afterItems.keys()].filter((uid) => !beforeItems.has(uid))
  const removed = [...beforeItems.keys()].filter((uid) => !afterItems.has(uid))

  const availabilityFlips: { uid: string; name: string; from: boolean; to: boolean }[] = []
  const priceChanges: { uid: string; name: string; from: string; to: string }[] = []
  const renamed: { uid: string; from: string; to: string }[] = []
  for (const [uid, item] of afterItems) {
    const prev = beforeItems.get(uid)
    if (!prev) continue
    const prevAvailable = prev.available !== false
    const nextAvailable = item.available !== false
    if (prevAvailable !== nextAvailable) {
      availabilityFlips.push({ uid, name: itemLabel(item), from: prevAvailable, to: nextAvailable })
    }
    if (String(prev.price ?? '') !== String(item.price ?? '')) {
      priceChanges.push({ uid, name: itemLabel(item), from: priceLabel(prev.price), to: priceLabel(item.price) })
    }
    if ((prev.he || '') !== (item.he || '') && (prev.he || prev.en || prev.ar)) {
      renamed.push({ uid, from: itemLabel(prev), to: itemLabel(item) })
    }
  }

  const categoryDelta = after.categories.length - before.categories.length

  const modifiers = summarizeModifierDiff(before, after)

  const parts: string[] = []
  if (added.length) parts.push(`${added.length} פריטים נוספו`)
  if (removed.length) parts.push(`${removed.length} פריטים נמחקו`)
  if (availabilityFlips.length) parts.push(`${availabilityFlips.length} שינויי זמינות`)
  if (priceChanges.length) parts.push(`${priceChanges.length} שינויי מחיר`)
  if (renamed.length) parts.push(`${renamed.length} פריטים שונו שם`)
  if (categoryDelta > 0) parts.push(`${categoryDelta} קטגוריות נוספו`)
  if (categoryDelta < 0) parts.push(`${-categoryDelta} קטגוריות נמחקו`)
  if (modifiers.tokens.length) {
    const shown = modifiers.tokens.slice(0, 4).join(', ')
    const more = modifiers.tokens.length > 4 ? ` ועוד ${modifiers.tokens.length - 4}` : ''
    parts.push(`עדכן התאמות: ${shown}${more}`)
  }
  if (modifiers.assignmentsChanged) parts.push('שויכו התאמות למוצרים')

  return {
    summary: parts.length ? parts.join(', ') : 'עדכון קל בתפריט',
    detail: {
      added: added.map((uid) => ({ uid, name: itemLabel(afterItems.get(uid)!) })),
      removed: removed.map((uid) => ({ uid, name: itemLabel(beforeItems.get(uid)!) })),
      availabilityFlips,
      priceChanges,
      renamed,
      modifierChanges: modifiers.tokens,
      modifierAssignmentsChanged: modifiers.assignmentsChanged,
      categoryCountBefore: before.categories.length,
      categoryCountAfter: after.categories.length,
    },
  }
}
