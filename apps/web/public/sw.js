const CACHE_NAME = "comicverse-offline-shell-v2";
const DB_NAME = "comicverse-offline-v1";
const DB_VERSION = 1;
const STORE_COMICS = "comics";
const STORE_CHAPTERS = "chapters";
const STORE_PAGES = "pages";
const STORE_COVERS = "covers";
const CHANNEL_NAME = "comicverse-offline-downloads";

const PRECACHE_URLS = [
  "/downloads",
  "/site.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

const PRIVATE_PREFIXES = ["/api/", "/auth/", "/user/", "/admin/", "/creator/"];
const activeDownloads = new Map(); // chapterId -> { state, controller }
const MAX_CONCURRENT_SW_DOWNLOADS = 5;
const downloadQueue = [];
let runningSwDownloads = 0;

function enqueueBackgroundDownload(payload) {
  const chId = payload?.chapter?.id;
  if (!chId) return Promise.resolve();
  if (activeDownloads.has(chId) || downloadQueue.some((p) => p.chapter.id === chId)) {
    return Promise.resolve();
  }
  const initialState = {
    chapterId: chId,
    comicId: payload.comic.id,
    comicTitle: payload.comic.title,
    chapterNumber: payload.chapter.displayNumber ?? payload.chapter.number,
    phase: "checking",
    completedPages: 0,
    totalPages: 0,
  };
  const ctrl = new AbortController();
  activeDownloads.set(chId, { state: initialState, controller: ctrl });
  void broadcastProgress(initialState);

  return new Promise((resolve) => {
    downloadQueue.push({ payload, ctrl, resolve });
    pumpDownloadQueue();
  });
}

function pumpDownloadQueue() {
  while (runningSwDownloads < MAX_CONCURRENT_SW_DOWNLOADS && downloadQueue.length > 0) {
    const job = downloadQueue.shift();
    if (!job) break;
    if (job.ctrl.signal.aborted) {
      activeDownloads.delete(job.payload.chapter.id);
      job.resolve();
      continue;
    }
    runningSwDownloads++;
    runBackgroundDownload(job.payload, job.ctrl)
      .catch(() => {})
      .finally(() => {
        runningSwDownloads = Math.max(0, runningSwDownloads - 1);
        job.resolve();
        pumpDownloadQueue();
      });
  }
}
const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL_NAME) : null;

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

function openOfflineDb() {
  return new Promise((resolve, reject) => {
    const req = self.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_COMICS)) {
        db.createObjectStore(STORE_COMICS, { keyPath: "comicId" });
      }
      if (!db.objectStoreNames.contains(STORE_CHAPTERS)) {
        const ch = db.createObjectStore(STORE_CHAPTERS, { keyPath: "chapterId" });
        ch.createIndex("by_comic", "comicId", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_PAGES)) {
        const pg = db.createObjectStore(STORE_PAGES, { keyPath: "key" });
        pg.createIndex("by_chapter", "chapterId", { unique: false });
        pg.createIndex("by_comic", "comicId", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_COVERS)) {
        db.createObjectStore(STORE_COVERS, { keyPath: "comicId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB error"));
  });
}

function reqPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IDB request failed"));
  });
}

function txPromise(tx, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { tx.abort(); } catch {}
      reject(new Error("Offline storage write timed out"));
    }, timeoutMs);
    tx.oncomplete = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    tx.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(tx.error || new Error("IDB tx failed"));
    };
    tx.onabort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(tx.error || new Error("IDB tx aborted"));
    };
  });
}

let dbWriteChain = Promise.resolve();
function withDbWriteLock(fn) {
  const next = dbWriteChain.then(fn, fn);
  dbWriteChain = next.catch(() => {});
  return next;
}

async function deleteChapterPagesFromDb(chapterId) {
  const db = await openOfflineDb();
  const tx = db.transaction(STORE_PAGES, "readwrite");
  const idx = tx.objectStore(STORE_PAGES).index("by_chapter");
  const keys = await reqPromise(idx.getAllKeys(IDBKeyRange.only(chapterId)));
  const store = tx.objectStore(STORE_PAGES);
  for (const k of keys) store.delete(k);
  await txPromise(tx);
}

