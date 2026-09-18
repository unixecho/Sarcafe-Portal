import { notFound } from 'next/navigation'
import { fetchMenu } from '@/lib/menu/fetch'
import MenuView from '@/components/MenuView'
import { getBranchBySlug } from '@/lib/branches/server'
import { getCustomerFeedbackEnabled, getMenuCartEnabled } from '@/lib/settings/server'
import type { BranchSlug } from '@/lib/branches'

// Deliberately NOT paired with generateStaticParams: Next.js prerenders
// any route generateStaticParams lists at BUILD time regardless of this
// `dynamic` export, which would bake in whatever menu state existed during
// the build — permanently, until the next deploy — the opposite of "the
// owner may publish mid-service." Every request must hit fetchMenu() live.
export const dynamic = 'force-dynamic'

export default async function PublicMenuPage({ params }: { params: Promise<{ branch: string }> }) {
  const { branch } = await params
  const branchRow = await getBranchBySlug(branch)
  if (!branchRow) notFound()

  const menu = await fetchMenu(branch)
  if (!menu) notFound()

  const [feedbackEnabled, cartEnabled] = await Promise.all([getCustomerFeedbackEnabled(), getMenuCartEnabled()])

  return (
    <MenuView
      branchSlug={branch as BranchSlug}
      initial={menu}
      feedbackEnabled={feedbackEnabled}
      cartEnabled={cartEnabled}
      hoursToday={branchRow.hoursToday}
      openNow={branchRow.openNow}
    />
  )
}
