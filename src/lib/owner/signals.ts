import { readDashboardStats } from '@/lib/owner/dashboard-stats'
import { createServiceRoleClient } from '@/lib/supabase/server'

export type Signal = {
  id: string
  rank: number // >=80 critical, 40-79 warning, <40 info
  icon: string
  title: string
  detail?: string
  href?: string
  /** True when `detail` can run long (a customer's own written message,
   *  not a fixed-shape line the app itself composed) — DashboardLive
   *  renders these collapsed-by-default with a toggle instead of the
   *  plain always-visible detail line the other signals use. */
  expandable?: boolean
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

  try {
    const feedback = await readNewFeedback(branchId)
    if (feedback.count > 0) {
      // Bottom of the stack, same reasoning Ayeka's own feedback signal
      // documents: every other row describes something happening on the
      // floor right now, and a message that will still be there tomorrow
      // must not be allowed to look urgent.
      signals.push({
        id: 'feedback-new',
        rank: 15,
        icon: '💬',
        title: feedback.count === 1 ? 'הודעת משוב חדשה אחת' : `${feedback.count} הודעות משוב חדשות`,
        // The most recent message itself, not just the count — a customer's
        // own written text, so it can run long; DashboardLive collapses it
        // behind a toggle (expandable: true) rather than showing it in full
        // unconditionally the way the other signals' short, app-composed
        // detail lines do.
        detail: feedback.latestMessage ?? undefined,
        expandable: true,
        href: '/owner/feedback',
      })
    }
  } catch {
    // Same posture as every other read here — drop only this signal.
  }

  return signals.sort((a, b) => b.rank - a.rank)
}

async function readNewFeedback(branchId: string): Promise<{ count: number; latestMessage: string | null }> {
  const service = createServiceRoleClient()
  const { data: branch } = await service.from('branches').select('slug').eq('id', branchId).maybeSingle()
  if (!branch) return { count: 0, latestMessage: null }

  const [{ count }, { data: latest }] = await Promise.all([
    service.from('customer_feedback').select('id', { count: 'exact', head: true }).eq('branch_slug', branch.slug).eq('status', 'new'),
    service
      .from('customer_feedback')
      .select('message')
      .eq('branch_slug', branch.slug)
      .eq('status', 'new')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  return { count: count ?? 0, latestMessage: latest?.message ?? null }
}
