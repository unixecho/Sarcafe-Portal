import { NextResponse, type NextRequest } from 'next/server'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { isOp, hasAnyMenuEditAccess, isStaff } from '@/lib/staff/access'

// Mirrors AyekaBar's auth/callback/route.ts. One important difference:
// Sarcafe's Google login is STAFF-ONLY. Unlike AyekaBar (where customers
// also sign in with Google for a loyalty club), Sarcafe's customer flow is
// intentionally account-less — a temporary order session + six-digit
// recovery code (Phase 2/3), never Google OAuth. So a Google-authenticated
// user with no `staff` row has no legitimate destination here at all.

function safeNext(raw: string | null): string | null {
  if (!raw) return null
  if (!raw.startsWith('/')) return null
  if (raw.startsWith('//')) return null
  if (raw.includes('://')) return null
  return raw
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = safeNext(searchParams.get('next'))

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth`)
  }

  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth`)
  }

  if (next) {
    return NextResponse.redirect(`${origin}${next}`)
  }

  // Idempotent — links a pre-created staff invite (keyed by email) to this
  // Google account on first sign-in. No-op if already linked or if no
  // matching invite exists.
  await supabase.rpc('claim_staff_invite')

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // `staff` has zero SELECT policies for `authenticated` on purpose — the
  // session-scoped `supabase` client above (subject to RLS) would always
  // see zero rows here, which is exactly the "no staff row -> /no-access"
  // bug this service-role read fixes.
  const { data: staffRow } = user
    ? await createServiceRoleClient()
        .from('staff')
        .select('role, badge, branch_id')
        .eq('auth_user_id', user.id)
        .eq('active', true)
        .maybeSingle()
    : { data: null }

  if (isOp(staffRow)) {
    return NextResponse.redirect(`${origin}/owner/dashboard`)
  }
  if (hasAnyMenuEditAccess(staffRow)) {
    return NextResponse.redirect(`${origin}/owner/editor`)
  }
  if (isStaff(staffRow)) {
    // A legitimate staff account without owner/menu-editor rights — Phase
    // 2/3 gives this a real kitchen/staff destination. For now there is
    // genuinely nowhere else to send them, so this is honest rather than a
    // placeholder page built just to have somewhere to land.
    return NextResponse.redirect(`${origin}/no-access`)
  }

  return NextResponse.redirect(`${origin}/no-access`)
}
