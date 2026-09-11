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
  /** false = sold out. Draft-only until published. */
  available?: boolean
}

export type MenuCategory = {
  id: string
  icon?: string
  title: Localized
  note?: Localized
  items: MenuItem[]
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
