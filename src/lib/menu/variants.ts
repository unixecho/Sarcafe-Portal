import type { MenuCategory, MenuDoc, MenuVariant } from '@/lib/menu/types'

function randomUid(): string {
  return `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

/** Walks the tree and mints any missing item uid. Idempotent — safe to run
 * on every read. Mutates a cloned copy, never the input. */
export function ensureUids(doc: MenuDoc): MenuDoc {
  return {
    categories: doc.categories.map((category) => ({
      ...category,
      items: category.items.map((item) => (item.uid ? item : { ...item, uid: randomUid() })),
    })),
  }
}

export function allItemUids(doc: MenuDoc): string[] {
  return doc.categories.flatMap((c: MenuCategory) => c.items.map((i) => i.uid).filter((uid): uid is string => !!uid))
}

/**
 * Resolution order, run identically server- and client-side (mirrors
 * AyekaBar's resolveVariant() exactly):
 * 1. Any variant whose schedule window is open right now wins (by sort_order).
 * 2. Else the manually-active variant, unless itself scheduled-but-closed
 *    or its active_until has passed.
 * 3. Else the default variant.
 */
export function resolveVariant(variants: MenuVariant[], activeVariantId: string | null, now: Date): MenuVariant | null {
  if (!variants.length) return null

  const scheduled = variants
    .filter((v) => v.schedule_enabled && isScheduleOpen(v, now))
    .sort((a, b) => a.sort_order - b.sort_order)
  if (scheduled[0]) return scheduled[0]

  const active = variants.find((v) => v.id === activeVariantId)
  if (active) {
    const scheduledButClosed = active.schedule_enabled && !isScheduleOpen(active, now)
    const timedOut = active.active_until && new Date(active.active_until) < now
    if (!scheduledButClosed && !timedOut) return active
  }

  return variants.find((v) => v.is_default) ?? variants[0] ?? null
}

function isScheduleOpen(variant: MenuVariant, now: Date): boolean {
  if (!variant.schedule_enabled) return false
  if (variant.schedule_days.length > 0 && !variant.schedule_days.includes(now.getDay())) return false
  if (!variant.schedule_start || !variant.schedule_end) return true

  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const start = toMinutes(variant.schedule_start)
  const end = toMinutes(variant.schedule_end)

  // end <= start wraps past midnight (e.g. 22:00 -> 02:00).
  if (end <= start) return nowMinutes >= start || nowMinutes < end
  return nowMinutes >= start && nowMinutes < end
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** Applies a resolved variant's exclusion list — returns a new doc with
 * excluded items filtered out, never mutates the input. */
export function applyVariant(doc: MenuDoc, variant: MenuVariant | null): MenuDoc {
  if (!variant || variant.excluded_uids.length === 0) return doc
  const excluded = new Set(variant.excluded_uids)
  return {
    categories: doc.categories.map((category) => ({
      ...category,
      items: category.items.filter((item) => !item.uid || !excluded.has(item.uid)),
    })),
  }
}
