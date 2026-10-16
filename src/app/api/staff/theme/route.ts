import { NextResponse, type NextRequest } from 'next/server'
import { BadRequest, Forbidden } from '@/lib/http/errors'
import { privateStaffRoute } from '@/lib/staff/records'
import { resolveStaffIdentity } from '@/lib/staff/session'
import { saveStaffTheme } from '@/lib/staff/theme-server'
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE, parseTheme } from '@/lib/staff/theme'

// The person's own look (the onboarding wizard's "style" step and the profile's "מראה האפליקציה"). It edits ONLY the row of whoever
// the session says they are, and only `ui_theme`; a code sign-in is enough. The look is also kept in a plain cookie so it changes at
// once on this device, and survives if the column is not in the database yet.
export const POST = privateStaffRoute(async (request: NextRequest) => {
  const staff = await resolveStaffIdentity()
  if (!staff) throw Forbidden('צריך להתחבר כדי לבחור סגנון.')
  const body = (await request.json().catch(() => null)) as { theme?: unknown } | null
  const theme = parseTheme(body?.theme)
  if (!theme) throw BadRequest('הסגנון שנבחר לא קיים.')
  const saved = await saveStaffTheme(staff.id, theme)
  const response = NextResponse.json({ ok: true, theme, saved })
  response.cookies.set(THEME_COOKIE, theme, { path: '/', maxAge: THEME_COOKIE_MAX_AGE, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' })
  return response
})
