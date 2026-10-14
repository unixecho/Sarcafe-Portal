// Where the first page of an installed-app launch should be corrected to (see StandaloneLaunchGuard).
// Pure: scripts/check-checklist-window.mjs runs this very file.

const STATION_PARAMS = ['v', 'p', 'add', 'o', 'branch']
// ONE specific checklist (the link an alert opens). Same shape as isStaffChecklistPath in lib/checklists/links.ts, which
// this file cannot import (the check script transpiles it on its own); check-checklist-window.mjs compares the two.
const CHECKLIST_LINK = /^\/staff\/checklists\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** null = leave the page alone. */
export function launchRedirect(location: { pathname: string; search: string }): string | null {
  const params = new URLSearchParams(location.search)
  if (location.pathname === '/pos' && !STATION_PARAMS.some((key) => params.has(key))) return '/staff'
  if (location.pathname === '/login') {
    const next = params.get('next')
    // A sign-in that was saved as the icon's address is sent to the staff sign-in, but a deliberate link to one
    // checklist (an alert tapped after the session expired) must still return to that checklist.
    if (next && next !== '/staff' && !CHECKLIST_LINK.test(next)) return '/login?next=/staff&quick=1'
  }
  return null
}
