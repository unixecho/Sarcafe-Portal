// Reads the `session_id` claim out of a Supabase access token. Pure and edge-safe
// (atob, no Buffer, no next/headers) because the middleware needs it too.
//
// This does NOT verify the token — it must only ever be called on a token whose
// user was just validated by auth.getUser() (which asks GoTrue). The claim is then
// used purely as a lookup key into pos_quick_sessions.

export function jwtSessionId(accessToken: string | null | undefined): string | null {
  if (!accessToken) return null
  const seg = accessToken.split('.')[1]
  if (!seg) return null
  try {
    const b64 = seg.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const payload = JSON.parse(atob(padded)) as { session_id?: unknown }
    return typeof payload.session_id === 'string' && /^[0-9a-f-]{36}$/i.test(payload.session_id) ? payload.session_id : null
  } catch {
    return null
  }
}
