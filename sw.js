/* Simpan fail apps supaya boleh buka tanpa internet.
   Ambil dari internet dulu (selalu semak versi terbaru di GitHub), dan guna simpanan
   hanya bila tiada internet. Dengan cara ini perubahan nampak sebaik sahaja refresh. */
// Apps lain di alamat github.io yang sama ada simpanan sendiri; hanya urus yang bermula dengan awalan ini.
const AWALAN = 'diecast-';
const CACHE = AWALAN + 'v27';
const FAIL = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'config.js',
  'en.js',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' supaya tak ambil salinan lama dari cache browser.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(FAIL.map((f) => fetch(f, { cache: 'reload' }).then((r) => (r.ok ? c.put(f, r) : null)).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith(AWALAN) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(new URL('./', self.location).pathname)) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      // 'no-cache': tanya GitHub sama ada fail berubah (laju bila tak berubah).
      const res = await fetch(req, { cache: 'no-cache' });
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      return (await cache.match(req, { ignoreSearch: true })) || (await cache.match('index.html')) || Response.error();
    }
  })());
});
