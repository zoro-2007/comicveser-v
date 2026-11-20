"use client";

export interface OfflineComicRecord {
  comicId: string;
  slug: string;
  title: string;
  author?: string;
  artist?: string;
  status?: string;
  type?: string;
  hue: number;
  coverUrl: string | null;
  hasCoverBlob: boolean;
  updatedAt: number;
}

export interface OfflineChapterRecord {
  chapterId: string;
  comicId: string;
  number: number;
  displayNumber?: string;
  title: string;
  publishedAt: string;
  pageCount: number;
  totalBytes: number;
  downloadedAt: number;
  sourceType: "uploaded" | "provider";
}

export interface OfflinePageRecord {
  key: string; // `${chapterId}:${position}`
  chapterId: string;
  comicId: string;
  position: number;
  width: number;
  height: number;
  mimeType: string;
  sizeBytes: number;
  blob: Blob;
}

export interface OfflineCoverRecord {
  comicId: string;
  mimeType: string;
  sizeBytes: number;
  blob: Blob;
}

export interface DownloadedComicSummary {
  comic: OfflineComicRecord;
  chapters: OfflineChapterRecord[];
  totalBytes: number;
}

export interface OfflineStorageStats {
  comicCount: number;
  chapterCount: number;
  totalBytes: number;
  quotaBytes: number | null;
  usageBytes: number | null;
}

const DB_NAME = "comicverse-offline-v1";
const DB_VERSION = 1;

const STORE_COMICS = "comics";
const STORE_CHAPTERS = "chapters";
const STORE_PAGES = "pages";
const STORE_COVERS = "covers";

let dbPromise: Promise<IDBDatabase> | null = null;

function isIndexedDbAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) {
    return Promise.reject(new Error("IndexedDB is not available in this browser."));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
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
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error("Failed to open offline database."));
    };
  });
  return dbPromise;
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed."));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed."));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted."));
  });
}

export function isQuotaExceededError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  const code = (err as { code?: number }).code;
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" || code === 22 || code === 1014;
}

export async function getAllDownloadedComics(): Promise<DownloadedComicSummary[]> {
  if (!isIndexedDbAvailable()) return [];
  const db = await openDb();
  const tx = db.transaction([STORE_COMICS, STORE_CHAPTERS], "readonly");
  const [comics, chapters] = await Promise.all([
    reqToPromise(tx.objectStore(STORE_COMICS).getAll()) as Promise<OfflineComicRecord[]>,
    reqToPromise(tx.objectStore(STORE_CHAPTERS).getAll()) as Promise<OfflineChapterRecord[]>,
  ]);
  await txDone(tx);

  const byComic = new Map<string, OfflineChapterRecord[]>();
  for (const ch of chapters) {
    const list = byComic.get(ch.comicId) ?? [];
    list.push(ch);
    byComic.set(ch.comicId, list);
  }

  const summaries: DownloadedComicSummary[] = [];
  for (const comic of comics) {
    const list = (byComic.get(comic.comicId) ?? []).sort((a, b) => a.number - b.number);
    if (list.length === 0) continue;
    const totalBytes = list.reduce((sum, ch) => sum + (ch.totalBytes || 0), 0);
    summaries.push({ comic, chapters: list, totalBytes });
  }

  return summaries.sort((a, b) => b.comic.updatedAt - a.comic.updatedAt);
}

export async function getDownloadedComic(comicId: string): Promise<OfflineComicRecord | null> {
  if (!isIndexedDbAvailable()) return null;
  const db = await openDb();
  const tx = db.transaction(STORE_COMICS, "readonly");
  const rec = (await reqToPromise(tx.objectStore(STORE_COMICS).get(comicId))) as OfflineComicRecord | undefined;
  await txDone(tx);
  return rec ?? null;
}

export async function getDownloadedChaptersForComic(comicId: string): Promise<OfflineChapterRecord[]> {
  if (!isIndexedDbAvailable()) return [];
  const db = await openDb();
  const tx = db.transaction(STORE_CHAPTERS, "readonly");
  const idx = tx.objectStore(STORE_CHAPTERS).index("by_comic");
  const rows = (await reqToPromise(idx.getAll(IDBKeyRange.only(comicId)))) as OfflineChapterRecord[];
  await txDone(tx);
  return rows.sort((a, b) => a.number - b.number);
}

