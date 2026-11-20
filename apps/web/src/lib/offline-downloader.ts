"use client";

import { API, buildAuthHeaders } from "./api";
import access from "../../public/offline/access.js";
import type { Chapter, Comic } from "./comics";
import type { ChapterMeta, Img, ImgPage } from "@/components/Reader";
import {
  getDownloadedCover,
  isQuotaExceededError,
  saveChapterOffline,
} from "./offline-db";

export type DownloadPhase =
  | "idle"
  | "checking"
  | "downloading"
  | "verifying"
  | "saved"
  | "failed"
  | "canceled";

export interface ChapterDownloadState {
  chapterId: string;
  comicId: string;
  comicTitle?: string;
  chapterNumber?: string | number;
  phase: DownloadPhase;
  completedPages: number;
  totalPages: number;
  error?: string;
}

const IMAGE_BATCH_LIMIT = 100;
const MAX_BATCH_ITERATIONS = 70;
const MAX_PAGE_RETRIES = 3;
const PAGE_TIMEOUT_MS = 45_000;
const CONCURRENCY = 2;
const CHANNEL_NAME = "comicverse-offline-downloads";

const states = new Map<string, ChapterDownloadState>();
const controllers = new Map<string, AbortController>();
const swAcked = new Set<string>();
const listeners = new Set<() => void>();
let bridgeInitialized = false;
let disableGeneration = 0;

function notify() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // Ignore subscriber errors
    }
  }
}

function setState(chapterId: string, next: ChapterDownloadState) {
  states.set(chapterId, next);
  notify();
}

function initSwBridge() {
  if (bridgeInitialized || typeof window === "undefined") return;
  bridgeInitialized = true;
  access.onChange((setting) => {
    if (setting.enabled && !setting.purgePending) return;
    disableGeneration++;
    for (const controller of controllers.values()) controller.abort();
    navigator.serviceWorker?.controller?.postMessage({ type: "CANCEL_ALL_CHAPTER_DOWNLOADS" });
  });

  if (typeof BroadcastChannel !== "undefined") {
    try {
      const bc = new BroadcastChannel(CHANNEL_NAME);
      bc.onmessage = (event) => {
        const data = event.data;
        if (data?.type === "DOWNLOAD_PROGRESS" && data.state?.chapterId) {
          swAcked.add(data.state.chapterId);
          setState(data.state.chapterId, data.state as ChapterDownloadState);
        }
      };
    } catch {
      // Ignore BroadcastChannel errors
    }
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      const data = event.data;
      if (data?.type === "DOWNLOAD_PROGRESS" && data.state?.chapterId) {
        swAcked.add(data.state.chapterId);
          setState(data.state.chapterId, data.state as ChapterDownloadState);
      } else if (data?.type === "DOWNLOAD_STATES_SNAPSHOT" && Array.isArray(data.states)) {
        const activeIds = new Set((data.states as ChapterDownloadState[]).map((s) => s.chapterId));
        for (const [id, st] of states.entries()) {
          if (!controllers.has(id) && !activeIds.has(id) && (st.phase === "checking" || st.phase === "downloading" || st.phase === "verifying")) {
            states.delete(id);
          }
        }
        for (const st of data.states as ChapterDownloadState[]) {
          if (st?.chapterId) states.set(st.chapterId, st);
        }
        notify();
      }
    });
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "GET_DOWNLOAD_STATES" });
    }
  }
}

export function subscribeDownloads(fn: () => void): () => void {
  initSwBridge();
  listeners.add(fn);
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: "GET_DOWNLOAD_STATES" });
  }
  return () => {
    listeners.delete(fn);
  };
}

export function getDownloadState(chapterId: string): ChapterDownloadState | undefined {
  initSwBridge();
  return states.get(chapterId);
}

export function getAllActiveDownloads(): ChapterDownloadState[] {
  initSwBridge();
  return Array.from(states.values()).filter(
    (s) => s.phase === "checking" || s.phase === "downloading" || s.phase === "verifying",
  );
}

export function clearDownloadState(chapterId: string) {
  states.delete(chapterId);
  notify();
}

