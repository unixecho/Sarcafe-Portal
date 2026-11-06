import { z } from 'zod'
import { DEVICE_SLUG_PATTERN } from '@/lib/kiosk/device-settings'
import type { MenuDoc } from '@/lib/menu/types'

// The menu editor in the kiosk's staff panel (owner, 2026-11-06: the full editor on the tablet, behind the staff PIN: names, prices,
// adding and removing items and types). The SAME writes as the dashboard's tablet tools (add/remove item, add/remove type, the
// item ↔ "has types" switch) plus menu_update_entry for a name or a price (migration 20261106180000); the same rules (only during
// opening hours, audited). Pure, for the unit stage; the route is src/app/api/kiosk/menu-edit. docs/SARCAFE_KIOSK_MENU.md.

export type EditType = { uid: string; name: string; price: string }
export type EditItem = { uid: string; name: string; price: string; types: EditType[] }
export type EditCategory = { id: string; name: string; items: EditItem[] }

const priceText = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' ? v : '')

/** Every category, item and type of the branch's working copy (the draft, like the dashboard's tablet page). */
export function menuTree(doc: MenuDoc | null | undefined): EditCategory[] {
  return (doc?.categories ?? []).map((c) => ({
    id: String(c.id),
    name: c.title?.he || c.title?.en || 'קטגוריה',
    items: (c.items ?? []).filter((i) => typeof i.uid === 'string' && i.uid).map((i) => ({
      uid: i.uid as string,
      name: i.he || i.en || 'פריט',
      price: priceText(i.price),
      types: (i.types ?? []).filter((t) => typeof t.uid === 'string' && t.uid).map((t) => ({ uid: t.uid, name: t.he || t.en || 'סוג', price: priceText(t.priceDelta) })),
    })),
  }))
}

/** Where an item or a type sits, with its label for the audit log, or null when the menu has no such entry. */
export function findEntry(doc: MenuDoc | null | undefined, itemUid: string, typeUid: string | null = null): { label: string; hasTypes: boolean } | null {
  for (const c of menuTree(doc)) {
    const item = c.items.find((i) => i.uid === itemUid)
    if (!item) continue
    if (!typeUid) return { label: item.name, hasTypes: item.types.length > 0 }
    const type = item.types.find((t) => t.uid === typeUid)
    return type ? { label: `${item.name} — ${type.name}`, hasTypes: true } : null
  }
  return null
}

/** The item a type belongs to, or null. */
export function itemOfType(doc: MenuDoc | null | undefined, typeUid: string): string | null {
  for (const c of menuTree(doc)) for (const i of c.items) if (i.types.some((t) => t.uid === typeUid)) return i.uid
  return null
}

const uid = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/)
const name = z.string().trim().min(1).max(80).refine((s) => !/[\u0000-\u001f‪-‮⁦-⁩]/.test(s), 'bad characters')
/** A price as staff type it: digits ("14", "14.5"), a range ("20/24"), or nothing. */
const price = z.string().trim().max(20).regex(/^$|^[0-9]+(\.[0-9]{1,2})?(\/[0-9]+(\.[0-9]{1,2})?)?$/, 'price')
const device = z.string().regex(DEVICE_SLUG_PATTERN).optional()

/** One change from the kiosk's menu editor (POST /api/kiosk/menu-edit). */
export const menuEditSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add_item'), device, categoryId: z.string().min(1).max(64), name, price: price.optional() }).strict(),
  z.object({ op: z.literal('remove_item'), device, itemUid: uid }).strict(),
  z.object({ op: z.literal('add_type'), device, itemUid: uid, name, price: price.optional() }).strict(),
  z.object({ op: z.literal('remove_type'), device, typeUid: uid }).strict(),
  z.object({ op: z.literal('update'), device, itemUid: uid, typeUid: uid.nullable().default(null), name: name.optional(), price: price.optional() }).strict(),
])
export type MenuEdit = z.infer<typeof menuEditSchema>

/** A change the schema allows but that changes nothing (an update with neither a name nor a price). */
export const isEmptyEdit = (e: MenuEdit) => e.op === 'update' && e.name === undefined && e.price === undefined
