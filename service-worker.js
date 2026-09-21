const CACHE="studio-costa-companion-v13-6-restored-20260921";
const APP_SHELL=[
  "./",
  "./index.html",
  "./styles.css?v=13.6",
  "./app.js?v=13.6",
  "./manifest.json?v=13.6",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png"
];
async function cacheShell(){const cache=await caches.open(CACHE);await cache.addAll(APP_SHELL)}
self.addEventListener("install",event=>{event.waitUntil(cacheShell());self.skipWaiting()});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith("studio-costa-companion-")&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()))});
self.addEventListener("message",event=>{if(event.data&&event.data.type==="CACHE_APP_SHELL")event.waitUntil(cacheShell())});
self.addEventListener("fetch",event=>{const request=event.request;if(request.method!=="GET")return;const url=new URL(request.url);if(url.origin!==self.location.origin)return;if(request.mode==="navigate"){event.respondWith(fetch(request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put("./index.html",copy));return response}).catch(()=>caches.match("./index.html")));return}event.respondWith(fetch(request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy));return response}).catch(()=>caches.match(request,{ignoreSearch:true}))) });
