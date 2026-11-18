"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ComicCard from "@/components/ComicCard";
import RequestComicModal from "@/components/RequestComicModal";
import {
  BrowseQuery,
  Comic,
  GENRES,
  GenreOption,
  SORTS,
  STATUSES,
  browseComics,
  getGenres,
  slugifyGenre,
} from "@/lib/comics";

const DEFAULT_GENRE_OPTIONS: GenreOption[] = GENRES.map((name) => ({
  name,
  slug: slugifyGenre(name),
}));

function MangaContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<{ items: Comic[]; total: number; page: number; pages: number }>({
    items: [],
    total: 0,
    page: 1,
    pages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [qInput, setQInput] = useState(searchParams.get("q") ?? "");
  const [availableGenres, setAvailableGenres] = useState<GenreOption[]>(DEFAULT_GENRE_OPTIONS);

  useEffect(() => {
    let active = true;
    getGenres()
      .then((list) => {
        if (active && list.length > 0) setAvailableGenres(list);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const rawGenreParam = searchParams.get("genre") ?? "";
  const selectedGenreSlugs = useMemo(
    () =>
      Array.from(
        new Set(
          rawGenreParam
            .split(",")
            .map((g) => slugifyGenre(g))
            .filter(Boolean),
        ),
      ),
    [rawGenreParam],
  );
  const activeStatus = searchParams.get("status") ?? "";
  const activeSort = searchParams.get("sort") ?? "updated";

  const genreOptions = useMemo(() => {
    const map = new Map<string, GenreOption>();
    for (const g of availableGenres) map.set(g.slug, g);
    for (const slug of selectedGenreSlugs) {
      if (!map.has(slug)) {
        const readableName = slug
          .split("-")
          .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
          .join(" ");
        map.set(slug, { name: readableName, slug });
      }
    }
    return Array.from(map.values());
  }, [availableGenres, selectedGenreSlugs]);

  // Strictly filter the /manga page to type = "Manga" only
  const query: BrowseQuery = {
    q: searchParams.get("q") ?? undefined,
    genre: selectedGenreSlugs.join(",") || undefined,
    type: "Manga",
    status: activeStatus || undefined,
    sort: activeSort,
    page: searchParams.get("page") ?? "1",
  };

  useEffect(() => {
    setQInput(searchParams.get("q") ?? "");
  }, [searchParams]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    browseComics(query)
      .then((res) => {
        if (active) {
          const mangaOnly = (res.items ?? []).filter(
            (c) => (c.type ?? "Manga").toLowerCase() === "manga",
          );
          setData({
            ...res,
            items: mangaOnly,
            total: res.items.length === mangaOnly.length ? res.total : mangaOnly.length,
          });
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setData({ items: [], total: 0, page: 1, pages: 1 });
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString()]);

  const updateParams = (patch: Record<string, string | null>, keepPage = false) => {
    const u = new URLSearchParams(searchParams.toString());
    u.delete("type");
    Object.entries(patch).forEach(([k, v]) => {
      if (!v) u.delete(k);
      else u.set(k, v);
    });
    if (!keepPage) u.delete("page");
    const qs = u.toString();
    router.push(qs ? `/manga?${qs}` : "/manga");
  };

  const toggleGenre = (slug: string) => {
    const normalized = slugifyGenre(slug);
    const next = selectedGenreSlugs.includes(normalized)
      ? selectedGenreSlugs.filter((x) => x !== normalized)
      : [...selectedGenreSlugs, normalized];
    updateParams({ genre: next.join(",") || null });
  };

  return (
    <div>
      <section className="panel browse-hero" data-layer="Manga Header + Genre Chips">
        <div className="panel-h2">
          <span className="ic" aria-hidden="true">
            ▤
          </span>
          <h1 style={{ fontSize: 19, fontWeight: 700, margin: 0, color: "#fff" }}>
            Manga Library
          </h1>
          <span className="count-badge" style={{ marginLeft: "auto" }} id="mMangaCount">
            {loading ? "…" : `${data.total} manga`}
          </span>
          <RequestComicModal
            initialTitle={qInput.trim()}
            buttonLabel="+ Request a Comic"
            buttonClassName="pillbtn"
          />
        </div>

        <form
          className="browse-tools"
          onSubmit={(e) => {
            e.preventDefault();
            updateParams({ q: qInput.trim() || null });
          }}
        >
          <label className="s-search" htmlFor="manga-search-q">
            <span aria-hidden="true">⌕</span>
            <input
              id="manga-search-q"
              name="q"
              type="search"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder="Search manga..."
              aria-label="Search manga"
            />
          </label>

          <label style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>
            STATUS&nbsp;
            <select
              value={activeStatus}
              onChange={(e) => updateParams({ status: e.target.value || null })}
              aria-label="Status"
            >
              <option value="">All</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <label style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>
            SORT&nbsp;
            <select
              value={activeSort}
              onChange={(e) => updateParams({ sort: e.target.value })}
              aria-label="Sort by"
            >
              {SORTS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </form>

        <div className="browse-tools" style={{ marginBottom: 0 }}>
          <button
            type="button"
            className={`chip${selectedGenreSlugs.length === 0 ? " on" : ""}`}
            aria-pressed={selectedGenreSlugs.length === 0}
            onClick={() => updateParams({ genre: null })}
          >
            All
          </button>
          {genreOptions.map((g) => {
            const isSelected = selectedGenreSlugs.includes(g.slug);
            return (
              <button
                key={g.slug}
                type="button"
                data-genre-slug={g.slug}
                className={`chip${isSelected ? " on" : ""}`}
                aria-pressed={isSelected}
                onClick={() => toggleGenre(g.slug)}
              >
                {g.name}
              </button>
            );
          })}
        </div>
      </section>

      <section className="panel" data-layer="Manga List" style={{ marginTop: 18 }}>
        {!loading && data.items.length === 0 ? (
          <div className="empty-note" id="mMangaEmpty">
            No manga match these filters. Try another genre, clear the search, or request this manga to our admins.
            <div style={{ marginTop: 12, display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => router.push("/manga")}
                className="pillbtn ghost"
              >
                Reset filters
              </button>
              <RequestComicModal
                initialTitle={qInput.trim()}
                buttonLabel={qInput.trim() ? `+ Request "${qInput.trim().slice(0, 28)}" to Admin` : "+ Request a Missing Manga"}
                buttonClassName="pillbtn"
              />
            </div>
          </div>
        ) : (
          <div className="browse-grid" id="mMangaList">
            {data.items.map((c) => (
              <ComicCard key={c.slug} comic={c} />
            ))}
          </div>
        )}

        {data.pages > 1 && (
          <nav aria-label="Pagination" className="pager">
            {data.page > 1 && (
              <button
                type="button"
                onClick={() => updateParams({ page: String(data.page - 1) }, true)}
              >
                ‹ Previous
              </button>
            )}
            <button type="button" className="on">
              Page {data.page} of {data.pages}
            </button>
            {data.page < data.pages && (
              <button
                type="button"
                onClick={() => updateParams({ page: String(data.page + 1) }, true)}
              >
                Next ›
              </button>
            )}
          </nav>
        )}
      </section>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="empty-note">Loading manga...</div>}>
      <MangaContent />
    </Suspense>
  );
}
