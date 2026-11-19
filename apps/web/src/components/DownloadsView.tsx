"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Download, HardDrive, Trash2, WifiOff } from "lucide-react";
import { API } from "@/lib/api";
import { Cover } from "./ComicCard";
import OfflineReader from "./OfflineReader";
import CircularDownloadProgress from "./CircularDownloadProgress";
import { cancelChapterDownload, getAllActiveDownloads, subscribeDownloads, type ChapterDownloadState } from "@/lib/offline-downloader";
import {
  deleteDownloadedChapter,
  deleteDownloadedComic,
  formatBytes,
  getAllDownloadedComics,
  getDownloadedCover,
  saveDownloadedCover,
  getOfflineStorageStats,
  type DownloadedComicSummary,
  type OfflineStorageStats,
} from "@/lib/offline-db";

function OfflineCover({
  comicId,
  hue,
  title,
  fallbackUrl,
}: {
  comicId: string;
  hue: number;
  title: string;
  fallbackUrl?: string | null;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let created: string | null = null;

    (async () => {
      try {
        const rec = await getDownloadedCover(comicId);
        if (active && rec?.blob && rec.blob.size > 0) {
          created = URL.createObjectURL(rec.blob);
          setBlobUrl(created);
          return;
        }
      } catch {
        // Ignore IndexedDB cover read error
      }

      // If no cover blob was saved yet and browser is online, fetch & cache it via scoped API endpoint
      if (typeof navigator !== "undefined" && navigator.onLine !== false) {
        try {
          const res = await fetch(`${API}/comics/${encodeURIComponent(comicId)}/cover/file`, {
            cache: "no-store",
          });
          if (res.ok) {
            const blob = await res.blob();
            if (active && blob.size > 0) {
              created = URL.createObjectURL(blob);
              setBlobUrl(created);
              void saveDownloadedCover(comicId, blob).catch(() => {});
              return;
            }
          }
        } catch {
          // Ignore network error
        }
        if (active && fallbackUrl) {
          setBlobUrl(fallbackUrl);
        }
      }
    })();

    return () => {
      active = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [comicId, fallbackUrl]);

  return (
    <Cover
      key={blobUrl ?? "fallback"}
      hue={hue}
      title={title}
      src={blobUrl}
      priority
      className="h-full w-full rounded-none border-0"
    />
  );
}

export default function DownloadsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedComicId = searchParams?.get("comic") ?? null;
  const selectedChapterId = searchParams?.get("chapter") ?? null;

  const [summaries, setSummaries] = useState<DownloadedComicSummary[]>([]);
  const [stats, setStats] = useState<OfflineStorageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activeDownloads, setActiveDownloads] = useState<ChapterDownloadState[]>([]);

  const loadData = useCallback(async () => {
    try {
      const [list, st] = await Promise.all([getAllDownloadedComics(), getOfflineStorageStats()]);
      setSummaries(list);
      setStats(st);
    } catch {
      setSummaries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    setActiveDownloads(getAllActiveDownloads());
    const unsub = subscribeDownloads(() => {
      setActiveDownloads(getAllActiveDownloads());
      void loadData();
    });
    const updateOnline = () => setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    updateOnline();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      unsub();
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, [loadData]);

  const activeSummary = useMemo(
    () => (selectedComicId ? summaries.find((s) => s.comic.comicId === selectedComicId) ?? null : null),
    [summaries, selectedComicId],
  );

  const activeChapter = useMemo(() => {
    if (!activeSummary || !selectedChapterId) return null;
    return activeSummary.chapters.find((c) => c.chapterId === selectedChapterId) ?? null;
  }, [activeSummary, selectedChapterId]);

  const handleRemoveChapter = async (chapterId: string) => {
    setBusyId(chapterId);
    try {
      await deleteDownloadedChapter(chapterId);
      await loadData();
    } finally {
      setBusyId(null);
    }
  };

  const handleRemoveComic = async (comicId: string) => {
    setBusyId(comicId);
    try {
      await deleteDownloadedComic(comicId);
      if (selectedComicId === comicId) {
        router.push("/downloads");
      }
      await loadData();
    } finally {
      setBusyId(null);
    }
  };

  // Standalone offline reader mode (when ?comic=...&chapter=... is selected)
  if (activeSummary && activeChapter) {
    return (
      <OfflineReader
        comic={activeSummary.comic}
        chapter={activeChapter}
        downloadedChapters={activeSummary.chapters}
        onBack={() => router.push(`/downloads?comic=${encodeURIComponent(activeSummary.comic.comicId)}`)}
      />
    );
  }

  return (
    <div className="space-y-5 pb-10">
      <section className="panel" data-layer="Downloads Header">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#9333ea]/20 text-[#c084fc]">
                <Download size={18} aria-hidden />
              </span>
              <h1 className="text-xl font-extrabold tracking-tight text-white">Downloads</h1>
              {offline && (
                <span className="inline-flex items-center gap-1 rounded-full border border-[#fbbf24]/30 bg-[#fbbf24]/15 px-2.5 py-0.5 text-xs font-bold text-[#fbbf24]">
                  <WifiOff size={12} aria-hidden />
                  Offline Mode
                </span>
              )}
            </div>
            <p className="mt-1.5 text-sm text-[#a49fb5]">
              Saved chapters stay on this browser and device so you can read anytime without a connection.
            </p>
          </div>

          {stats && stats.chapterCount > 0 && (
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#232130] px-3.5 py-2 text-xs text-[#d4d0e2]">
              <HardDrive size={15} className="text-[#c084fc]" aria-hidden />
              <span>
                <b>{stats.comicCount}</b> {stats.comicCount === 1 ? "title" : "titles"} ·{" "}
                <b>{stats.chapterCount}</b> {stats.chapterCount === 1 ? "chapter" : "chapters"} ·{" "}
                <b>{formatBytes(stats.totalBytes)}</b>
              </span>
            </div>
          )}
        </div>
      </section>

      {activeDownloads.length > 0 && (
        <section className="panel" data-layer="Active Downloads">
          <div className="panel-h2">
            <span className="ic" aria-hidden="true">↓</span>
            <h2>
              Downloading <span style={{ color: "var(--muted)", fontSize: 13 }}>({activeDownloads.length})</span>
            </h2>
          </div>
          <div className="chap-list">
            {activeDownloads.map((dl) => {
              const pct = dl.phase === "verifying" ? 100 : dl.totalPages > 0 ? Math.round((dl.completedPages / dl.totalPages) * 100) : 0;
              const chLabel = String(dl.chapterNumber ?? "");
              return (
                <div key={dl.chapterId} className="chaprow chaprow-wrap">
                  <div className="chaprow-link">
                    <span className="min-w-0 truncate">
                      <span className="n">{dl.comicTitle || "Downloading"}</span>
                      {chLabel && <span className="t">— Chapter {chLabel}</span>}
                    </span>
                    <span className="w">
                      {dl.phase === "checking" ? "Preparing…" : dl.phase === "verifying" ? "Saving…" : `${dl.completedPages}/${dl.totalPages}`}
                    </span>
                  </div>
                  <div className="chap-dl-actions">
                    <CircularDownloadProgress
                      pct={pct}
                      indeterminate={dl.phase === "checking" || dl.totalPages === 0}
                      onCancel={() => cancelChapterDownload(dl.chapterId)}
                      chapterLabel={chLabel}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {loading ? (
        <section className="panel">
          <p className="py-8 text-center text-sm text-[#a49fb5]">Loading saved downloads…</p>
        </section>
      ) : activeSummary ? (
        <section className="panel" data-layer="Downloaded Chapters">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => router.push("/downloads")}
                className="pillbtn ghost"
                style={{ marginLeft: 0 }}
              >
                <ArrowLeft size={14} aria-hidden />
                All Downloads
              </button>
              <div className="min-w-0">
                <h2 className="truncate text-lg font-bold text-white">{activeSummary.comic.title}</h2>
                <p className="text-xs text-[#a49fb5]">
                  {activeSummary.chapters.length}{" "}
                  {activeSummary.chapters.length === 1 ? "saved chapter" : "saved chapters"} ·{" "}
                  {formatBytes(activeSummary.totalBytes)}
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={busyId === activeSummary.comic.comicId}
              onClick={() => void handleRemoveComic(activeSummary.comic.comicId)}
              className="pillbtn ghost dl-danger-btn"
              style={{ marginLeft: 0 }}
            >
              <Trash2 size={14} aria-hidden />
              {busyId === activeSummary.comic.comicId ? "Removing…" : "Remove All"}
            </button>
          </div>

          <div className="chap-list">
            {activeSummary.chapters.map((ch) => (
              <div key={ch.chapterId} className="chaprow chaprow-wrap">
                <Link
                  href={`/downloads?comic=${encodeURIComponent(activeSummary.comic.comicId)}&chapter=${encodeURIComponent(ch.chapterId)}`}
                  className="chaprow-link"
                >
                  <span className="min-w-0 truncate">
                    <span className="n">Chapter {ch.displayNumber ?? ch.number}</span>
                    {!/^chapter\s/i.test(ch.title) && ch.title && (
                      <span className="t">— {ch.title}</span>
                    )}
                  </span>
                  <span className="w">
                    {ch.pageCount} pages · {formatBytes(ch.totalBytes)}
                  </span>
                </Link>
                <div className="chap-dl-actions">
                  <button
                    type="button"
                    disabled={busyId === ch.chapterId}
                    onClick={() => void handleRemoveChapter(ch.chapterId)}
                    className="chap-dl-btn remove"
                    aria-label={`Remove Chapter ${ch.displayNumber ?? ch.number} from downloads`}
                    title="Remove download"
                  >
                    <Trash2 size={13} aria-hidden />
                    <span>{busyId === ch.chapterId ? "…" : "Remove"}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : summaries.length === 0 ? (
        <section className="panel" data-layer="Downloads Empty State">
          <div className="mx-auto max-w-md py-10 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#a855f7]/30 bg-[#9333ea]/15 text-[#c084fc]">
              <Download size={26} aria-hidden />
            </div>
            <h2 className="text-lg font-bold text-white">No offline chapters yet</h2>
            <p className="mt-2 text-sm leading-6 text-[#a49fb5]">
              Open any published comic on ComicVerse, tap <b className="text-[#fbbf24]">Read Offline</b>, and download chapters to read them here even without internet access.
            </p>
            {!offline && (
              <div className="mt-5">
                <Link href="/browse" className="pillbtn" style={{ marginLeft: 0 }}>
                  Browse Comics
                </Link>
              </div>
            )}
          </div>
        </section>
      ) : (
        <section className="panel" data-layer="Downloaded Comics Grid">
          <div className="panel-h2">
            <span className="ic" aria-hidden="true">
              ★
            </span>
            <h2>
              Saved Comics{" "}
              <span style={{ color: "var(--muted)", fontSize: 13 }}>({summaries.length})</span>
            </h2>
          </div>
          <div className="dl-grid">
            {summaries.map((s) => (
              <div key={s.comic.comicId} className="ucard dl-card" data-t={s.comic.title}>
                <Link
                  href={`/downloads?comic=${encodeURIComponent(s.comic.comicId)}`}
                  className="cov-btn"
                  aria-label={`Open ${s.comic.title} offline chapters`}
                >
                  <span className="cov">
                    <OfflineCover
                      comicId={s.comic.comicId}
                      hue={s.comic.hue}
                      title={s.comic.title}
                      fallbackUrl={s.comic.coverUrl}
                    />
                    <span className="rate-badge">
                      {s.chapters.length} {s.chapters.length === 1 ? "Chapter" : "Chapters"}
                    </span>
                  </span>
                </Link>

                <div className="cinfo">
                  <Link href={`/downloads?comic=${encodeURIComponent(s.comic.comicId)}`}>
                    <h3 title={s.comic.title}>{s.comic.title}</h3>
                  </Link>
                  <div className="cmeta">
                    <span className="chpill">
                      {s.chapters.length} saved {s.chapters.length === 1 ? "chapter" : "chapters"}
                    </span>
                    <span className="text-[11px] text-[#a49fb5]">{formatBytes(s.totalBytes)}</span>
                  </div>
                  <button
                    type="button"
                    disabled={busyId === s.comic.comicId}
                    onClick={() => void handleRemoveComic(s.comic.comicId)}
                    className="bm-toggle dl-remove-card-btn"
                    aria-label={`Remove all downloads for ${s.comic.title}`}
                  >
                    <Trash2 size={13} aria-hidden />
                    <span>{busyId === s.comic.comicId ? "Removing…" : "Remove"}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel" data-layer="How Offline Reading Works">
        <h2 className="text-sm font-bold text-[#fbbf24]">How Offline Reading Works</h2>
        <ul className="mt-2 space-y-1.5 text-xs leading-5 text-[#d4d0e2]">
          <li>
            <b className="text-white">Local storage:</b> Downloaded chapters or series are saved directly on your device rather than on an external server.
          </li>
          <li>
            <b className="text-white">No internet needed:</b> Once a comic chapter is downloaded, you can open and read it with no connection.
          </li>
        </ul>
      </section>
    </div>
  );
}
