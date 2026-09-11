import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient as createSupabaseJsClient } from '@supabase/supabase-js'
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

  const { pathname, searchParams } = request.nextUrl

  // Defensive: Supabase should redirect the OAuth callback to
  // `redirectTo` (`/auth/callback`) — confirmed correct at the request
  // level (the `redirect_to` sent to Google/Supabase is right) — but has
  // intermittently landed the browser on bare `/` with the `code` still
  // attached instead, which strands the code (nothing on `/` exchanges
  // it). Whatever the cause upstream, forward it server-side rather than
  // let the code go to waste on every request, not just this app's own
  // navigations.
  if (pathname === '/' && searchParams.has('code')) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/callback'
    return NextResponse.redirect(url)
  }

  const editorProtected = matchesAny(pathname, [MENU_EDITOR_PREFIX])
  const opProtected = matchesAny(pathname, OP_ONLY_PREFIXES)

  if (matchesAny(pathname, PROTECTED_ROUTES) && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    return NextResponse.redirect(url)
  }

  if (user && (editorProtected || opProtected)) {
    // `staff` has zero SELECT policies for `authenticated` on purpose — a
    // staff member shouldn't be able to read their own role/badge directly
    // and reason about privilege escalation client-side. That means the
    // session-scoped `supabase` client above (subject to RLS) would always
    // see zero rows here; this check needs the service-role client, which
    // bypasses RLS, same as owner/guard.ts and staff/guard.ts.
    const service = createSupabaseJsClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const { data: staffRow } = await service
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
