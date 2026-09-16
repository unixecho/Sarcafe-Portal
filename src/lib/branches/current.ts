// The one shared mechanism for "which branch is the owner currently looking
// at" across every /owner/* page. Before this existed, each page picked its
// own default (always branches[0]) with zero persistence, so choosing a
// branch on the dashboard had no effect on the editor, staff, or any other
// page — this file plus BranchSwitcher.tsx is the fix.
//
// No next/headers import here on purpose: server pages resolve the slug via
// resolveCurrentBranchSlug() (reading the cookie themselves through
// next/headers' cookies()), and client components write it via
// setCurrentBranchCookie() — both sides share this one constant/helper pair
// without either pulling in the other's runtime.

export const BRANCH_COOKIE = 'sarcafe_branch'

/** Picks the branch slug a page should render for: the cookie's value if it
 *  names one of the branches actually on offer (a scoped general_manager's
 *  allowed-branch filter, or a branch since deleted, both fall through
 *  safely), otherwise the first branch — the same fallback every page used
 *  before, just centralized. */
export function resolveCurrentBranchSlug(
  branches: readonly { slug: string }[],
  cookieValue: string | null | undefined
): string {
  if (cookieValue && branches.some((b) => b.slug === cookieValue)) return cookieValue
  return branches[0]?.slug ?? ''
}

/** Client-only — persists the choice so the next page navigated to (a full
 *  route, not a client-side state transition) reads the same branch. A
 *  year-long max-age because "which branch am I working on" is a standing
 *  preference, not a session-scoped one. */
export function setCurrentBranchCookie(slug: string) {
  if (typeof document === 'undefined') return
  document.cookie = `${BRANCH_COOKIE}=${encodeURIComponent(slug)}; path=/; max-age=31536000; samesite=lax`
}
