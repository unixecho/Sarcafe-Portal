// A push subscription's endpoint is a URL the browser hands us, and the server later POSTs to it. Left unchecked,
// anyone who can subscribe could make this server send requests to an address of their choosing (server-side
// request forgery). Real browsers only ever hand out endpoints on their vendor's push service, so only those hosts
// are accepted, over https, on the default port. Used when a subscription is saved AND right before a send.
//
// Hosts in use (checked 2026-10-28): fcm.googleapis.com (Chrome, Android, Edge on Android, Samsung, Opera),
// web.push.apple.com (Safari / iPhone home-screen apps). The other suffixes cover Firefox (Mozilla autopush) and
// Edge on Windows (WNS).
const PUSH_HOST_SUFFIXES = ['.googleapis.com', '.push.apple.com', '.mozilla.com', '.mozaws.net', '.notify.windows.com']

export function isAllowedPushEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 1000) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '') return false
  const host = url.hostname.toLowerCase()
  return PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
}
