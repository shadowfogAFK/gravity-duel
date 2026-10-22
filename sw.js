/* Gravity Duel service worker: the game starts from the cache (fast, also offline),
   pages are fetched fresh when online, the online backend is never cached. */
const VERSION = 'gd-v2';
const CORE = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-180.png', 'icon-maskable-512.png', 'favicon-32.png',
  'fonts/chakra-500.woff', 'fonts/chakra-700.woff', 'fonts/figtree.woff', 'impressum.html', 'datenschutz.html'];
const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.111.0/dist/umd/supabase.js';

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(CORE);
    try { await c.add(new Request(LIB, { mode: 'cors' })) } catch (err) { /* cached on first use instead */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  const isLib = url.href.startsWith('https://cdn.jsdelivr.net/npm/@supabase/') || url.href.startsWith('https://unpkg.com/@supabase/');
  if (!same && !isLib) return;                       // Supabase API, auth, realtime: always live
  if (same && url.pathname.endsWith('/admin.html')) return;
  if (req.mode === 'navigate' || (same && /\.(html|webmanifest)$|\/$/.test(url.pathname))) {
    // pages: fresh when online (new versions show up at once), the cached copy when offline or slow
    e.respondWith((async () => {
      const c = await caches.open(VERSION);
      try {
        const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 4000);
        const res = await fetch(req, { signal: ctl.signal }); clearTimeout(t);
        if (res.ok) c.put(req.mode === 'navigate' && url.pathname.endsWith('/') ? 'index.html' : req, res.clone());
        return res;
      } catch (err) {
        return (await c.match(req, { ignoreSearch: true })) || (await c.match('index.html')) || Response.error();
      }
    })());
    return;
  }
  // fonts, icons, the Supabase library: from the cache, fetched once
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    const hit = await c.match(req, { ignoreSearch: same });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') c.put(req, res.clone());
    return res;
  })());
});

/* push notifications (opt-in in the settings) */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {} } catch (err) { d = { body: e.data && e.data.text() } }
  e.waitUntil(self.registration.showNotification(d.title || 'Gravity Duel', {
    body: d.body || '', icon: 'icon-192.png', badge: 'icon-192.png', tag: d.tag || 'gd', data: { url: d.url || './' }, lang: 'de'
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || './', self.location.href).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of all) if (w.url.startsWith(self.location.origin)) { await w.focus(); if ('navigate' in w) try { await w.navigate(target) } catch (err) {} return }
    await self.clients.openWindow(target);
  })());
});