export function cancelChapterDownload(chapterId: string) {
  const ctrl = controllers.get(chapterId);
  if (ctrl) {
    ctrl.abort();
  }
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: "CANCEL_CHAPTER_DOWNLOAD",
      chapterId,
    });
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isSameOriginOrApiUrl(url: string): boolean {
  if (url.startsWith("/")) return true;
  try {
    const parsed = new URL(url, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    if (typeof window !== "undefined" && parsed.origin === window.location.origin) return true;
    if (/^https?:\/\//i.test(API)) {
      const apiOrigin = new URL(API).origin;
      if (parsed.origin === apiOrigin) return true;
    }
  } catch {
    return false;
  }
  return false;
}

async function fetchJsonWithSignal<T>(path: string, signal: AbortSignal): Promise<{ status: number; data: T }> {
  const url = `${API}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    headers: buildAuthHeaders(),
    cache: "no-store",
    signal,
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    const msg = errBody?.message ?? errBody?.error?.message ?? `Request failed (${res.status})`;
    const err = new Error(typeof msg === "string" ? msg : `Request failed (${res.status})`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  const data = (await res.json()) as T;
  return { status: res.status, data };
}

async function verifyRenderableImageBlob(blob: Blob): Promise<{ width: number; height: number }> {
  if (!blob || blob.size === 0) {
    throw new Error("Empty image response");
  }
  if (blob.type && !blob.type.startsWith("image/") && blob.type !== "application/octet-stream") {
    throw new Error(`Unexpected content type: ${blob.type}`);
  }

  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    const width = bitmap.width;
    const height = bitmap.height;
    bitmap.close();
    if (width <= 0 || height <= 0) {
      throw new Error("Decoded image has zero dimensions");
    }
    return { width, height };
  }

  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      URL.revokeObjectURL(url);
      if (width <= 0 || height <= 0) {
        reject(new Error("Decoded image has zero dimensions"));
      } else {
        resolve({ width, height });
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image failed to decode"));
    };
    img.src = url;
  });
}

async function fetchAndVerifyImage(url: string, parentSignal: AbortSignal): Promise<{ blob: Blob; width: number; height: number }> {
  const internal = isSameOriginOrApiUrl(url);
  let lastErr: unknown;

  for (let attempt = 0; attempt <= MAX_PAGE_RETRIES; attempt++) {
    if (parentSignal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const timeoutCtrl = new AbortController();
    const timer = setTimeout(() => timeoutCtrl.abort(), PAGE_TIMEOUT_MS);
    const onParentAbort = () => timeoutCtrl.abort();
    parentSignal.addEventListener("abort", onParentAbort, { once: true });

    try {
      const res = await fetch(url, {
        method: "GET",
        mode: "cors",
        credentials: internal ? "include" : "omit",
        headers: internal ? buildAuthHeaders() : undefined,
        referrerPolicy: "no-referrer",
        cache: "no-store",
        signal: timeoutCtrl.signal,
      });

      await access.rejectIfDisabledResponse(res);
      if (!res.ok) {
        const statusErr = new Error(`Image request failed (${res.status})`) as Error & { status?: number };
        statusErr.status = res.status;
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
          throw statusErr;
        }
        throw statusErr;
      }

      const blob = await res.blob();
      const dims = await verifyRenderableImageBlob(blob);
      return { blob, width: dims.width, height: dims.height };
    } catch (err) {
      if ((err as { code?: string })?.code === access.errorCode) throw err;
      if (parentSignal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      lastErr = err;
      const status = (err as { status?: number })?.status;
      if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
        throw err;
      }
      if (attempt < MAX_PAGE_RETRIES) {
        await sleep((status === 429 ? 1500 : 500) * (attempt + 1), parentSignal);
      }
    } finally {
      clearTimeout(timer);
      parentSignal.removeEventListener("abort", onParentAbort);
    }
  }

  throw lastErr ?? new Error("Failed to download image");
}

async function resolveAllChapterImages(
  chapterId: string,
  signal: AbortSignal,
): Promise<Img[]> {
  const collected: Img[] = [];
  let from = 0;
  let total = Infinity;

  for (let batchIdx = 0; batchIdx < MAX_BATCH_ITERATIONS; batchIdx++) {
    const { data } = await fetchJsonWithSignal<ImgPage>(
      `/chapters/${encodeURIComponent(chapterId)}/images?from=${from}&limit=${IMAGE_BATCH_LIMIT}`,
      signal,
    );
    total = typeof data.total === "number" ? data.total : collected.length;
    const items = Array.isArray(data.items) ? data.items : [];
    if (items.length === 0) break;
    collected.push(...items);
    from += items.length;
    if (collected.length >= total) break;
  }

  collected.sort((a, b) => a.position - b.position);
  return collected;
}

export async function startChapterDownload(comic: Comic, chapter: Chapter): Promise<boolean> {
  initSwBridge();
  const existingState = states.get(chapter.id);
  if (
    controllers.has(chapter.id) ||
    existingState?.phase === "checking" ||
    existingState?.phase === "downloading" ||
    existingState?.phase === "verifying"
  ) {
    return false;
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    setState(chapter.id, {
      chapterId: chapter.id,
      comicId: comic.id,
      comicTitle: comic.title,
      chapterNumber: chapter.displayNumber ?? chapter.number,
      phase: "failed",
      completedPages: 0,
      totalPages: 0,
      error: "You are offline. Connect to the internet to download chapters.",
    });
    return false;
  }

  const generation = disableGeneration;
  let purgeRevision: number;
  try {
    ({ purgeRevision } = await access.requireEnabled(API));
  } catch {
    return false;
  }
  const pending = states.get(chapter.id)?.phase;
  if (generation !== disableGeneration || controllers.has(chapter.id)
    || pending === "checking" || pending === "downloading" || pending === "verifying") return false;

  // Prefer Service Worker background execution so downloads survive page navigation & mobile backgrounding
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator && navigator.serviceWorker.controller) {
    swAcked.delete(chapter.id);
    setState(chapter.id, {
      chapterId: chapter.id,
      comicId: comic.id,
      comicTitle: comic.title,
      chapterNumber: chapter.displayNumber ?? chapter.number,
      phase: "checking",
      completedPages: 0,
      totalPages: 0,
    });
    navigator.serviceWorker.controller.postMessage({
      type: "START_CHAPTER_DOWNLOAD",
      payload: {
        apiBase: API,
        purgeRevision,
        authHeaders: buildAuthHeaders(),
        comic: {
          id: comic.id,
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
          id: chapter.id,
          number: chapter.number,
          displayNumber: chapter.displayNumber,
          title: chapter.title,
          publishedAt: chapter.publishedAt,
        },
      },
    });
    // Watchdog: if an older SW did not acknowledge within 2s, fall back to in-page download automatically
    const ackOk = await new Promise<boolean>((resolve) => {
      const check = () => {
        if (swAcked.has(chapter.id)) {
          cleanup();
          resolve(true);
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve(swAcked.has(chapter.id));
      }, 2000);
      const unsub = subscribeDownloads(check);
      const cleanup = () => {
        clearTimeout(timer);
        unsub();
      };
      check();
    });
    if (ackOk) {
      return true;
    }
    if (generation !== disableGeneration) {
      setState(chapter.id, {
        chapterId: chapter.id,
        comicId: comic.id,
        phase: "canceled",
        completedPages: 0,
        totalPages: 0,
        error: access.errorMessage,
      });
      return false;
    }
  }

  // Fallback in-page execution when SW is not controlling yet
  const ctrl = new AbortController();
  controllers.set(chapter.id, ctrl);

  setState(chapter.id, {
    chapterId: chapter.id,
    comicId: comic.id,
    comicTitle: comic.title,
    chapterNumber: chapter.displayNumber ?? chapter.number,
    phase: "checking",
    completedPages: 0,
    totalPages: 0,
  });

  try {
    let meta: ChapterMeta;
    try {
      const res = await fetchJsonWithSignal<ChapterMeta>(`/chapters/${encodeURIComponent(chapter.id)}`, ctrl.signal);
      meta = res.data;
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 404) {
        throw new Error("This chapter is no longer published.");
      }
      throw err;
    }

    if (!meta?.comic || meta.comic.id !== comic.id) {
      throw new Error("Chapter does not belong to this published comic.");
    }

    const items = await resolveAllChapterImages(meta.id, ctrl.signal);
    const sourceType = meta.external ? "provider" : "uploaded";
    if (items.length === 0) {
      throw new Error("This chapter has no downloadable pages.");
    }

    const totalPages = items.length;
    setState(chapter.id, {
      chapterId: chapter.id,
      comicId: comic.id,
      comicTitle: comic.title,
      chapterNumber: chapter.displayNumber ?? chapter.number,
      phase: "downloading",
      completedPages: 0,
      totalPages,
    });

    let coverBlob: Blob | null = null;
    {
      const existingCover = await getDownloadedCover(comic.id).catch(() => null);
      if (!existingCover) {
        const apiCoverUrl = `${API}/comics/${encodeURIComponent(comic.id)}/cover/file`;
        const candidates = comic.coverUrl && isSameOriginOrApiUrl(comic.coverUrl)
          ? [comic.coverUrl, apiCoverUrl]
          : [apiCoverUrl];
        for (const candidateUrl of candidates) {
          try {
            const verifiedCover = await fetchAndVerifyImage(candidateUrl, ctrl.signal);
            coverBlob = verifiedCover.blob;
            break;
          } catch {
            coverBlob = null;
          }
        }
      }
    }

    const downloadedPages: Array<{
      position: number;
      width: number;
      height: number;
      mimeType: string;
      sizeBytes: number;
      blob: Blob;
    }> = new Array(items.length);

    let nextIndex = 0;
    let completedCount = 0;

    async function worker() {
      while (true) {
        const idx = nextIndex++;
        if (idx >= items.length) return;
        if (ctrl.signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        const img = items[idx];
        const pageFetchUrl = isSameOriginOrApiUrl(img.url)
          ? img.url
          : `${API}/chapters/${encodeURIComponent(chapter.id)}/pages/${idx}/file`;
        const { blob, width, height } = await fetchAndVerifyImage(pageFetchUrl, ctrl.signal);
        downloadedPages[idx] = {
          position: idx,
          width: img.width > 0 ? img.width : width,
          height: img.height > 0 ? img.height : height,
          mimeType: blob.type || "image/jpeg",
          sizeBytes: blob.size,
          blob,
        };
        completedCount++;
        setState(chapter.id, {
          chapterId: chapter.id,
          comicId: comic.id,
          comicTitle: comic.title,
          chapterNumber: chapter.displayNumber ?? chapter.number,
          phase: "downloading",
          completedPages: completedCount,
          totalPages,
        });
      }
    }

    const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, () => worker());
    await Promise.all(workers);

    if (ctrl.signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    setState(chapter.id, {
      chapterId: chapter.id,
      comicId: comic.id,
      comicTitle: comic.title,
      chapterNumber: chapter.displayNumber ?? chapter.number,
      phase: "verifying",
      completedPages: totalPages,
      totalPages,
    });

    const totalBytes = downloadedPages.reduce((sum, p) => sum + p.sizeBytes, 0);

    await access.requireEnabled(API);
    if (ctrl.signal.aborted) throw new DOMException("Aborted", "AbortError");
    await access.commitDownload(purgeRevision, () => saveChapterOffline({
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
        pageCount: downloadedPages.length,
        totalBytes,
        sourceType,
      },
      pages: downloadedPages,
      coverBlob,
    }));

    setState(chapter.id, {
      chapterId: chapter.id,
      comicId: comic.id,
      comicTitle: comic.title,
      chapterNumber: chapter.displayNumber ?? chapter.number,
      phase: "saved",
      completedPages: totalPages,
      totalPages,
    });
    return true;
  } catch (err) {
    if (ctrl.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
      setState(chapter.id, {
        chapterId: chapter.id,
        comicId: comic.id,
        comicTitle: comic.title,
        chapterNumber: chapter.displayNumber ?? chapter.number,
        phase: "canceled",
        completedPages: 0,
        totalPages: 0,
        error: "Download canceled.",
      });
      return false;
    }

    const message = isQuotaExceededError(err)
      ? "Storage quota exceeded. Remove some downloads to free space."
      : err instanceof Error && err.message
      ? err.message
      : "Download failed. Please try again.";

    setState(chapter.id, {
      chapterId: chapter.id,
      comicId: comic.id,
      comicTitle: comic.title,
      chapterNumber: chapter.displayNumber ?? chapter.number,
      phase: "failed",
      completedPages: 0,
      totalPages: 0,
      error: message,
    });
    return false;
  } finally {
    controllers.delete(chapter.id);
  }
}

function waitForChapterFinish(chapterId: string): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      const st = states.get(chapterId);
      if (!st || st.phase === "saved" || st.phase === "failed" || st.phase === "canceled") {
        unsub();
        resolve();
      }
    };
    const unsub = subscribeDownloads(check);
    check();
  });
}

export async function startBulkChapterDownloads(
  comic: Comic,
  chapters: Chapter[],
  maxConcurrentChapters = 5,
): Promise<void> {
  if (chapters.length === 0) return;
  initSwBridge();
  const generation = disableGeneration;
  let idx = 0;
  async function worker() {
    while (generation === disableGeneration) {
      const i = idx++;
      if (i >= chapters.length) return;
      const ch = chapters[i];
      const started = await startChapterDownload(comic, ch);
      if (started) {
        await waitForChapterFinish(ch.id);
      }
    }
  }
  const workers = Array.from(
    { length: Math.min(maxConcurrentChapters, chapters.length) },
    () => worker(),
  );
  await Promise.all(workers);
}

export function cancelBulkDownloads(chapterIds: string[]) {
  for (const id of chapterIds) {
    cancelChapterDownload(id);
  }
}
