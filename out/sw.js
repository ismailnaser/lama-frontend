/* OPD LoggerX & Surgical Dressing Log — offline shell cache */
const CACHE = "sdl-app-v3";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(["/", "/index.html", "/manifest.webmanifest", "/icons/app-icon.svg"]).catch(() => undefined)
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  // Don't let the SW interfere with cross-origin requests (API).
  // This avoids stale localhost URLs and removes noisy "offline" errors for API fetches.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(request));
    return;
  }

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      try {
        const net = await fetch(request);
        if (net.ok && request.url.startsWith(self.location.origin)) {
          cache.put(request, net.clone()).catch(() => undefined);
        }
        return net;
      } catch {
        const cached = await cache.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") {
          const shell = await cache.match("/") ?? (await cache.match("/index.html"));
          if (shell) return shell;
        }
        throw new Error("offline");
      }
    })
  );
});
