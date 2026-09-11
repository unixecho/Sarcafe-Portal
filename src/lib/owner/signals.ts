import { readDashboardStats } from '@/lib/owner/dashboard-stats'

export type Signal = {
  id: string
  rank: number // >=80 critical, 40-79 warning, <40 info
  icon: string
  title: string
  detail?: string
  href?: string
}

/**
 * Returns only the signals currently true, sorted by rank. Entirely absent
 * from the dashboard when nothing is true — mirrors AyekaBar's design
 * principle: a quiet night should render nothing, not a stack of
 * "everything's fine" checkmarks nobody needs to read.
 *
 * Deliberately small right now — Phase 2/3 (orders/kitchen/inventory) adds
 * real operational signals (stuck orders, low inventory, notification
 * failures). This is not the place to invent placeholder signals for
 * systems that don't exist yet.
 */
export async function readDashboardSignals(branchId: string): Promise<Signal[]> {
  const signals: Signal[] = []

  try {
    const stats = await readDashboardStats(branchId)

    if (stats.hasUnpublishedChanges.known && stats.hasUnpublishedChanges.value === true) {
      signals.push({
        id: 'menu-unpublished',
        rank: 50,
        icon: '📝',
        title: 'יש שינויים בתפריט שלא פורסמו',
        detail: 'לקוחות עדיין רואים את הגרסה הקודמת.',
        href: '/owner/editor',
      })
    }

    if (stats.outOfStockCount.known && (stats.outOfStockCount.value as number) > 0) {
      signals.push({
        id: 'menu-out-of-stock',
        rank: 60,
        icon: '📦',
        title: `${stats.outOfStockCount.value} פריטים אזלו מהמלאי`,
        href: '/owner/editor',
      })
    }
  } catch {
    // A broken read here drops the signal, never the whole dashboard.
  }

  return signals.sort((a, b) => b.rank - a.rank)
}
