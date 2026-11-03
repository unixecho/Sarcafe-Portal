import { createHash } from 'node:crypto'
import type { Localized, MenuCategory, MenuItem } from '@/lib/menu/types'

// The kiosk's menu: a strict, read-only projection of the PUBLISHED public menu into the small shape the
// kiosk page renders. No draft, audit, uid, image, POS or modifier data leaves the server through here.
// Pure (no database, no network) so scripts/check-kiosk-menu.mjs can run it directly.

/** The kiosk's other languages. Hebrew is the main field set (name, title, note, types); these ride alongside. */
export type KioskLang = 'en' | 'ar'
export const KIOSK_LANGS: KioskLang[] = ['en', 'ar']

/** An item's words in one other language. `types` lines up one-to-one with the Hebrew `types`. */
export type KioskItemText = { name: string; note?: string; types?: string[] }

export type KioskItem = {
  name: string
  price: number | string
  note?: string
  types?: string[]
  recommended?: boolean
  quantity?: number
  /** Present only for a language the owner gave this item a name in; older kiosk pages simply ignore it. */
  tr?: Partial<Record<KioskLang, KioskItemText>>
}

export type KioskCategory = { id: string; title: string; items: KioskItem[]; tr?: Partial<Record<KioskLang, { title: string }>> }

export type KioskSnapshot = {
  branch: string
  publishedAt: string | null
  /** Hash of the content itself: the kiosk reloads only when this changes, so a "save draft" ping costs nothing. */
  version: string
  categories: KioskCategory[]
}

/** Hebrew first (the kiosk is Hebrew), English as the fallback for a label the owner only wrote in English. */
const label = (value?: Localized): string => (value?.he ?? value?.en ?? '').trim()

const SOLD_OUT = 'אזל'
const SOLD_OUT_IN: Record<KioskLang, string> = { en: 'Sold out', ar: 'نفدت الكمية' }

/** A label in one of the other languages, or '' when the owner did not write one (the kiosk then shows the Hebrew). */
const labelIn = (value: Localized | undefined, lang: KioskLang): string => (value?.[lang] ?? '').trim()

function itemText(item: MenuItem, lang: KioskLang): KioskItemText | null {
  const name = labelIn(item, lang)
  if (!name) return null
  const soldOut = SOLD_OUT_IN[lang]
  const out: KioskItemText = { name }
  // same rules as the Hebrew note below, in this language; a missing translation falls back to the Hebrew words
  const note = labelIn(item.note, lang) || label(item.note)
  if (note && item.available === false) out.note = `${note} — ${soldOut}`
  else if (item.available === false) out.note = soldOut
  else if (note) out.note = note
  const types = (item.types ?? [])
    .map((type) => {
      const typeName = labelIn(type, lang) || label(type)
      if (!typeName) return null
      return type.available === false || type.quantity === 0 ? `${typeName} — ${soldOut}` : typeName
    })
    .filter((typeName): typeName is string => typeName !== null)
  if (types.length > 0) out.types = types
  return out
}

function projectItem(item: MenuItem): KioskItem | null {
  const name = label(item)
  const price = item.price
  // an item with no name or no price cannot be shown on a price list
  if (!name || price === null || price === undefined || price === '') return null

  const out: KioskItem = { name, price }
  const note = label(item.note)
  const soldOut = item.available === false
  if (note && soldOut) out.note = `${note} — ${SOLD_OUT}`
  else if (soldOut) out.note = SOLD_OUT
  else if (note) out.note = note

  const types = (item.types ?? [])
    .map((type) => {
      const typeName = label(type)
      if (!typeName) return null
      return type.available === false || type.quantity === 0 ? `${typeName} — ${SOLD_OUT}` : typeName
    })
    .filter((typeName): typeName is string => typeName !== null)
  if (types.length > 0) out.types = types

  if (item.recommended === true) out.recommended = true
  if (typeof item.quantity === 'number' && item.quantity > 0) out.quantity = item.quantity

  const tr: Partial<Record<KioskLang, KioskItemText>> = {}
  for (const lang of KIOSK_LANGS) {
    const text = itemText(item, lang)
    if (text) tr[lang] = text
  }
  if (Object.keys(tr).length > 0) out.tr = tr
  return out
}

export function projectKioskMenu(categories: MenuCategory[]): KioskCategory[] {
  const out: KioskCategory[] = []
  for (const category of categories) {
    const title = label(category.title)
    const items = (category.items ?? []).map(projectItem).filter((item): item is KioskItem => item !== null)
    if (!category.id || !title || items.length === 0) continue
    const tr: Partial<Record<KioskLang, { title: string }>> = {}
    for (const lang of KIOSK_LANGS) {
      const text = labelIn(category.title, lang)
      if (text) tr[lang] = { title: text }
    }
    out.push(Object.keys(tr).length > 0 ? { id: category.id, title, items, tr } : { id: category.id, title, items })
  }
  return out
}

export function kioskVersion(categories: KioskCategory[]): string {
  return createHash('sha256').update(JSON.stringify(categories)).digest('hex').slice(0, 16)
}

export function buildKioskSnapshot(branchName: string, publishedAt: string | null, publicCategories: MenuCategory[]): KioskSnapshot {
  const categories = projectKioskMenu(publicCategories)
  return { branch: branchName, publishedAt, version: kioskVersion(categories), categories }
}
