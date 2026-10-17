import 'server-only'

import { cookies } from 'next/headers'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { NUDGE_COOKIE, THEME_COOKIE, resolveTheme, type StaffTheme } from '@/lib/staff/theme'

// Reads and writes a person's look. TOLERANT ON PURPOSE, like gate-state.ts: `staff.ui_theme` is an extra column (migration
// 20261017120000); until it exists, or if the read fails, the device's cookie decides and then the default. A failed read must never
// be the reason a page does not open. The cookie is also what makes the choice instant on THIS device.

export async function loadStaffTheme(staffId: string | null | undefined): Promise<{ theme: StaffTheme; chosen: boolean; nudgeSeen: boolean }> {
  let db: unknown = null
  if (staffId) {
    try {
      const { data, error } = await createServiceRoleClient().from('staff').select('ui_theme').eq('id', staffId).maybeSingle()
      if (!error && data) db = (data as { ui_theme?: unknown }).ui_theme
    } catch { /* the cookie and the default still answer */ }
  }
  let cookie: unknown = null
  let nudgeSeen = false
  try {
    const jar = await cookies()
    cookie = jar.get(THEME_COOKIE)?.value
    nudgeSeen = jar.get(NUDGE_COOKIE)?.value === '1'
  } catch { /* no request scope (a build): default */ }
  return { ...resolveTheme(db, cookie), nudgeSeen }
}

/** Saves the choice on the person's row. Returns false when the database refused (the column may not exist yet): the caller still
 *  sets the cookie, so the look changes on this device either way. */
export async function saveStaffTheme(staffId: string, theme: StaffTheme): Promise<boolean> {
  try {
    const { error } = await createServiceRoleClient().from('staff').update({ ui_theme: theme }).eq('id', staffId)
    return !error
  } catch {
    return false
  }
}
