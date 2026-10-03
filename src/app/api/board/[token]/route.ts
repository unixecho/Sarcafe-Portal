import { NextResponse, type NextRequest } from 'next/server'
import { ApiError } from '@/lib/http/errors'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'
import { loadBoard } from '@/lib/pos/server/board'
import { RATE } from '@/lib/pos/vocab'

// GET /api/board/[token] — the Ready board's data. PUBLIC: no session, no cookies.
//
// Trust model. The link IS the credential (an unguessable, rotatable token held in a table no
// browser can read), so this route is built to be useless to anyone without it:
//   * Rate limited per IP BEFORE anything is looked up (120/min — a TV polling every 3 s is
//     20/min, so this leaves room for a few screens behind one NAT and none for a scraper).
//     The limiter fails open, like every limiter here: it must not take the board down.
//   * Every miss — a malformed token, an unknown token — returns ONE identical 404 body, so
//     the response cannot be used to tell "close" from "nothing like it".
//   * The data is the least that works (lib/pos/server/board.ts): first names and ticket
//     numbers. No phone, no surname, no item.
//   * Nothing is cacheable: a stale board that says "ready" for an order already collected is
//     the one failure this screen cannot afford. Errors carry the header too.
//   * A database failure is a 500, NOT a 404 — a TV must show "reconnecting", not "not found".
//
// Written without apiRoute() on purpose: every response, error or not, needs the no-store
// header, which apiRoute's own error responses do not carry.

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

function fail(status: number, code: string, message: string, extra: Record<string, string> = {}) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { ...NO_STORE, ...extra } })
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  try {
    const { token } = await params

    if (!(await checkRateLimit(`pos:board:${clientIp(request)}`, RATE.boardPerMin, 60))) {
      return fail(429, 'rate_limited', 'Too many requests.', { 'Retry-After': '10' })
    }

    const board = await loadBoard(token)
    if (!board) return fail(404, 'not_found', 'Not found.')

    return NextResponse.json(board, { headers: NO_STORE })
  } catch (err) {
    if (err instanceof ApiError) return fail(err.status, err.code, err.message)
    // The token is in the URL, so it is deliberately not part of this log line.
    console.error('board request failed:', err instanceof Error ? err.message : 'unknown')
    return fail(500, 'internal_error', 'Something went wrong.')
  }
}
