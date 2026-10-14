import StaffChecklistsPageBody from '@/components/checklists/StaffChecklistsPageBody'

export const dynamic = 'force-dynamic'

export default async function StaffChecklistsPage({ searchParams }: { searchParams: Promise<{ branch?: string | string[] }> }) {
  // The older "?open=<id>&branch=<slug>" links still work: the workspace reads ?open itself, the branch comes from here.
  const wanted = (await searchParams).branch
  return <StaffChecklistsPageBody requestedBranch={typeof wanted === 'string' ? wanted : undefined} />
}
