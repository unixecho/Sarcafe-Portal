import { messageOf } from '@/components/staff/types'
import type { StaffTheme } from '@/lib/staff/theme'

/** Saves the person's look (POST /api/staff/theme). Never throws: the picker already changed the screen, this only makes it stick. */
export async function saveTheme(theme: StaffTheme): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const response = await fetch('/api/staff/theme', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme }) })
    const payload = await response.json().catch(() => null)
    if (!response.ok) return { ok: false, message: messageOf(payload, 'לא הצלחנו לשמור את הסגנון. נסו שוב.') }
    return { ok: true }
  } catch {
    return { ok: false, message: 'בעיית חיבור. הסגנון לא נשמר, נסו שוב.' }
  }
}