export async function getDownloadedChapter(chapterId: string): Promise<OfflineChapterRecord | null> {
  if (!isIndexedDbAvailable()) return null;
  const db = await openDb();
  const tx = db.transaction(STORE_CHAPTERS, "readonly");
  const row = (await reqToPromise(tx.objectStore(STORE_CHAPTERS).get(chapterId))) as OfflineChapterRecord | undefined;
  await txDone(tx);
  return row ?? null;
}

export async function getDownloadedChapterIdsForComic(comicId: string): Promise<Set<string>> {
  const rows = await getDownloadedChaptersForComic(comicId);
  return new Set(rows.map((r) => r.chapterId));
}

export async function getDownloadedChapterPages(chapterId: string): Promise<OfflinePageRecord[]> {
  if (!isIndexedDbAvailable()) return [];
  const db = await openDb();
  const tx = db.transaction(STORE_PAGES, "readonly");
  const idx = tx.objectStore(STORE_PAGES).index("by_chapter");
  const rows = (await reqToPromise(idx.getAll(IDBKeyRange.only(chapterId)))) as OfflinePageRecord[];
  await txDone(tx);
  return rows.sort((a, b) => a.position - b.position);
}

export async function getDownloadedCover(comicId: string): Promise<OfflineCoverRecord | null> {
  if (!isIndexedDbAvailable()) return null;
  const db = await openDb();
  const tx = db.transaction(STORE_COVERS, "readonly");
  const row = (await reqToPromise(tx.objectStore(STORE_COVERS).get(comicId))) as OfflineCoverRecord | undefined;
  await txDone(tx);
  return row ?? null;
}


export async function saveDownloadedCover(comicId: string, blob: Blob): Promise<void> {
  if (!isIndexedDbAvailable() || !blob || blob.size === 0) return;
  const db = await openDb();
  const tx = db.transaction([STORE_COVERS, STORE_COMICS], "readwrite");
  tx.objectStore(STORE_COVERS).put({
    comicId,
    mimeType: blob.type || "image/jpeg",
    sizeBytes: blob.size,
    blob,
  } satisfies OfflineCoverRecord);
  const comicReq = tx.objectStore(STORE_COMICS).get(comicId);
  comicReq.onsuccess = () => {
    const rec = comicReq.result as OfflineComicRecord | undefined;
    if (rec && !rec.hasCoverBlob) {
      tx.objectStore(STORE_COMICS).put({ ...rec, hasCoverBlob: true });
    }
  };
  await txDone(tx);
}

export async function saveChapterOffline(input: {
  comic: Omit<OfflineComicRecord, "updatedAt" | "hasCoverBlob">;
  chapter: Omit<OfflineChapterRecord, "downloadedAt">;
  pages: Array<Omit<OfflinePageRecord, "key" | "chapterId" | "comicId">>;
  coverBlob?: Blob | null;
}): Promise<void> {
  const db = await openDb();
  const now = Date.now();

  // First remove any stale pages for this chapterId to avoid orphaned pages on re-download.
  await deleteChapterPagesOnly(input.chapter.chapterId);

  // Check existing cover in a separate readonly transaction so the readwrite tx has zero awaits before .put()
  const existingCover = await getDownloadedCover(input.comic.comicId).catch(() => null);
  const hasCoverBlob = Boolean(input.coverBlob || existingCover);

  const tx = db.transaction([STORE_COMICS, STORE_CHAPTERS, STORE_PAGES, STORE_COVERS], "readwrite");
  const comicsStore = tx.objectStore(STORE_COMICS);
  const chaptersStore = tx.objectStore(STORE_CHAPTERS);
  const pagesStore = tx.objectStore(STORE_PAGES);
  const coversStore = tx.objectStore(STORE_COVERS);

  try {

    if (input.coverBlob && input.coverBlob.size > 0) {
      const coverRec: OfflineCoverRecord = {
        comicId: input.comic.comicId,
        mimeType: input.coverBlob.type || "image/jpeg",
        sizeBytes: input.coverBlob.size,
        blob: input.coverBlob,
      };
      coversStore.put(coverRec);
    }

    const comicRec: OfflineComicRecord = {
      ...input.comic,
      hasCoverBlob,
      updatedAt: now,
    };
    comicsStore.put(comicRec);

    for (const p of input.pages) {
      const pageRec: OfflinePageRecord = {
        key: `${input.chapter.chapterId}:${p.position}`,
        chapterId: input.chapter.chapterId,
        comicId: input.comic.comicId,
        position: p.position,
        width: p.width,
        height: p.height,
        mimeType: p.mimeType,
        sizeBytes: p.sizeBytes,
        blob: p.blob,
      };
      pagesStore.put(pageRec);
    }

    const chapterRec: OfflineChapterRecord = {
      ...input.chapter,
      downloadedAt: now,
    };
    chaptersStore.put(chapterRec);

    await txDone(tx);
  } catch (err) {
    try {
      tx.abort();
    } catch {
      // Ignore abort errors
    }
    throw err;
  }
}

