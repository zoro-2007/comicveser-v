"use client";

import { API, buildAuthHeaders } from "./api";
import type { Chapter, Comic } from "./comics";
import type { ChapterMeta, Img, ImgPage } from "@/components/Reader";
import type { ExtPages } from "./sources";
import {
  deleteDownloadedChapter,
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
  phase: DownloadPhase;
  completedPages: number;
  totalPages: number;
  error?: string;
}

const IMAGE_BATCH_LIMIT = 20;
const MAX_BATCH_ITERATIONS = 50;
const MAX_PAGE_RETRIES = 2;
const PAGE_TIMEOUT_MS = 20_000;
const CONCURRENCY = 10;

const states = new Map<string, ChapterDownloadState>();
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // Ignore subscriber errors
    }
  }
}

export function subscribeDownloads(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getDownloadState(chapterId: string): ChapterDownloadState | undefined {
  return states.get(chapterId);
}

function setState(chapterId: string, next: ChapterDownloadState) {
  states.set(chapterId, next);
  notify();
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

/**
 * Verifies that a Blob actually decodes into a non-empty renderable image
 * before we ever persist it or mark a chapter saved.
 */
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

      if (!res.ok) {
        const statusErr = new Error(`Image request failed (${res.status})`) as Error & { status?: number };
        statusErr.status = res.status;
        // Do not retry permanent 4xx errors (except 408/429)
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
          throw statusErr;
        }
        throw statusErr;
      }

      const blob = await res.blob();
      const dims = await verifyRenderableImageBlob(blob);
      return { blob, width: dims.width, height: dims.height };
    } catch (err) {
      if (parentSignal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      lastErr = err;
      const status = (err as { status?: number })?.status;
      if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
        throw err;
      }
      if (attempt < MAX_PAGE_RETRIES) {
        await sleep(500 * (attempt + 1), parentSignal);
      }
    } finally {
      clearTimeout(timer);
      parentSignal.removeEventListener("abort", onParentAbort);
    }
  }

  throw lastErr ?? new Error("Failed to download image");
}

async function resolveAllChapterImages(
  meta: ChapterMeta,
  signal: AbortSignal,
): Promise<{ items: Img[]; sourceType: "uploaded" | "provider" }> {
  if (meta.external) {
    const { sourceId, mangaId, chapterId } = meta.external;
    const { data } = await fetchJsonWithSignal<ExtPages>(
      `/sources/${encodeURIComponent(sourceId)}/manga/${encodeURIComponent(mangaId)}/chapters/${encodeURIComponent(chapterId)}/pages`,
      signal,
    );
    const items: Img[] = (data.pages ?? [])
      .slice()
      .sort((a, b) => a.pageNumber - b.pageNumber)
      .map((p, idx) => ({
        id: `p${p.pageNumber}`,
        position: typeof p.pageNumber === "number" && p.pageNumber > 0 ? p.pageNumber - 1 : idx,
        width: p.width ?? 0,
        height: p.height ?? 0,
        url: p.imageUrl,
      }));
    return { items, sourceType: "provider" };
  }

  const collected: Img[] = [];
  let from = 0;
  let total = Infinity;

  for (let batchIdx = 0; batchIdx < MAX_BATCH_ITERATIONS; batchIdx++) {
    const { data } = await fetchJsonWithSignal<ImgPage>(
      `/chapters/${encodeURIComponent(meta.id)}/images?from=${from}&limit=${IMAGE_BATCH_LIMIT}`,
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
  return { items: collected, sourceType: "uploaded" };
}

export async function startChapterDownload(comic: Comic, chapter: Chapter): Promise<boolean> {
  if (controllers.has(chapter.id)) {
    return false;
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    setState(chapter.id, {
      chapterId: chapter.id,
      comicId: comic.id,
      phase: "failed",
      completedPages: 0,
      totalPages: 0,
      error: "You are offline. Connect to the internet to download chapters.",
    });
    return false;
  }

  const ctrl = new AbortController();
  controllers.set(chapter.id, ctrl);

  setState(chapter.id, {
    chapterId: chapter.id,
    comicId: comic.id,
    phase: "checking",
    completedPages: 0,
    totalPages: 0,
  });

  try {
    // 1. Recheck publication status & chapter-to-comic relationship via existing API.
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

    // 2. Resolve every page in order (including paginated batches for uploaded chapters).
    const { items, sourceType } = await resolveAllChapterImages(meta, ctrl.signal);
    if (items.length === 0) {
      throw new Error("This chapter has no downloadable pages.");
    }

    const totalPages = items.length;
    setState(chapter.id, {
      chapterId: chapter.id,
      comicId: comic.id,
      phase: "downloading",
      completedPages: 0,
      totalPages,
    });

    // 3. Download cover image if needed (best-effort so offline cover card renders).
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

    // 4. Download & verify all chapter page images with bounded concurrency.
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

    // 5. Persist atomically to IndexedDB only after all pages are verified.
    setState(chapter.id, {
      chapterId: chapter.id,
      comicId: comic.id,
      phase: "verifying",
      completedPages: totalPages,
      totalPages,
    });

    const totalBytes = downloadedPages.reduce((sum, p) => sum + p.sizeBytes, 0);

    await saveChapterOffline({
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
    });

    setState(chapter.id, {
      chapterId: chapter.id,
      comicId: comic.id,
      phase: "saved",
      completedPages: totalPages,
      totalPages,
    });
    return true;
  } catch (err) {
    // Ensure no partial chapter data remains in IndexedDB.
    await deleteDownloadedChapter(chapter.id).catch(() => {});

    if (ctrl.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
      setState(chapter.id, {
        chapterId: chapter.id,
        comicId: comic.id,
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

export async function startBulkChapterDownloads(
  comic: Comic,
  chapters: Chapter[],
  maxConcurrentChapters = 3,
): Promise<void> {
  if (chapters.length === 0) return;
  let idx = 0;
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= chapters.length) return;
      const ch = chapters[i];
      await startChapterDownload(comic, ch);
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
