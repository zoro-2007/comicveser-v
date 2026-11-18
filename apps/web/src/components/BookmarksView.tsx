"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Cover } from "./ComicCard";
import { ApiError, api } from "@/lib/api";
import { coverSrc, hueOf } from "@/lib/media";
import { act } from "@/lib/useApi";
import { useAuth } from "./AuthProvider";

type Status = "READING" | "COMPLETED" | "PLAN_TO_READ" | "ON_HOLD" | "DROPPED";
type Sort = "updated" | "added" | "title";
interface ChapterSummary {
  id: string;
  number: number;
  displayNumber?: string;
  title?: string;
  publishedAt?: string | null;
}
interface Item {
  bookmarkedAt: string;
  lastUpdatedAt: string | null;
  status: Status;
  statusSource: "auto" | "manual";
  comic: {
    id: string;
    slug: string;
    title: string;
    type: string;
    status: string;
    coverUrl: string | null;
    totalChapters: number;
    latestChapter: { id: string; number: number; displayNumber: string } | null;
  };
  progress: {
    readCount: number;
    percent: number;
    lastReadAt: string | null;
    current: {
      chapterId: string;
      number: number;
      displayNumber: string;
      imageIndex: number;
    } | null;
  };
}
interface Page {
  total: number;
  page: number;
  pageSize: number;
  counts: Record<string, number>;
  items: Item[];
}

const TABS: { key: "ALL" | Status; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "READING", label: "Reading" },
  { key: "PLAN_TO_READ", label: "Plan to Read" },
  { key: "COMPLETED", label: "Completed" },
  { key: "ON_HOLD", label: "On Hold" },
  { key: "DROPPED", label: "Dropped" },
];
const LABEL = Object.fromEntries(TABS.map((t) => [t.key, t.label])) as Record<string, string>;
const SORTS: { key: Sort; label: string }[] = [
  { key: "updated", label: "Recently updated" },
  { key: "added", label: "Recently added" },
  { key: "title", label: "A – Z" },
];

const STATUS_DOT_COLOR: Record<Status, string> = {
  READING: "#3b82f6",
  COMPLETED: "#34d399",
  PLAN_TO_READ: "#a855f7",
  ON_HOLD: "#f59e0b",
  DROPPED: "#f87171",
};

