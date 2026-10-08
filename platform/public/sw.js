const CACHE='veya-offline-v1';
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(['/offline.html','/icon-192.png'])));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('veya-offline-')&&key!==CACHE).map(key=>caches.delete(key)))),self.clients.claim()]));});
self.addEventListener('fetch',event=>{
 if(new URL(event.request.url).pathname==='/icon-192.png'){event.respondWith(caches.match('/icon-192.png').then(hit=>hit||fetch(event.request)));return;}
 if(event.request.mode!=='navigate'||new URL(event.request.url).origin!==self.location.origin)return;
 event.respondWith(fetch(event.request).catch(async()=>{const page=await caches.match('/offline.html');return page?new Response(await page.text(),{headers:{'Content-Type':'text/html; charset=utf-8'}}):Response.error();}));
});
