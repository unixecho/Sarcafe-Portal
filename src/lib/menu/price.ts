// Shared by every POS surface that needs to know whether a MenuItem's
// price is a plain, chargeable number — MenuItem.price/MenuItemType.
// priceDelta can also be a free-text range string ("20/24"), which has
// no reliable numeric parse (see lib/orders/actions.ts and migration
// 017's header for why price is staff-confirmed, never derived, at
// order time). This only ever answers "is there a safe default to
// suggest", never "what should we charge" on its own.

export function parsePrice(value: number | string | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim())) return Number(value.trim())
  return null
}
