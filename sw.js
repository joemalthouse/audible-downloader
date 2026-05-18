// Service worker for the static app shell + ffmpeg core. Bump CACHE_VERSION on
// any change to shell files to force older clients onto the new cache.

const CACHE_VERSION = "v3";
const SHELL_CACHE = `audible-shell-${CACHE_VERSION}`;
const SHELL_PATHS = [
  "/",
  "/index.html",
  "/app.js",
  "/styles.css",
  "/lib/audible-shared.js",
  "/lib/rsa.js",
  "/vendor/ffmpeg/ffmpeg/dist/esm/index.js",
  "/vendor/ffmpeg/ffmpeg/dist/esm/classes.js",
  "/vendor/ffmpeg/ffmpeg/dist/esm/const.js",
  "/vendor/ffmpeg/ffmpeg/dist/esm/errors.js",
  "/vendor/ffmpeg/ffmpeg/dist/esm/types.js",
  "/vendor/ffmpeg/ffmpeg/dist/esm/utils.js",
  "/vendor/ffmpeg/ffmpeg/dist/esm/worker.js",
  "/vendor/ffmpeg/core/dist/esm/ffmpeg-core.js",
  "/vendor/ffmpeg/core/dist/esm/ffmpeg-core.wasm.gz",
];

const BYPASS_PATHS = ["/auth/", "/library", "/license/", "/source"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL_PATHS).catch(() => {});
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (BYPASS_PATHS.some((path) => url.pathname.startsWith(path))) return;

  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(request, { ignoreSearch: false });
    if (cached) {
      // Stale-while-revalidate for the app shell.
      fetch(request).then((response) => {
        if (response.ok) cache.put(request, response.clone()).catch(() => {});
      }).catch(() => {});
      return cached;
    }
    try {
      const response = await fetch(request);
      if (response.ok && SHELL_PATHS.includes(url.pathname)) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    } catch {
      const fallback = await cache.match("/");
      return fallback || new Response("Offline", { status: 503 });
    }
  })());
});
