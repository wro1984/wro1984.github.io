/* HUB dos apps — service worker.

   Fica na RAIZ (escopo "/") para o HUB instalado abrir offline. Por isso ele também "enxerga" os pedidos dos outros
   apps (/CO_PROB/, /CO_Painel/...): só responde pelos arquivos do PRÓPRIO HUB e deixa todo o resto passar direto,
   sem cache nem alteração. Cada app continua com o service worker dele. */
const VERSION = '1.1.0';
const CACHE = 'hub-v' + VERSION;
const CORE = ['/', '/index.html', '/cripto.js', '/app.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png',
  '/icons/icon-maskable-512.png'];
const DO_HUB = new Set(CORE);

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  // só apaga caches do próprio HUB: os dos apps têm outros nomes e não são tocados
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('hub-v') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname === '/hub.json') return;          // sempre da rede (o app guarda a última cópia, cifrada)
  if (!DO_HUB.has(url.pathname)) return;             // arquivos dos outros apps: não é com o HUB
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) { const copia = r.clone(); caches.open(CACHE).then(c => c.put(url.pathname, copia)); }
      return r;
    }).catch(() => caches.match(url.pathname).then(r => r || caches.match('/')))
  );
});
