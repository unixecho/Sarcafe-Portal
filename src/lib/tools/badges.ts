import type { DashboardStats } from '@/lib/owner/dashboard-stats'

// PURE: the server (first paint) and DashboardLive (after a branch switch) build the same pills from the same numbers.
/** The pills next to tools on the home screen (the "2 בקשות" style): what is waiting where. Only true, known numbers. */
export function toolBadges(input: { stats?: DashboardStats | null; shortages?: number | null; requests?: number | null }): Record<string, string> {
  const badges: Record<string, string> = {}
  const { stats, shortages, requests } = input
  if (requests) { badges['schedule-manage'] = `${requests} בקשות`; badges['approve-swap'] = `${requests} בקשות` }
  if (shortages) badges.issues = `${shortages} לטיפול`
  if (stats?.outOfStockCount.known && Number(stats.outOfStockCount.value) > 0) {
    const n = Number(stats.outOfStockCount.value)
    badges['tablet-avail'] = `${n} אזלו`
    badges['mark-soldout'] = `${n} אזלו`
  }
  if (stats?.hasUnpublishedChanges.known && stats.hasUnpublishedChanges.value) { badges['menu-editor'] = 'טיוטה'; badges['publish-menu'] = 'טיוטה' }
  return badges
}
