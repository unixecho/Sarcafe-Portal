import { createClient } from '@/lib/supabase/client'
import { resolveVariant, applyVariant } from '@/lib/menu/variants'
import type { MenuDoc, MenuVariant, PublicMenu } from '@/lib/menu/types'
import type { ResolvedMenu } from '@/lib/menu/fetch'

/** Client-side twin of lib/menu/fetch.ts's fetchMenu() — used for polling
 * on the public menu page and for the owner editor's own reads. */
export async function fetchMenuClient(branchSlug: string): Promise<ResolvedMenu | null> {
  const supabase = createClient()

  const { data: menu, error } = await supabase
    .from('public_menus')
    .select('id, slug, name, published, active_variant_id, published_at')
    .eq('slug', branchSlug)
    .maybeSingle<PublicMenu & { id: string }>()

  if (error || !menu) return null

  const { data: variantRows } = await supabase.from('public_menu_variants').select('*').eq('menu_id', menu.id)

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

/** Just the published_at stamp — cheap enough to poll frequently to decide
 * whether a full refetch is warranted. */
export async function fetchPublishedAt(branchSlug: string): Promise<string | null> {
  const supabase = createClient()
  const { data } = await supabase.from('public_menus').select('published_at').eq('slug', branchSlug).maybeSingle()
  return data?.published_at ?? null
}
