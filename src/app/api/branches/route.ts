import { NextResponse } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { getBranches } from '@/lib/branches/server'

// Public, unauthenticated — branches are public-read data (the portal's
// branch picker, the digital menu's branch check). Replaces the old
// hardcoded BRANCHES/PORTAL_BRANCHES constants for every Client Component
// that used to import them directly.
//
// EVENT branches (the POS's one-off stalls) are never listed here: this is the
// list a stranger can read, and an event is not advertised to the public. The
// exclusion is already getBranches()'s default; it is spelled out so nobody
// "fixes" this call to match the owner pages (which pass includeEvents: true).
export const GET = apiRoute(async () => {
  const branches = await getBranches({ includeEvents: false })
  return NextResponse.json({ branches })
})
