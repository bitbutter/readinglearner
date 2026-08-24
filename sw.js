'use strict';

// Big immutable assets (the ~40 MB Vosk model, the 5.8 MB vosk.js, level art)
// are served cache-first, because GitHub Pages only sends a 10-minute cache
// header and re-downloading the model every visit makes startup crawl.
// App shell files (html/js/css) stay network-first so a normal push still
// updates immediately, with the cache as an offline fallback.
const CACHE = 'rl-cache-v2';

// The art manifest is tiny and drives which images exist — it must always
// come from the network, otherwise a cached copy pins the app to old artwork.
const NETWORK_FIRST = /manifest\.json$/;

const CACHE_FIRST = /(?:model\.tar\.gz$|vosk\/vosk\.js$|\/images\/|\/audio\/)/;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// Exact-URL match (no ignoreSearch): bumping a ?v= query on an asset is how
// the app forces a refetch when e.g. the letter-sound clips are regenerated.
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const resp = await fetch(request);
  if (resp.ok) cache.put(request, resp.clone());
  return resp;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const resp = await fetch(request);
    if (resp.ok) cache.put(request, resp.clone());
    return resp;
  } catch (err) {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (NETWORK_FIRST.test(url.pathname))  event.respondWith(networkFirst(event.request));
  else if (CACHE_FIRST.test(url.pathname)) event.respondWith(cacheFirst(event.request));
  else                                event.respondWith(networkFirst(event.request));
});
