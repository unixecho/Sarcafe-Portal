import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse, ApiError, NotFound } from '@/lib/http/errors'
import { getKioskSnapshot } from '@/lib/kiosk/menu'

// The kiosk tablet's menu. It does not poll this: the dashboard's own "menu changed" broadcast
// (lib/menu/realtime.ts, sent on every save / publish / availability change) tells the tablet to come and
// fetch. `?since=<version>` answers `{ unchanged: true }` when nothing the kiosk shows has changed, so a
// "save draft" ping or a repeated ping is free.
//
// Public on purpose (it is a projection of the published public menu, nothing else) and CORS-open so the
// page bundled inside the tablet app (file origin) may read it. Read-only: GET and OPTIONS only.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'no-store',
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function GET(request: NextRequest) {
  try {
    const snapshot = await getKioskSnapshot()
    if (!snapshot) throw NotFound('Menu not found.')

    const since = request.nextUrl.searchParams.get('since')
    if (since && since === snapshot.version) {
      return NextResponse.json({ unchanged: true, version: snapshot.version }, { headers: CORS })
    }
    return NextResponse.json(snapshot, { headers: CORS })
  } catch (err) {
    if (err instanceof ApiError) {
      const response = errorResponse(err)
      Object.entries(CORS).forEach(([key, value]) => response.headers.set(key, value))
      return response
    }
    console.error('Kiosk menu error:', err)
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Something went wrong.' } },
      { status: 500, headers: CORS },
    )
  }
}
