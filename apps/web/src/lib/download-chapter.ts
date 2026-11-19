import { api } from "@/lib/api";
import type { ChapterMeta, Img, ImgPage } from "@/components/Reader";
import type { ExtPages } from "@/lib/sources";
import {
  addDownload,
  chapterCacheName,
  getDownload,
  localImagePath,
  prepareOfflineStorage,
} from "../../public/offline/storage.mjs";

export interface DownloadComic {
  id: string;
  title: string;
  coverUrl: string | null;
}
type Progress = { done: number; total: number } | null;
const BATCH = 30;
const MAX_PAGE_COUNT = 1500;

async function getPages(meta: ChapterMeta, signal: AbortSignal): Promise<Img[]> {
  if (meta.external) {
    const { sourceId, mangaId, chapterId } = meta.external;
    const id = encodeURIComponent;
    const pages = await api<ExtPages>(`/sources/${id(sourceId)}/manga/${id(mangaId)}/chapters/${id(chapterId)}/pages`, { signal });
    return pages.pages.map((page) => ({
      id: String(page.pageNumber), position: page.pageNumber,
      width: page.width ?? 0, height: page.height ?? 0, url: page.imageUrl,
    }));
  }

  const items: Img[] = [];
  let expected: number | undefined;
  do {
    const from = items.length;
    const res = await api<ImgPage>(`/chapters/${encodeURIComponent(meta.id)}/images?from=${from}&limit=${BATCH}`, { signal });
    expected ??= res.total;
    if (!Number.isInteger(expected) || expected < 0 || expected > MAX_PAGE_COUNT ||
        !Array.isArray(res.items) || res.total !== expected ||
        res.items.length !== Math.min(BATCH, expected - from)) {
      throw new Error("The chapter pages are incomplete or changed. Please try again.");
    }
    items.push(...res.items);
  } while (items.length < expected);
  return items;
}

function verifyImage(path: string, signal: AbortSignal): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    function finish(error?: unknown) {
      img.onload = img.onerror = null;
      signal.removeEventListener("abort", cancel);
      if (error) { img.removeAttribute("src"); reject(error); }
      else resolve({ width: img.naturalWidth, height: img.naturalHeight });
    }
    function cancel() { finish(signal.reason); }
    img.onload = () => img.naturalWidth > 0 && img.naturalHeight > 0
      ? finish()
      : finish(new Error("The server did not return a readable image."));
    img.onerror = () => finish(new Error("The server did not return a readable image."));
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel(); else img.src = path;
  });
}

async function saveImage(
  cache: Cache, path: string, src: string, chapterSignal: AbortSignal, opaqueOrigins: Set<string>,
) {
  const url = new URL(src, window.location.origin);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Unsupported image URL.");
  }
  const signal = AbortSignal.any([chapterSignal, AbortSignal.timeout(35000)]);
  const options: RequestInit = { credentials: "same-origin", referrerPolicy: "no-referrer", signal };
  let response: Response | undefined;
  if (!opaqueOrigins.has(url.origin)) {
    try {
      response = await fetch(url, { ...options, mode: "cors" });
    } catch (error) {
      signal.throwIfAborted();
      if (url.origin === window.location.origin || !(error instanceof TypeError)) throw error;
      opaqueOrigins.add(url.origin);
    }
  }
  if (!response) response = await fetch(url, { ...options, mode: "no-cors" });
  if (response.type !== "opaque" && (!response.ok || !/^image\//i.test(response.headers.get("content-type") ?? ""))) {
    throw new Error("The server did not return an image.");
  }
  await cache.put(path, response);
  // A successful no-CORS fetch can be an opaque 404. Decode the cached image
  // through the worker before counting it, without re-requesting the CDN.
  return verifyImage(path, signal);
}

export async function downloadChapter(
  comic: DownloadComic, chapterId: string, signal: AbortSignal, progress: (value: Progress) => void,
) {
  if (!navigator.onLine) throw new Error("Reconnect to download this chapter.");
  await prepareOfflineStorage(signal);
  if (await getDownload(chapterId)) return;
  // Best effort: a browser may decline persistent storage.
  void navigator.storage?.persist?.().catch(() => {});
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(120000)]);
  const meta = await api<ChapterMeta>(`/chapters/${encodeURIComponent(chapterId)}`, { signal: requestSignal });
  if (meta.id !== chapterId || meta.comic.id !== comic.id) throw new Error("Chapter doesn't belong to this comic.");
  const pages = (await getPages(meta, requestSignal)).sort((a, b) => a.position - b.position);
  if (!pages.length || pages.length > MAX_PAGE_COUNT ||
      new Set(pages.map((item) => item.position)).size !== pages.length ||
      pages.some((item) => !Number.isInteger(item.position) || item.position < 0 || !item.url)) {
    throw new Error("This chapter has no complete set of pages available to download.");
  }

  signal.throwIfAborted();
  const token = `${Date.now()}-${crypto.randomUUID()}`;
  const name = chapterCacheName(token);
  const cache = await caches.open(name);
  const opaqueOrigins = new Set<string>();
  const dimensions: { width: number; height: number }[] = [];
  try {
    progress({ done: 0, total: pages.length });
    for (let i = 0; i < pages.length; i++) {
      try {
        dimensions.push(await saveImage(cache, localImagePath(token, i), pages[i].url, signal, opaqueOrigins));
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof DOMException && error.name === "QuotaExceededError") throw error;
        throw new Error(`Page ${i + 1} of ${pages.length} could not be saved. Check your connection and try again.`);
      }
      progress({ done: i + 1, total: pages.length });
    }
    let coverIndex: "cover" | 0 = 0;
    if (comic.coverUrl) {
      const cover = localImagePath(token, "cover");
      try {
        await saveImage(cache, cover, comic.coverUrl, signal, opaqueOrigins);
        coverIndex = "cover";
      } catch {
        await cache.delete(cover);
      }
    }
    signal.throwIfAborted();
    await addDownload({
      id: chapterId, comicId: comic.id, comicTitle: comic.title,
      number: meta.number, label: meta.displayNumber ?? String(meta.number), title: meta.title,
      savedAt: Date.now(), token, coverIndex, pages: dimensions,
    });
  } catch (error) {
    await caches.delete(name).catch(() => {});
    if (error instanceof DOMException && error.name === "ConstraintError" && await getDownload(chapterId)) return;
    throw error;
  }
}