function formatBookmarkedDate(iso?: string | null): string {
  if (!iso) return "Recently";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Recently";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatTypeLabel(raw?: string | null): string {
  if (!raw) return "Manhwa";
  const s = raw.toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Bookmarks Library:
 * - Separate accessible click targets on each bookmark card:
 *   - Clicking the comic cover/image opens the Bookmark Detail Popup.
 *   - Clicking the comic title/name opens the comic detail page (/comics/[slug]).
 * - Inside the Bookmark Detail Popup:
 *   - Changing reading status immediately saves via PUT /user/bookmarks/:comicId/status.
 *   - Clicking + or − or Set to Latest resolves the real chapterId and persists reading position via POST /user/progress and POST /user/chapters/:chapterId/read.
 *   - Displays Saving, Saved, or Error feedback and refreshes bookmark cards and Continue Reading automatically.
 */
export default function BookmarksView() {
  const router = useRouter();
  const { user, status: sessionStatus } = useAuth();
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [tab, setTab] = useState<"ALL" | Status>("ALL");
  const [sort, setSort] = useState<Sort>("updated");
  const [pageNo, setPageNo] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [reloadTick, setReloadTick] = useState(0);

  // Collapsible Continue Reading section & dismissed IDs
  const [continueOpen, setContinueOpen] = useState(true);
  const [dismissedContinueIds, setDismissedContinueIds] = useState<Record<string, boolean>>({});

  // Bookmark Detail Modal state & chapter cache
  const [modalItem, setModalItem] = useState<Item | null>(null);
  const [modalChapNum, setModalChapNum] = useState<number>(1);
  const [editingChapNum, setEditingChapNum] = useState<boolean>(false);
  const [chapInputVal, setChapInputVal] = useState<string>("1");
  const [modalChapters, setModalChapters] = useState<ChapterSummary[]>([]);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState<string>("");
  const chaptersCacheRef = useRef<Map<string, ChapterSummary[]>>(new Map());

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("cv:bm:dismissedContinue") ?? "null");
      if (saved && typeof saved === "object") setDismissedContinueIds(saved);
    } catch {}
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setDq(q.trim());
      setPageNo(1);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!user || sessionStatus === "loading") return;
    const controller = new AbortController();
    const p = new URLSearchParams({ sort, page: String(pageNo), limit: "24" });
    if (tab !== "ALL") p.set("status", tab);
    if (dq) p.set("q", dq);
    setState((s) => (data ? s : "loading"));

    api<Page>(`/user/bookmarks?${p}`, {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then((r) => {
        if (controller.signal.aborted) return;
        if (r.items.length === 0 && pageNo > 1) {
          setPageNo(pageNo - 1);
          return;
        }
        setData(r);
        setModalItem((prev) => {
          if (!prev) return null;
          const updated = r.items.find((x) => x.comic.id === prev.comic.id);
          return updated ?? prev;
        });
        setState("ok");
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        if (!(e instanceof ApiError && e.status === 401)) setState("error");
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, sessionStatus, tab, sort, dq, pageNo, reloadTick]);

  const reload = useCallback(() => setReloadTick((n) => n + 1), []);

  const loadChaptersForComic = useCallback(async (comicId: string): Promise<ChapterSummary[]> => {
    const cached = chaptersCacheRef.current.get(comicId);
    if (cached && cached.length > 0) return cached;
    try {
      const list = await api<ChapterSummary[]>(`/comics/${encodeURIComponent(comicId)}/chapters?order=asc`, {
        cache: "no-store",
      });
      if (Array.isArray(list)) {
        const sorted = [...list].sort((a, b) => a.number - b.number);
        chaptersCacheRef.current.set(comicId, sorted);
        return sorted;
      }
    } catch {
      // Fall back to empty array if chapters endpoint fails
    }
    return [];
  }, []);

  const remove = async (it: Item) => {
    setBusy(it.comic.id);
    setErr("");
    setSaveState("saving");
    setSaveMessage("Saving…");
    try {
      await act(`/user/bookmarks/${it.comic.id}`, "DELETE");
      setData((d) =>
        d
          ? {
              ...d,
              total: Math.max(0, d.total - 1),
              counts: {
                ...d.counts,
                ...(typeof d.counts.ALL === "number" ? { ALL: Math.max(0, d.counts.ALL - 1) } : {}),
                ...(typeof d.counts[it.status] === "number"
                  ? { [it.status]: Math.max(0, d.counts[it.status] - 1) }
                  : {}),
              },
              items: d.items.filter((x) => x.comic.id !== it.comic.id),
            }
          : d,
      );
      if (modalItem?.comic.id === it.comic.id) setModalItem(null);
      setSaveState("idle");
      setSaveMessage("");
      reload();
      window.dispatchEvent(new Event("cv:bookmarks"));
    } catch {
      setSaveState("error");
      setSaveMessage("Error: Couldn't remove bookmark.");
      setErr("Couldn't remove that bookmark. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const setStatus = async (it: Item, s: Status | "AUTO") => {
    setBusy(it.comic.id);
    setErr("");
    setSaveState("saving");
    setSaveMessage("Saving…");
    try {
      await act(`/user/bookmarks/${encodeURIComponent(it.comic.id)}/status`, "PUT", { status: s });
      if (s !== "AUTO") {
        setModalItem((prev) =>
          prev && prev.comic.id === it.comic.id
            ? { ...prev, status: s, statusSource: "manual" }
            : prev,
        );
        setData((prev) =>
          prev
            ? {
                ...prev,
                items: prev.items.map((x) =>
                  x.comic.id === it.comic.id ? { ...x, status: s, statusSource: "manual" } : x,
                ),
              }
            : prev,
        );
      }
      setSaveState("saved");
      setSaveMessage("Saved");
      reload();
      window.dispatchEvent(new Event("cv:bookmarks"));
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Couldn't update that status. Please try again.";
      setSaveState("error");
      setSaveMessage(`Error: ${msg}`);
      setErr(msg);
    } finally {
      setBusy(null);
    }
  };

  const saveChapterSelection = async (
    it: Item,
    targetMode: { type: "step"; delta: -1 | 1 } | { type: "latest" } | { type: "number"; number: number },
  ) => {
    setBusy(it.comic.id);
    setErr("");
    setSaveState("saving");
    setSaveMessage("Saving…");

    try {
      let chapters = modalChapters.length > 0 ? modalChapters : await loadChaptersForComic(it.comic.id);
      if (chapters.length > 0 && modalChapters.length === 0) {
        setModalChapters(chapters);
      }

      let targetChapter: ChapterSummary | null = null;
      const totalCh = it.comic.totalChapters || chapters.length;

      if (targetMode.type === "latest") {
        if (chapters.length > 0) {
          targetChapter = chapters[chapters.length - 1];
        } else if (it.comic.latestChapter) {
          targetChapter = {
            id: it.comic.latestChapter.id,
            number: it.comic.latestChapter.number,
            displayNumber: it.comic.latestChapter.displayNumber,
          };
        }
      } else if (targetMode.type === "step") {
        if (chapters.length > 0) {
          const currentId = it.progress.current?.chapterId;
          let curIdx = chapters.findIndex(
            (ch) => (currentId && ch.id === currentId) || Math.abs(ch.number - modalChapNum) < 0.001,
          );
          if (curIdx === -1) {
            // Find closest chapter to modalChapNum
            curIdx = chapters.reduce(
              (bestIdx, ch, idx) =>
                Math.abs(ch.number - modalChapNum) < Math.abs(chapters[bestIdx].number - modalChapNum)
                  ? idx
                  : bestIdx,
              0,
            );
          }
          const nextIdx = Math.min(chapters.length - 1, Math.max(0, curIdx + targetMode.delta));
          targetChapter = chapters[nextIdx];
        } else {
          const nextNum = Math.min(totalCh || 1, Math.max(1, modalChapNum + targetMode.delta));
          if (it.comic.latestChapter && nextNum === it.comic.latestChapter.number) {
            targetChapter = {
              id: it.comic.latestChapter.id,
              number: it.comic.latestChapter.number,
              displayNumber: it.comic.latestChapter.displayNumber,
            };
          } else if (it.progress.current && nextNum === it.progress.current.number) {
            targetChapter = {
              id: it.progress.current.chapterId,
              number: it.progress.current.number,
              displayNumber: it.progress.current.displayNumber,
            };
          }
        }
      } else {
        if (chapters.length > 0) {
          targetChapter =
            chapters.find(
              (ch) =>
                Math.abs(ch.number - targetMode.number) < 0.001 ||
                Number.parseFloat(ch.displayNumber ?? "") === targetMode.number,
            ) ??
            chapters.reduce((best, ch) =>
              Math.abs(ch.number - targetMode.number) < Math.abs(best.number - targetMode.number)
                ? ch
                : best,
            );
        } else if (it.comic.latestChapter && targetMode.number === it.comic.latestChapter.number) {
          targetChapter = {
            id: it.comic.latestChapter.id,
            number: it.comic.latestChapter.number,
            displayNumber: it.comic.latestChapter.displayNumber,
          };
        } else if (it.progress.current) {
          targetChapter = {
            id: it.progress.current.chapterId,
            number: targetMode.number,
            displayNumber: String(targetMode.number),
          };
        }
      }

      if (!targetChapter || !targetChapter.id) {
        throw new Error("Could not find a published chapter for that position.");
      }

      const resolvedNum = targetChapter.number;
      const resolvedDisplay = targetChapter.displayNumber ?? String(resolvedNum);
      setModalChapNum(resolvedNum);
      setChapInputVal(String(resolvedNum));

      // Persist both reading history position and read-chapter record using the real chapterId
      await act("/user/progress", "POST", {
        comicId: it.comic.id,
        chapterId: targetChapter.id,
        imageIndex: 0,
        scrollY: 0,
      });
      await act(`/user/chapters/${encodeURIComponent(targetChapter.id)}/read`, "POST").catch(() => undefined);

      const newPercent =
        totalCh > 0 ? Math.min(100, Math.round((resolvedNum / totalCh) * 100)) : it.progress.percent;
      const newReadCount = Math.max(it.progress.readCount, Math.min(totalCh || resolvedNum, Math.floor(resolvedNum)));
      const newCurrent = {
        chapterId: targetChapter.id,
        number: resolvedNum,
        displayNumber: resolvedDisplay,
        imageIndex: 0,
      };
      const newStatus: Status =
        it.statusSource === "manual"
          ? it.status
          : it.comic.status === "COMPLETED" && totalCh > 0 && newReadCount >= totalCh
          ? "COMPLETED"
          : "READING";

      // Make sure comic is not hidden in Continue Reading if the user just updated its chapter
      if (dismissedContinueIds[it.comic.id]) {
        const nextDismissed = { ...dismissedContinueIds };
        delete nextDismissed[it.comic.id];
        setDismissedContinueIds(nextDismissed);
        try {
          localStorage.setItem("cv:bm:dismissedContinue", JSON.stringify(nextDismissed));
        } catch {}
      }

      const applyItemUpdate = (item: Item): Item =>
        item.comic.id !== it.comic.id
          ? item
          : {
              ...item,
              status: newStatus,
              progress: {
                ...item.progress,
                readCount: newReadCount,
                percent: newPercent,
                lastReadAt: new Date().toISOString(),
                current: newCurrent,
              },
            };

      setModalItem((prev) => (prev ? applyItemUpdate(prev) : prev));
      setData((prev) => (prev ? { ...prev, items: prev.items.map(applyItemUpdate) } : prev));
      setSaveState("saved");
      setSaveMessage("Saved");
      reload();
      window.dispatchEvent(new Event("cv:bookmarks"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't save reading chapter.";
      setSaveState("error");
      setSaveMessage(`Error: ${msg}`);
      setErr(msg);
    } finally {
      setBusy(null);
    }
  };

  const dismissContinueCard = (e: React.MouseEvent, comicId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const next = { ...dismissedContinueIds, [comicId]: true };
    setDismissedContinueIds(next);
    try {
      localStorage.setItem("cv:bm:dismissedContinue", JSON.stringify(next));
    } catch {}
  };

  const counts = data?.counts ?? {};
  const total = data
    ? typeof counts.ALL === "number"
      ? counts.ALL
      : Object.entries(counts)
          .filter(([k]) => k !== "ALL")
          .reduce((a, [, b]) => a + b, 0)
    : 0;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtered = tab !== "ALL" || dq.length > 0;

  const { updatesWaiting, totalLibraryChapters, avgProgress, continueItems } = useMemo(() => {
    const list = data?.items ?? [];
    let waiting = 0;
    let totalCh = 0;
    let sumPct = 0;
    for (const it of list) {
      totalCh += it.comic.totalChapters || 0;
      const curNum = it.progress.current?.number ?? it.progress.readCount ?? 0;
      const itemPct =
        it.progress.percent > 0
          ? it.progress.percent
          : it.comic.totalChapters > 0
          ? Math.min(100, Math.round((curNum / it.comic.totalChapters) * 100))
          : 0;
      sumPct += itemPct;
      if (it.comic.totalChapters > curNum) waiting++;
    }
    const avg = list.length ? Math.round(sumPct / list.length) : 0;
    const cont = list
      .filter((it) => it.progress.current !== null && !dismissedContinueIds[it.comic.id])
      .slice(0, 6);
    return {
      updatesWaiting: waiting,
      totalLibraryChapters: totalCh,
      avgProgress: avg,
      continueItems: cont,
    };
  }, [data, dismissedContinueIds]);

  const openModal = (it: Item) => {
    setModalItem(it);
    setSaveState("idle");
    setSaveMessage("");
    setErr("");
    const curNum = it.progress.current?.number ?? it.progress.readCount ?? 0;
    const initNum = curNum > 0 ? curNum : 1;
    setModalChapNum(initNum);
    setChapInputVal(String(initNum));
    setEditingChapNum(false);
    const cached = chaptersCacheRef.current.get(it.comic.id);
    if (cached) {
      setModalChapters(cached);
    } else {
      setModalChapters([]);
      void loadChaptersForComic(it.comic.id).then((list) => {
        setModalChapters(list);
      });
    }
  };

  const minModalChapterNum = modalChapters.length > 0 ? modalChapters[0].number : 1;
  const maxModalChapterNum =
    modalChapters.length > 0
      ? modalChapters[modalChapters.length - 1].number
      : modalItem?.comic.latestChapter?.number ?? modalItem?.comic.totalChapters ?? 1;

  const skeleton = useMemo(
    () => (
      <div className="bm-poster-grid" aria-busy="true">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="skeleton aspect-[3/4.3] rounded-xl" />
        ))}
      </div>
    ),
    [],
  );

  return (
    <div>
      {/* 1. Library Header Panel */}
      <section className="panel" data-layer="Library Header">
        <div className="panel-h2">
          <span className="ic" aria-hidden="true">
            ▸
          </span>
          <h1 style={{ fontSize: 19, fontWeight: 700, margin: 0, color: "#fff" }}>
            Your Bookmarks
          </h1>
          <span style={{ color: "var(--muted)", fontSize: 12.5 }} id="bmSummary">
            {data
              ? `${total} saved · ${updatesWaiting} with new chapters`
              : "Loading your library…"}
          </span>
          <Link href="/browse" className="pillbtn" style={{ marginLeft: "auto" }}>
            ＋ Browse Comics
          </Link>
        </div>

        <div className="bm-stats">
          <div className="m-stat" style={{ textAlign: "left" }}>
            <b>{total}</b>
            <span>Saved comics</span>
          </div>
          <div className="m-stat" style={{ textAlign: "left" }}>
            <b style={{ color: "var(--purple-2)" }}>{updatesWaiting}</b>
            <span>New chapters waiting</span>
          </div>
          <div className="m-stat" style={{ textAlign: "left" }}>
            <b>{totalLibraryChapters.toLocaleString()}</b>
            <span>Chapters in library</span>
          </div>
          <div className="m-stat" style={{ textAlign: "left" }}>
            <b>{avgProgress}%</b>
            <span>Average progress</span>
          </div>
        </div>
      </section>

      {/* 2. Continue Reading Collapsible Card Carousel */}
      {continueItems.length > 0 && (
        <section className="panel bm-cont-panel" data-layer="Continue Reading">
          <button
            type="button"
            className="bm-cont-header"
            onClick={() => setContinueOpen((o) => !o)}
            aria-expanded={continueOpen}
          >
            <h2>Continue Reading</h2>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`bm-cont-chev${continueOpen ? " open" : ""}`}
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          {continueOpen && (
            <div className="bm-continue-rail">
              {continueItems.map((it) => {
                const c = it.comic;
                const cur = it.progress.current!;
                const pct =
                  c.totalChapters > 0
                    ? Math.min(100, Math.round((cur.number / c.totalChapters) * 100))
                    : it.progress.percent;

                return (
                  <Link
                    key={c.id}
                    href={`/comics/${c.slug}/chapter/${cur.chapterId}`}
                    className="bm-cont-card-v2"
                  >
                    <Cover
                      hue={hueOf(c.slug)}
                      title={c.title}
                      src={coverSrc(c.coverUrl)}
                      className="bm-cont-cov-v2 border-0 !p-1"
                    />
                    <div className="bm-cont-body-v2">
                      <button
                        type="button"
                        className="bm-cont-x"
                        aria-label={`Hide ${c.title} from Continue Reading`}
                        onClick={(e) => dismissContinueCard(e, c.id)}
                      >
                        ✕
                      </button>
                      <h4>{c.title}</h4>
                      <span className="bm-cont-pct">{pct}%</span>
                      <div className="bm-cont-bar">
                        <i style={{ width: `${pct}%` }} />
                      </div>
                      <div className="bm-cont-ch-row">
                        <span>Ch. {cur.displayNumber}</span>
                        <span>Ch. {c.totalChapters}</span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* 3. Library Filters + Poster Grid */}
      <section className="panel" data-layer="Library Filters + Grid">
        <div className="browse-tools">
          <label className="s-search" htmlFor="bm-q">
            <span aria-hidden="true">⌕</span>
            <input
              id="bm-q"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search your library…"
              aria-label="Search your bookmarks"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                aria-label="Clear search"
                style={{
                  background: "none",
                  border: 0,
                  color: "var(--muted)",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                ✕
              </button>
            )}
          </label>

          <span id="bmChips" style={{ display: "contents" }} role="tablist" aria-label="Filter by status">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                data-active={tab === t.key}
                className={`chip${tab === t.key ? " on" : ""}`}
                onClick={() => {
                  setTab(t.key);
                  setPageNo(1);
                }}
              >
                {t.label}
                {data && (
                  <span style={{ opacity: 0.7, fontSize: 11 }}>
                    ({counts[t.key] ?? (t.key === "ALL" ? total : 0)})
                  </span>
                )}
              </button>
            ))}
          </span>

          <span style={{ flex: 1 }} />

          <label style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>
            SORT&nbsp;
            <select
              aria-label="Sort bookmarks"
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as Sort);
                setPageNo(1);
              }}
            >
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {err && !modalItem && (
          <p role="alert" className="mb-3 text-sm text-danger">
            {err}
          </p>
        )}

        {state === "loading" && skeleton}
        {state === "error" && (
          <div role="alert" className="empty-note">
            We couldn&apos;t load your bookmarks.{" "}
            <button type="button" onClick={reload} className="pillbtn" style={{ marginLeft: 8 }}>
              Try again
            </button>
          </div>
        )}

        {state === "ok" && data && data.items.length === 0 && (
          <div className="empty-note" id="bmEmpty">
            {filtered
              ? "No bookmarks match. Try another filter or clear the search."
              : "Your bookmark library is empty. Click Bookmark on any comic card to save it here."}
            <div style={{ marginTop: 14 }}>
              {filtered ? (
                <button
                  type="button"
                  onClick={() => {
                    setTab("ALL");
                    setQ("");
                  }}
                  className="pillbtn"
                >
                  Clear filters
                </button>
              ) : (
                <Link href="/browse" className="pillbtn">
                  Browse comics
                </Link>
              )}
            </div>
          </div>
        )}

        {state === "ok" && data && data.items.length > 0 && (
          <>
            <div className="bm-poster-grid" id="bmGrid">
              {data.items.map((it) => {
                const c = it.comic;
                const cur = it.progress.current;
                const readNum = cur?.number ?? it.progress.readCount ?? 0;
                const dotColor = STATUS_DOT_COLOR[it.status] ?? "#a855f7";

                return (
                  <article
                    key={c.id}
                    className="bm-poster-card"
                    style={busy === c.id ? { opacity: 0.7 } : undefined}
                  >
                    <button
                      type="button"
                      className="bm-poster-cov"
                      aria-label={`Manage bookmark for ${c.title}`}
                      onClick={() => openModal(it)}
                    >
                      <Cover
                        hue={hueOf(c.slug)}
                        title={c.title}
                        src={coverSrc(c.coverUrl)}
                        className="h-full w-full rounded-none border-0"
                      />
                      <span className="bm-status-v2">
                        <span className="dot" style={{ background: dotColor }} />
                        {LABEL[it.status] ?? "Reading"}
                      </span>
                      <span className="bm-frac-v2">
                        {readNum}/{c.totalChapters}
                      </span>
                    </button>
                    <Link
                      href={`/comics/${c.slug}`}
                      className="bm-poster-foot"
                      aria-label={`Open ${c.title} detail page`}
                    >
                      <span className="bm-poster-title" title={c.title}>
                        {c.title}
                      </span>
                    </Link>
                  </article>
                );
              })}
            </div>

            {pages > 1 && (
              <nav aria-label="Pages" className="pager">
                <button
                  type="button"
                  disabled={pageNo <= 1}
                  onClick={() => setPageNo((p) => p - 1)}
                >
                  ‹ Prev
                </button>
                <button type="button" className="on">
                  Page {pageNo} of {pages}
                </button>
                <button
                  type="button"
                  disabled={pageNo >= pages}
                  onClick={() => setPageNo((p) => p + 1)}
                >
                  Next ›
                </button>
              </nav>
            )}
          </>
        )}
      </section>

      {/* 4. Bookmark Detail Modal */}
      {modalItem && (
        <div
          className="bm-modal-overlay"
          data-layer="Bookmark Detail Modal"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModalItem(null);
          }}
        >
          <div className="bm-modal-v2" role="dialog" aria-modal="true" aria-label={modalItem.comic.title}>
            <div className="bmm-head-v2">
              <Cover
                hue={hueOf(modalItem.comic.slug)}
                title={modalItem.comic.title}
                src={coverSrc(modalItem.comic.coverUrl)}
                className="bmm-cov-v2 border-0 !p-1"
              />
              <div className="bmm-head-info">
                <h3>
                  <Link
                    href={`/comics/${modalItem.comic.slug}`}
                    onClick={() => setModalItem(null)}
                    className="hover:text-primary"
                  >
                    {modalItem.comic.title}
                  </Link>
                </h3>
                <span className="bdate">
                  Bookmarked {formatBookmarkedDate(modalItem.bookmarkedAt)}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="bmm-type-v2">{formatTypeLabel(modalItem.comic.type)}</span>
                  {saveState !== "idle" && (
                    <span
                      role="status"
                      aria-live="polite"
                      data-save-state={saveState}
                      style={{
                        fontSize: 11.5,
                        fontWeight: 700,
                        padding: "2px 9px",
                        borderRadius: 6,
                        background:
                          saveState === "error"
                            ? "rgba(248, 113, 113, 0.18)"
                            : saveState === "saved"
                            ? "rgba(52, 211, 153, 0.18)"
                            : "rgba(168, 85, 247, 0.2)",
                        color:
                          saveState === "error"
                            ? "#fca5a5"
                            : saveState === "saved"
                            ? "#6ee7b7"
                            : "#d8b4fe",
                      }}
                    >
                      {saveMessage}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                className="bmm-x-v2"
                aria-label="Close"
                onClick={() => setModalItem(null)}
              >
                ✕
              </button>
            </div>

            <div className="bmm-stepper-v2">
              <button
                type="button"
                className="bmm-circle-btn"
                aria-label="Previous chapter"
                disabled={busy === modalItem.comic.id || modalChapNum <= minModalChapterNum || modalItem.comic.totalChapters <= 0}
                onClick={() => void saveChapterSelection(modalItem, { type: "step", delta: -1 })}
              >
                −
              </button>
              {editingChapNum ? (
                <form
                  className="bmm-chap-edit-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setEditingChapNum(false);
                    const parsed = Number.parseFloat(chapInputVal);
                    if (Number.isFinite(parsed)) {
                      const clamped = Math.min(maxModalChapterNum, Math.max(minModalChapterNum, parsed));
                      setChapInputVal(String(clamped));
                      if (clamped !== modalChapNum) {
                        void saveChapterSelection(modalItem, { type: "number", number: clamped });
                      }
                    } else {
                      setChapInputVal(String(modalChapNum));
                    }
                  }}
                >
                  <span className="bmm-chap-prefix">Ch.</span>
                  <input
                    type="number"
                    min={minModalChapterNum}
                    max={maxModalChapterNum}
                    step="any"
                    value={chapInputVal}
                    autoFocus
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setChapInputVal(e.target.value)}
                    onBlur={() => {
                      setEditingChapNum(false);
                      const parsed = Number.parseFloat(chapInputVal);
                      if (Number.isFinite(parsed)) {
                        const clamped = Math.min(maxModalChapterNum, Math.max(minModalChapterNum, parsed));
                        setChapInputVal(String(clamped));
                        if (clamped !== modalChapNum) {
                          void saveChapterSelection(modalItem, { type: "number", number: clamped });
                        }
                      } else {
                        setChapInputVal(String(modalChapNum));
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setEditingChapNum(false);
                        setChapInputVal(String(modalChapNum));
                      }
                    }}
                    aria-label="Edit chapter number"
                    className="bmm-chap-input"
                  />
                  <span className="bmm-chap-suffix">/ {modalItem.comic.totalChapters}</span>
                </form>
              ) : (
                <button
                  type="button"
                  className="bmm-chap-text bmm-chap-trigger"
                  title="Click to type a chapter number"
                  onClick={() => {
                    if (modalItem.comic.totalChapters <= 0) return;
                    setChapInputVal(String(modalChapNum));
                    setEditingChapNum(true);
                  }}
                >
                  Chapter {modalChapNum} / {modalItem.comic.totalChapters}
                </button>
              )}
              <button
                type="button"
                className="bmm-circle-btn"
                aria-label="Next chapter"
                disabled={busy === modalItem.comic.id || modalChapNum >= maxModalChapterNum || modalItem.comic.totalChapters <= 0}
                onClick={() => void saveChapterSelection(modalItem, { type: "step", delta: 1 })}
              >
                +
              </button>
            </div>

            <button
              type="button"
              className="bmm-set-latest"
              disabled={
                busy === modalItem.comic.id ||
                modalItem.comic.totalChapters <= 0 ||
                modalChapNum >= maxModalChapterNum
              }
              onClick={() => void saveChapterSelection(modalItem, { type: "latest" })}
            >
              Set to Chapter {modalItem.comic.latestChapter?.displayNumber ?? modalItem.comic.totalChapters}
            </button>

            <div className="bmm-prog-v2">
              <i
                style={{
                  width: `${
                    modalItem.comic.totalChapters
                      ? Math.min(100, Math.round((modalChapNum / modalItem.comic.totalChapters) * 100))
                      : 0
                  }%`,
                }}
              />
            </div>
            <div className="bmm-prog-labels">
              <span>Chapter {modalChapNum}</span>
              <span>
                {Math.max(0, modalItem.comic.totalChapters - modalChapNum)} behind
              </span>
            </div>

            <div className="bmm-status-box">
              <span
                className="bmm-status-dot"
                style={{ background: STATUS_DOT_COLOR[modalItem.status] ?? "#a855f7" }}
              />
              <select
                className="bmm-status-select"
                aria-label="Reading status"
                disabled={busy === modalItem.comic.id}
                value={modalItem.status}
                onChange={(e) => {
                  const nextStatus = e.target.value as Status;
                  void setStatus(modalItem, nextStatus);
                }}
              >
                {TABS.slice(1).map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="bmm-status-chev"
                aria-hidden="true"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </div>

            <div className="bmm-actions-v2">
              <Link
                href={
                  modalItem.progress.current
                    ? `/comics/${modalItem.comic.slug}/chapter/${modalItem.progress.current.chapterId}`
                    : modalItem.comic.latestChapter
                    ? `/comics/${modalItem.comic.slug}/chapter/${modalItem.comic.latestChapter.id}`
                    : `/comics/${modalItem.comic.slug}`
                }
                className="bmm-play-v2"
                onClick={() => setModalItem(null)}
              >
                <span aria-hidden="true">▶</span>{" "}
                <span>
                  Chapter {modalItem.progress.current?.displayNumber ?? (modalChapNum || 1)}
                </span>
              </Link>
              <button
                type="button"
                className="bmm-sq-v2 info"
                aria-label="Comic details"
                onClick={() => {
                  const slug = modalItem.comic.slug;
                  setModalItem(null);
                  router.push(`/comics/${slug}`);
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 16v-4" />
                  <path d="M12 8h.01" />
                </svg>
              </button>
              <button
                type="button"
                className="bmm-sq-v2 del"
                aria-label="Remove bookmark"
                onClick={() => void remove(modalItem)}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <path d="M3 6h18" />
                  <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
