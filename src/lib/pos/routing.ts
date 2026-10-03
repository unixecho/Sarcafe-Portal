// Which selling point makes an item. Pure.
//
// Precedence (most specific wins; one confirmed map, deliberately independent of
// how the cashier BROWSES the menu — Ayeka routed `celebration` to the kitchen by
// mistake and a cook saw a ₪750 bottle on their screen):
//
//   1. an item-level route               -> that point
//   2. the owner marked the item unsold  -> unsold
//   3. a category-level route -> point P:
//        - the item is in P.excluded_uids -> excluded   (P opted it out)
//        - otherwise                      -> P
//   4. the owner marked the category unsold -> unsold
//   5. otherwise                            -> unrouted    (nobody makes it)
//
// Only `point` is sellable. `unrouted` is a CONFIGURATION GAP the dashboard
// flags; `unsold` / `excluded` are deliberate and are never flagged.

import type { PosPoint, PosRoute, RouteResult } from './types'
import type { MenuCategory, MenuItem } from '@/lib/menu/types'

export type RoutingContext = {
  points: Pick<PosPoint, 'id' | 'active' | 'excluded_uids'>[]
  routes: Pick<PosRoute, 'kind' | 'ref' | 'point_id'>[]
  /** pos_branch_settings.unsold_refs — 'c:<categoryId>' / 'i:<itemUid>' */
  unsold: string[]
}

export function resolveRoute(ctx: RoutingContext, categoryId: string | null, itemUid: string | null): RouteResult {
  const activePoint = (id: string) => ctx.points.find((p) => p.id === id && p.active)

  if (itemUid) {
    const r = ctx.routes.find((x) => x.kind === 'item' && x.ref === itemUid)
    if (r) return activePoint(r.point_id) ? { kind: 'point', pointId: r.point_id } : { kind: 'unrouted' }
    if (ctx.unsold.includes(`i:${itemUid}`)) return { kind: 'unsold' }
  }
  if (categoryId) {
    const r = ctx.routes.find((x) => x.kind === 'category' && x.ref === categoryId)
    if (r) {
      const p = activePoint(r.point_id)
      if (!p) return { kind: 'unrouted' }
      if (itemUid && p.excluded_uids.includes(itemUid)) return { kind: 'excluded' }
      return { kind: 'point', pointId: p.id }
    }
    if (ctx.unsold.includes(`c:${categoryId}`)) return { kind: 'unsold' }
  }
  return { kind: 'unrouted' }
}

export type RoutedItem = { category: MenuCategory; item: MenuItem; route: RouteResult }

/** Every item with where it goes. Items without a uid are skipped (they cannot be ordered). */
export function routeMenu(ctx: RoutingContext, categories: MenuCategory[]): RoutedItem[] {
  const out: RoutedItem[] = []
  for (const category of categories) {
    for (const item of category.items) {
      if (!item.uid) continue
      out.push({ category, item, route: resolveRoute(ctx, category.id, item.uid) })
    }
  }
  return out
}

/** Items a customer could ask for that NO point makes — the owner's to-do list. */
export function unroutedItems(ctx: RoutingContext, categories: MenuCategory[]): RoutedItem[] {
  return routeMenu(ctx, categories).filter((r) => r.route.kind === 'unrouted')
}

export type PointSummary = {
  pointId: string
  /** categories claimed whole (minus exclusions) */
  categories: MenuCategory[]
  /** every item this point makes, however it got there */
  items: MenuItem[]
}

/** What a point makes — drives the wizard's "N items" counts and its review sentence. */
export function summarizePoint(ctx: RoutingContext, categories: MenuCategory[], pointId: string): PointSummary {
  const items: MenuItem[] = []
  const cats = new Set<string>()
  for (const r of routeMenu(ctx, categories)) {
    if (r.route.kind === 'point' && r.route.pointId === pointId) {
      items.push(r.item)
      const claimed = ctx.routes.some((x) => x.kind === 'category' && x.ref === r.category.id && x.point_id === pointId)
      if (claimed) cats.add(r.category.id)
    }
  }
  return { pointId, categories: categories.filter((c) => cats.has(c.id)), items }
}

/** Who owns each category right now — the wizard's "already sold at …" badges. */
export function categoryOwners(ctx: RoutingContext): Map<string, string> {
  const m = new Map<string, string>()
  for (const r of ctx.routes) if (r.kind === 'category') m.set(r.ref, r.point_id)
  return m
}
export function itemOwners(ctx: RoutingContext): Map<string, string> {
  const m = new Map<string, string>()
  for (const r of ctx.routes) if (r.kind === 'item') m.set(r.ref, r.point_id)
  return m
}
