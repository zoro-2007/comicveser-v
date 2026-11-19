const CACHE_NAME = "comicverse-offline-shell-v1";

const PRECACHE_URLS = [
  "/downloads",
  "/site.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

const PRIVATE_PREFIXES = ["/api/", "/auth/", "/user/", "/admin/", "/creator/"];

function isPrivateOrApiPath(pathname) {
  return PRIVATE_PREFIXES.some((prefix) => pathname === prefix.slice(0, -1) || pathname.startsWith(prefix));
}

function isStaticAsset(pathname) {
  return (
    pathname.startsWith("/_next/static/") ||
    pathname === "/site.webmanifest" ||
    pathname === "/favicon.ico" ||
    pathname === "/icon.svg" ||
    pathname === "/icon-192.png" ||
    pathname === "/icon-512.png" ||
    pathname === "/apple-touch-icon.png" ||
    pathname === "/logo.svg" ||
    pathname === "/logo-mark.svg" ||
    pathname === "/logo-lockup.svg"
  );
}

async function cacheUrlList(urls) {
  if (!Array.isArray(urls) || urls.length === 0) return;
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(
    urls.map(async (raw) => {
      try {
        const u = new URL(raw, self.location.origin);
        if (u.origin !== self.location.origin) return;
        if (isPrivateOrApiPath(u.pathname)) return;
        if (u.pathname !== "/downloads" && !isStaticAsset(u.pathname)) return;
        const req = new Request(u.pathname === "/downloads" ? "/downloads" : u.href, {
          credentials: "same-origin",
        });
        const res = await fetch(req);
        if (res && res.ok) {
          await cache.put(req, res.clone());
        }
      } catch {
        // Ignore individual precache failures
      }
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await cacheUrlList(PRECACHE_URLS);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith("comicverse-offline-") && k !== CACHE_NAME).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.type === "CACHE_URLS" && Array.isArray(data.urls)) {
    event.waitUntil(cacheUrlList(data.urls));
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (req.headers.has("authorization")) return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (isPrivateOrApiPath(url.pathname)) return;

  // Navigation requests when offline: serve /downloads from cache (including / and /downloads?comic=...&chapter=...)
  if (req.mode === "navigate" && url.pathname === "/downloads") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          const networkRes = await fetch(req);
          if (networkRes && networkRes.ok) {
            // Store under canonical /downloads key for fresh-tab offline opens
            await cache.put("/downloads", networkRes.clone());
          }
          return networkRes;
        } catch {
          const cached = await cache.match("/downloads");
          if (cached) return cached;
          return new Response(
            "<!doctype html><html><body style='background:#131118;color:#f5f3fa;font-family:system-ui,sans-serif;padding:24px'><h1>Offline</h1><p>Downloads shell is not cached yet. Open ComicVerse once while online, then try again.</p></body></html>",
            { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
          );
        }
      })(),
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(req);
        } catch {
          const cache = await caches.open(CACHE_NAME);
          const cachedDownloads = await cache.match("/downloads");
          if (cachedDownloads) return cachedDownloads;
          return new Response(
            "<!doctype html><html><body style=\x27background:#131118;color:#f5f3fa;font-family:system-ui,sans-serif;padding:24px\x27><h1>You are offline</h1><p>Open ComicVerse once while online to enable offline Downloads.</p></body></html>",
            { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
          );
        }
      })(),
    );
    return;
  }

  // Immutable Next.js static assets & app icons
  if (isStaticAsset(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(req, { ignoreSearch: false });
        if (cached) return cached;
        const networkRes = await fetch(req);
        if (networkRes && networkRes.ok) {
          await cache.put(req, networkRes.clone());
        }
        return networkRes;
      })(),
    );
  }
});
