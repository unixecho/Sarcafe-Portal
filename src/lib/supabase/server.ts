import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient as createSupabaseJsClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

// Request-scoped Supabase client for Server Components, Route Handlers, and
// the middleware. Reads the caller's session from cookies (set during the
// OAuth callback) so every server-side read respects that user's RLS
// policies. NEVER use this for privileged writes that must bypass RLS
// (menu-variant publishing under a general_manager's own session is fine;
// anything gated by requireOwner()/requireMenuEditor() should use
// createServiceRoleClient() below instead).
export async function createServerSupabaseClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a Server Component (not a Route Handler/action) —
            // the response cookies can't be written here. Harmless as long
            // as middleware is also refreshing the session on every
            // request, which it does.
          }
        },
      },
    }
  )
}

// Service-role client: bypasses RLS entirely. Only ever call this from
// server-side code AFTER an explicit requireOwner()/requireMenuEditor()/
// requireStaff() check has already resolved the caller's real permissions —
// this client has no concept of "who is asking," so the guard is what makes
// every write it performs safe. Never import this into a Client Component;
// the service-role key must never reach the browser.
export function createServiceRoleClient() {
  return createSupabaseJsClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
