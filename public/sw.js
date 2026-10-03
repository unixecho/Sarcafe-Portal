// Minimal Web Push service worker — order tracking only, no offline
// caching/PWA shell (that's a separate, much bigger scope this app hasn't
// asked for). Two jobs: show the notification a `push` event carries, and
// focus/open the order page on click.

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

  const title = data.title || 'עדכון הזמנה'
  const url = data.url || '/order'

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
      // notification instead of stacking a second one in the tray.
      tag: data.orderId ? `order-${data.orderId}` : undefined,
      data: { url },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/order'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(url) && 'focus' in client) return client.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
      return undefined
    })
  )
})
