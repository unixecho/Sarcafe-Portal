// The menu as the POS sees it: the PUBLISHED document, variant-resolved, plus a
// cheap stamp so a device can poll "has it changed?" without downloading it.
//
// Two rules this file exists to hold:
//   * NEVER the draft. A cashier sells what customers can see; the owner's
//     half-edited draft (a price being changed, an item being added) must not leak
//     into a till. Only `published` is ever selected.
//   * The server prices from THIS, not from anything the browser sends — which is
//     why lines.ts reads the same function the screens' menu comes from. If the two
//     read different things the total on screen could disagree with the order.
//
// Service-role read, so the caller must already have passed a guard (the public
// menu is readable by anyone, but the POS reads `menus` directly to get the
// `updated_at` that a live stock change bumps — public_menus does not expose it).

import { createServiceRoleClient } from '@/lib/supabase/server'
import { applyVariant, resolveVariant } from '@/lib/menu/variants'
import type { MenuDoc, MenuVariant } from '@/lib/menu/types'
import type { PosMenu } from '@/lib/pos/types'
import { posError } from '@/lib/pos/server/guard'

type MenuRow = {
  id: string
  active_variant_id: string | null
  published_at: string | null
  updated_at: string | null
}

type MenuRowWithDoc = MenuRow & { published: MenuDoc | null }

async function readMenu(branchId: string, withDocument: boolean): Promise<{ menu: MenuRow; doc: MenuDoc | null; variants: MenuVariant[] } | null> {
  const service = createServiceRoleClient()
  const columns = withDocument ? 'id, active_variant_id, published_at, updated_at, published' : 'id, active_variant_id, published_at, updated_at'
  const { data: menuData, error } = await service.from('menus').select(columns).eq('branch_id', branchId).maybeSingle()
  // A failed READ is not "no menu": returning null here would make every line look
  // like an item that does not exist. Throw, so the caller answers 500 and the
  // device retries (the outbox keeps an order it could not send).
  if (error) {
    console.error('menus read failed:', error.code)
    throw posError('internal_error')
  }
  if (!menuData) return null
  const menu = menuData as unknown as MenuRowWithDoc

  const { data: variantData, error: variantError } = await service.from('menu_variants').select('*').eq('menu_id', menu.id)
  if (variantError) {
    console.error('menu_variants read failed:', variantError.code)
    throw posError('internal_error')
  }
  return { menu, doc: withDocument ? (menu.published ?? { categories: [] }) : null, variants: (variantData ?? []) as unknown as MenuVariant[] }
}

// NOTE on the clock: resolveVariant() reads wall-clock hours from the Date it is
// given, and on the server that is the server's zone, not the branch's. The public
// menu's server render has exactly the same behaviour, so the till agrees with the
// customer's page; a scheduled variant on an event menu would be the one case to
// revisit (the fix belongs in lib/menu/variants.ts, not here).
function stampOf(menu: MenuRow, resolved: MenuVariant | null): string {
  // The RESOLVED variant, not menus.active_variant_id: a variant whose schedule
  // window opens (or whose temporary run ends) changes what is on sale without any
  // write to `menus`, so a stamp built from active_variant_id alone would never
  // move and every device would keep an out-of-date menu until the next edit.
  // Its updated_at is included for the same reason — editing the exclusion list of
  // the variant that is live must reach the tills.
  const variantUpdated = (resolved as (MenuVariant & { updated_at?: string }) | null)?.updated_at ?? ''
  return `${menu.published_at ?? ''}|${menu.updated_at ?? ''}|${resolved?.id ?? menu.active_variant_id ?? ''}|${variantUpdated}`
}

/** The change stamp alone — one tiny read, no document. null when the branch has no menu row. */
export async function loadPosMenuStamp(branchId: string): Promise<string | null> {
  const found = await readMenu(branchId, false)
  if (!found) return null
  return stampOf(found.menu, resolveVariant(found.variants, found.menu.active_variant_id, new Date()))
}

/** The published, variant-resolved menu. null when the branch has no menu row at all
 *  (a published-but-empty menu is a real, empty PosMenu — the readiness checklist is
 *  what tells the owner nothing is published yet). */
export async function loadPosMenu(branchId: string): Promise<PosMenu | null> {
  const found = await readMenu(branchId, true)
  if (!found || !found.doc) return null
  const resolved = resolveVariant(found.variants, found.menu.active_variant_id, new Date())
  const doc = applyVariant(found.doc, resolved)
  return {
    categories: doc.categories ?? [],
    // applyVariant preserves modifierGroups (it spreads the document), so a variant
    // that hides items never also hides the groups the remaining items point at.
    modifierGroups: doc.modifierGroups ?? [],
    stamp: stampOf(found.menu, resolved),
    publishedAt: found.menu.published_at,
  }
}
