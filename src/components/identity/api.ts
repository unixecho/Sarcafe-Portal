// How the identity screens talk to their API routes: one fetch, one way to turn a refusal into words. Browser-safe (no secrets).

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string; message?: string }

export async function identityApi<T>(url: string, init?: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown }): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, {
      method: init?.method ?? 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: init?.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    })
    const data = (await response.json().catch(() => null)) as (T & { error?: { code?: string; message?: string } }) | null
    if (response.ok && data) return { ok: true, data }
    return { ok: false, status: response.status, code: data?.error?.code ?? '', message: data?.error?.message }
  } catch {
    return { ok: false, status: 0, code: 'offline' }
  }
}

/** A photo, sent as the raw file (FABLE-003). The server checks and re-encodes it; its refusal says why in plain words (`message`). */
export async function uploadPhoto(url: string, file: File): Promise<ApiResult<{ photoId: string; width: number; height: number }>> {
  try {
    const response = await fetch(url, { method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: { 'content-type': file.type || 'application/octet-stream' }, body: file })
    const data = (await response.json().catch(() => null)) as ({ photoId: string; width: number; height: number } & { error?: { code?: string; message?: string } }) | null
    if (response.ok && data?.photoId) return { ok: true, data }
    return { ok: false, status: response.status, code: data?.error?.code ?? '', message: data?.error?.message }
  } catch {
    return { ok: false, status: 0, code: 'offline' }
  }
}

/** What to tell the person. A refusal never says whether the thing exists: 403 is one sentence for all of it. */
export function refusalText(result: { status: number; code: string }): string {
  if (result.status === 0) return 'אין חיבור כרגע. בדקו את הרשת ונסו שוב.'
  if (result.status === 401) return 'ההתחברות פגה. התחברו מחדש.'
  if (result.code === 'self_invite') return 'אי אפשר להזמין את עצמכם.'
  if (result.code === 'conflict') return 'השם הזה כבר קיים, או שהפעולה כבר בוצעה.'
  if (result.code === 'limit') return 'הגעתם למספר המרבי.'
  if (result.code === 'stale') return 'הפרטים השתנו מאז שנפתח המסך. טענו מחדש ונסו שוב.'
  if (result.code === 'closed') return 'ההרשמה עדיין לא נפתחה.'
  if (result.code === 'registration_unavailable') return 'הקישור אינו זמין. בקשו קישור חדש ממי ששלח לכם אותו.'
  if (result.status === 400) return 'הפרטים שהוזנו אינם תקינים.'
  if (result.status === 403) return 'אין לכם הרשאה לפעולה הזו.'
  if (result.status === 429) return 'יותר מדי ניסיונות. נסו שוב מאוחר יותר.'
  if (result.status === 503) return 'הניהול אינו זמין כרגע. נסו שוב בעוד רגע.'
  return 'משהו השתבש. נסו שוב.'
}

const WHEN = new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' })
/** A date and time for a Hebrew sentence (wrap it in <bdi dir="ltr">). */
export const when = (iso: string): string => {
  const at = Date.parse(iso)
  return Number.isFinite(at) ? WHEN.format(at) : ''
}