async function saveChapterToDb({ comic, chapter, pages, coverBlob }) {
  return withDbWriteLock(async () => {
    await deleteChapterPagesFromDb(chapter.chapterId);
    const db = await openOfflineDb();
    let existingCover = null;
    try {
      const rTx = db.transaction(STORE_COVERS, "readonly");
      existingCover = await reqPromise(rTx.objectStore(STORE_COVERS).get(comic.comicId));
    } catch {}

    const now = Date.now();
    const tx = db.transaction([STORE_COMICS, STORE_CHAPTERS, STORE_PAGES, STORE_COVERS], "readwrite");
    const comicsStore = tx.objectStore(STORE_COMICS);
    const chaptersStore = tx.objectStore(STORE_CHAPTERS);
    const pagesStore = tx.objectStore(STORE_PAGES);
    const coversStore = tx.objectStore(STORE_COVERS);

    const hasCoverBlob = Boolean(coverBlob || existingCover);
    if (coverBlob && coverBlob.size > 0) {
    coversStore.put({
      comicId: comic.comicId,
      mimeType: coverBlob.type || "image/jpeg",
      sizeBytes: coverBlob.size,
      blob: coverBlob,
    });
  }

  comicsStore.put({ ...comic, hasCoverBlob, updatedAt: now });

  for (const p of pages) {
    pagesStore.put({
      key: `${chapter.chapterId}:${p.position}`,
      chapterId: chapter.chapterId,
      comicId: comic.comicId,
      position: p.position,
      width: p.width,
      height: p.height,
      mimeType: p.mimeType,
      sizeBytes: p.sizeBytes,
      blob: p.blob,
    });
  }

    chaptersStore.put({ ...chapter, downloadedAt: now });
    await txPromise(tx);
  });
}

async function broadcastProgress(state) {
  const msg = { type: "DOWNLOAD_PROGRESS", state };
  if (bc) {
    try { bc.postMessage(msg); } catch {}
  }
  const allClients = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
  for (const c of allClients) {
    try { c.postMessage(msg); } catch {}
  }
}

async function hasValidImageMagicBytes(blob) {
  const buf = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (buf.length < 4) return false;
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  // GIF
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return true;
  // RIFF....WEBP
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return true;
  // ISO BMFF (AVIF / HEIF)
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return true;
  return false;
}

async function verifyBlobInSw(blob) {
  if (!blob || blob.size === 0) throw new Error("Empty image response");
  if (blob.type && !blob.type.startsWith("image/") && blob.type !== "application/octet-stream") {
    throw new Error(`Unexpected content type: ${blob.type}`);
  }
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(blob);
      const w = bmp.width;
      const h = bmp.height;
      bmp.close();
      if (w > 0 && h > 0) return { width: w, height: h };
    } catch {
      // Mobile SWs can throw OOM on very tall webtoon strips; fall back to magic-byte validation
    }
  }
  const ok = await hasValidImageMagicBytes(blob);
  if (!ok) throw new Error("Invalid or corrupt image data");
  return { width: 0, height: 0 };
}

function isSameOriginOrApi(url, apiBase) {
  if (url.startsWith("/")) return true;
  try {
    const u = new URL(url, self.location.origin);
    if (u.origin === self.location.origin) return true;
    if (/^https?:\/\//i.test(apiBase)) {
      return u.origin === new URL(apiBase).origin;
    }
  } catch {}
  return false;
}

