import type { Metadata } from "next";
import Link from "next/link";
import SeriesFilterBar from "@/components/SeriesFilterBar";
import {
  BrowseQuery,
  browseComics,
  getGenres,
  slugifyGenre,
} from "@/lib/comics";

export const metadata: Metadata = { title: "Browse Series" };

export default async function BrowsePage({ searchParams }: { searchParams: BrowseQuery }) {
  const [res, availableGenres] = await Promise.all([
    browseComics(searchParams),
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
    const next: BrowseQuery = { ...searchParams, page: undefined, ...overrides };
    const sp = new URLSearchParams();
    Object.entries(next).forEach(([k, v]) => {
      if (v) sp.set(k, v);
    });
    const q = sp.toString();
    return q ? `/browse?${q}` : "/browse";
  };

  return (
    <div style={{ paddingTop: 18 }}>
      <SeriesFilterBar
        basePath="/browse"
        headingTitle="Browse Series"
        totalCount={total}
        items={items}
        availableGenres={availableGenres}
        selectedGenreSlugs={selectedGenreSlugs}
        q={searchParams.q}
        type={searchParams.type}
        status={searchParams.status}
        creator={searchParams.creator}
        minChapters={searchParams.minChapters}
        sort={searchParams.sort}
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
