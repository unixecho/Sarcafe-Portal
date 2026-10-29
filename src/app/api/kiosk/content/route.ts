import { NextResponse, type NextRequest } from 'next/server'
import { getKioskContent } from '@/lib/kiosk/content'

// The kiosk's rotating cards, timings, hours and menu highlights (what the owner sets on /owner/kiosk). The kiosk asks
// for it on start and now and then; `?since=<version>` answers `{ unchanged: true }` when nothing it shows changed.
//
// Public on purpose and CORS-open so the page bundled inside the tablet app (file origin) may read it, like
// /api/kiosk/menu. Read-only (GET and OPTIONS), pinned to the kiosk's branch, and it carries no personal data: only
// the owner's card texts, the branch's hours, published menu names and prices, and the poll's public link.
// Shape: lib/kiosk/content-project.ts KioskContent. The kiosk is coded against it; do not change it on one side only.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}
// A short shared cache: an owner's Save reaches the kiosk within about a minute, and a busy kiosk costs nothing.
const CACHED = { ...CORS, 'Cache-Control': 'public, max-age=0, s-maxage=30, stale-while-revalidate=120' }
const UNCACHED = { ...CORS, 'Cache-Control': 'no-store' }

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: UNCACHED })
}

export async function GET(request: NextRequest) {
  try {
    const content = await getKioskContent(request.nextUrl.origin)
    if (!content) {
      return NextResponse.json({ error: { code: 'not_found', message: 'Not found.' } }, { status: 404, headers: UNCACHED })
    }
    const since = request.nextUrl.searchParams.get('since')
    if (since && since === content.version) {
      return NextResponse.json({ unchanged: true, version: content.version }, { headers: CACHED })
    }
    return NextResponse.json(content, { headers: CACHED })
  } catch (err) {
    // logged here (nothing personal is read on this path), never echoed in the public answer
    console.error('Kiosk content error:', err)
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Something went wrong.' } },
      { status: 500, headers: UNCACHED },
    )
  }
}
