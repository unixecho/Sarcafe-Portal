import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { isOp, isStaff, hasAnyMenuEditAccess } from '@/lib/staff/access'

// Mirrors AyekaBar's src/middleware.ts, minus the loyalty-club gate and the
// floor/shift-scheduling prefixes — Sarcafe has none of those systems.
// Everything else (single Google-only login door, authenticate-then-
// authorize as two separate gates, deny-to-/no-access rather than bouncing
// back to /login once already signed in) is the same shape on purpose.

const MENU_EDITOR_PREFIX = '/owner/editor'
const OP_ONLY_PREFIXES = ['/owner/dashboard', '/owner/staff', '/owner/accessibility']

const PROTECTED_ROUTES = [MENU_EDITOR_PREFIX, ...OP_ONLY_PREFIXES]

function matchesAny(pathname: string, prefixes: string[]) {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    }
  )

  // Also refreshes the session cookie as a side effect — required on every
  // request, not just protected ones, or sessions silently expire early.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const editorProtected = matchesAny(pathname, [MENU_EDITOR_PREFIX])
  const opProtected = matchesAny(pathname, OP_ONLY_PREFIXES)

  if (matchesAny(pathname, PROTECTED_ROUTES) && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    return NextResponse.redirect(url)
  }

  if (user && (editorProtected || opProtected)) {
    const { data: staffRow } = await supabase
      .from('staff')
      .select('role, badge, branch_id')
      .eq('auth_user_id', user.id)
      .eq('active', true)
      .maybeSingle()

    const denied =
      !isStaff(staffRow) ||
      (editorProtected && !hasAnyMenuEditAccess(staffRow)) ||
      (opProtected && !isOp(staffRow))

    if (denied) {
      const url = request.nextUrl.clone()
      url.pathname = '/no-access'
      url.search = ''
      return NextResponse.redirect(url)
    }
  }

  return response
}

export const config = {
  matcher: [
    // Skip static assets, images, and favicon — same exclusion list as
    // AyekaBar's, so this never runs (and never re-authenticates) on every
    // logo/background image request.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
