/* Companion V20.11 — attivazione aggiornamento e recupero online, fallback offline. */
const CACHE = 'studio-costa-companion-v20-11-shell';
const APP_SHELL = ["./","./index.html","./ai-touch.jpg","./app-actions.js?v=20.11","./app-bootstrap.js?v=20.11","./app-calculators.js?v=20.11","./app-calendar.js?v=20.11","./app-details.js?v=20.11","./app-planner.js?v=20.11","./app-privacy.js?v=20.11","./app-workflows.js?v=20.11","./app.js?v=20.11","./apple-touch-icon.png","./brand-wave.jpg","./companion-core.js?v=20.11","./companion-storage.js?v=20.11","./companion-vault.js?v=20.11","./companion-version.js?v=20.11","./courtroom.jpg","./digital-home.jpg","./icon-192.png","./icon-512.png","./logo-gc.png","./office.jpg","./planner-batch-mobile.js?v=20.11","./sea-desk.jpg","./styles-foundation.css?v=20.11","./styles-legacy.css?v=20.11","./styles.css?v=20.11","./manifest.json?v=20.11"];
const SHELL_PATHS = new Set(APP_SHELL.filter(x=>!x.endsWith('/')).map(x=>new URL(x,self.registration.scope).pathname));
self.addEventListener('install', event => {
  event.waitUntil((async()=>{
    const cache = await caches.open(CACHE);
    await cache.addAll(APP_SHELL); // installazione fallisce se manca una risorsa
    await self.skipWaiting(); // L’aggiornamento diventa attivo alla successiva apertura.
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith('studio-costa-companion-')&&k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if(event.data?.type === 'ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
  if(event.data?.type === 'CACHE_APP_SHELL') event.waitUntil(caches.open(CACHE).then(c=>c.addAll(APP_SHELL)).catch(()=>{}));
});
self.addEventListener('fetch', event => {
  const req=event.request;
  if(req.method!=='GET') return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin) return;
  if(req.mode==='navigate') {
    // Privilegiare la versione pubblicata; offline usare la shell completa in cache.
    event.respondWith(fetch(req,{cache:'no-store'}).catch(()=>caches.match('./index.html')));
    return;
  }
  if(!SHELL_PATHS.has(url.pathname)) return;
  event.respondWith(caches.match(req).then(hit=>hit||fetch(req)));
});