async function fetchImageWithRetry(url, internal, authHeaders, parentSignal) {
  let lastErr;
  for (let attempt = 0; attempt <= 3; attempt++) {
    if (parentSignal.aborted) throw new DOMException("Aborted", "AbortError");
    const tCtrl = new AbortController();
    const timer = setTimeout(() => tCtrl.abort(), 25_000);
    const onAbort = () => tCtrl.abort();
    parentSignal.addEventListener("abort", onAbort, { once: true });
    try {
      const res = await fetch(url, {
        method: "GET",
        mode: "cors",
        credentials: internal ? "include" : "omit",
        headers: internal ? authHeaders : undefined,
        cache: "no-store",
        signal: tCtrl.signal,
      });
      if (!res.ok) {
        const err = new Error(`Image fetch failed (${res.status})`);
        err.status = res.status;
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) throw err;
        throw err;
      }
      const blob = await res.blob();
      const dims = await verifyBlobInSw(blob);
      return { blob, width: dims.width, height: dims.height };
    } catch (err) {
      if (parentSignal.aborted) throw new DOMException("Aborted", "AbortError");
      lastErr = err;
      if (err && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) throw err;
      if (attempt < 3) await new Promise((r) => setTimeout(r, (err?.status === 429 ? 1500 : 500) * (attempt + 1)));
    } finally {
      clearTimeout(timer);
      parentSignal.removeEventListener("abort", onAbort);
    }
  }
  throw lastErr || new Error("Image download failed");
}


async function fetchJsonTimeout(url, headers, parentSignal, timeoutMs = 45000) {
  const tCtrl = new AbortController();
  const timer = setTimeout(() => tCtrl.abort(), timeoutMs);
  const onAbort = () => tCtrl.abort();
  parentSignal.addEventListener("abort", onAbort, { once: true });
  try {
    return await fetch(url, {
      method: "GET",
      credentials: "include",
      headers,
      cache: "no-store",
      signal: tCtrl.signal,
    });
  } finally {
    clearTimeout(timer);
    parentSignal.removeEventListener("abort", onAbort);
  }
}

