import {
  SETTINGS_TAG,
  CUSTOMER_FEEDBACK_ENABLED_KEY,
  DEFAULT_CUSTOMER_FEEDBACK_ENABLED,
  DEFAULT_MENU_CART_ENABLED,
  INTRO_ENABLED_KEY,
  DEFAULT_INTRO_ENABLED,
} from '@/lib/settings/keys'
import { normalizeIntroEnabled } from '@/lib/intro/config'

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

/** Wires up the `menu_cart_enabled` row that's existed since migration 002
 *  as a stub for exactly this feature — nothing read it until now. */
export async function getMenuCartEnabled(): Promise<boolean> {
  return readSetting('menu_cart_enabled', DEFAULT_MENU_CART_ENABLED)
}

/** Does the portal play its intro? Read by the root layout on EVERY page render
 *  (through components/intro/IntroGate, which also time-boxes it), so it must
 *  stay cheap: it is the same tagged, cached fetch as every other switch here.
 *  See INTRO_ENABLED_KEY for why it defaults to ON and fails open. */
export async function getIntroEnabled(): Promise<boolean> {
  return normalizeIntroEnabled(await readSetting<unknown>(INTRO_ENABLED_KEY, DEFAULT_INTRO_ENABLED))
}
