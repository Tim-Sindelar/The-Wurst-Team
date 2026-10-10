/* Service worker for the installed app. The build (pwa plugin in
   vite.config.ts) fills in BUILD with this release's id and file list.

   - The app shell (index.html and the entry scripts and styles) is cached on
     install, so the app opens without a network.
   - Pages go to the network first; offline they fall back to the cached
     index.html. Redirects (the login proxy) pass through untouched.
   - Hashed files under assets/ are served from the cache once fetched.
   - The API is never cached: bookings and timers must be live.
   - Production's scope (/) also covers PR previews (/pr/N/, each with its own
     worker) and the AR build (/ar/), so those paths are left alone. */

const BUILD = self.__BUILD__;
const scope = self.registration.scope;
const prefix = `study-spaces ${scope} `;
const cacheName = prefix + BUILD.id;
const indexUrl = new URL('index.html', scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(cacheName)
      .then((cache) =>
        cache.addAll(BUILD.precache.map((path) => new URL(path, scope).href)),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith(prefix) && name !== cacheName)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith(scope)) return;
  const path = new URL(request.url).pathname.slice(
    new URL(scope).pathname.length,
  );
  if (/^(api|pr|ar)(\/|$)/.test(path)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(indexUrl).then((cached) => cached ?? Response.error()),
      ),
    );
  } else if (path.startsWith('assets/')) {
    event.respondWith(
      caches.open(cacheName).then((cache) =>
        cache.match(request).then(
          (cached) =>
            cached ??
            fetch(request).then((response) => {
              if (response.ok) cache.put(request, response.clone());
              return response;
            }),
        ),
      ),
    );
  }
});
