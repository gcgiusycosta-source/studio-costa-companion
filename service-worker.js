/* Companion V20.8 — shell atomico: nessun skipWaiting automatico sugli aggiornamenti. */
const CACHE = 'studio-costa-companion-v20-8-shell';
const APP_SHELL = ["./","./index.html","./ai-touch.jpg","./app-actions.js?v=20.8","./app-bootstrap.js?v=20.8","./app-calculators.js?v=20.8","./app-calendar.js?v=20.8","./app-details.js?v=20.8","./app-planner.js?v=20.8","./app-privacy.js?v=20.8","./app-workflows.js?v=20.8","./app.js?v=20.8","./apple-touch-icon.png","./brand-wave.jpg","./companion-core.js?v=20.8","./companion-storage.js?v=20.8","./companion-vault.js?v=20.8","./companion-version.js?v=20.8","./courtroom.jpg","./digital-home.jpg","./icon-192.png","./icon-512.png","./logo-gc.png","./office.jpg","./planner-batch-mobile.js?v=20.8","./sea-desk.jpg","./styles-foundation.css?v=20.8","./styles-legacy.css?v=20.8","./styles.css?v=20.8","./manifest.json?v=20.8"];
const SHELL_PATHS = new Set(APP_SHELL.filter(x=>!x.endsWith('/')).map(x=>new URL(x,self.registration.scope).pathname));
self.addEventListener('install', event => {
  event.waitUntil((async()=>{
    const cache = await caches.open(CACHE);
    await cache.addAll(APP_SHELL); // installazione fallisce se manca una risorsa
    if (!self.registration.active) await self.skipWaiting(); // solo prima installazione
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
    // Mantiene la stessa versione di HTML+CSS+JS finché l'utente non attiva l'update.
    event.respondWith(caches.match('./index.html').then(hit => hit || fetch(req)));
    return;
  }
  if(!SHELL_PATHS.has(url.pathname)) return;
  event.respondWith(caches.match(req).then(hit=>hit||fetch(req)));
});
