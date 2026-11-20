/* Deliberately cache only the offline shell and explicitly selected images. */
importScripts("/offline/access.js");
const downloadAccess = self.ComicVerseDownloadAccess;
const SHELL_PREFIX = "comicverse-downloads-shell-";
const SHELL_CACHE = SHELL_PREFIX + "v3";
const SHELL = "/offline/downloads.html";
const ASSETS = [SHELL, "/offline/downloads.css", "/offline/downloads.mjs", "/offline/storage.mjs", "/offline/access.js", "/logo-mark.svg"];
const MEDIA = /^\/offline-media\/(\d{13}-[a-f0-9-]{36})\/(cover|\d+)$/;
const CHAPTER_CACHE_PREFIX = "comicverse-chapter-v1-";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(ASSETS.map((url) => new Request(url, { cache: "reload" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(SHELL_PREFIX) && name !== SHELL_CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/offline-media/")) {
    const match = url.pathname.match(MEDIA);
    event.respondWith((async () => {
      if (!match || request.destination !== "image" || !downloadAccess.isAllowed(await downloadAccess.read())) {
        return new Response(null, { status: 404 });
      }
      return await caches.match(url.pathname, { cacheName: CHAPTER_CACHE_PREFIX + match[1] })
        ?? new Response(null, { status: 404 });
    })());
    return;
  }

  if (request.mode === "navigate" &&
      !/^\/(api|_next)\b/.test(url.pathname)) {
    event.respondWith((async () => {
      if (url.pathname === "/downloads" || url.pathname === SHELL) {
        // Always use the installed shell with its matching CSS/JS. No API, RSC
        // request, session check, or remote font is needed to open Downloads.
        const installed = await caches.match(SHELL, { cacheName: SHELL_CACHE });
        if (installed) return installed;
      }
      try {
        return await fetch(request);
      } catch {
        const installed = await caches.match(SHELL, { cacheName: SHELL_CACHE });
        if (!installed) return Response.error();
        return Response.redirect(new URL("/downloads", self.location.origin).href, 302);
      }
    })());
    return;
  }

  if (ASSETS.includes(url.pathname) && url.pathname !== SHELL) {
    event.respondWith((async () => await caches.match(url.pathname, { cacheName: SHELL_CACHE }) ?? fetch(request))());
  }
});
