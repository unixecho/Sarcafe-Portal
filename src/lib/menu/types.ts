// Mirrors AyekaBar's menu JSONB shape exactly — see
// supabase/migrations/001_menus_schema.sql. Categories/items only need
// identity (id/uid); everything else is free-form JSON, so adding a field
// later is a content change, never a migration.

export type Localized = { he?: string; en?: string; ar?: string }

export type MenuItem = Localized & {
  /** Minted once by ensureUids(), never re-derived from the label —
   * everything that must reference an item stably (variant exclusion
   * lists, later order-item snapshots) points at this, not at array
   * position or the name. */
  uid?: string
  price?: number | string | null // number, or a "20/24" range string
  note?: Localized
  image?: string
  /** false = sold out. Draft-only until published — flipping this in the
   * editor takes effect on the next Publish, same as any other edit.
   * (The live tablet editor bypasses draft/publish entirely via the
   * set_availability() RPC — see lib/menu/audit.ts's 'menu.availability'
   * action — so a toggle made there is NOT gated by this comment.) */
  available?: boolean
  /** Selectable types/flavors of this item (e.g. a pastry's fillings, a
   * shake's flavors, a cookie's varieties) — any item can carry these, not
   * just the three categories that motivated adding it. Not a schema
   * change: draft/published are jsonb, so this is purely a content shape
   * change, same philosophy as every other MenuItem field. */
  types?: MenuItemType[]
  /** Ayeka-style menu badges — "חדש" / "כדאי לטעום". Independent of
   * `available` ("אזל"), which already has its own badge treatment; an
   * item can carry any combination. */
  isNew?: boolean
  recommended?: boolean
  /** Live stock count, written only by the tablet page's set_availability()
   * RPC (migration 012) — draft-and-published both, immediately, same as
   * `available`. Absent means "not tracked here" (most items); present
   * means the public menu should show it. Setting this to 0 also forces
   * `available` false in the same write; raising it again does not
   * auto-restore availability. */
  quantity?: number
}

export type MenuItemType = Localized & {
  /** Minted once, same discipline as MenuItem.uid — set_availability()
   * (the live tablet editor's RPC) addresses a type by this, not by name
   * or array position. */
  uid: string
  /** Added to (or replacing, if the UI chooses) the parent item's price —
   * kept loose (number or a literal string) for the same reason
   * MenuItem.price is: some prices are ranges, not single numbers. */
  priceDelta?: number | string | null
  /** false = sold out. Same draft/publish vs. live-tablet split as
   * MenuItem.available above. */
  available?: boolean
  /** Same shape as MenuItem.quantity, same RPC, same rules. */
  quantity?: number
}

export type MenuCategory = {
  id: string
  icon?: string
  title: Localized
  note?: Localized
  items: MenuItem[]
  /** Owner-set flag marking this category as one the tablet page
   * (/owner/tablet, TabletAvailability.tsx) manages — Shakes/Pastries/
   * Sandwiches/Cookies, not every category. A flag rather than matching
   * category *names* because those are free-text and owner-edited; a
   * stable id would work too but this reads directly off the doc with no
   * extra lookup. */
  liveOnTablet?: boolean
  /** Owner-set flag for a category that's self-serve at the truck (e.g.
   * ice cream, fridge drinks) rather than made to order by the barista —
   * excluded from the POS register's item picker (/api/orders/catalog)
   * so staff can't accidentally ring up something a customer just grabs
   * themselves, while the public menu keeps showing it normally. */
  excludeFromPos?: boolean
}

export type MenuDoc = {
  categories: MenuCategory[]
}

export type MenuVariant = {
  id: string
  menu_id: string
  name: Localized
  excluded_uids: string[]
  is_default: boolean
  sort_order: number
  schedule_enabled: boolean
  schedule_days: number[] // 0=Sun..6=Sat, JS getDay(); empty = every day
  schedule_start: string | null // "HH:MM", branch-local
  schedule_end: string | null
  active_until: string | null // ISO instant
  expire_action: 'revert' | 'delete'
  is_active?: boolean
}

export type PublicMenu = {
  id: string
  slug: string
  name: Localized
  published: MenuDoc
  active_variant_id: string | null
  published_at: string | null
}

export const SUPPORTED_LANGS = ['he', 'en', 'ar'] as const
export type Lang = (typeof SUPPORTED_LANGS)[number]
export const RTL_LANGS: Lang[] = ['he', 'ar']

export function localized(field: Localized | undefined, lang: Lang): string {
  return field?.[lang] || field?.he || ''
}
