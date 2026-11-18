/* Companion V20.13 — attivazione aggiornamento e recupero online, fallback offline. */
const CACHE = 'studio-costa-companion-21-0-0-studio-home1';
const APP_SHELL = ["./", "./index.html", "manifest.json?v=21.0.0", "apple-touch-icon.png?v=21.0.0", "styles-foundation.css?v=21.0.0", "styles-legacy.css?v=21.0.0", "styles.css?v=21.0.0", "studio.css?v=21.0.0", "companion-version.js?v=21.0.0", "companion-core.js?v=21.0.0", "planner-batch-mobile.js?v=21.0.0", "companion-vault.js?v=21.0.0", "companion-storage.js?v=21.0.0", "app.js?v=21.0.0", "app-calendar.js?v=21.0.0-home1", "app-planner.js?v=21.0.0", "app-workflows.js?v=21.0.0", "app-calculators.js?v=21.0.0", "app-actions.js?v=21.0.0", "app-details.js?v=21.0.0", "app-privacy.js?v=21.0.0", "app-scadenze.js?v=21.0.0", "companion-access.js?v=21.0.0", "studio-core.js?v=21.0.0", "studio.js?v=21.0.0-home1", "app-bootstrap.js?v=21.0.0", "courtroom.jpg", "sea-desk.jpg", "brand-wave.jpg", "icon-512.png", "ai-touch.jpg", "apple-touch-icon.png", "office.jpg", "icon-192.png", "logo-gc.png", "digital-home.jpg"];
const SHELL_PATHS = new Set(APP_SHELL.filter(x=>!x.endsWith('/')).map(x=>new URL(x,self.registration.scope).pathname));
self.addEventListener('install', event => {
  event.waitUntil((async()=>{
    const cache = await caches.open(CACHE);
    await cache.addAll(APP_SHELL); // installazione fallisce se manca una risorsa
    // A replacement waits for the existing user-confirmed update flow.
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
