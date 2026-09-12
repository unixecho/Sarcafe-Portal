import {
  Coffee,
  Croissant,
  Cookie,
  IceCream2,
  Sandwich,
  CupSoda,
  Soup,
  Salad,
  Pizza,
  Cake,
  Popcorn,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react'

// Category icons used to be a free-typed emoji (category.icon: string, e.g.
// "🍽️") — hard to pick correctly on a phone keyboard and inconsistent
// across devices (see the ui-ux-pro-max skill's "no emoji as structural
// icons" guidance). They're now one of these fixed keys instead, chosen
// from IconPicker.tsx. The `icon` column/field itself is unchanged (still
// a plain string) — any *old* emoji value already saved just falls back to
// the default glyph below rather than breaking, so no data migration is
// required.
export const CATEGORY_ICON_KEYS = [
  'coffee',
  'croissant',
  'cookie',
  'ice-cream',
  'sandwich',
  'cup-soda',
  'soup',
  'salad',
  'pizza',
  'cake',
  'popcorn',
  'utensils',
] as const

export type CategoryIconKey = (typeof CATEGORY_ICON_KEYS)[number]

const ICON_MAP: Record<CategoryIconKey, LucideIcon> = {
  coffee: Coffee,
  croissant: Croissant,
  cookie: Cookie,
  'ice-cream': IceCream2,
  sandwich: Sandwich,
  'cup-soda': CupSoda,
  soup: Soup,
  salad: Salad,
  pizza: Pizza,
  cake: Cake,
  popcorn: Popcorn,
  utensils: UtensilsCrossed,
}

export function resolveCategoryIcon(value: string | null | undefined): LucideIcon {
  return ICON_MAP[(value ?? '') as CategoryIconKey] ?? UtensilsCrossed
}
