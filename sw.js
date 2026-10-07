const CACHE='kamba-market-v1';
const ASSETS=['/','/index.html','/styles.css','/app.js','/manifest.webmanifest','/icon.svg'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{ if(e.request.method!=='GET'||e.request.url.includes('/api/')) return; e.respondWith(fetch(e.request).catch(()=>caches.match(e.request))); });
