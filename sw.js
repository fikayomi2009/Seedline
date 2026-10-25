// Seedline service worker: caches the app shell only. Audio is NEVER cached.
const VERSION = 'seedline-v2';
const SHELL = [
  './', './index.html', './styles.css', './config.js', './manifest.webmanifest',
  './js/app.js', './js/logic.js', './js/data.js', './js/player.js', './js/store.js',
  './js/icons.js', './js/admin.js', './js/supa.js',
  './catalog.json', './youtube.json',
  './icons/logo.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Only same-origin GETs for the shell. Never touch audio, range requests, or other sites (Mixlr API/audio, YouTube, Supabase).
  if (req.method !== 'GET' || url.origin !== self.location.origin || req.headers.has('range') || /\.(mp3|m4a|aac|ogg|wav)$/i.test(url.pathname)) return;
  // Network first (so updates show up), fall back to cache when offline.
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
  );
});
