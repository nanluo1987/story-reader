/* 故事编辑器 Service Worker
 * 缓存策略：
 *   - App Shell（HTML / manifest / SW 本身）→ Cache First
 *   - Google Fonts CSS → Stale While Revalidate（优先缓存，后台刷新）
 *   - Google Fonts 字体文件 → Cache First + 长期缓存
 */

const VERSION = 'v1';
const CACHE_APP   = `story-app-${VERSION}`;
const CACHE_FONTS = `story-fonts-${VERSION}`;

// 启动时预缓存的本地资源
const APP_ASSETS = [
  './',
  './index.html',
  './manifest.json',
];

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_APP)
      .then(cache => cache.addAll(APP_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_APP && k !== CACHE_FONTS)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Google Fonts 字体文件（二进制，Cache First，永久缓存）
  if (url.hostname === 'fonts.gstatic.com') {
    event.respondWith(fontFileStrategy(request));
    return;
  }

  // Google Fonts CSS（文本，Stale While Revalidate）
  if (url.hostname === 'fonts.googleapis.com') {
    event.respondWith(staleWhileRevalidate(request, CACHE_FONTS));
    return;
  }

  // 本地导航请求（HTML 页面）→ Cache First，回落到 index.html
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match(request)
        .then(cached => cached || caches.match('./index.html'))
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 其余本地资源 → Cache First
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_APP).then(cache => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});

// ── 策略函数 ──────────────────────────────────────────────────────────────────

/** Cache First：有缓存直接返回；无缓存则请求并存入 */
function fontFileStrategy(request) {
  return caches.open(CACHE_FONTS).then(cache =>
    cache.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response.ok) cache.put(request, response.clone());
        return response;
      }).catch(() => cached); // 完全离线时也返回 undefined，字体降级即可
    })
  );
}

/** Stale While Revalidate：返回缓存同时在后台刷新 */
function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then(cache =>
    cache.match(request).then(cached => {
      const networkFetch = fetch(request).then(response => {
        if (response.ok) cache.put(request, response.clone());
        return response;
      }).catch(() => null);

      return cached || networkFetch;
    })
  );
}
