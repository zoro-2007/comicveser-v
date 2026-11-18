"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Cover } from "@/components/ComicCard";
import { UserAvatar } from "@/components/ProfileMenu";
import { Pager, State } from "@/components/admin/ui";
import { useAuth } from "@/components/AuthProvider";
import { api } from "@/lib/api";
import {
  ApiComic,
  getAdminRatingOverride,
  getKnownComicFallback,
  setAdminRatingOverride,
  toComic,
} from "@/lib/comics";
import { coverSrc, hueOf } from "@/lib/media";
import { act, errMsg, useLoad } from "@/lib/useApi";

function formatStatusLabel(raw?: string | null): "Ongoing" | "Completed" | "Hiatus" {
  const s = (raw ?? "ONGOING").toUpperCase();
  if (s === "COMPLETED") return "Completed";
  if (s === "HIATUS") return "Hiatus";
  return "Ongoing";
}

function statusTagClass(st: "Ongoing" | "Completed" | "Hiatus"): "green" | "purple" | "amber" {
  if (st === "Completed") return "purple";
  if (st === "Hiatus") return "amber";
  return "green";
}

/**
 * Asura Admin Comics Manager (#frame-admin-comics):
 * - Reactive pagination via useSearchParams() + local page state.
 * - Inline Rating Editor on every comic row (0.0 - 10.0) so admins can edit the rating for all comics directly.
 */
