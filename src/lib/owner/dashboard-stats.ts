import { createServiceRoleClient } from '@/lib/supabase/server'

export type Stat = { known: boolean; value: number | boolean }

export type DashboardStats = {
  hasUnpublishedChanges: Stat
  outOfStockCount: Stat
  categoryCount: Stat
}

const UNKNOWN: Stat = { known: false, value: 0 }

type MenuItem = { available?: boolean }
type MenuCategory = { items?: MenuItem[] }
type MenuDoc = { categories?: MenuCategory[] }

function countItems(doc: MenuDoc | null | undefined, predicate: (item: MenuItem) => boolean): number {
  if (!doc?.categories) return 0
  return doc.categories.reduce((sum, cat) => sum + (cat.items ?? []).filter(predicate).length, 0)
}

/**
 * Reads the one branch's dashboard stats. Every read is independent and
 * never throws — a broken query drops only its own stat, the rest of the
 * dashboard still renders. `known` travels with every stat so a read
 * failure is never misreported as "nothing's happening" (AyekaBar's
 * load-bearing rule for this file, carried over exactly).
 */
export async function readDashboardStats(branchId: string): Promise<DashboardStats> {
  const [hasUnpublishedChanges, outOfStockCount, categoryCount] = await Promise.all([
    readHasUnpublishedChanges(branchId),
    readOutOfStockCount(branchId),
    readCategoryCount(branchId),
  ])

  return { hasUnpublishedChanges, outOfStockCount, categoryCount }
}

async function readHasUnpublishedChanges(branchId: string): Promise<Stat> {
  try {
    const service = createServiceRoleClient()
    const { data, error } = await service
      .from('menus')
      .select('draft, published')
      .eq('branch_id', branchId)
      .maybeSingle()
    if (error || !data) return UNKNOWN
    return { known: true, value: JSON.stringify(data.draft) !== JSON.stringify(data.published) }
  } catch {
    return UNKNOWN
  }
}

async function readOutOfStockCount(branchId: string): Promise<Stat> {
  try {
    const service = createServiceRoleClient()
    const { data, error } = await service.from('menus').select('published').eq('branch_id', branchId).maybeSingle()
    if (error || !data) return UNKNOWN
    return { known: true, value: countItems(data.published as MenuDoc, (item) => item.available === false) }
  } catch {
    return UNKNOWN
  }
}

async function readCategoryCount(branchId: string): Promise<Stat> {
  try {
    const service = createServiceRoleClient()
    const { data, error } = await service.from('menus').select('published').eq('branch_id', branchId).maybeSingle()
    if (error || !data) return UNKNOWN
    const doc = data.published as MenuDoc
    return { known: true, value: doc?.categories?.length ?? 0 }
  } catch {
    return UNKNOWN
  }
}
