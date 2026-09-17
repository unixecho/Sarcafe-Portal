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

// The dashboard's "which branch?" confirmation prompt (DashboardLive.tsx)
// — sessionStorage rather than the cookie above on purpose: this is
// "confirm once per login," not a standing preference, and sessionStorage
// clears itself when the tab/browser closes. SignOutButton also clears it
// explicitly on sign-out, so the NEXT person to sign in in the same tab
// (a shared device) gets prompted again rather than inheriting whoever
// signed in before them confirming it.
const DASHBOARD_BRANCH_CONFIRMED_KEY = 'sarcafe:dashboard-branch-confirmed'

export function isDashboardBranchConfirmed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.sessionStorage.getItem(DASHBOARD_BRANCH_CONFIRMED_KEY) === '1'
  } catch {
    return false
  }
}

export function setDashboardBranchConfirmed() {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(DASHBOARD_BRANCH_CONFIRMED_KEY, '1')
  } catch {
    // Private browsing / quota — worst case, prompts again next visit.
  }
}

export function clearDashboardBranchConfirmed() {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(DASHBOARD_BRANCH_CONFIRMED_KEY)
  } catch {
    // Nothing to do — same non-fatal posture as the setter above.
  }
}
