"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  List,
  Maximize,
  Minimize,
  Settings,
  WifiOff,
  X,
} from "lucide-react";
import { recordOfflineReadProgress } from "@/lib/offline-read-sync";
import {
  getDownloadedChapterPages,
  type OfflineChapterRecord,
  type OfflineComicRecord,
} from "@/lib/offline-db";

type Mode = "vertical" | "paged" | "rtl";
type Width = "narrow" | "wide" | "full";
type Sheet = null | "chapters" | "settings";

const WIDTHS: Record<Width, string> = { narrow: "760px", wide: "1000px", full: "100%" };
const ZOOMS = [1, 1.25, 1.5, 2];
const HIDE_AFTER_MS = 4000;

interface LocalPageUrl {
  position: number;
  width: number;
  height: number;
  url: string;
}

export default function OfflineReader({
  comic,
  chapter,
  downloadedChapters,
  onBack,
}: {
  comic: OfflineComicRecord;
  chapter: OfflineChapterRecord;
  downloadedChapters: OfflineChapterRecord[];
  onBack: () => void;
}) {
  const router = useRouter();
  const [pages, setPages] = useState<LocalPageUrl[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>("vertical");
  const [width, setWidth] = useState<Width>("wide");
  const [zoom, setZoom] = useState(1);
  const [current, setCurrent] = useState(0);
  const [visible, setVisible] = useState(true);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [atEnd, setAtEnd] = useState(false);
  const [activity, setActivity] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [fsSupported, setFsSupported] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const touchX = useRef<number | null>(null);

  const paged = mode !== "vertical";
  const rtl = mode === "rtl";

  // Sort downloaded chapters in reading order (ascending by chapter number)
  const orderedChapters = useMemo(
    () => [...downloadedChapters].sort((a, b) => a.number - b.number),
    [downloadedChapters],
  );
  const currentIdx = orderedChapters.findIndex((c) => c.chapterId === chapter.chapterId);
  const prevChapter = currentIdx > 0 ? orderedChapters[currentIdx - 1] : null;
  const nextChapter =
    currentIdx >= 0 && currentIdx < orderedChapters.length - 1 ? orderedChapters[currentIdx + 1] : null;

  const chHref = (chId: string) =>
    `/downloads?comic=${encodeURIComponent(comic.comicId)}&chapter=${encodeURIComponent(chId)}`;
  const goChapter = (chId: string) => {
    setSheet(null);
    router.push(chHref(chId));
  };

  // Load saved pages from IndexedDB and create local ObjectURLs
  useEffect(() => {
    let active = true;
    const createdUrls: string[] = [];
    setLoading(true);
    setError(null);
    setCurrent(0);
    setAtEnd(false);
    window.scrollTo({ top: 0 });

    getDownloadedChapterPages(chapter.chapterId)
      .then((rows) => {
        if (!active) return;
        if (rows.length === 0) {
          setError("No saved pages found for this chapter.");
          setPages([]);
          setLoading(false);
          return;
        }
        const urls = rows.map((r) => {
          const url = URL.createObjectURL(r.blob);
          createdUrls.push(url);
          return {
            position: r.position,
            width: r.width,
            height: r.height,
            url,
          };
        });
        setPages(urls);
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load offline pages.");
        setPages([]);
        setLoading(false);
      });

    return () => {
      active = false;
      for (const u of createdUrls) {
        URL.revokeObjectURL(u);
      }
    };
  }, [chapter.chapterId]);

  // Restore local reader preferences (localStorage only, no network)
  useEffect(() => {
    try {
      const w = localStorage.getItem("cv:reader:width") as Width;
      if (w in WIDTHS) setWidth(w);
      const m = localStorage.getItem("cv:reader:mode");
      if (m === "paged" || m === "rtl") setMode(m);
      const z = Number(localStorage.getItem("cv:reader:zoom"));
      if (ZOOMS.includes(z)) setZoom(z);
    } catch {
      // Ignore storage errors
    }
    setFsSupported(!!document.documentElement.requestFullscreen && document.fullscreenEnabled !== false);
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Auto-hide controls after inactivity
  useEffect(() => {
    if (!visible || sheet || atEnd || pages.length === 0) return;
    const t = setTimeout(() => setVisible(false), HIDE_AFTER_MS);
    return () => clearTimeout(t);
  }, [visible, sheet, atEnd, activity, pages.length]);

  // Dismiss overlay on scroll
  useEffect(() => {
    let y = window.scrollY;
    const onScroll = () => {
      if (Math.abs(window.scrollY - y) > 48) {
        y = window.scrollY;
        setVisible(false);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Reveal bottom controls at end of vertical chapter
  useEffect(() => {
    if (paged || !endRef.current) {
      setAtEnd(false);
      return;
    }
    const o = new IntersectionObserver(
      ([e]) => {
        const hit = e.isIntersecting && window.scrollY > 100;
        setAtEnd(hit);
        if (hit) setVisible(true);
      },
      { threshold: 0.1 },
    );
    o.observe(endRef.current);
    return () => o.disconnect();
  }, [paged, pages.length]);

  // Track current page in vertical mode
  useEffect(() => {
    if (paged || pages.length === 0) return;
    const o = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setCurrent(Number((e.target as HTMLElement).dataset.idx));
          }
        }
      },
      { rootMargin: "-50% 0px -49% 0px" },
    );
    document.querySelectorAll("[data-offline-idx]").forEach((el) => o.observe(el));
    return () => o.disconnect();
  }, [paged, pages.length]);

  // Record offline reading progress locally (and mark read at end) for Bookmarks & ChapterList sync.
  useEffect(() => {
    if (loading || pages.length === 0) return;
    const isAtLastPage = paged ? current >= pages.length - 1 : atEnd || current >= pages.length - 1;
    recordOfflineReadProgress({
      comicId: comic.comicId,
      chapterId: chapter.chapterId,
      number: chapter.number,
      displayNumber: chapter.displayNumber,
      imageIndex: current,
      markRead: isAtLastPage,
    });
  }, [loading, pages.length, paged, current, atEnd, comic.comicId, chapter.chapterId, chapter.number, chapter.displayNumber]);

  const step = (dir: 1 | -1) => {
    if (dir === 1) {
      if (current + 1 < pages.length) setCurrent(current + 1);
      else if (nextChapter) goChapter(nextChapter.chapterId);
    } else if (current > 0) {
      setCurrent(current - 1);
    } else if (prevChapter) {
      goChapter(prevChapter.chapterId);
    }
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    document.documentElement.requestFullscreen?.().catch(() => {});
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape") {
        if (sheet) setSheet(null);
        else if (!document.fullscreenElement) onBack();
        return;
      }
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        toggleFullscreen();
        return;
      }
      if (e.key === "ArrowRight") {
        if (paged) step(rtl ? -1 : 1);
        else if (nextChapter) goChapter(nextChapter.chapterId);
      } else if (e.key === "ArrowLeft") {
        if (paged) step(rtl ? 1 : -1);
        else if (prevChapter) goChapter(prevChapter.chapterId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const onReadingClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (sheet) {
      setSheet(null);
      return;
    }
    if (paged && zoom === 1) {
      const r = e.currentTarget.getBoundingClientRect();
      const f = (e.clientX - r.left) / r.width;
      if (f < 0.3) {
        step(rtl ? 1 : -1);
        return;
      }
      if (f > 0.7) {
        step(rtl ? -1 : 1);
        return;
      }
    }
    setVisible((v) => !v);
    setActivity((a) => a + 1);
  };

  const chapterLabel = `Chapter ${chapter.displayNumber ?? chapter.number}`;
  const total = pages.length || chapter.pageCount;
  const pageNum = Math.min(current + 1, Math.max(total, 1));
  const pct = total > 0 ? Math.min(100, Math.round((pageNum / total) * 100)) : 0;
  const shown = visible || atEnd || loading || Boolean(error);

  return (
    <div
      className="rd-root select-none"
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
    >
      <div onClick={onReadingClick} className="min-h-[100dvh]">
        {loading && (
          <div className="flex min-h-[100dvh] items-center justify-center text-sm text-[#a49fb5]">
            Loading saved pages…
          </div>
        )}

        {!loading && error && (
          <div className="mx-auto max-w-lg px-4 py-28 text-center">
            <p className="text-base font-semibold text-white">{error}</p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onBack();
              }}
              className="pillbtn mt-5"
              style={{ marginLeft: 0 }}
            >
              Back to Downloads
            </button>
          </div>
        )}

        {!loading && !error && paged && pages.length > 0 && (
          <div
            className="mx-auto flex min-h-[100dvh] w-full max-w-5xl select-none items-center justify-center"
            onTouchStart={(e) => {
              touchX.current = e.touches[0].clientX;
            }}
            onTouchEnd={(e) => {
              if (touchX.current === null || zoom !== 1) return;
              const dx = e.changedTouches[0].clientX - touchX.current;
              touchX.current = null;
              if (Math.abs(dx) >= 50) step((rtl ? dx > 0 : dx < 0) ? 1 : -1);
            }}
          >
            <div
              className={`w-full ${zoom !== 1 ? "overflow-auto" : ""}`}
              style={zoom !== 1 ? { maxHeight: "100dvh" } : undefined}
            >
              {pages[current] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={pages[current].url}
                  alt={`Page ${current + 1}`}
                  width={pages[current].width || undefined}
                  height={pages[current].height || undefined}
                  decoding="async"
                  draggable={false}
                  className={
                    zoom === 1
                      ? "mx-auto block max-h-[100dvh] w-auto max-w-full"
                      : "block max-w-none"
                  }
                  style={zoom !== 1 ? { width: `${zoom * 100}%` } : undefined}
                />
              )}
            </div>
          </div>
        )}

        {!loading && !error && !paged && pages.length > 0 && (
          <div
            className="mx-auto"
            style={width === "full" ? undefined : { maxWidth: `calc(${WIDTHS[width]} * ${zoom})` }}
          >
            {pages.map((p, i) => (
              <div
                key={p.position}
                data-offline-idx={i}
                data-idx={i}
                style={
                  p.width > 0 && p.height > 0
                    ? { aspectRatio: `${p.width} / ${p.height}` }
                    : { minHeight: "30vh" }
                }
                className="relative w-full select-none bg-[#0a0a0a]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.url}
                  alt={`Page ${i + 1}`}
                  width={p.width || undefined}
                  height={p.height || undefined}
                  decoding="async"
                  draggable={false}
                  className="rd-img"
                />
              </div>
            ))}
            <div ref={endRef} className="h-24" aria-hidden />
          </div>
        )}
      </div>

      {/* Standalone Offline Reader Controls (no site header, no mobile bottom nav) */}
      <div
        onClick={(e) => {
          e.stopPropagation();
          setActivity((a) => a + 1);
        }}
      >
        <header className="rd-bar rd-bar-top" data-visible={shown}>
          <div className="mx-auto flex max-w-3xl items-center gap-1.5 px-2 py-1.5">
            <button
              type="button"
              onClick={onBack}
              className="rd-iconbtn"
              aria-label="Back to Downloads"
              title="Back to Downloads"
            >
              <ArrowLeft size={20} />
            </button>
            <div className="min-w-0 flex-1 px-1">
              <p className="truncate text-sm font-semibold text-white">{comic.title}</p>
              <p className="truncate text-xs font-semibold text-[#fbbf24]">
                <WifiOff size={11} className="mr-1 inline -translate-y-px" aria-hidden />
                Offline · {chapterLabel}
                {total > 0 && (
                  <span className="font-normal text-[#a8a1b5]">
                    {" "}
                    · Page {pageNum} / {total} · {pct}%
                  </span>
                )}
              </p>
            </div>
            <button
              type="button"
              className="rd-iconbtn"
              aria-label="Reading settings"
              onClick={() => setSheet(sheet === "settings" ? null : "settings")}
            >
              <Settings size={20} />
            </button>
          </div>
        </header>

        <nav className="rd-bar rd-bar-bottom" data-visible={shown} aria-label="Offline chapter navigation">
          <div className="h-0.5 bg-white/10">
            <div
              className="h-full bg-gradient-to-r from-[#f59e0b] to-[#fbbf24] transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-1 px-2 py-1.5">
            {prevChapter ? (
              <Link
                href={chHref(prevChapter.chapterId)}
                className="rd-iconbtn"
                aria-label="Previous downloaded chapter"
              >
                <ChevronLeft size={22} />
              </Link>
            ) : (
              <span
                className="rd-iconbtn"
                aria-disabled="true"
                aria-label="Previous downloaded chapter (not available)"
                role="link"
              >
                <ChevronLeft size={22} />
              </span>
            )}

            <button
              type="button"
              onClick={() => setSheet(sheet === "chapters" ? null : "chapters")}
              className="flex min-h-[2.75rem] flex-1 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold hover:bg-white/10"
              aria-label="Downloaded chapters list"
            >
              <List size={18} aria-hidden />
              <span>{chapterLabel}</span>
            </button>

            {nextChapter ? (
              <Link
                href={chHref(nextChapter.chapterId)}
                className="rd-iconbtn"
                aria-label="Next downloaded chapter"
              >
                <ChevronRight size={22} />
              </Link>
            ) : (
              <span
                className="rd-iconbtn"
                aria-disabled="true"
                aria-label="Next downloaded chapter (not available)"
                role="link"
              >
                <ChevronRight size={22} />
              </span>
            )}

            <button
              type="button"
              className="rd-iconbtn"
              aria-label="Scroll to top"
              onClick={() => {
                if (paged) {
                  setCurrent(0);
                  window.scrollTo({ top: 0 });
                } else {
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }
              }}
            >
              <ArrowUp size={20} aria-hidden />
            </button>
          </div>
        </nav>

        {sheet && (
          <>
            <div className="rd-scrim" onClick={() => setSheet(null)} aria-hidden />
            <div
              className="rd-sheet"
              role="dialog"
              aria-label={sheet === "chapters" ? "Downloaded chapters" : "Reading settings"}
            >
              <div className="sticky top-0 flex items-center justify-between border-b border-white/10 bg-[rgba(20,15,28,.98)] px-4 py-2.5">
                <h2 className="text-sm font-bold">
                  {sheet === "chapters" ? "Downloaded chapters" : "Reading settings"}
                </h2>
                <button
                  type="button"
                  className="rd-iconbtn !min-h-9 !min-w-9"
                  aria-label="Close"
                  onClick={() => setSheet(null)}
                >
                  <X size={18} />
                </button>
              </div>

              {sheet === "chapters" ? (
                <ul className="p-2">
                  {orderedChapters.map((c) => {
                    const cur = c.chapterId === chapter.chapterId;
                    return (
                      <li key={c.chapterId}>
                        <Link
                          href={chHref(c.chapterId)}
                          onClick={() => setSheet(null)}
                          aria-current={cur ? "page" : undefined}
                          className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-sm hover:bg-white/10 ${
                            cur ? "bg-[#9333ea]/25 font-bold text-white" : "text-[#d4d0e2]"
                          }`}
                        >
                          <span className="min-w-0 truncate">
                            Chapter {c.displayNumber ?? c.number}
                          </span>
                          <span className="shrink-0 text-xs text-[#a49fb5]">
                            {c.pageCount} pages
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="space-y-5 p-4">
                  <div>
                    <p className="mb-2 text-xs font-semibold text-[#a1a1aa]">Reading mode</p>
                    <div className="flex gap-2">
                      {(
                        [
                          ["vertical", "Vertical"],
                          ["paged", "Paged"],
                          ["rtl", "Paged RTL"],
                        ] as const
                      ).map(([m, l]) => (
                        <button
                          key={m}
                          type="button"
                          aria-pressed={mode === m}
                          onClick={() => {
                            setMode(m);
                            try {
                              localStorage.setItem("cv:reader:mode", m);
                            } catch {}
                          }}
                          className={`min-h-[2.5rem] flex-1 rounded-lg border px-3 text-sm font-semibold ${
                            mode === m
                              ? "border-[#a855f7] bg-[rgba(147,51,234,.35)] text-white"
                              : "border-white/10 bg-white/5 text-[#d4d0dc] hover:bg-white/10"
                          }`}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                  {mode === "vertical" && (
                    <div>
                      <p className="mb-2 text-xs font-semibold text-[#a1a1aa]">Page width</p>
                      <div className="flex gap-2">
                        {(
                          [
                            ["narrow", "Narrow"],
                            ["wide", "Wide"],
                            ["full", "Full width"],
                          ] as const
                        ).map(([w, l]) => (
                          <button
                            key={w}
                            type="button"
                            aria-pressed={width === w}
                            onClick={() => {
                              setWidth(w);
                              try {
                                localStorage.setItem("cv:reader:width", w);
                              } catch {}
                            }}
                            className={`min-h-[2.5rem] flex-1 rounded-lg border px-3 text-sm font-semibold ${
                              width === w
                                ? "border-[#a855f7] bg-[rgba(147,51,234,.35)] text-white"
                                : "border-white/10 bg-white/5 text-[#d4d0dc] hover:bg-white/10"
                            }`}
                          >
                            {l}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {(mode !== "vertical" || width !== "full") && (
                    <div>
                      <p className="mb-2 text-xs font-semibold text-[#a1a1aa]">Zoom</p>
                      <div className="flex gap-2">
                        {ZOOMS.map((z) => (
                          <button
                            key={z}
                            type="button"
                            aria-pressed={zoom === z}
                            onClick={() => {
                              setZoom(z);
                              try {
                                localStorage.setItem("cv:reader:zoom", String(z));
                              } catch {}
                            }}
                            className={`min-h-[2.5rem] flex-1 rounded-lg border px-3 text-sm font-semibold ${
                              zoom === z
                                ? "border-[#a855f7] bg-[rgba(147,51,234,.35)] text-white"
                                : "border-white/10 bg-white/5 text-[#d4d0dc] hover:bg-white/10"
                            }`}
                          >
                            {z * 100}%
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {fsSupported && (
                    <button
                      type="button"
                      onClick={toggleFullscreen}
                      className="flex min-h-[2.5rem] w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 text-sm font-semibold text-[#d4d0dc] hover:bg-white/10"
                    >
                      {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
                      {fullscreen ? "Exit full screen" : "Full screen"}{" "}
                      <span className="text-xs text-[#a1a1aa]">(F)</span>
                    </button>
                  )}
                  <p className="text-xs leading-5 text-[#a1a1aa]">
                    Shortcuts: ← previous downloaded chapter, → next downloaded chapter, F full screen, Esc back to Downloads.
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
