/* Shared by the app, the offline HTML fallback and both service workers. */
(function () {
  const DB_NAME = "comicverse-download-policy-v1";
  const STORE = "access";
  const KEY = "global";
  const PURGED = "purged-revision";
  const LOCK = "comicverse-offline-download-data";
  const LEASE_MS = 24 * 60 * 60 * 1000;
  const CHANNEL = "comicverse-download-policy-v2";
  const listeners = new Set();
  const inFlight = new Map();
  const errorCode = "DOWNLOADS_DISABLED";
  const errorMessage = "Downloads and offline reading are disabled.";
  let channel;
  let dbPromise;
  let memory = null;
  let acknowledged = 0;
  let localQueue = Promise.resolve();

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }).catch((error) => {
        dbPromise = undefined;
        throw error;
      });
    }
    return dbPromise;
  }

  function prefer(old, next) {
    if (!old) return next;
    if (!next) return old;
    if (old.revision !== next.revision) return old.revision > next.revision ? old : next;
    if (old.enabled !== next.enabled) return old.enabled ? next : old;
    if ((old.purgeRevision ?? 0) !== (next.purgeRevision ?? 0)) {
      return (old.purgeRevision ?? 0) > (next.purgeRevision ?? 0) ? old : next;
    }
    return old.checkedAt > next.checkedAt ? old : next;
  }

  function isAllowed(record, now = Date.now()) {
    return Boolean(record?.enabled && !record.purgePending && now >= record.checkedAt && now < record.expiresAt);
  }

  function storedValue(store, key) {
    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function snapshot() {
    if (!memory) return null;
    const purgeRevision = memory.purgeRevision ?? 0;
    return { ...memory, purgeRevision, purgePending: purgeRevision > acknowledged };
  }

  async function readState() {
    try {
      const db = await open();
      const store = db.transaction(STORE).objectStore(STORE);
      const [saved, purged] = await Promise.all([storedValue(store, KEY), storedValue(store, PURGED)]);
      memory = prefer(memory, saved ?? null);
      acknowledged = Math.max(acknowledged, purged ?? 0);
    } catch {
      // Until durable cleanup succeeds, a known pending purge stays locked.
    }
    return snapshot();
  }

  async function write(key, value) {
    const db = await open();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
  }

  function exclusive(action) {
    if (typeof navigator !== "undefined" && navigator.locks?.request) {
      return navigator.locks.request(LOCK, action);
    }
    const next = localQueue.then(action, action);
    localQueue = next.catch(() => {});
    return next;
  }

  function clearStores(dbName, allowedStores) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName);
      let databaseDidNotExist = false;
      request.onupgradeneeded = () => {
        // Do not create an empty offline database before the downloader has initialized it.
        databaseDidNotExist = true;
        request.transaction.abort();
      };
      request.onerror = () => databaseDidNotExist ? resolve() : reject(request.error);
      request.onblocked = () => reject(new Error("Offline storage is busy."));
      request.onsuccess = () => {
        const db = request.result;
        const stores = allowedStores.filter((name) => db.objectStoreNames.contains(name));
        if (stores.length === 0) { db.close(); resolve(); return; }
        const tx = db.transaction(stores, "readwrite");
        for (const name of stores) tx.objectStore(name).clear();
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  }

  async function deleteSavedDownloads() {
    await Promise.all([
      clearStores("comicverse-offline-v1", ["comics", "chapters", "pages", "covers"]),
      clearStores("comicverse-offline", ["chapters"]),
      (async () => {
        if (typeof caches === "undefined") return;
        const names = await caches.keys();
        await Promise.all(names.filter((name) => name.startsWith("comicverse-chapter-v1-")).map((name) => caches.delete(name)));
      })(),
    ]);
  }

  // Caller holds the same lock used to commit saved downloads.
  async function finishPurge() {
    const state = await readState();
    if (!state?.purgePending) return state;
    publish(state);
    try {
      await deleteSavedDownloads();
      await write(PURGED, state.purgeRevision);
      acknowledged = Math.max(acknowledged, state.purgeRevision);
    } catch {
      // Leave unacknowledged so the next status check retries on this device.
      return snapshot();
    }
    const done = snapshot();
    publish(done);
    return done;
  }

  async function read() {
    const state = await readState();
    if (!state?.purgePending) return state;
    return exclusive(finishPurge);
  }

  function commitDownload(expectedPurgeRevision, action) {
    return exclusive(async () => {
      const state = await readState();
      if (!isAllowed(state) || state.purgeRevision !== expectedPurgeRevision) throw disabledError();
      return action();
    });
  }

  function notify(record) {
    if (!record) return;
    for (const listener of listeners) listener(record);
  }

  function publish(record) {
    notify(record);
    try { getChannel()?.postMessage("updated"); } catch { /* best-effort */ }
  }

  function getChannel() {
    if (!channel && typeof BroadcastChannel !== "undefined") {
      try {
        channel = new BroadcastChannel(CHANNEL);
        channel.onmessage = (event) => {
          if (event.data === "updated") void readState().then(notify).catch(() => {});
        };
      } catch { /* cross-tab updates are best-effort */ }
    }
    return channel;
  }

  function validSetting(setting) {
    return typeof setting?.enabled === "boolean" &&
      Number.isSafeInteger(setting.revision) && setting.revision >= 0 &&
      Number.isSafeInteger(setting.purgeRevision) && setting.purgeRevision >= 0;
  }

  async function remember(setting, checkedAt = Date.now()) {
    if (!validSetting(setting)) throw new Error("Unexpected download settings response.");
    const candidate = {
      enabled: setting.enabled,
      revision: setting.revision,
      purgeRevision: setting.purgeRevision,
      checkedAt,
      expiresAt: setting.enabled ? checkedAt + LEASE_MS : 0,
    };
    return exclusive(async () => {
      await readState();
      memory = prefer(memory, candidate);
      try { await write(KEY, memory); } catch { /* keep fail-closed state in memory */ }
      const state = snapshot();
      if (state.purgePending) return finishPurge();
      publish(state);
      return state;
    });
  }

  function onChange(listener) {
    listeners.add(listener);
    getChannel();
    return () => { listeners.delete(listener); };
  }

  function checkOnline(apiBase) {
    const endpoint = apiBase.replace(/\/+$/, "") + "/settings/offline-downloads";
    if (inFlight.has(endpoint)) return inFlight.get(endpoint);
    const checkedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const request = (async () => {
      const response = await fetch(endpoint, {
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Could not check whether downloads are enabled.");
      return remember(await response.json(), checkedAt);
    })().finally(() => {
      clearTimeout(timeout);
      inFlight.delete(endpoint);
    });
    inFlight.set(endpoint, request);
    return request;
  }

  function disabledError() {
    return Object.assign(new Error(errorMessage), { code: errorCode });
  }

  async function requireEnabled(apiBase) {
    const setting = await checkOnline(apiBase);
    if (!setting.enabled) throw disabledError();
    if (!isAllowed(setting)) throw new Error("Download permission could not be verified.");
    return setting;
  }

  async function rejectIfDisabledResponse(response) {
    if (response.status !== 403) return;
    const data = await response.clone().json().catch(() => null);
    if (data?.error?.code !== errorCode) return;
    await remember({
      enabled: false,
      revision: data.error.revision,
      purgeRevision: data.error.purgeRevision,
    });
    throw disabledError();
  }

  const access = {
    read, remember, isAllowed, onChange, checkOnline, requireEnabled, commitDownload,
    rejectIfDisabledResponse, errorCode, errorMessage,
  };
  if (typeof module === "object" && module.exports) module.exports = access;
  else globalThis.ComicVerseDownloadAccess = access;
})();
