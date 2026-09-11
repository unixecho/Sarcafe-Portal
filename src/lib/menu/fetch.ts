import { createServerSupabaseClient } from '@/lib/supabase/server'
import { resolveVariant, applyVariant } from '@/lib/menu/variants'
import type { MenuDoc, MenuVariant, PublicMenu } from '@/lib/menu/types'

export type ResolvedMenu = {
  name: PublicMenu['name']
  categories: MenuDoc['categories']
  publishedAt: string | null
  activeVariant: MenuVariant | null
  isDefaultVariant: boolean
}

/**
 * Server-side read for the public /menu/[branch] page. Reads the
 * public-safe views only (never draft/owner columns) — anon-granted, no
 * auth required. Resolves which variant is live and applies its exclusion
 * list before returning, so first paint is already correctly filtered.
 */
export async function fetchMenu(branchSlug: string): Promise<ResolvedMenu | null> {
  const supabase = await createServerSupabaseClient()

  const { data: menu, error: menuError } = await supabase
    .from('public_menus')
    .select('id, slug, name, published, active_variant_id, published_at')
    .eq('slug', branchSlug)
    .maybeSingle()

  if (menuError || !menu) return null

  const { data: variantRows } = await supabase
    .from('public_menu_variants')
    .select('*')
    .eq('menu_id', menu.id)

  const variants = (variantRows ?? []) as MenuVariant[]
  const activeVariant = resolveVariant(variants, menu.active_variant_id, new Date())
  const filtered = applyVariant(menu.published as MenuDoc, activeVariant)

  return {
    name: menu.name,
    categories: filtered.categories ?? [],
    publishedAt: menu.published_at,
    activeVariant,
    isDefaultVariant: !activeVariant || activeVariant.is_default,
  }
}
