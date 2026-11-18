"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Search, TrendingUp, X } from "lucide-react";
import { Comic, browseComics, formatRating, slugifyGenre } from "@/lib/comics";
import { Cover } from "./ComicCard";
import RequestComicModal from "./RequestComicModal";

const TRENDING = ["Action", "Fantasy", "Romance", "Regression", "Martial Arts", "Mystery", "Murim", "Sci-Fi"];

export default function SearchPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Comic[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else {
      setQ("");
      setResults([]);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const query = q.trim();
    if (!query) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      browseComics({ q: query, page: "1" })
        .then((r) => setResults(r.items.slice(0, 6)))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 220);
    return () => clearTimeout(t);
  }, [q, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="absolute inset-x-0 top-full z-40 px-3 pb-4 pt-2 sm:px-4" role="search">
      <div className="mx-auto max-w-3xl rounded-2xl border border-purple-500/30 bg-[#17141f]/95 p-4 shadow-2xl shadow-black/70 backdrop-blur-xl md:p-5">
        <div className="flex items-center gap-2.5">
          <div className="relative flex-1">
            <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search comics, manga, manhwa…"
              aria-label="Search comics, manga, manhwa"
              className="w-full rounded-full border border-purple-500/50 bg-[#131118] py-3 pl-11 pr-10 text-sm text-white outline-none focus:border-purple-400 sm:text-base"
            />
            {q && (
              <button
                type="button"
                onClick={() => {
                  setQ("");
                  inputRef.current?.focus();
                }}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-2 py-0.5 text-xs text-muted hover:bg-purple-600 hover:text-white"
              >
                ✕
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="rounded-xl border border-purple-500/40 bg-[#1d1929] p-2.5 text-muted hover:bg-purple-600 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted">
            <TrendingUp size={13} /> Browse by Genre
          </span>
          <RequestComicModal
            initialTitle={q.trim()}
            buttonLabel="+ Request a Comic"
            buttonClassName="text-xs font-semibold text-purple-400 hover:text-purple-300"
          />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5 sm:gap-2">
          {TRENDING.map((g) => (
            <Link
              key={g}
              href={`/browse?genre=${encodeURIComponent(slugifyGenre(g))}`}
              onClick={onClose}
              className="rounded-full border border-white/10 bg-[#221e30] px-3 py-1.5 text-xs font-semibold text-[#e6e1f4] transition hover:border-purple-500 hover:bg-purple-600 hover:text-white"
            >
              {g}
            </Link>
          ))}
        </div>

        {q.trim() && (
          <div className="mt-4" aria-live="polite">
            {loading ? (
              <p className="py-3 text-sm text-muted">Searching catalogue…</p>
            ) : results.length === 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-card/50 p-3.5 text-sm">
                <p className="m-0 text-muted">
                  No results for <strong className="text-fg">“{q.trim()}”</strong> on ComicVerse yet.
                </p>
                <RequestComicModal
                  initialTitle={q.trim()}
                  buttonLabel={`+ Request "${q.trim().slice(0, 28)}" to Admin`}
                  buttonClassName="rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-white hover:bg-primary-hover"
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {results.map((c) => {
                  const count = c.chapterCount || c.chapters.length;
                  const ratingLabel = formatRating(c);
                  return (
                    <Link
                      key={c.slug}
                      href={`/comics/${c.slug}`}
                      onClick={onClose}
                      className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#1d1b28] p-2.5 transition hover:border-purple-500/50 hover:bg-[#252234]"
                    >
                      <Cover hue={c.hue} title={c.title} src={c.coverUrl} className="aspect-[2/3] w-11 shrink-0 rounded-md !p-1" />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-sm font-bold leading-snug text-white">{c.title}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                          <span className="rounded bg-purple-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-purple-300">
                            {c.type || "Manhwa"}
                          </span>
                          <span>{count} Chapters</span>
                          <span>·</span>
                          <span>{c.status || "Ongoing"}</span>
                        </span>
                      </span>
                      {ratingLabel !== "Not Rated" && (
                        <span className="shrink-0 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-xs font-bold text-amber-400">
                          ★ {ratingLabel}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            )}
            {results.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-2.5">
                <Link
                  href={`/browse?q=${encodeURIComponent(q.trim())}`}
                  onClick={onClose}
                  className="text-sm font-semibold text-purple-400 hover:text-white"
                >
                  See all results for “{q.trim()}” →
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
