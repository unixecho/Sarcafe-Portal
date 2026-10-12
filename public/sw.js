// Minimal Web Push service worker — no offline caching/PWA shell (that's a
// separate, much bigger scope this app hasn't asked for). Two jobs: show the
// notification a `push` event carries, and focus/open its page on click.
// It serves two audiences from one registration: customers tracking an order
// (payload carries `orderId`) and staff (payload carries a `staff-…` tag).

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }

  const title = data.title || (data.orderId ? 'עדכון הזמנה' : 'Sarcafe')
  const url = data.url || (data.orderId ? '/order' : '/staff')
  const isStaff = typeof data.tag === 'string' && data.tag.startsWith('staff-')

  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      // A dedicated small icon (192x192, ~9KB) — NOT the full logo
      // (1412x1412, ~830KB). iOS's push implementation has been reported
      // to silently drop a notification whose icon is slow/large to
      // fetch; a notification icon should never be a multi-hundred-KB
      // asset regardless of platform.
      icon: '/notification-icon.png',
      badge: '/notification-icon.png',
      dir: 'rtl',
      lang: 'he',
      // A repeat push for the SAME order replaces its own earlier
      // notification instead of stacking a second one in the tray. Staff
      // alerts bring their own tag (one per inbox row, or a per-person digest).
      tag: data.orderId ? `order-${data.orderId}` : isStaff ? data.tag : undefined,
      data: { url, staff: isStaff },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const notified = event.notification.data || {}
  const url = notified.url || '/order'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(url) && 'focus' in client) return client.focus()
      }
      // A staff member with the app already open is taken to the page in that window,
      // not handed a second one. (A customer's order page is never navigated away.)
      if (notified.staff) {
        const open = clientList.find((client) => 'navigate' in client && 'focus' in client)
        if (open) return open.navigate(url).then((moved) => (moved || open).focus()).catch(() => (self.clients.openWindow ? self.clients.openWindow(url) : undefined))
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
      return undefined
    })
  )
})
