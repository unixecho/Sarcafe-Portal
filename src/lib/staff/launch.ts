// Where the first page of an installed-app launch should be corrected to (see StandaloneLaunchGuard).
// Pure: scripts/check-checklist-window.mjs runs this very file.

const STATION_PARAMS = ['v', 'p', 'add', 'o', 'branch']

/** null = leave the page alone. */
export function launchRedirect(location: { pathname: string; search: string }): string | null {
  const params = new URLSearchParams(location.search)
  if (location.pathname === '/pos' && !STATION_PARAMS.some((key) => params.has(key))) return '/staff'
  if (location.pathname === '/login') {
    const next = params.get('next')
    if (next && next !== '/staff') return '/login?next=/staff&quick=1'
  }
  return null
}