async function runBackgroundDownload(payload, existingCtrl) {
  const { apiBase, authHeaders, comic, chapter } = payload;
  const ctrl = existingCtrl || new AbortController();
  const updateState = async (patch) => {
    const prev = activeDownloads.get(chapter.id)?.state || {
      chapterId: chapter.id,
      comicId: comic.id,
      comicTitle: comic.title,
      chapterNumber: chapter.displayNumber ?? chapter.number,
      phase: "checking",
      completedPages: 0,
      totalPages: 0,
    };
    const next = { ...prev, ...patch };
    activeDownloads.set(chapter.id, { state: next, controller: ctrl });
    await broadcastProgress(next);
  };

  await updateState({ phase: "checking", completedPages: 0, totalPages: 0 });

  try {
    const metaRes = await fetchJsonTimeout(`${apiBase}/chapters/${encodeURIComponent(chapter.id)}`, authHeaders, ctrl.signal, 45000);
    if (metaRes.status === 404) throw new Error("This chapter is no longer published.");
    if (!metaRes.ok) throw new Error(`Chapter check failed (${metaRes.status})`);
    const meta = await metaRes.json();
    if (!meta?.comic || meta.comic.id !== comic.id) {
      throw new Error("Chapter does not belong to this published comic.");
    }

    const collected = [];
    let from = 0;
    let total = Infinity;
    for (let b = 0; b < 70; b++) {
      const imgRes = await fetchJsonTimeout(`${apiBase}/chapters/${encodeURIComponent(chapter.id)}/images?from=${from}&limit=100`, authHeaders, ctrl.signal, 45000);
      if (!imgRes.ok) throw new Error(`Could not load chapter pages (${imgRes.status})`);
      const batch = await imgRes.json();
      total = typeof batch.total === "number" ? batch.total : collected.length;
      const items = Array.isArray(batch.items) ? batch.items : [];
      if (items.length === 0) break;
      collected.push(...items);
      from += items.length;
      if (collected.length >= total) break;
    }

    collected.sort((a, b) => a.position - b.position);
    if (collected.length === 0) throw new Error("This chapter has no downloadable pages.");

    const totalPages = collected.length;
    await updateState({ phase: "downloading", completedPages: 0, totalPages });

    // Cover fetch (best-effort)
    let coverBlob = null;
    try {
      const db = await openOfflineDb();
      const tx = db.transaction(STORE_COVERS, "readonly");
      const existing = await reqPromise(tx.objectStore(STORE_COVERS).get(comic.id));
      if (!existing) {
        const apiCoverUrl = `${apiBase}/comics/${encodeURIComponent(comic.id)}/cover/file`;
        const candidates = comic.coverUrl && isSameOriginOrApi(comic.coverUrl, apiBase)
          ? [comic.coverUrl, apiCoverUrl]
          : [apiCoverUrl];
        for (const cUrl of candidates) {
          try {
            const res = await fetchImageWithRetry(cUrl, true, authHeaders, ctrl.signal);
            coverBlob = res.blob;
            break;
          } catch {}
        }
      }
    } catch {}

    const downloadedPages = new Array(totalPages);
    let nextIdx = 0;
    let completed = 0;

    async function worker() {
      while (true) {
        const idx = nextIdx++;
        if (idx >= totalPages) return;
        const item = collected[idx];
        const internal = isSameOriginOrApi(item.url, apiBase);
        const targetUrl = internal
          ? item.url
          : `${apiBase}/chapters/${encodeURIComponent(chapter.id)}/pages/${idx}/file`;
        const { blob, width, height } = await fetchImageWithRetry(targetUrl, true, authHeaders, ctrl.signal);
        downloadedPages[idx] = {
          position: idx,
          width: item.width > 0 ? item.width : width,
          height: item.height > 0 ? item.height : height,
          mimeType: blob.type || "image/jpeg",
          sizeBytes: blob.size,
          blob,
        };
        completed++;
        await updateState({ phase: "downloading", completedPages: completed, totalPages });
      }
    }

    await Promise.all(Array.from({ length: Math.min(2, totalPages) }, () => worker()));

    await updateState({ phase: "verifying", completedPages: totalPages, totalPages });
    const totalBytes = downloadedPages.reduce((s, p) => s + p.sizeBytes, 0);

    await saveChapterToDb({
      comic: {
        comicId: comic.id,
        slug: comic.slug,
        title: comic.title,
        author: comic.author,
        artist: comic.artist,
        status: comic.status,
        type: comic.type,
        hue: comic.hue,
        coverUrl: comic.coverUrl,
      },
      chapter: {
        chapterId: chapter.id,
        comicId: comic.id,
        number: meta.number ?? chapter.number,
        displayNumber: meta.displayNumber ?? chapter.displayNumber,
        title: meta.title ?? chapter.title,
        publishedAt: chapter.publishedAt,
        pageCount: totalPages,
        totalBytes,
        sourceType: meta.external ? "provider" : "uploaded",
      },
      pages: downloadedPages,
      coverBlob,
    });

    await updateState({ phase: "saved", completedPages: totalPages, totalPages });
  } catch (err) {
    await deleteChapterPagesFromDb(chapter.id).catch(() => {});
    const isAbort = ctrl.signal.aborted || (err && err.name === "AbortError");
    const isQuota = err && (err.name === "QuotaExceededError" || err.code === 22);
    const errorMsg = isAbort
      ? "Download canceled."
      : isQuota
      ? "Storage quota exceeded. Remove some downloads to free space."
      : err?.message || "Download failed.";
    await updateState({
      phase: isAbort ? "canceled" : "failed",
      completedPages: 0,
      totalPages: 0,
      error: errorMsg,
    });
  } finally {
    activeDownloads.delete(chapter.id);
  }
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
  } else if (data.type === "START_CHAPTER_DOWNLOAD" && data.payload) {
    event.waitUntil(enqueueBackgroundDownload(data.payload));
  } else if (data.type === "CANCEL_CHAPTER_DOWNLOAD" && data.chapterId) {
    const entry = activeDownloads.get(data.chapterId);
    if (entry) entry.controller.abort();
  } else if (data.type === "GET_DOWNLOAD_STATES") {
    const list = Array.from(activeDownloads.values()).map((v) => v.state);
    if (event.source) {
      event.source.postMessage({ type: "DOWNLOAD_STATES_SNAPSHOT", states: list });
    }
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

  if (req.mode === "navigate" && url.pathname === "/downloads") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          const networkRes = await fetch(req);
          if (networkRes && networkRes.ok) {
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
            "<!doctype html><html><body style='background:#131118;color:#f5f3fa;font-family:system-ui,sans-serif;padding:24px'><h1>You are offline</h1><p>Open ComicVerse once while online to enable offline Downloads.</p></body></html>",
            { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
          );
        }
      })(),
    );
    return;
  }

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
