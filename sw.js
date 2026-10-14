/* Simpan fail apps dalam telefon supaya boleh buka tanpa internet.
   Papar dari simpanan dulu (laju), kemudian ambil versi baru di belakang tabir.
   Jadi bila fail di GitHub dikemas kini, perubahan nampak pada bukaan seterusnya. */
// Apps lain di alamat github.io yang sama ada simpanan sendiri; hanya urus yang bermula dengan awalan ini.
const AWALAN = 'diecast-';
const CACHE = AWALAN + 'v2';
const FAIL = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'config.js',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FAIL)).then(() => self.skipWaiting()));
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
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // Hanya fail dalam folder apps ini.
  if (!new URL(req.url).pathname.startsWith(new URL('./', self.location).pathname)) return;

  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const tersimpan = await cache.match(req, { ignoreSearch: true });
      const rangkaian = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      if (tersimpan) { e.waitUntil(rangkaian); return tersimpan; }
      return (await rangkaian) || (await cache.match('index.html')) || Response.error();
    })
  );
});
