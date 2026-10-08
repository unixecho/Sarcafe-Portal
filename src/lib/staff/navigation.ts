export const POS_RETURN_COOKIE = 'sarcafe_pos_return'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** A station link may survive login; only known event navigation is retained. */
export function safePosReturn(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith('/pos') || raw.includes('\\')) return null
  const url = new URL(raw, 'https://sarcafe.invalid')
  if (url.origin !== 'https://sarcafe.invalid' || url.pathname !== '/pos') return null
  const result = new URLSearchParams()
  const view = url.searchParams.get('v')
  if (view && ['register','station','timeline','orders','home'].includes(view)) result.set('v', view)
  for (const key of ['p','add','o']) {
    const value = url.searchParams.get(key)
    if (value && uuid.test(value)) result.set(key, value)
  }
  const branch = url.searchParams.get('branch')
  if (branch && /^[A-Za-z0-9_-]{1,80}$/.test(branch)) result.set('branch', branch)
  return result.size ? `/pos?${result}` : '/pos'
}
