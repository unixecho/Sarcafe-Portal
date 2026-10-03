import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient as createSupabaseJsClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { isOp, isStaff, hasAnyMenuEditAccess } from '@/lib/staff/access'
import { jwtSessionId } from '@/lib/pos/quick-jwt'

// Mirrors AyekaBar's src/middleware.ts, minus the loyalty-club gate and the
// floor/shift-scheduling prefixes — Sarcafe has none of those systems.
// Everything else (single Google-only login door, authenticate-then-
// authorize as two separate gates, deny-to-/no-access rather than bouncing
// back to /login once already signed in) is the same shape on purpose.

// /owner/audit, /owner/tablet, /owner/links and /owner/reviews are gated
// the same as the editor (menu-edit access, not owner-only) — whoever can
// edit a branch's menu can also see its change history, toggle its live
// availability, and fix its portal links/reviews, same reasoning the
// page/API routes apply again server-side.
//
// /owner/pos (the POS manager side: event hub, selling-point setup, every order,
// statistics, the audit log) is gated the same way — "manager" for the POS means
// exactly "can edit this branch's menu": the owner, or a general manager scoped to
// the branch, so the on-site manager can run an event without full owner rights.
// Staff management and branch creation stay OP-only. The per-branch decision is
// requirePosManager() on each page/route; this prefix is only the coarse first gate.
const MENU_EDITOR_PREFIXES = [
  '/owner/editor',
  '/owner/audit',
  '/owner/tablet',
  '/owner/links',
  '/owner/reviews',
  '/owner/pos',
]
// /owner/feedback is owner-only, not menu-edit-scoped — unsolicited public
// correspondence, sometimes with a contact address attached, and being
// trusted with the menu has never implied being handed that.
const OP_ONLY_PREFIXES = ['/owner/dashboard', '/owner/staff', '/owner/accessibility', '/owner/feedback']
// /owner/schedule and /staff/* are gated by isStaff() only — a delegated
// schedule manager can be any active staff member (badge might just be
// "barista"), so neither the editor nor the op-only check applies here.
// The real per-branch "can this person actually manage a schedule" check
// happens inside the page itself (see src/app/owner/schedule/page.tsx),
// same division of labor the editor/op checks already use elsewhere.
//
// /pos (the point-of-sale app: register, selling-point screens, orders) is the same
// story: any active staff member may reach it, and the real checks — may they work
// THIS branch, is the POS switched on there, have they confirmed a nickname — are
// requirePosStaff() on every /api/pos route and in the page's own server entry.
// Deliberately NOT listed anywhere in this file: /board/[token] (the public Ready
// board, whose credential is its link) and /api/* (every route guards itself — the
// matcher below lets /api through and the PROTECTED_ROUTES check never matches it).
const STAFF_ONLY_PREFIXES = ['/owner/schedule', '/staff', '/pos']

const PROTECTED_ROUTES = [...MENU_EDITOR_PREFIXES, ...OP_ONLY_PREFIXES, ...STAFF_ONLY_PREFIXES]

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

  const editorProtected = matchesAny(pathname, MENU_EDITOR_PREFIXES)
  const opProtected = matchesAny(pathname, OP_ONLY_PREFIXES)
  const staffProtected = matchesAny(pathname, STAFF_ONLY_PREFIXES)

  if (matchesAny(pathname, PROTECTED_ROUTES) && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    // Carry the destination through the door for the POS only (a phone opening /pos
    // should come back to /pos after Google). Owner paths keep the bare /login. The
    // value is a constant, never request data, so it cannot be an open redirect.
    if (matchesAny(pathname, ['/pos'])) url.searchParams.set('next', '/pos')
    return NextResponse.redirect(url)
  }

  // A quick-login session (employee number + passcode, migration 022) is floor work
  // only — never an /owner page, whatever the person's role. Looked up only for owner
  // paths so every floor request stays as cheap as it was. Fails CLOSED: a lookup
  // error sends the visitor to /pos rather than letting a possibly-weak session in.
  if (user && (pathname === '/owner' || pathname.startsWith('/owner/'))) {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const sessionId = jwtSessionId(session?.access_token)
    let quick = false
    if (sessionId) {
      const lookup = await createSupabaseJsClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      )
        .from('pos_quick_sessions')
        .select('session_id')
        .eq('session_id', sessionId)
        .maybeSingle()
      quick = lookup.error !== null || lookup.data !== null
    }
    if (quick) {
      const url = request.nextUrl.clone()
      url.pathname = '/pos'
      url.search = ''
      return NextResponse.redirect(url)
    }
  }

  if (user && (editorProtected || opProtected || staffProtected)) {
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
    // staffProtected needs nothing beyond the isStaff() check already
    // folded into `denied` above — no additional badge/role requirement.

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
