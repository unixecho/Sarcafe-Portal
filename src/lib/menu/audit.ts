// Server-only. Writes to menu_audit (RLS-enabled, zero policies — only a
// service-role client can ever insert here) and builds the human-readable
// summary/diff that goes with each row. Ported in spirit from AyekaBar's
// shift_audit writer (log_shift_audit()): an audit entry describes what a
// person did in one line, with the field-level detail available on demand,
// not the other way around.

import type { createServiceRoleClient } from '@/lib/supabase/server'
import type { MenuDoc, MenuItem } from '@/lib/menu/types'

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

  const parts: string[] = []
  if (added.length) parts.push(`${added.length} פריטים נוספו`)
  if (removed.length) parts.push(`${removed.length} פריטים נמחקו`)
  if (availabilityFlips.length) parts.push(`${availabilityFlips.length} שינויי זמינות`)
  if (priceChanges.length) parts.push(`${priceChanges.length} שינויי מחיר`)
  if (renamed.length) parts.push(`${renamed.length} פריטים שונו שם`)
  if (categoryDelta > 0) parts.push(`${categoryDelta} קטגוריות נוספו`)
  if (categoryDelta < 0) parts.push(`${-categoryDelta} קטגוריות נמחקו`)

  return {
    summary: parts.length ? parts.join(', ') : 'עדכון קל בתפריט',
    detail: {
      added: added.map((uid) => ({ uid, name: itemLabel(afterItems.get(uid)!) })),
      removed: removed.map((uid) => ({ uid, name: itemLabel(beforeItems.get(uid)!) })),
      availabilityFlips,
      priceChanges,
      renamed,
      categoryCountBefore: before.categories.length,
      categoryCountAfter: after.categories.length,
    },
  }
}
