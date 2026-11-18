"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Track from "@/components/Track";
import ComicCard from "@/components/ComicCard";
import RequestComicModal from "@/components/RequestComicModal";
import { CardGridSkeleton } from "@/components/LoadingSkeleton";
import {
  BrowseQuery,
  Comic,
  GENRES,
  GenreOption,
  MIN_CHAPTER_OPTIONS,
  SORTS,
  STATUSES,
  TYPES,
  browseComics,
  getGenres,
  slugifyGenre,
} from "@/lib/comics";

type Data = { items: Comic[]; total: number; page: number; pages: number };
const EMPTY: Data = { items: [], total: 0, page: 1, pages: 1 };
const DEFAULT_GENRE_OPTIONS: GenreOption[] = GENRES.map((name) => ({
  name,
  slug: slugifyGenre(name),
}));

function useDebounced(value: string, ms: number, onSettle: (v: string) => void) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => onSettle(value), ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, ms]);
}

function BrowseContent() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const spKey = sp.toString();
  const [data, setData] = useState<Data>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const lastQ = useRef<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(true);
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

  const query: BrowseQuery = {
    q: sp.get("q") ?? undefined,
    genre: sp.get("genre") ?? undefined,
    type: sp.get("type") ?? undefined,
    status: sp.get("status") ?? undefined,
    creator: sp.get("creator") ?? undefined,
    minChapters: sp.get("minChapters") ?? undefined,
    minRating: sp.get("minRating") ?? undefined,
    year: sp.get("year") ?? undefined,
    sort: sp.get("sort") ?? "updated",
    page: sp.get("page") ?? "1",
  };

  // Normalize selected genres to consistent genre slugs
  const selectedGenreSlugs = useMemo(
    () =>
      Array.from(
        new Set(
          (query.genre ?? "")
            .split(",")
            .map((g) => slugifyGenre(g))
            .filter(Boolean),
        ),
      ),
    [query.genre],
  );

  // Ensure any genre slug present in URL is also represented in the rendered chip list
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

  const update = useCallback(
    (patch: Record<string, string | null>, keepPage = false) => {
      const u = new URLSearchParams(window.location.search);
      Object.entries(patch).forEach(([k, v]) => {
        if (v === null || v === "") u.delete(k);
        else u.set(k, v);
      });
      if (!keepPage) u.delete("page");
      const qs = u.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  const [qInput, setQInput] = useState(query.q ?? "");
  const [creatorInput, setCreatorInput] = useState(query.creator ?? "");

  useEffect(() => {
    const urlQ = sp.get("q") ?? "";
    if (lastQ.current === null || urlQ !== lastQ.current) setQInput(urlQ);
    setCreatorInput(sp.get("creator") ?? "");
  }, [spKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useDebounced(qInput, 300, (v) => {
    lastQ.current = v.trim();
    if (v.trim() !== (sp.get("q") ?? "")) update({ q: v.trim() || null });
  });
  useDebounced(creatorInput, 400, (v) => {
    if (v.trim() !== (sp.get("creator") ?? "")) update({ creator: v.trim() || null });
  });

  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    browseComics(query)
      .then((res) => {
        if (active) {
          setData(res);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setData(EMPTY);
          setFailed(true);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spKey, retry]);

  const toggleGenre = (genreSlug: string) => {
    const normalized = slugifyGenre(genreSlug);
    const next = selectedGenreSlugs.includes(normalized)
      ? selectedGenreSlugs.filter((x) => x !== normalized)
      : [...selectedGenreSlugs, normalized];
    update({ genre: next.join(",") || null });
  };
  const single = (key: "status" | "type", value: string) =>
    update({ [key]: query[key] === value ? null : value });

  const resetAll = () => {
    lastQ.current = null;
    setQInput("");
    setCreatorInput("");
    const u = new URLSearchParams();
    const s = sp.get("sort");
    if (s) u.set("sort", s);
    router.replace(u.toString() ? `${pathname}?${u}` : pathname, { scroll: false });
  };

  const hasFilters =
    selectedGenreSlugs.length > 0 ||
    !!query.status ||
    !!query.type ||
    !!query.creator ||
    !!query.minChapters ||
    !!query.q;

  const goPage = (p: number) => {
    update({ page: String(p) }, true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div>
      {query.q?.trim() && <Track type="SEARCH" query={query.q.trim().slice(0, 100)} />}

      {/* Asura Browse Series Hero Panel */}
      <section className="panel browse-hero" data-layer="Filters / Genre · Status · Sort">
        <div className="panel-h2">
          <span className="ic" aria-hidden="true">
            ▦
          </span>
          <h1 style={{ fontSize: 19, fontWeight: 700, margin: 0, color: "#fff" }}>
            Browse Series
          </h1>
          <span className="count-badge" style={{ marginLeft: "auto" }} id="browseCount">
            {loading ? "…" : data.total}
          </span>
          <RequestComicModal initialTitle={qInput.trim()} buttonLabel="+ Request a Comic" buttonClassName="pillbtn" />
        </div>

        <div className="browse-tools">
          <label className="s-search" htmlFor="browse-q">
            <span aria-hidden="true">⌕</span>
            <input
              id="browse-q"
              type="search"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder="Search by title…"
              aria-label="Search by title"
            />
            {qInput && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setQInput("");
                  lastQ.current = "";
                  update({ q: null });
                }}
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

          <label style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>
            SORT&nbsp;
            <select
              value={query.sort}
              onChange={(e) => update({ sort: e.target.value })}
              aria-label="Sort comics"
            >
              {SORTS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="browse-tools" style={{ marginBottom: filtersOpen ? 14 : 0 }}>
          <button
            type="button"
            className="filters-btn"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((o) => !o)}
          >
            Filters <span aria-hidden="true">⚙</span>
            {hasFilters && (
              <span className="np-count" style={{ marginLeft: 4 }}>
                Active
              </span>
            )}
          </button>
        </div>

        {filtersOpen && (
          <div className="space-y-3 border-t border-[rgba(255,255,255,.08)] pt-3.5">
            <div className="browse-tools" style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>GENRES</span>
              <button
                type="button"
                className={`chip${selectedGenreSlugs.length === 0 ? " on" : ""}`}
                aria-pressed={selectedGenreSlugs.length === 0}
                onClick={() => update({ genre: null })}
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

            <div className="browse-tools" style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>STATUS</span>
              <button
                type="button"
                className={`chip${!query.status ? " on" : ""}`}
                onClick={() => update({ status: null })}
              >
                All
              </button>
              {STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`chip${query.status === s ? " on" : ""}`}
                  aria-pressed={query.status === s}
                  onClick={() => single("status", s)}
                >
                  {s}
                </button>
              ))}

              <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, marginLeft: 10 }}>
                TYPE
              </span>
              <button
                type="button"
                className={`chip${!query.type ? " on" : ""}`}
                onClick={() => update({ type: null })}
              >
                All
              </button>
              {TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`chip${query.type === t ? " on" : ""}`}
                  aria-pressed={query.type === t}
                  onClick={() => single("type", t)}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="browse-tools" style={{ marginBottom: 0 }}>
              <label className="s-search">
                <input
                  value={creatorInput}
                  onChange={(e) => setCreatorInput(e.target.value)}
                  placeholder="Creator / author…"
                  aria-label="Filter by creator"
                />
              </label>
              <label style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>
                MIN CHAPTERS&nbsp;
                <select
                  value={query.minChapters ?? ""}
                  onChange={(e) => update({ minChapters: e.target.value || null })}
                >
                  <option value="">Any</option>
                  {MIN_CHAPTER_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}+ chapters
                    </option>
                  ))}
                </select>
              </label>
              {hasFilters && (
                <button type="button" onClick={resetAll} className="pillbtn ghost">
                  Reset filters
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Asura 4-Column Desktop / 2-Column Mobile Unified Comic Grid */}
      <section className="panel" data-layer="Comic Grid" style={{ marginTop: 18 }}>
        {loading && data.items.length === 0 ? (
          <CardGridSkeleton count={12} className="browse-grid" />
        ) : failed ? (
          <div className="empty-note">
            Couldn&apos;t load comics.{" "}
            <button
              type="button"
              onClick={() => setRetry((n) => n + 1)}
              className="pillbtn"
              style={{ marginLeft: 8 }}
            >
              Retry
            </button>
          </div>
        ) : data.items.length === 0 ? (
          <div className="empty-note" id="browseEmpty">
            No comics match those filters. Try a different genre, clear the search, or request this comic directly to our admins.
            <div style={{ marginTop: 12, display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
              {hasFilters && (
                <button type="button" onClick={resetAll} className="pillbtn ghost">
                  Reset filters
                </button>
              )}
              <RequestComicModal initialTitle={qInput.trim()} buttonLabel={qInput.trim() ? `+ Request "${qInput.trim().slice(0, 28)}" to Admin` : "+ Request a Missing Comic"} buttonClassName="pillbtn" />
            </div>
          </div>
        ) : (
          <div className={`browse-grid ${loading ? "opacity-60" : ""}`} id="browseGrid">
            {data.items.map((c) => (
              <ComicCard key={c.slug} comic={c} />
            ))}
          </div>
        )}

        {data.pages > 1 && (
          <nav aria-label="Pagination" className="pager">
            <button
              type="button"
              disabled={data.page <= 1}
              onClick={() => goPage(data.page - 1)}
            >
              ‹ Prev
            </button>
            <button type="button" className="on">
              {data.page} / {data.pages}
            </button>
            <button
              type="button"
              disabled={data.page >= data.pages}
              onClick={() => goPage(data.page + 1)}
            >
              Next ›
            </button>
          </nav>
        )}
      </section>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<CardGridSkeleton count={12} className="browse-grid" />}>
      <BrowseContent />
    </Suspense>
  );
}
