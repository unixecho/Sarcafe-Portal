// One stable, distinct colour per branch, for the places that show several branches side by side (the
// owner's shift tracker). Client-safe: no server imports. The colour follows the branch's place in the
// alphabetical slug list, so it does not jump when the owner reorders branches.

const BRANCH_PALETTE = ['#38bdf8', '#a78bfa', '#2dd4bf', '#facc15', '#f472b6', '#4ade80', '#fb923c', '#f87171'] as const

export function branchColor(slug: string, branches: ReadonlyArray<{ slug: string }>): string {
  const slugs = [...new Set(branches.map((branch) => branch.slug))].sort()
  const index = slugs.indexOf(slug)
  return BRANCH_PALETTE[(index < 0 ? slugs.length : index) % BRANCH_PALETTE.length]!
}
