"use client";
import Link from "next/link";
import { Eye } from "lucide-react";
import { useLibrary } from "./LibraryProvider";

/** Shows white "Continue Reading" when the reader has progress in this comic, or white "First Chapter" otherwise. */
export default function ContinueButton({
  comicId,
  slug,
  firstChapterId,
}: {
  comicId: string;
  slug: string;
  firstChapterId?: string;
}) {
  const p = useLibrary().progressFor(comicId);
  const targetChapterId = p?.chapterId || firstChapterId;
  if (!targetChapterId) return null;

  return (
    <Link
      href={`/comics/${slug}/chapter/${targetChapterId}`}
      className="cv-detail-btn cv-read-btn"
    >
      <Eye size={17} aria-hidden />
      <span>{p ? "Continue Reading" : "First Chapter"}</span>
    </Link>
  );
}
