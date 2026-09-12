import { NextResponse } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { getBranches } from '@/lib/branches/server'

// Public, unauthenticated — branches are public-read data (the portal's
// branch picker, the digital menu's branch check). Replaces the old
// hardcoded BRANCHES/PORTAL_BRANCHES constants for every Client Component
// that used to import them directly.
export const GET = apiRoute(async () => {
  const branches = await getBranches()
  return NextResponse.json({ branches })
})
