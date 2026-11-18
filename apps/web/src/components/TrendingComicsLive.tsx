"use client";

import { useEffect, useState } from "react";
import ComicCard from "./ComicCard";
import EmptyState from "./EmptyState";
import { api } from "@/lib/api";
import { ApiComic, Comic, toComic } from "@/lib/comics";

/**
 * Dynamically keeps the Homepage "Trending Comics" row ordered by highest views (and rating tie-breaker),
 * refreshing on mount and window focus so viewing a comic or reading a chapter immediately updates its rank.
 */
export default function TrendingComicsLive({ initial }: { initial: Comic[] }) {
  const [comics, setComics] = useState<Comic[]>(initial);

  useEffect(() => {
    setComics(initial);
  }, [initial]);

  useEffect(() => {
    let active = true;
    const refreshTrending = () => {
      api<{ items: ApiComic[] }>("/comics?pageSize=24&sort=popular", { cache: "no-store" })
        .then((res) => {
          if (!active || !Array.isArray(res?.items) || res.items.length === 0) return;
          const mapped = res.items.map((a) => toComic(a));
          mapped.sort(
            (a, b) =>
              (b.views ?? 0) - (a.views ?? 0) ||
              (b.rating ?? 0) - (a.rating ?? 0) ||
              b.updatedAt.localeCompare(a.updatedAt),
          );
          setComics(mapped.slice(0, 10));
        })
        .catch(() => {});
    };

    refreshTrending();
    window.addEventListener("focus", refreshTrending);
    return () => {
      active = false;
      window.removeEventListener("focus", refreshTrending);
    };
  }, []);

  if (!comics.length) {
    return <EmptyState title="Nothing trending yet" />;
  }

  return (
    <div className="trend-row" id="trendRow">
      {comics.slice(0, 5).map((c, i) => (
        <ComicCard key={c.slug} comic={c} priority={i < 5} />
      ))}
    </div>
  );
}
