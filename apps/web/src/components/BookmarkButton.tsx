"use client";
import { Bookmark } from "lucide-react";
import { useLibrary } from "./LibraryProvider";

export default function BookmarkButton({ comicId }: { comicId: string }) {
  const lib = useLibrary();
  const on = lib.isBookmarked(comicId);
  return (
    <button
      type="button"
      onClick={() => void lib.toggleBookmark(comicId)}
      aria-pressed={on}
      className={`cv-detail-btn ${on ? "cv-bm-on" : "cv-bm-off"}`}
    >
      <Bookmark size={16} className={on ? "fill-current" : ""} aria-hidden />
      <span>{on ? "Bookmarked" : "Bookmark"}</span>
    </button>
  );
}