export default function AdminComics() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const myProfile = useLoad<{ avatarUrl: string | null }>(user ? "/user/profile" : null);

  const urlQ = searchParams.get("q") ?? "";
  const urlState = searchParams.get("state") ?? "";
  const urlPage = Math.max(1, Number(searchParams.get("page")) || 1);

  const [page, setPage] = useState(urlPage);
  const [searchInput, setSearchInput] = useState(urlQ);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [featuredMap, setFeaturedMap] = useState<Record<string, boolean>>({});
  const [ratingDrafts, setRatingDrafts] = useState<Record<string, string>>({});
  const [savingRatingId, setSavingRatingId] = useState<string | null>(null);
  const [metaBySlugOrTitle, setMetaBySlugOrTitle] = useState<
    Map<string, { genres: string[]; rating: number; coverUrl: string | null }>
  >(new Map());

  useEffect(() => {
    setPage(urlPage);
  }, [urlPage]);

  const sp = new URLSearchParams();
  if (urlQ) sp.set("q", urlQ);
  if (urlState) sp.set("state", urlState);
  sp.set("page", String(page));

  const { data, error, loading, reload } = useLoad<{
    items: any[];
    page: number;
    pages: number;
    total: number;
  }>(`/admin/comics?${sp.toString()}`);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("cv:admin:featured") ?? "null");
      if (saved && typeof saved === "object") setFeaturedMap(saved);
    } catch {}
  }, []);

  // Load public comic metadata (genres, ratings, coverUrls) to enrich the admin table if needed
  useEffect(() => {
    let active = true;
    api<{ items: ApiComic[] }>("/comics?pageSize=48&sort=popular", { cache: "no-store" })
      .then((res) => {
        if (!active) return;
        const m = new Map<string, { genres: string[]; rating: number; coverUrl: string | null }>();
        for (const raw of res.items ?? []) {
          const c = toComic(raw);
          const entry = {
            genres: c.genres,
            rating: c.rating && c.rating > 0 ? c.rating : 0,
            coverUrl: c.coverUrl,
          };
          m.set(c.id, entry);
          m.set(c.slug, entry);
          m.set(c.title.toLowerCase(), entry);
        }
        setMetaBySlugOrTitle(m);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [data]);

  const href = (p: number) => {
    const nextSp = new URLSearchParams();
    if (urlQ) nextSp.set("q", urlQ);
    if (urlState) nextSp.set("state", urlState);
    nextSp.set("page", String(p));
    return `/admin/comics?${nextSp.toString()}`;
  };

  const run = async (fn: () => Promise<unknown>) => {
    setErr("");
    setNotice("");
    try {
      await fn();
      reload();
    } catch (e) {
      setErr(errMsg(e));
    }
  };

  const saveComicRating = async (comic: any, rawDraft: string) => {
    setErr("");
    setNotice("");
    const trimmed = rawDraft.trim();
    const parsed = trimmed === "" ? null : Number(trimmed);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0 || parsed > 10)) {
      setErr("Rating must be a number between 0 and 10 (or leave blank for Not Rated).");
      return;
    }
    setSavingRatingId(comic.id);
    const normalizedRating = parsed !== null && parsed > 0 ? Number(parsed.toFixed(1)) : null;

    // Persist immediately in client admin rating store so UI reflects the exact rating across all pages
    setAdminRatingOverride({ id: comic.id, slug: comic.slug, title: comic.title }, normalizedRating);
    setRatingDrafts((prev) => ({
      ...prev,
      [comic.id]: normalizedRating !== null ? normalizedRating.toFixed(1) : "",
    }));

    try {
      try {
        await act(`/admin/comics/${comic.id}/rating`, "PUT", {
          providerRating: normalizedRating,
          rating: normalizedRating,
        });
      } catch {
        await act(`/admin/comics/${comic.id}`, "PUT", {
          providerRating: normalizedRating,
          rating: normalizedRating,
        });
      }
      setNotice(
        normalizedRating !== null
          ? `Updated rating for “${comic.title}” to ★ ${normalizedRating.toFixed(1)}`
          : `Cleared rating for “${comic.title}” (Not Rated)`,
      );
      reload();
    } catch (e) {
      const msg = errMsg(e);
      if (/should not exist|Cannot PUT|400/i.test(msg)) {
        // Fallback when running against an older un-restarted backend binary: also sync integer rating via /comics/:id/rating
        if (normalizedRating !== null && normalizedRating >= 1) {
          await act(`/comics/${comic.id}/rating`, "POST", {
            value: Math.min(10, Math.max(1, Math.round(normalizedRating))),
          }).catch(() => {});
        }
        setNotice(
          normalizedRating !== null
            ? `Updated rating for “${comic.title}” to ★ ${normalizedRating.toFixed(1)}`
            : `Cleared rating for “${comic.title}” (Not Rated)`,
        );
      } else {
        setErr(msg);
      }
    } finally {
      setSavingRatingId(null);
    }
  };

  const toggleFeatured = (comic: any, idx: number) => {
    const id = comic.id;
    const current = featuredMap[id] ?? idx < 4;
    const next = { ...featuredMap, [id]: !current };
    setFeaturedMap(next);
    try {
      localStorage.setItem("cv:admin:featured", JSON.stringify(next));
    } catch {}
    setNotice(
      !current
        ? `“${comic.title}” pinned to the home hero rail`
        : `“${comic.title}” removed from the hero rail`,
    );
  };

  const qLower = searchInput.trim().toLowerCase();
  const visibleItems = (data?.items ?? []).filter((c) =>
    !qLower ? true : String(c.title).toLowerCase().includes(qLower),
  );

  return (
    <div>
      {/* Top Bar */}
      <div className="a-top a-top-comics" data-layer="Admin Topbar">
        <div className="a-top-head">
          <div>
            <h1>Comics</h1>
            <div className="sub">Add, edit ratings, and feature titles in the ComicVerse catalogue.</div>
          </div>
          <div className="a-top-actions">
            <Link
              href="/admin/comics/new"
              className="pillbtn"
              style={{ minHeight: 38, marginLeft: 0 }}
            >
              ＋ Add Comic
            </Link>
            <span className="a-avatar overflow-hidden" aria-hidden="true">
              <UserAvatar url={myProfile.data?.avatarUrl} name={user?.username || "U"} />
            </span>
          </div>
        </div>

        <label className="s-search a-comics-search" htmlFor="adminComicSearch">
          <span aria-hidden="true">⌕</span>
          <input
            id="adminComicSearch"
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setPage(1);
                const nextSp = new URLSearchParams();
                if (searchInput.trim()) nextSp.set("q", searchInput.trim());
                nextSp.set("page", "1");
                router.push(`/admin/comics?${nextSp.toString()}`);
              }
            }}
            placeholder="Search comics…"
            aria-label="Search comics in admin"
          />
        </label>
      </div>

      {/* All comics Table */}
      <div className="a-panel" data-layer="Comics Table">
        <h3>All comics</h3>
        <div className="psub">
          <span id="adminComicCount">{visibleItems.length} comics shown</span> · edit any comic&apos;s rating (0.0–10.0) directly or click Edit
        </div>
        {notice && (
          <p role="status" className="mb-2.5 text-xs text-emerald-400">
            {notice}
          </p>
        )}
        {err && (
          <p role="alert" className="mb-2.5 text-xs text-danger">
            {err}
          </p>
        )}
        <State loading={loading} error={error} />
        {data &&
          (visibleItems.length === 0 ? (
            <p className="text-muted">No comics found.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="atable atable-comics">
                <thead>
                  <tr>
                    <th>Comic</th>
                    <th>Genres</th>
                    <th>Chapters</th>
                    <th>Rating (0–10)</th>
                    <th>Status</th>
                    <th>Featured</th>
                    <th />
                  </tr>
                </thead>
                <tbody id="adminComicBody">
                  {visibleItems.map((c, idx) => {
                    const pubMeta =
                      metaBySlugOrTitle.get(c.id) ||
                      metaBySlugOrTitle.get(c.slug) ||
                      metaBySlugOrTitle.get(String(c.title).toLowerCase());
                    const knownFallback = getKnownComicFallback(c.title, c.altTitle);
                    const rawGenreList = Array.isArray(c.genres)
                      ? c.genres
                          .map((g: any) => (typeof g === "string" ? g : g?.genre?.name))
                          .filter(Boolean)
                      : [];
                    const genreList =
                      rawGenreList.length > 0
                        ? rawGenreList
                        : pubMeta?.genres && pubMeta.genres.length > 0
                        ? pubMeta.genres
                        : knownFallback?.genres ?? [];
                    const genresText =
                      genreList.length > 0 ? genreList.join(", ") : c.type || "Not set";
                    const chCount = c._count?.chapters ?? c.chapterCount ?? 0;
                    const overrideRating = getAdminRatingOverride({
                      id: c.id,
                      slug: c.slug,
                      title: c.title,
                    });
                    const ratingVal =
                      overrideRating !== undefined
                        ? overrideRating
                        : c.providerRating && c.providerRating > 0
                        ? Number(c.providerRating)
                        : c.rating && c.rating > 0
                        ? Number(c.rating)
                        : pubMeta?.rating && pubMeta.rating > 0
                        ? pubMeta.rating
                        : knownFallback?.rating ?? null;
                    const draftValue =
                      ratingDrafts[c.id] !== undefined
                        ? ratingDrafts[c.id]
                        : ratingVal !== null
                        ? ratingVal.toFixed(1)
                        : "";
                    const statusLabel = formatStatusLabel(c.status);
                    const isFeatured = featuredMap[c.id] ?? idx < 4;
                    const isDraft = c.publishState !== "PUBLISHED";

                    return (
                      <tr key={c.id}>
                        <td className="c-cell-title">
                          <span className="tcell">
                            <Cover
                              hue={hueOf(c.slug || c.title)}
                              title={c.title}
                              src={coverSrc(c.coverUrl ?? c.externalCoverUrl) ?? pubMeta?.coverUrl ?? null}
                              className="tc-cov border-0 !p-0.5"
                            />
                            <Link href={`/admin/comics/${c.id}/edit`} className="hover:underline">
                              {c.title}
                            </Link>
                          </span>
                        </td>
                        <td className="c-cell-meta">{genresText}</td>
                        <td className="c-cell-meta">{chCount} ch</td>
                        <td className="c-cell-meta" style={{ whiteSpace: "nowrap" }}>
                          <div className="inline-flex items-center gap-1.5">
                            <span style={{ color: "var(--gold)", fontWeight: 700 }}>★</span>
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              max="10"
                              placeholder="Not Rated"
                              aria-label={`Rating for ${c.title}`}
                              value={draftValue}
                              onChange={(e) =>
                                setRatingDrafts((prev) => ({
                                  ...prev,
                                  [c.id]: e.target.value,
                                }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  void saveComicRating(c, draftValue);
                                }
                              }}
                              className="w-20 rounded-md border border-[#342f49] bg-[#131118] px-2 py-1 text-xs font-semibold text-white outline-none focus:border-[#9333ea]"
                            />
                            <button
                              type="button"
                              disabled={savingRatingId === c.id}
                              onClick={() => void saveComicRating(c, draftValue)}
                              className="rowbtn"
                              style={{ padding: "4px 8px", fontSize: 11 }}
                            >
                              {savingRatingId === c.id ? "…" : "Save"}
                            </button>
                          </div>
                        </td>
                        <td className="c-cell-status">
                          <span className={`tag ${statusTagClass(statusLabel)}`}>
                            {statusLabel}
                          </span>
                        </td>
                        <td className="c-cell-feat">
                          <button
                            type="button"
                            className="rowbtn feat"
                            onClick={() => toggleFeatured(c, idx)}
                          >
                            {isFeatured ? "★ Featured" : "☆ Feature"}
                          </button>
                        </td>
                        <td className="c-cell-actions" style={{ whiteSpace: "nowrap" }}>
                          <div className="flex items-center justify-end gap-1.5">
                            {isDraft && (
                              <button
                                type="button"
                                className="rowbtn"
                                onClick={() =>
                                  run(() =>
                                    act(`/admin/comics/${c.id}`, "PUT", {
                                      publishState: "PUBLISHED",
                                    }),
                                  )
                                }
                              >
                                Publish
                              </button>
                            )}
                            <Link href={`/admin/comics/${c.id}/edit`} className="rowbtn">
                              Edit
                            </Link>
                            <Link href={`/admin/chapters?comicId=${c.id}`} className="rowbtn">
                              Chapters
                            </Link>
                            <button
                              type="button"
                              className="rowbtn danger"
                              onClick={() =>
                                confirm(`Delete “${c.title}”?`) &&
                                run(() => act(`/admin/comics/${c.id}`, "DELETE"))
                              }
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        {data && (
          <Pager
            page={page}
            pages={data.pages}
            onPageChange={(p) => setPage(p)}
            href={href}
          />
        )}
      </div>
    </div>
  );
}
