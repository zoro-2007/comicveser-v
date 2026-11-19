const DB_NAME = "comicverse-offline";
const STORE = "chapters";
const CACHE_PREFIX = "comicverse-chapter-v1-";
export const DOWNLOADS_PATH = "/downloads";

export function chapterCacheName(token) {
  return CACHE_PREFIX + token;
}

export function localImagePath(token, index) {
  return `/offline-media/${token}/${index}`;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function transact(mode, operation) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = operation(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error ?? request.error ?? new Error("Local storage transaction failed."));
    });
  } finally {
    db.close();
  }
}

export const listDownloads = () => transact("readonly", (store) => store.getAll());
export const getDownload = (id) => transact("readonly", (store) => store.get(id));
export const addDownload = (entry) => transact("readwrite", (store) => store.add(entry));

export async function deleteDownload(entry) {
  // Only remove the exact copy the UI is displaying, even across tabs.
  const db = await openDatabase();
  try {
    const removed = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const request = store.get(entry.id);
      let matched = false;
      request.onsuccess = () => {
        if (request.result?.token !== entry.token) return;
        matched = true;
        store.delete(entry.id);
      };
      tx.oncomplete = () => resolve(matched);
      tx.onabort = () => reject(tx.error ?? new Error("Could not remove the download."));
    });
    if (removed) await caches.delete(chapterCacheName(entry.token));
  } finally {
    db.close();
  }
}

export async function cleanupStaleDownloads() {
  const saved = new Set((await listDownloads()).map((entry) => chapterCacheName(entry.token)));
  for (const name of await caches.keys()) {
    if (!name.startsWith(CACHE_PREFIX) || saved.has(name)) continue;
    const created = Number(name.slice(CACHE_PREFIX.length).split("-")[0]);
    // An uncommitted cache might still belong to a tab downloading a chapter.
    if (created && Date.now() - created > 24 * 60 * 60 * 1000) await caches.delete(name);
  }
}

let registration;
export function installOfflineWorker() {
  if (!window.isSecureContext || !("serviceWorker" in navigator) || !("caches" in window) || !("indexedDB" in window)) {
    return Promise.reject(new Error("Downloads require HTTPS (or localhost) and browser storage."));
  }
  registration ??= navigator.serviceWorker.register("/offline-sw.js", { scope: "/", updateViaCache: "none" })
    .catch((error) => { registration = undefined; throw error; });
  return registration;
}

export async function prepareOfflineStorage(signal) {
  signal.throwIfAborted();
  await installOfflineWorker();
  const workers = navigator.serviceWorker;
  if (workers.controller?.scriptURL.endsWith("/offline-sw.js")) return;
  await new Promise((resolve, reject) => {
    function finish(error) {
      clearTimeout(timer);
      workers.removeEventListener("controllerchange", check);
      signal.removeEventListener("abort", cancel);
      if (error) reject(error); else resolve();
    }
    function check() {
      if (workers.controller?.scriptURL.endsWith("/offline-sw.js")) finish();
    }
    function cancel() { finish(signal.reason); }
    const timer = setTimeout(() => finish(new Error("Could not start offline storage. Reload this page while online and try again.")), 15000);
    workers.addEventListener("controllerchange", check);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel(); else check();
  });
}
