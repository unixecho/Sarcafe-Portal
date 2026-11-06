import { z } from 'zod'
import { DEVICE_SLUG_PATTERN } from '@/lib/kiosk/device-settings'
import type { MenuDoc } from '@/lib/menu/types'

// Live stock from the kiosk's staff panel (owner, 2026-11-06: "I want the kiosk to be able to handle the live stock like the dashboard
// does so I can update the menu quantities from the dashboard and or the kiosk"). The SAME categories as the dashboard's live-stock page
// (/owner/tablet: those marked liveOnTablet), the SAME write (set_availability through src/app/api/kiosk/stock), the SAME rules:
// a quantity of 0 marks it sold out, only during operating hours, audited. Pure, for the unit stage. docs/SARCAFE_KIOSK_REMOTE.md.

export type StockType = { uid: string; name: string; available: boolean; quantity: number | null }
export type StockItem = { uid: string; name: string; available: boolean; quantity: number | null; types: StockType[] }
export type StockCategory = { id: string; name: string; items: StockItem[] }

const qty = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null)
const isAvailable = (available: unknown, quantity: number | null) => available !== false && quantity !== 0

/** What the kiosk's stock tab shows: the live categories of the branch's working copy (draft, like the dashboard's page). */
export function stockView(doc: MenuDoc | null | undefined): StockCategory[] {
  return (doc?.categories ?? [])
    .filter((c) => c.liveOnTablet === true)
    .map((c) => ({
      id: String(c.id),
      name: c.title?.he || c.title?.en || 'קטגוריה',
      items: (c.items ?? [])
        .filter((i) => typeof i.uid === 'string' && i.uid)
        .map((i) => {
          const q = qty(i.quantity)
          return {
            uid: i.uid as string,
            name: i.he || i.en || 'פריט',
            available: isAvailable(i.available, q),
            quantity: q,
            types: (i.types ?? []).filter((t) => typeof t.uid === 'string' && t.uid).map((t) => {
              const tq = qty(t.quantity)
              return { uid: t.uid, name: t.he || t.en || 'סוג', available: isAvailable(t.available, tq), quantity: tq }
            }),
          }
        }),
    }))
}

/** The label of an item (or one of its types) in a LIVE category, or null when the kiosk may not touch it. */
export function stockLabel(doc: MenuDoc | null | undefined, itemUid: string, typeUid: string | null): string | null {
  for (const c of stockView(doc)) {
    const item = c.items.find((i) => i.uid === itemUid)
    if (!item) continue
    if (!typeUid) return item.name
    const type = item.types.find((t) => t.uid === typeUid)
    return type ? `${item.name} — ${type.name}` : null
  }
  return null
}

const uid = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/)

/** One change from the kiosk's stock tab (POST /api/kiosk/stock). */
export const kioskStockWriteSchema = z
  .object({
    device: z.string().regex(DEVICE_SLUG_PATTERN).optional(),
    itemUid: uid,
    typeUid: uid.nullable().default(null),
    available: z.boolean().optional(),
    quantity: z.number().int().min(0).max(999).optional(),
  })
  .strict()
  .refine((b) => b.available !== undefined || b.quantity !== undefined, { message: 'available or quantity' })
