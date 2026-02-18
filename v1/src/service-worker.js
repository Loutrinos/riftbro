// service-worker.js
const CACHE_NAME = 'riftbro-api-cache-v1';
const API_BASE = 'http://localhost:3000';

// Install event - cache static assets
self.addEventListener('install', event => {
  console.log('Service Worker installing.');
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  console.log('Service Worker activating.');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Fetch event - intercept API calls and cache responses
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Only handle API requests
  if (url.origin === new URL(API_BASE).origin && url.pathname.startsWith('/api/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache => {
        // Try to get from cache first
        return cache.match(event.request).then(response => {
          if (response) {
            console.log('Serving from SW cache:', event.request.url);
            return response;
          }

          // Not in cache, fetch from network
          return fetch(event.request).then(networkResponse => {
            // Cache successful responses
            if (networkResponse.ok) {
              cache.put(event.request, networkResponse.clone());
              console.log('Cached API response:', event.request.url);
            }
            return networkResponse;
          }).catch(error => {
            console.error('Network fetch failed:', error);
            // Return cached response if available, otherwise error
            return response || new Response(JSON.stringify({ error: 'Network unavailable' }), {
              status: 503,
              headers: { 'Content-Type': 'application/json' }
            });
          });
        });
      })
    );
  }
});

// Message event - handle messages from main thread
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});