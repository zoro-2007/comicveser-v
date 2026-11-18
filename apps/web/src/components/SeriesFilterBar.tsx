"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import ComicCard from "./ComicCard";
import { useLibrary } from "./LibraryProvider";
import RequestComicModal from "./RequestComicModal";
import {
  Comic,
  GenreOption,
  MIN_CHAPTER_OPTIONS,
  SORTS,
  STATUSES,
  TYPES,
  slugifyGenre,
} from "@/lib/comics";

interface SeriesFilterBarProps {
  basePath: "/browse" | "/manga";
  headingTitle: string;
  totalCount: number;
  items: Comic[];
  availableGenres: GenreOption[];
  selectedGenreSlugs: string[];
  q?: string;
  type?: string;
  status?: string;
  creator?: string;
  minChapters?: string;
  sort?: string;
  hideBookmarkedInitial?: boolean;
  lockTypeToManga?: boolean;
}

type OpenPopover = null | "sort" | "status" | "type" | "genres" | "creator" | "minChapters";

export default function SeriesFilterBar({
  basePath,
  headingTitle,
  totalCount,
  items,
  availableGenres,
  selectedGenreSlugs,
  q = "",
  type = "",
  status = "",
  creator = "",
  minChapters = "",
  sort = "updated",
  hideBookmarkedInitial = false,
  lockTypeToManga = false,
}: SeriesFilterBarProps) {
  const router = useRouter();
  const [openPopover, setOpenPopover] = useState<OpenPopover>(null);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState<OpenPopover>(null);
  const [searchValue, setSearchValue] = useState(q);
  const [creatorValue, setCreatorValue] = useState(creator);
  const [genreSearch, setGenreSearch] = useState("");
  const lib = useLibrary();
  const [hideBookmarked, setHideBookmarked] = useState(hideBookmarkedInitial);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSearchValue(q);
  }, [q]);

  useEffect(() => {
    setCreatorValue(creator);
  }, [creator]);

  // Close desktop popovers when clicking outside
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenPopover(null);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const buildHref = (
    overrides: Record<string, string | undefined>,
    customGenres?: string[],
  ) => {
    const next: Record<string, string | undefined> = {
      q: q || undefined,
      type: lockTypeToManga ? undefined : type || undefined,
      status: status || undefined,
      creator: creator || undefined,
      minChapters: minChapters || undefined,
      sort: sort && sort !== "updated" ? sort : undefined,
      genre:
        customGenres !== undefined
          ? customGenres.length > 0
            ? customGenres.join(",")
            : undefined
          : selectedGenreSlugs.length > 0
          ? selectedGenreSlugs.join(",")
          : undefined,
      page: undefined,
      ...overrides,
    };
    const sp = new URLSearchParams();
    Object.entries(next).forEach(([k, v]) => {
      if (v) sp.set(k, v);
    });
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const toggleGenreHref = (genreNameOrSlug: string) => {
    const targetSlug = slugifyGenre(genreNameOrSlug);
    const exists = selectedGenreSlugs.includes(targetSlug);
    const updated = exists
      ? selectedGenreSlugs.filter((g) => g !== targetSlug)
      : [...selectedGenreSlugs, targetSlug];
    return buildHref({}, updated);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(buildHref({ q: searchValue.trim() || undefined }));
    setMobileDrawerOpen(false);
  };

  const handleCreatorSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setOpenPopover(null);
    router.push(buildHref({ creator: creatorValue.trim() || undefined }));
  };

  const currentSortLabel = useMemo(() => {
    const found = SORTS.find(([k]) => k === (sort || "updated"));
    return found ? found[1] : "Latest Update";
  }, [sort]);

  const filteredGenresList = useMemo(() => {
    const term = genreSearch.trim().toLowerCase();
    if (!term) return availableGenres;
    return availableGenres.filter((g) => g.name.toLowerCase().includes(term));
  }, [availableGenres, genreSearch]);

  const visibleItems = useMemo(() => {
    if (!hideBookmarked) return items;
    return items.filter((c) => !lib.isBookmarked(c.id));
  }, [items, hideBookmarked, lib]);

  const hiddenBookmarkTotal = useMemo(() => {
    const activeType = lockTypeToManga ? "MANGA" : type ? type.toUpperCase() : "";
    if (!activeType) return lib.bookmarkedItems.length;
    return lib.bookmarkedItems.filter((b) => b.type === activeType).length;
  }, [lib.bookmarkedItems, lockTypeToManga, type]);

  const displayCount = hideBookmarked
    ? totalCount <= items.length
      ? visibleItems.length
      : Math.max(visibleItems.length, totalCount - hiddenBookmarkTotal)
    : totalCount;

  const hasActiveFilters = Boolean(
    q ||
      selectedGenreSlugs.length > 0 ||
      (!lockTypeToManga && type) ||
      status ||
      creator ||
      minChapters ||
      (sort && sort !== "updated") ||
      hideBookmarked,
  );

  return (
    <>
      {/* Top Series Banner with Count Badge */}
      <section className="series-hero-banner" data-layer={`${headingTitle} Header`}>
        <div className="series-hero-title-row">
          <h1 className="series-hero-title">{headingTitle}</h1>
          <span className="series-hero-badge">{displayCount}</span>
        </div>

        {/* Filter Bar (Desktop 2-row + Mobile Search + Filters Drawer Trigger) */}
        <div className="series-filter-wrap" ref={barRef}>
        {/* DESKTOP FILTER BAR */}
        <div className="series-filter-desktop">
          {/* Row 1: Sort, Status, Type on left; Search on right */}
          <div className="sfb-row">
            <div className="sfb-group">
              {/* Sort Dropdown */}
              <div className="sfb-popover-anchor">
                <button
                  type="button"
                  className={`sfb-btn sfb-sort-btn ${openPopover === "sort" ? "open" : ""}`}
                  onClick={() => setOpenPopover(openPopover === "sort" ? null : "sort")}
                >
                  <span className="sfb-icon">⇅</span>
                  <span>{currentSortLabel}</span>
                  <span className="sfb-caret">▾</span>
                </button>
                {openPopover === "sort" && (
                  <div className="sfb-dropdown">
                    {SORTS.map(([val, label]) => {
                      const active = (sort || "updated") === val;
                      return (
                        <Link
                          key={val}
                          href={buildHref({ sort: val === "updated" ? undefined : val })}
                          className={`sfb-dropdown-item ${active ? "active" : ""}`}
                          onClick={() => setOpenPopover(null)}
                        >
                          <span>{label}</span>
                          {active && <span>✓</span>}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Status Filter */}
              <div className="sfb-popover-anchor">
                <button
                  type="button"
                  className={`sfb-btn ${status ? "active" : ""}`}
                  onClick={() => setOpenPopover(openPopover === "status" ? null : "status")}
                >
                  <span className="sfb-plus">⊕</span>
                  <span>Status{status ? `: ${status}` : ""}</span>
                </button>
                {openPopover === "status" && (
                  <div className="sfb-dropdown">
                    <Link
                      href={buildHref({ status: undefined })}
                      className={`sfb-dropdown-item ${!status ? "active" : ""}`}
                      onClick={() => setOpenPopover(null)}
                    >
                      <span>All Statuses</span>
                      {!status && <span>✓</span>}
                    </Link>
                    {STATUSES.map((s) => {
                      const active = status?.toLowerCase() === s.toLowerCase();
                      return (
                        <Link
                          key={s}
                          href={buildHref({ status: active ? undefined : s })}
                          className={`sfb-dropdown-item ${active ? "active" : ""}`}
                          onClick={() => setOpenPopover(null)}
                        >
                          <span>{s}</span>
                          {active && <span>✓</span>}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Type Filter */}
              <div className="sfb-popover-anchor">
                <button
                  type="button"
                  className={`sfb-btn ${type && !lockTypeToManga ? "active" : ""}`}
                  onClick={() => setOpenPopover(openPopover === "type" ? null : "type")}
                >
                  <span className="sfb-plus">⊕</span>
                  <span>Type{lockTypeToManga ? ": Manga" : type ? `: ${type}` : ""}</span>
                </button>
                {openPopover === "type" && (
                  <div className="sfb-dropdown">
                    {lockTypeToManga ? (
                      <>
                        <div className="sfb-dropdown-item active">
                          <span>Manga Only</span>
                          <span>✓</span>
                        </div>
                        <Link
                          href="/browse"
                          className="sfb-dropdown-item"
                          onClick={() => setOpenPopover(null)}
                        >
                          <span>Browse All Types →</span>
                        </Link>
                      </>
                    ) : (
                      <>
                        <Link
                          href={buildHref({ type: undefined })}
                          className={`sfb-dropdown-item ${!type ? "active" : ""}`}
                          onClick={() => setOpenPopover(null)}
                        >
                          <span>All Types</span>
                          {!type && <span>✓</span>}
                        </Link>
                        {TYPES.map((t) => {
                          const active = type?.toLowerCase() === t.toLowerCase();
                          return (
                            <Link
                              key={t}
                              href={buildHref({ type: active ? undefined : t })}
                              className={`sfb-dropdown-item ${active ? "active" : ""}`}
                              onClick={() => setOpenPopover(null)}
                            >
                              <span>{t}</span>
                              {active && <span>✓</span>}
                            </Link>
                          );
                        })}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Right: Search Series Input */}
            <form onSubmit={handleSearchSubmit} className="sfb-search-form">
              <span className="sfb-search-icon" aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
              </span>
              <input
                type="search"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                placeholder="Search series..."
                aria-label="Search series"
                className="sfb-search-input"
              />
              {searchValue && (
                <button
                  type="button"
                  className="sfb-search-clear"
                  aria-label="Clear search"
                  onClick={() => {
                    setSearchValue("");
                    router.push(buildHref({ q: undefined }));
                  }}
                >
                  ✕
                </button>
              )}
            </form>
          </div>

          {/* Row 2: Genres, Creator, Minimum Chapters, Hide Bookmarked */}
          <div className="sfb-row">
            <div className="sfb-group">
              {/* Genres Multi-select Popover */}
              <div className="sfb-popover-anchor">
                <button
                  type="button"
                  className={`sfb-btn ${selectedGenreSlugs.length > 0 ? "active" : ""}`}
                  onClick={() => setOpenPopover(openPopover === "genres" ? null : "genres")}
                >
                  <span className="sfb-plus">⊕</span>
                  <span>
                    Genres{selectedGenreSlugs.length > 0 ? ` (${selectedGenreSlugs.length})` : ""}
                  </span>
                </button>
                {openPopover === "genres" && (
                  <div className="sfb-dropdown sfb-genres-dropdown">
                    <div className="sfb-genres-header">
                      <input
                        type="search"
                        value={genreSearch}
                        onChange={(e) => setGenreSearch(e.target.value)}
                        placeholder="Filter genres..."
                        className="sfb-mini-input"
                      />
                      {selectedGenreSlugs.length > 0 && (
                        <Link
                          href={buildHref({}, [])}
                          className="sfb-clear-link"
                          onClick={() => setOpenPopover(null)}
                        >
                          Clear ({selectedGenreSlugs.length})
                        </Link>
                      )}
                    </div>
                    <div className="sfb-genres-grid">
                      {filteredGenresList.map((g) => {
                        const gSlug = g.slug || slugifyGenre(g.name);
                        const isSelected = selectedGenreSlugs.includes(gSlug);
                        return (
                          <Link
                            key={gSlug}
                            href={toggleGenreHref(gSlug)}
                            className={`sfb-genre-chip ${isSelected ? "active" : ""}`}
                          >
                            <span>{g.name}</span>
                            {isSelected && <span>✓</span>}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Creator Popover */}
              <div className="sfb-popover-anchor">
                <button
                  type="button"
                  className={`sfb-btn ${creator ? "active" : ""}`}
                  onClick={() => setOpenPopover(openPopover === "creator" ? null : "creator")}
                >
                  <span className="sfb-plus">⊕</span>
                  <span>Creator{creator ? `: ${creator}` : ""}</span>
                </button>
                {openPopover === "creator" && (
                  <div className="sfb-dropdown sfb-creator-dropdown">
                    <form onSubmit={handleCreatorSubmit} className="sfb-creator-form">
                      <input
                        type="text"
                        value={creatorValue}
                        onChange={(e) => setCreatorValue(e.target.value)}
                        placeholder="Author or artist name..."
                        className="sfb-mini-input"
                        autoFocus
                      />
                      <div className="sfb-creator-actions">
                        {creator && (
                          <Link
                            href={buildHref({ creator: undefined })}
                            className="sfb-clear-link"
                            onClick={() => {
                              setCreatorValue("");
                              setOpenPopover(null);
                            }}
                          >
                            Clear
                          </Link>
                        )}
                        <button type="submit" className="sfb-apply-btn">
                          Apply
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </div>

              {/* Minimum Chapters Popover */}
              <div className="sfb-popover-anchor">
                <button
                  type="button"
                  className={`sfb-btn ${minChapters ? "active" : ""}`}
                  onClick={() =>
                    setOpenPopover(openPopover === "minChapters" ? null : "minChapters")
                  }
                >
                  <span className="sfb-plus">⊕</span>
                  <span>
                    Minimum Chapters{minChapters ? `: ${minChapters}+` : ""}
                  </span>
                </button>
                {openPopover === "minChapters" && (
                  <div className="sfb-dropdown">
                    <Link
                      href={buildHref({ minChapters: undefined })}
                      className={`sfb-dropdown-item ${!minChapters ? "active" : ""}`}
                      onClick={() => setOpenPopover(null)}
                    >
                      <span>Any chapters</span>
                      {!minChapters && <span>✓</span>}
                    </Link>
                    {MIN_CHAPTER_OPTIONS.map((mc) => {
                      const active = Number(minChapters) === mc;
                      return (
                        <Link
                          key={mc}
                          href={buildHref({ minChapters: active ? undefined : String(mc) })}
                          className={`sfb-dropdown-item ${active ? "active" : ""}`}
                          onClick={() => setOpenPopover(null)}
                        >
                          <span>{mc}+ chapters</span>
                          {active && <span>✓</span>}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Hide Bookmarked Button */}
              <button
                type="button"
                className={`sfb-btn ${hideBookmarked ? "active" : ""}`}
                onClick={() => setHideBookmarked((v) => !v)}
                aria-pressed={hideBookmarked}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
                <span>Hide Bookmarked</span>
              </button>

              {hasActiveFilters && (
                <Link
                  href={basePath}
                  className="sfb-btn sfb-reset-btn"
                  onClick={() => setHideBookmarked(false)}
                >
                  Reset
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* MOBILE FILTER BAR (Search Input + Full-width Filters Button) */}
        <div className="series-filter-mobile">
          <form onSubmit={handleSearchSubmit} className="sfb-mobile-search">
            <span className="sfb-search-icon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </span>
            <input
              type="search"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder="Search series..."
              aria-label="Search series"
              className="sfb-search-input"
            />
          </form>

          <button
            type="button"
            className="sfb-mobile-trigger"
            onClick={() => setMobileDrawerOpen(true)}
          >
            <span>Filters</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="4" y1="21" x2="4" y2="14" />
              <line x1="4" y1="10" x2="4" y2="3" />
              <line x1="12" y1="21" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12" y2="3" />
              <line x1="20" y1="21" x2="20" y2="16" />
              <line x1="20" y1="12" x2="20" y2="3" />
              <line x1="1" y1="14" x2="7" y2="14" />
              <line x1="9" y1="8" x2="15" y2="8" />
              <line x1="17" y1="16" x2="23" y2="16" />
            </svg>
          </button>
        </div>
      </div>

      </section>

      {/* MOBILE SLIDE-OVER DRAWER (Matches Screenshot 181615.png) */}
      {mobileDrawerOpen && (
        <div
          className="sfb-drawer-backdrop"
          onClick={() => setMobileDrawerOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Series Filters"
        >
          <div className="sfb-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="sfb-drawer-header">
              <h2 className="sfb-drawer-title">Filters</h2>
              <button
                type="button"
                className="sfb-drawer-close"
                aria-label="Close filters"
                onClick={() => setMobileDrawerOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="sfb-drawer-body">
              {/* 1. Sort */}
              <button
                type="button"
                className="sfb-drawer-row sfb-drawer-row-between"
                onClick={() => setMobileExpanded(mobileExpanded === "sort" ? null : "sort")}
              >
                <span className="sfb-drawer-row-left">
                  <span className="sfb-icon">⇅</span>
                  <span>{currentSortLabel}</span>
                </span>
                <span className="sfb-caret">▾</span>
              </button>
              {mobileExpanded === "sort" && (
                <div className="sfb-drawer-panel">
                  {SORTS.map(([val, label]) => {
                    const active = (sort || "updated") === val;
                    return (
                      <Link
                        key={val}
                        href={buildHref({ sort: val === "updated" ? undefined : val })}
                        className={`sfb-genre-chip ${active ? "active" : ""}`}
                        onClick={() => setMobileDrawerOpen(false)}
                      >
                        {label}
                      </Link>
                    );
                  })}
                </div>
              )}

              {/* 2. Status */}
              <button
                type="button"
                className={`sfb-drawer-row ${status ? "active" : ""}`}
                onClick={() => setMobileExpanded(mobileExpanded === "status" ? null : "status")}
              >
                <span className="sfb-plus">⊕</span>
                <span>Status{status ? `: ${status}` : ""}</span>
              </button>
              {mobileExpanded === "status" && (
                <div className="sfb-drawer-panel">
                  <Link
                    href={buildHref({ status: undefined })}
                    className={`sfb-genre-chip ${!status ? "active" : ""}`}
                    onClick={() => setMobileDrawerOpen(false)}
                  >
                    All
                  </Link>
                  {STATUSES.map((s) => {
                    const active = status?.toLowerCase() === s.toLowerCase();
                    return (
                      <Link
                        key={s}
                        href={buildHref({ status: active ? undefined : s })}
                        className={`sfb-genre-chip ${active ? "active" : ""}`}
                        onClick={() => setMobileDrawerOpen(false)}
                      >
                        {s}
                      </Link>
                    );
                  })}
                </div>
              )}

              {/* 3. Type */}
              <button
                type="button"
                className={`sfb-drawer-row ${type && !lockTypeToManga ? "active" : ""}`}
                onClick={() => setMobileExpanded(mobileExpanded === "type" ? null : "type")}
              >
                <span className="sfb-plus">⊕</span>
                <span>Type{lockTypeToManga ? ": Manga" : type ? `: ${type}` : ""}</span>
              </button>
              {mobileExpanded === "type" && (
                <div className="sfb-drawer-panel">
                  {lockTypeToManga ? (
                    <span className="sfb-genre-chip active">Manga</span>
                  ) : (
                    <>
                      <Link
                        href={buildHref({ type: undefined })}
                        className={`sfb-genre-chip ${!type ? "active" : ""}`}
                        onClick={() => setMobileDrawerOpen(false)}
                      >
                        All
                      </Link>
                      {TYPES.map((t) => {
                        const active = type?.toLowerCase() === t.toLowerCase();
                        return (
                          <Link
                            key={t}
                            href={buildHref({ type: active ? undefined : t })}
                            className={`sfb-genre-chip ${active ? "active" : ""}`}
                            onClick={() => setMobileDrawerOpen(false)}
                          >
                            {t}
                          </Link>
                        );
                      })}
                    </>
                  )}
                </div>
              )}

              {/* 4. Genres */}
              <button
                type="button"
                className={`sfb-drawer-row ${selectedGenreSlugs.length > 0 ? "active" : ""}`}
                onClick={() => setMobileExpanded(mobileExpanded === "genres" ? null : "genres")}
              >
                <span className="sfb-plus">⊕</span>
                <span>
                  Genres{selectedGenreSlugs.length > 0 ? ` (${selectedGenreSlugs.length})` : ""}
                </span>
              </button>
              {mobileExpanded === "genres" && (
                <div className="sfb-drawer-panel">
                  {availableGenres.map((g) => {
                    const gSlug = g.slug || slugifyGenre(g.name);
                    const isSelected = selectedGenreSlugs.includes(gSlug);
                    return (
                      <Link
                        key={gSlug}
                        href={toggleGenreHref(gSlug)}
                        className={`sfb-genre-chip ${isSelected ? "active" : ""}`}
                        onClick={() => setMobileDrawerOpen(false)}
                      >
                        {g.name}
                      </Link>
                    );
                  })}
                </div>
              )}

              {/* 5. Creator */}
              <button
                type="button"
                className={`sfb-drawer-row ${creator ? "active" : ""}`}
                onClick={() => setMobileExpanded(mobileExpanded === "creator" ? null : "creator")}
              >
                <span className="sfb-plus">⊕</span>
                <span>Creator{creator ? `: ${creator}` : ""}</span>
              </button>
              {mobileExpanded === "creator" && (
                <form
                  onSubmit={(e) => {
                    handleCreatorSubmit(e);
                    setMobileDrawerOpen(false);
                  }}
                  className="sfb-drawer-panel"
                >
                  <input
                    type="text"
                    value={creatorValue}
                    onChange={(e) => setCreatorValue(e.target.value)}
                    placeholder="Author or artist name..."
                    className="sfb-mini-input"
                  />
                  <button type="submit" className="sfb-apply-btn">
                    Apply
                  </button>
                </form>
              )}

              {/* 6. Minimum Chapters */}
              <button
                type="button"
                className={`sfb-drawer-row ${minChapters ? "active" : ""}`}
                onClick={() =>
                  setMobileExpanded(mobileExpanded === "minChapters" ? null : "minChapters")
                }
              >
                <span className="sfb-plus">⊕</span>
                <span>Minimum Chapters{minChapters ? `: ${minChapters}+` : ""}</span>
              </button>
              {mobileExpanded === "minChapters" && (
                <div className="sfb-drawer-panel">
                  <Link
                    href={buildHref({ minChapters: undefined })}
                    className={`sfb-genre-chip ${!minChapters ? "active" : ""}`}
                    onClick={() => setMobileDrawerOpen(false)}
                  >
                    Any
                  </Link>
                  {MIN_CHAPTER_OPTIONS.map((mc) => {
                    const active = Number(minChapters) === mc;
                    return (
                      <Link
                        key={mc}
                        href={buildHref({ minChapters: active ? undefined : String(mc) })}
                        className={`sfb-genre-chip ${active ? "active" : ""}`}
                        onClick={() => setMobileDrawerOpen(false)}
                      >
                        {mc}+
                      </Link>
                    );
                  })}
                </div>
              )}

              {/* 7. Hide Bookmarked */}
              <button
                type="button"
                className={`sfb-drawer-row ${hideBookmarked ? "active" : ""}`}
                onClick={() => setHideBookmarked((v) => !v)}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
                <span>Hide Bookmarked</span>
              </button>

              {hasActiveFilters && (
                <Link
                  href={basePath}
                  className="sfb-drawer-row sfb-reset-btn"
                  onClick={() => {
                    setHideBookmarked(false);
                    setMobileDrawerOpen(false);
                  }}
                >
                  Reset All Filters
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Results Grid */}
      {visibleItems.length === 0 ? (
        <div
          className="panel empty-note"
          style={{
            marginTop: 18,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div>
            No series matched those filters.{" "}
            <Link
              href={basePath}
              style={{ color: "var(--purple-2)", fontWeight: 600 }}
              onClick={() => setHideBookmarked(false)}
            >
              Reset all filters
            </Link>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              justifyContent: "center",
            }}
          >
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              Can&apos;t find the comic you&apos;re looking for?
            </span>
            <RequestComicModal defaultTitle={q || ""} buttonLabel="Request This Comic" />
          </div>
        </div>
      ) : (
        <div className="trend-row" data-layer="Results Grid" style={{ marginTop: 18 }}>
          {visibleItems.map((c) => (
            <ComicCard key={c.id} comic={c} />
          ))}
        </div>
      )}
    </>
  );
}
