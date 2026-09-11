'use client'

import { createBrowserClient } from '@supabase/ssr'

// One client per browser tab, memoized on the module — every client
// component that needs Supabase (login, menu editor, dashboard polling)
// imports this instead of constructing its own, so there's exactly one
// realtime/auth connection per tab.
let client: ReturnType<typeof createBrowserClient> | undefined

export function createClient() {
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  }
  return client
}