async function deleteChapterPagesOnly(chapterId: string): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  const db = await openDb();
  const tx = db.transaction(STORE_PAGES, "readwrite");
  const idx = tx.objectStore(STORE_PAGES).index("by_chapter");
  const keys = await reqToPromise(idx.getAllKeys(IDBKeyRange.only(chapterId)));
  const store = tx.objectStore(STORE_PAGES);
  for (const k of keys) {
    store.delete(k);
  }
  await txDone(tx);
}

export async function deleteDownloadedChapter(chapterId: string): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  const db = await openDb();
  const ch = await getDownloadedChapter(chapterId);
  if (!ch) {
    await deleteChapterPagesOnly(chapterId);
    return;
  }

  const remaining = await getDownloadedChaptersForComic(ch.comicId);
  const otherChapters = remaining.filter((r) => r.chapterId !== chapterId);

  const tx = db.transaction([STORE_COMICS, STORE_CHAPTERS, STORE_PAGES, STORE_COVERS], "readwrite");
  const pagesStore = tx.objectStore(STORE_PAGES);
  const pageKeys = await reqToPromise(pagesStore.index("by_chapter").getAllKeys(IDBKeyRange.only(chapterId)));
  for (const k of pageKeys) {
    pagesStore.delete(k);
  }
  tx.objectStore(STORE_CHAPTERS).delete(chapterId);

  if (otherChapters.length === 0) {
    tx.objectStore(STORE_COMICS).delete(ch.comicId);
    tx.objectStore(STORE_COVERS).delete(ch.comicId);
  }

  await txDone(tx);
}


export async function deleteDownloadedChapters(chapterIds: string[]): Promise<void> {
  for (const id of chapterIds) {
    await deleteDownloadedChapter(id);
  }
}

export async function deleteDownloadedComic(comicId: string): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  const db = await openDb();
  const tx = db.transaction([STORE_COMICS, STORE_CHAPTERS, STORE_PAGES, STORE_COVERS], "readwrite");

  const pagesStore = tx.objectStore(STORE_PAGES);
  const pageKeys = await reqToPromise(pagesStore.index("by_comic").getAllKeys(IDBKeyRange.only(comicId)));
  for (const k of pageKeys) {
    pagesStore.delete(k);
  }

  const chaptersStore = tx.objectStore(STORE_CHAPTERS);
  const chapterKeys = await reqToPromise(chaptersStore.index("by_comic").getAllKeys(IDBKeyRange.only(comicId)));
  for (const k of chapterKeys) {
    chaptersStore.delete(k);
  }

  tx.objectStore(STORE_COMICS).delete(comicId);
  tx.objectStore(STORE_COVERS).delete(comicId);
  await txDone(tx);
}

export async function getOfflineStorageStats(): Promise<OfflineStorageStats> {
  const summaries = await getAllDownloadedComics();
  const comicCount = summaries.length;
  let chapterCount = 0;
  let totalBytes = 0;
  for (const s of summaries) {
    chapterCount += s.chapters.length;
    totalBytes += s.totalBytes;
  }
  let quotaBytes: number | null = null;
  let usageBytes: number | null = null;
  if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
    try {
      const est = await navigator.storage.estimate();
      quotaBytes = typeof est.quota === "number" ? est.quota : null;
      usageBytes = typeof est.usage === "number" ? est.usage : null;
    } catch {
      // Ignore storage estimate errors
    }
  }
  return { comicCount, chapterCount, totalBytes, quotaBytes, usageBytes };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val >= 10 || idx === 0 ? Math.round(val) : val.toFixed(1)} ${units[idx]}`;
}
