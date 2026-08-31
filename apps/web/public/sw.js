const CACHE_NAME = 'wemux-pwa-v1'
const APP_SHELL = ['/', '/manifest.webmanifest', '/favicon.png', '/apple-touch-icon.png', '/pwa-192x192.png', '/pwa-512x512.png']
const SKIP_WAITING_MESSAGE_TYPE = 'WEMUX_SKIP_WAITING'

const cacheIfOk = (request, response) => {
  if (!response.ok) {
    return response
  }

  const copy = response.clone()
  caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
  return response
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  if (request.method !== 'GET') return

  const url = new URL(request.url)

  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/ws')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => cacheIfOk('/', response))
        .catch(async () => {
          const cached = await caches.match('/')
          return cached || Response.error()
        }),
    )
    return
  }

  const isStaticAsset = request.destination === 'script'
    || request.destination === 'style'
    || request.destination === 'font'
    || request.destination === 'image'
    || url.pathname.startsWith('/assets/')

  if (!isStaticAsset) return

  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => cacheIfOk(request, response))
        .catch(() => cached || Response.error())

      return cached || networkFetch
    }),
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type !== SKIP_WAITING_MESSAGE_TYPE) {
    return
  }

  self.skipWaiting()
})

// ---- Web Push（feature P3）：页面关闭也能收通知 ----

/** 点击通知 → 跳转对应会话（payload.url）。 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const url = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})

self.addEventListener('push', (event) => {
  let payload = { title: 'wemux', body: '', tag: '', url: '/' }
  if (event.data) {
    try {
      payload = { ...payload, ...JSON.parse(event.data.text()) }
    } catch {
      payload = { ...payload, body: event.data.text() }
    }
  }

  const options = {
    body: payload.body,
    tag: payload.tag,
    data: { url: payload.url },
    icon: '/pwa-192x192.png',
    badge: '/favicon.png',
  }

  event.waitUntil(self.registration.showNotification(payload.title, options))
})
