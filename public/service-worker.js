const CACHE_NAME = 'avelut-assets-v2';

// Assets to cache immediately on install
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/logo.svg',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Use Settled to gracefully handle any missing dev/build files
      return Promise.allSettled(
        PRECACHE_ASSETS.map(asset => 
          cache.add(asset).catch(err => console.warn(`Failed to precache ${asset}:`, err))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      return self.clients.claim().catch((err) => {
        console.warn('Failed to claim clients during activation:', err);
      });
    })
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle http and https requests to prevent chrome-extension and other schemes from failing
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // Skip non-GET requests and Firebase Database / Auth / Functions / API requests
  if (
    event.request.method !== 'GET' ||
    url.origin.includes('firebaseio.com') ||
    url.origin.includes('googleapis.com') ||
    url.origin.includes('identitytoolkit') ||
    url.pathname.includes('/study_guide_messages')
  ) {
    return;
  }

  // Stale-While-Revalidate strategy for document and index.html
  if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((cachedResponse) => {
          const fetchPromise = fetch(event.request).then((networkResponse) => {
            if (networkResponse.status === 200) {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          }).catch(() => {
            // Fallback to cache if network fails
            return cachedResponse;
          });
          return cachedResponse || fetchPromise;
        });
      })
    );
    return;
  }

  // Cache-First strategy for static assets, local resources, and CDN dependencies
  const isStaticAsset = 
    url.pathname.startsWith('/assets/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.ico') ||
    url.pathname.endsWith('.woff') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.ttf') ||
    url.origin.includes('aistudiocdn.com') ||
    url.origin.includes('esm.sh') ||
    url.origin.includes('jsdelivr.net');

  if (isStaticAsset) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        });
      })
    );
    return;
  }
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const chatId = event.notification?.data?.chatId;
	const messengerUrl = chatId ? `/?openMessengerChatId=${encodeURIComponent(chatId)}` : '/';

	event.waitUntil(
		self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
			for (const client of clients) {
				if ('focus' in client) {
					if (chatId) {
						client.postMessage({ type: 'open-messenger-chat', chatId });
					}
					return client.focus();
				}
			}
			if (self.clients.openWindow) {
				return self.clients.openWindow(messengerUrl);
			}
			return undefined;
		})
	);
});
