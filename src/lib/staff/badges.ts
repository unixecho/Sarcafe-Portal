// Job-title vocabulary shown on the owner's staff list. Purely cosmetic
// EXCEPT 'owner' and 'general_manager', which access.ts also reads for
// authorization — see the comment there before renaming either of those
// two keys.

export type Badge =
  | 'owner'
  | 'general_manager'
  | 'manager'
  | 'barista'
  | 'cook'
  | 'cashier'

export const BADGES: Record<Badge, { he: string; en: string; ar: string }> = {
  owner: { he: 'בעלים', en: 'Owner', ar: 'مالك' },
  general_manager: { he: 'מנהל/ת כללי/ת', en: 'General Manager', ar: 'مدير عام' },
  manager: { he: 'מנהל/ת משמרת', en: 'Shift Manager', ar: 'مدير مناوبة' },
  barista: { he: 'בריסטה', en: 'Barista', ar: 'باريستا' },
  cook: { he: 'טבח/ית', en: 'Cook', ar: 'طاهي' },
  cashier: { he: 'קופאי/ת', en: 'Cashier', ar: 'كاشير' },
}

// Controls which half of the (future) public team page a person appears in.
// NOT an authorization check — see access.ts for the real gate.
export const MANAGEMENT_BADGES: Badge[] = ['owner', 'general_manager', 'manager']

export function badgeLabel(badge: string | null | undefined, lang: 'he' | 'en' | 'ar' = 'he'): string {
  if (!badge) return ''
  const known = BADGES[badge as Badge]
  return known ? known[lang] : badge
}
