/**
 * Cache layer for repeat visits.
 *
 * /components/ (demo documents + their JS) is NETWORK-FIRST: files travel in
 * matched sets, and serving half a deploy from cache tears a demo apart.
 * The origin answers 304s cheaply (max-age=0 + ETag), and the cache steps in
 * only when the network fails — so demos are always the current deploy, yet
 * still work offline.
 *
 * /assets/ (thumbnails, sprites, sounds) is stale-while-revalidate: leaf
 * media with no cross-file coupling, where instant beats freshest.
 *
 * The page shell (index/styles/app) and /presence/ never touch this cache.
 */
'use strict';

const CACHE = 'zw-playground-v2';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const isDemo = /^\/components\//.test(url.pathname);
  const isAsset = /^\/assets\//.test(url.pathname);
  if (!isDemo && !isAsset) return;

  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);

      if (isDemo) {
        try {
          const res = await fetch(e.request);
          if (res.ok) {
            // keep the worker alive until the copy is actually stored
            e.waitUntil(cache.put(e.request, res.clone()).catch(() => {}));
          }
          return res;
        } catch {
          return (await cache.match(e.request)) || Response.error();
        }
      }

      // assets: serve the hit now, refresh behind it — and hold the worker
      // open through the write, or short visits never absorb a deploy.
      const hit = await cache.match(e.request);
      const refresh = fetch(e.request)
        .then(async (res) => {
          if (res.ok) await cache.put(e.request, res.clone()).catch(() => {});
          return res;
        })
        .catch(() => hit);
      e.waitUntil(refresh.then(() => undefined, () => undefined));
      return hit || refresh;
    })()
  );
});
