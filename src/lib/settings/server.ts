import { SETTINGS_TAG, CUSTOMER_FEEDBACK_ENABLED_KEY, DEFAULT_CUSTOMER_FEEDBACK_ENABLED } from '@/lib/settings/keys'

/**
 * Reads one app_settings row via the Supabase REST endpoint directly
 * (not supabase-js) so the response lands in Next's data cache — pages
 * don't pay a per-request round trip, and the owner API busts the
 * `app-settings` tag on every write so a toggle is visible immediately.
 * Mirrors AyekaBar's lib/settings/server.ts exactly.
 *
 * Any failure (missing env, network, no row) returns the caller-supplied
 * default — a settings outage must never take the site down.
 */
export async function readSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/app_settings?key=eq.${encodeURIComponent(key)}&select=value`
    const res = await fetch(url, {
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
      },
      next: { revalidate: 60, tags: [SETTINGS_TAG] },
    })
    if (!res.ok) return fallback

    const rows = (await res.json()) as Array<{ value: unknown }>
    const row = rows[0]
    if (!row) return fallback

    // Merge-over-defaults: a partial stored blob (e.g. before a new sub-key
    // shipped) never loses the new key's default.
    if (typeof fallback === 'object' && fallback !== null && !Array.isArray(fallback)) {
      return { ...fallback, ...(row.value as object) } as T
    }
    return row.value as T
  } catch {
    return fallback
  }
}

export async function getCustomerFeedbackEnabled(): Promise<boolean> {
  return readSetting(CUSTOMER_FEEDBACK_ENABLED_KEY, DEFAULT_CUSTOMER_FEEDBACK_ENABLED)
}
