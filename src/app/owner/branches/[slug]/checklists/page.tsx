import { redirect } from 'next/navigation'
import { branchChecklistBuilderPath } from '@/lib/checklists/links'

// The bare address opens the first form. /owner/branches/<slug>/checklists/<kind> is the builder itself.
export default async function BranchChecklistsIndex({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  redirect(/^[a-z0-9-]+$/.test(slug) ? branchChecklistBuilderPath(slug, 'opening') : '/owner/branches')
}
