import type { Metadata } from "next";
import Link from "next/link";
import SeriesFilterBar from "@/components/SeriesFilterBar";
import {
  BrowseQuery,
  browseComics,
  getGenres,
  slugifyGenre,
} from "@/lib/comics";

export const metadata: Metadata = {
  title: "Manga Series",
  description: "Browse and filter Manga series on ComicVerse.",
};

export default async function MangaCataloguePage({ searchParams }: { searchParams: BrowseQuery }) {
  const effectiveQuery: BrowseQuery = { ...searchParams, type: "Manga" };
  const [res, availableGenres] = await Promise.all([
    browseComics(effectiveQuery),
    getGenres(),
  ]);
  const { items, total, page, pages } = res;

  const selectedGenreSlugs = Array.from(
    new Set(
      (searchParams.genre ?? "")
        .split(",")
        .map((g) => slugifyGenre(g))
        .filter(Boolean),
    ),
  );

  const href = (overrides: Partial<BrowseQuery>) => {
    const next: BrowseQuery = { ...searchParams, type: undefined, page: undefined, ...overrides };
    const sp = new URLSearchParams();
    Object.entries(next).forEach(([k, v]) => {
      if (v) sp.set(k, v);
    });
    const q = sp.toString();
    return q ? `/manga?${q}` : "/manga";
  };

  return (
    <div style={{ paddingTop: 18 }}>
      <SeriesFilterBar
        basePath="/manga"
        headingTitle="Manga Series"
        totalCount={total}
        items={items}
        availableGenres={availableGenres}
        selectedGenreSlugs={selectedGenreSlugs}
        q={searchParams.q}
        type="Manga"
        status={searchParams.status}
        creator={searchParams.creator}
        minChapters={searchParams.minChapters}
        sort={searchParams.sort}
        lockTypeToManga
      />

      {pages > 1 && (() => {
        const winStart = Math.max(1, Math.min(page - 2, Math.max(1, pages - 4)));
        const winEnd = Math.min(pages, winStart + 4);
        const pageNums = Array.from({ length: winEnd - winStart + 1 }, (_, i) => winStart + i);
        return (
          <nav aria-label="Pagination" className="pag">
            <Link
              href={href({ page: String(Math.max(1, page - 1)) })}
              aria-disabled={page <= 1}
              className={`pg${page <= 1 ? " disabled" : ""}`}
            >
              ‹
            </Link>
            {pageNums.map((n) => (
              <Link
                key={n}
                href={href({ page: String(n) })}
                aria-current={n === page ? "page" : undefined}
                className={`pg${n === page ? " on" : ""}`}
              >
                {n}
              </Link>
            ))}
            <Link
              href={href({ page: String(Math.min(pages, page + 1)) })}
              aria-disabled={page >= pages}
              className={`pg${page >= pages ? " disabled" : ""}`}
            >
              ›
            </Link>
          </nav>
        );
      })()}
    </div>
  );
}
