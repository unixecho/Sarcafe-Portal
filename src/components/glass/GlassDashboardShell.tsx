import { cookies } from 'next/headers'
import type { ReactNode } from 'react'
import { getBranches } from '@/lib/branches/server'
import { BRANCH_COOKIE, resolveCurrentBranchSlug } from '@/lib/branches/current'
import GlassPage from './GlassPage'
import GlassTopBar, { type TopBarAccount } from './GlassTopBar'
import GlassDock, { type DockKind } from './GlassDock'
import { GlassBranchProvider } from './BranchContext'

// Every glass home screen is put together here: backdrop → (branch provider) → top bar → content → dock.
// `branchSwitch`: the person manages several branches (an owner): the top bar shows the switch and everything below follows it.
export default async function GlassDashboardShell({ title, dock, home, account, branchSwitch = false, branchSlug, children }: {
  title: string; dock: DockKind; home: string; account: TopBarAccount; branchSwitch?: boolean; branchSlug?: string | null; children: ReactNode
}) {
  const body = (
    <>
      <GlassTopBar title={title} account={account} />
      <main id="main" tabIndex={-1} className="gl-main">{children}</main>
      <GlassDock kind={dock} home={home} />
    </>
  )
  if (!branchSwitch) return <GlassPage branchSlug={branchSlug}>{body}</GlassPage>
  const branches = await getBranches()
  const current = resolveCurrentBranchSlug(branches, (await cookies()).get(BRANCH_COOKIE)?.value)
  // The provider wraps the whole page, backdrop included, so the photo follows the branch switch too.
  return (
    <GlassBranchProvider branches={branches.map((b) => ({ slug: b.slug, name: b.name.he }))} initial={current}>
      <GlassPage branchSlug={current}>{body}</GlassPage>
    </GlassBranchProvider>
  )
}
