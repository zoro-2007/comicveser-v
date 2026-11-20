"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Chapter, Comic } from "@/lib/comics";
import { timeAgo } from "@/lib/comics";
import { useLibrary } from "./LibraryProvider";
import { useReadChapters } from "@/lib/useReadChapters";
import { getDownloadedChapterIdsForComic } from "@/lib/offline-db";
import {
  cancelBulkDownloads,
  cancelChapterDownload,
  getDownloadState,
  startBulkChapterDownloads,
  startChapterDownload,
  subscribeDownloads,
  type ChapterDownloadState,
} from "@/lib/offline-downloader";

import CircularDownloadProgress from "./CircularDownloadProgress";
import { useDownloadAccess } from "./DownloadAccessProvider";

/** Asura-style Chapter List (.panel, .chap-list, .chaprow) with newest/oldest sorting, read progress, and single/bulk offline downloads. */
export default function ChapterList({
  slug,
  comicId,
  chapters,
  comic,
}: {
  slug: string;
  comicId: string;
  chapters: Chapter[];
  comic?: Comic;
}) {
  const [newestFirst, setNewestFirst] = useState(true);
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set());
  const { status: downloadStatus, purgeRevision } = useDownloadAccess();
  const canDownload = downloadStatus === "enabled";
  const [bulkRequested, setBulkMode] = useState(false);
  const bulkMode = canDownload && bulkRequested;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [, setTick] = useState(0);
  const lib = useLibrary();
  const progress = lib.progressFor(comicId);
  const reads = useReadChapters(comicId);
  const rows = useMemo(
    () => (newestFirst ? [...chapters].reverse() : chapters),
    [chapters, newestFirst],
  );
  const latestId = chapters[chapters.length - 1]?.id;

  const refreshSaved = useCallback(() => {
    void getDownloadedChapterIdsForComic(comicId)
      .then((ids) => {
        setSavedIds(ids);
        setSelectedIds((prev) => {
          if (prev.size === 0) return prev;
          const next = new Set(Array.from(prev).filter((id) => !ids.has(id)));
          return next.size === prev.size ? prev : next;
        });
      })
      .catch(() => {});
  }, [comicId]);

  useEffect(() => {
    if (!canDownload) {
      setBulkMode(false);
      setSelectedIds(new Set());
      return;
    }
    refreshSaved();
    const unsub = subscribeDownloads(() => {
      setTick((n) => n + 1);
      refreshSaved();
    });
    return unsub;
  }, [canDownload, purgeRevision, refreshSaved]);

  // Listen for "Read Offline" button click on the comic detail hero
  useEffect(() => {
    if (!canDownload) return;
    const onOpenBulk = () => setBulkMode(true);
    window.addEventListener("cv:open-bulk-offline", onOpenBulk);
    return () => window.removeEventListener("cv:open-bulk-offline", onOpenBulk);
  }, [canDownload]);

  const comicForDownload: Comic = useMemo(
    () =>
      comic ?? {
        id: comicId,
        slug,
        title: slug,
        description: "",
        author: "Unknown",
        artist: "Unknown",
        genres: [],
        type: "Manhwa",
        status: "Ongoing",
        year: 0,
        rating: 0,
        hue: 265,
        views: 0,
        addedAt: "",
        updatedAt: "",
        chapters,
        chapterCount: chapters.length,
        latest: null,
        coverUrl: null,
      },
    [comic, comicId, slug, chapters],
  );

  const undownloadedRows = useMemo(
    () => rows.filter((ch) => !savedIds.has(ch.id)),
    [rows, savedIds],
  );

  const activeDownloadIds = useMemo(
    () =>
      rows
        .filter((ch) => {
          const st = getDownloadState(ch.id);
          return st && (st.phase === "checking" || st.phase === "downloading" || st.phase === "verifying");
        })
        .map((ch) => ch.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, savedIds, bulkMode, selectedIds],
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllUndownloaded = () => {
    setSelectedIds(new Set(undownloadedRows.map((c) => c.id)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const handleBulkDownload = () => {
    if (!canDownload) return;
    const chosen = rows.filter((c) => selectedIds.has(c.id) && !savedIds.has(c.id));
    if (chosen.length === 0) return;
    void startBulkChapterDownloads(comicForDownload, chosen, 5);
  };

  return (
    <section id="chapters-section" className="panel" data-layer="Chapter List" aria-label="Chapters">
      <div className="panel-h2 flex-wrap gap-2">
        <span className="ic" aria-hidden="true">
          ☰
        </span>
        <h2>
          Chapters <span style={{ color: "var(--muted)", fontSize: 13 }}>({chapters.length})</span>
        </h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {bulkMode && (
            <button
              type="button"
              onClick={() => setBulkMode(false)}
              className="pillbtn gold-offline"
              style={{ marginLeft: 0 }}
            >
              Done Offline
            </button>
          )}
          <button
            type="button"
            onClick={() => setNewestFirst((v) => !v)}
            className="pillbtn ghost"
            style={{ marginLeft: 0 }}
            aria-label={`Sorted ${newestFirst ? "newest" : "oldest"} first. Switch order`}
          >
            ↕ {newestFirst ? "Newest first" : "Oldest first"}
          </button>
        </div>
      </div>

      {bulkMode && rows.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#fbbf24]/30 bg-[#232130] px-3.5 py-2.5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#d4d0e2]">
            <button
              type="button"
              onClick={selectAllUndownloaded}
              disabled={undownloadedRows.length === 0}
              className="chap-dl-btn"
            >
              Select All ({undownloadedRows.length})
            </button>
            {selectedIds.size > 0 && (
              <button type="button" onClick={clearSelection} className="chap-dl-btn">
                Clear
              </button>
            )}
            <span>
              <b className="text-white">{selectedIds.size}</b> selected
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {activeDownloadIds.length > 0 && (
              <button
                type="button"
                onClick={() => cancelBulkDownloads(activeDownloadIds)}
                className="chap-dl-btn cancel"
              >
                Cancel Active ({activeDownloadIds.length})
              </button>
            )}
            <button
              type="button"
              disabled={selectedIds.size === 0}
              onClick={handleBulkDownload}
              className="pillbtn gold-offline disabled:cursor-not-allowed disabled:opacity-50"
              style={{ marginLeft: 0, padding: "6px 14px", fontSize: 12 }}
            >
              Download Selected ({selectedIds.size})
            </button>
          </div>
        </div>
      )}

      {canDownload && (() => {
        const failedItem = rows
          .map((ch) => ({ ch, st: getDownloadState(ch.id) }))
          .find((x) => x.st?.phase === "failed" && x.st.error);
        if (!failedItem) return null;
        return (
          <div className="mb-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            <b>Ch. {failedItem.ch.displayNumber ?? failedItem.ch.number}:</b> {failedItem.st!.error}
          </div>
        );
      })()}

      {rows.length === 0 ? (
        <div className="empty-note">No chapters published yet.</div>
      ) : (
        <div className="chap-list" id="detailChaps">
          {rows.map((ch) => {
            const read = reads.isRead(ch.id);
            const current = !read && progress?.chapterId === ch.id;
            const state = read ? "read" : current ? "current" : "unread";
            const generic = /^chapter\s/i.test(ch.title) ? "" : ch.title;
            const dlState: ChapterDownloadState | undefined = getDownloadState(ch.id);
            const isSaved = savedIds.has(ch.id);
            const isBusy =
              dlState?.phase === "checking" ||
              dlState?.phase === "downloading" ||
              dlState?.phase === "verifying";
            const isFailed = dlState?.phase === "failed" || dlState?.phase === "canceled";
            const isChecked = selectedIds.has(ch.id);
            const chNumLabel = String(ch.displayNumber ?? ch.number);

            const total = dlState?.totalPages ?? 0;
            const done = dlState?.completedPages ?? 0;
            const pct =
              dlState?.phase === "verifying"
                ? 100
                : total > 0
                ? Math.round((done / total) * 100)
                : 0;

            return (
              <div key={ch.id} data-state={state} className="chaprow chaprow-wrap">
                {bulkMode && !isSaved && (
                  <label className="flex cursor-pointer items-center pl-3 pr-1">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleSelect(ch.id)}
                      aria-label={`Select Chapter ${chNumLabel} for download`}
                      className="h-4 w-4 accent-[#fbbf24]"
                    />
                  </label>
                )}

                {bulkMode && !isSaved ? (
                  <button
                    type="button"
                    onClick={() => toggleSelect(ch.id)}
                    className="chaprow-link w-full border-0 bg-transparent text-left"
                  >
                  <span className="min-w-0 truncate">
                    <span className="n">Chapter {chNumLabel}</span>
                    {generic && <span className="t">— {generic}</span>}
                    {ch.id === latestId && (
                      <span className="tag purple" style={{ marginLeft: 8, padding: "1px 7px", fontSize: 10 }}>
                        NEW
                      </span>
                    )}
                    {current && (
                      <span className="tag purple" style={{ marginLeft: 8, padding: "1px 7px", fontSize: 10 }}>
                        Continue · p.{progress!.imageIndex + 1}
                      </span>
                    )}
                    {read && (
                      <span className="tag grey" style={{ marginLeft: 8, padding: "1px 7px", fontSize: 10 }}>
                        Read
                      </span>
                    )}
                  </span>
                  <span suppressHydrationWarning className="w">
                    {timeAgo(ch.publishedAt) ||
                      (ch.publishedAt && new Date(ch.publishedAt).getTime() > 0
                        ? new Date(ch.publishedAt).toLocaleDateString("en-IN", { dateStyle: "medium" })
                        : "")}
                  </span>
                </button>
                ) : (
                  <Link href={`/comics/${slug}/chapter/${ch.id}`} className="chaprow-link">
                  <span className="min-w-0 truncate">
                    <span className="n">Chapter {chNumLabel}</span>
                    {generic && <span className="t">— {generic}</span>}
                    {ch.id === latestId && (
                      <span className="tag purple" style={{ marginLeft: 8, padding: "1px 7px", fontSize: 10 }}>
                        NEW
                      </span>
                    )}
                    {current && (
                      <span className="tag purple" style={{ marginLeft: 8, padding: "1px 7px", fontSize: 10 }}>
                        Continue · p.{progress!.imageIndex + 1}
                      </span>
                    )}
                    {read && (
                      <span className="tag grey" style={{ marginLeft: 8, padding: "1px 7px", fontSize: 10 }}>
                        Read
                      </span>
                    )}
                  </span>
                  <span suppressHydrationWarning className="w">
                    {timeAgo(ch.publishedAt) ||
                      (ch.publishedAt && new Date(ch.publishedAt).getTime() > 0
                        ? new Date(ch.publishedAt).toLocaleDateString("en-IN", { dateStyle: "medium" })
                        : "")}
                  </span>
                </Link>
                )}

                {canDownload && (isSaved || bulkMode || isBusy || isFailed) && (
                <div className="chap-dl-actions">
                  {isSaved ? (
                    <Link
                      href={`/downloads?comic=${encodeURIComponent(comicId)}&chapter=${encodeURIComponent(ch.id)}`}
                      className="chap-dl-btn saved"
                      title="Open saved offline chapter"
                      aria-label={`Open offline copy of Chapter ${chNumLabel}`}
                    >
                      Offline
                    </Link>
                  ) : isBusy ? (
                    <CircularDownloadProgress
                      pct={pct}
                      indeterminate={dlState?.phase === "checking" || total === 0}
                      onCancel={() => cancelChapterDownload(ch.id)}
                      chapterLabel={chNumLabel}
                    />
                  ) : isFailed ? (
                    <button
                      type="button"
                      onClick={() => void startChapterDownload(comicForDownload, ch)}
                      className="chap-dl-btn retry"
                      title={dlState?.error || "Download failed. Retry."}
                      aria-label={`Retry download for Chapter ${chNumLabel}`}
                    >
                      Retry
                    </button>
                  ) : bulkMode ? (
                    <button
                      type="button"
                      onClick={() => void startChapterDownload(comicForDownload, ch)}
                      className="chap-dl-icon-btn"
                      title="Download chapter for offline reading"
                      aria-label={`Download Chapter ${chNumLabel} for offline reading`}
                    >
                      <svg viewBox="0 0 36 36" className="chap-dl-ring" aria-hidden="true">
                        <circle
                          cx="18"
                          cy="18"
                          r="14"
                          fill="none"
                          stroke="rgba(255,255,255,0.16)"
                          strokeWidth="2.5"
                        />
                        <path
                          d="M18 11.5v10.5m0 0-3.8-3.8m3.8 3.8 3.8-3.8"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.1"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  ) : null}
                </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
