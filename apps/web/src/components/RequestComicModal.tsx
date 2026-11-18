"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "./AuthProvider";

const COMIC_TYPES = ["Manhwa", "Manga", "Manhua", "Webtoon"] as const;

export default function RequestComicModal({
  initialTitle = "",
  buttonLabel = "+ Request a Comic",
  buttonClassName = "pillbtn",
}: {
  initialTitle?: string;
  buttonLabel?: string;
  buttonClassName?: string;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [comicType, setComicType] = useState<string>("Manhwa");
  const [providerOrUrl, setProviderOrUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentTitle, setSentTitle] = useState<string | null>(null);

  useEffect(() => {
    if (open && initialTitle && !title) {
      setTitle(initialTitle);
    }
  }, [open, initialTitle, title]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleanTitle = title.trim();
    if (cleanTitle.length < 2) {
      setError("Please enter the comic title you want to request (at least 2 characters).");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const detailsParts = [
        `Requested Title: ${cleanTitle}`,
        `Type: ${comicType}`,
        providerOrUrl.trim() ? `Provider / Reference Link: ${providerOrUrl.trim()}` : null,
        notes.trim() ? `Additional Notes: ${notes.trim()}` : null,
      ].filter(Boolean);
      const description = detailsParts.join("\n");
      const subject = `Comic Request: ${cleanTitle} (${comicType})`;

      // Submit via top-level /reports endpoint (always available and never shadowed by /comics/:slug),
      // with fallback to FEATURE_REQUEST if an older backend instance is running.
      try {
        await api("/reports", {
          method: "POST",
          body: JSON.stringify({
            targetType: "platform",
            targetId: "comic-request",
            category: "COMIC_REQUEST",
            subject,
            description,
            reason: description,
          }),
        });
      } catch {
        await api("/reports", {
          method: "POST",
          body: JSON.stringify({
            targetType: "platform",
            targetId: "comic-request",
            category: "FEATURE_REQUEST",
            subject,
            description,
            reason: description,
          }),
        });
      }

      setSentTitle(cleanTitle);
      setOpen(false);
      setProviderOrUrl("");
      setNotes("");
    } catch (err) {
      setError((err as Error).message || "Could not submit comic request. Please log in first.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => {
          setSentTitle(null);
          if (initialTitle) setTitle(initialTitle);
          setOpen(true);
        }}
        className={buttonClassName}
      >
        {buttonLabel}
      </button>

      {sentTitle && (
        <span role="status" className="text-xs font-semibold text-emerald-400">
          ✓ Requested “{sentTitle}” — Admin notified!
        </span>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Request a Comic to Admin"
            className="w-full max-w-md rounded-2xl border border-[#342f49] bg-[#1b1826] p-5 text-left shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">Request a Missing Comic</h3>
                <p className="mt-0.5 text-xs text-[#a39db8]">
                  Can&apos;t find a series on ComicVerse? Send a request directly to our admins.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close modal"
                className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-[#a39db8] hover:text-white"
              >
                ✕
              </button>
            </div>

            {!user ? (
              <div className="space-y-3 py-2 text-xs text-[#ddd9ea]">
                <p>Please sign in so our admins can notify you as soon as your requested comic is published.</p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-lg border border-white/15 px-3 py-2 text-[#a39db8] hover:text-white"
                  >
                    Cancel
                  </button>
                  <Link
                    href="/login"
                    onClick={() => setOpen(false)}
                    className="rounded-lg bg-[#9333ea] px-4 py-2 font-semibold text-white hover:bg-[#a855f7]"
                  >
                    Sign In to Request
                  </Link>
                </div>
              </div>
            ) : (
              <>
                {error && (
                  <p role="alert" className="rounded-lg bg-red-500/15 p-2.5 text-xs text-red-300 border border-red-500/30">
                    {error}
                  </p>
                )}

                <form onSubmit={handleSubmit} className="space-y-3 text-xs">
                  <label className="block space-y-1">
                    <span className="font-semibold text-[#ddd9ea]">Comic Title *</span>
                    <input
                      type="text"
                      required
                      maxLength={200}
                      placeholder="e.g. Academy's Genius Swordmaster, Solo Leveling..."
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="w-full rounded-lg border border-[#342f49] bg-[#131118] px-3 py-2.5 text-white outline-none focus:border-[#9333ea]"
                    />
                  </label>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="block space-y-1">
                      <span className="font-semibold text-[#ddd9ea]">Format / Type</span>
                      <select
                        value={comicType}
                        onChange={(e) => setComicType(e.target.value)}
                        className="w-full rounded-lg border border-[#342f49] bg-[#131118] px-3 py-2.5 text-white outline-none focus:border-[#9333ea]"
                      >
                        {COMIC_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block space-y-1">
                      <span className="font-semibold text-[#ddd9ea]">Source / Link (Optional)</span>
                      <input
                        type="text"
                        maxLength={300}
                        placeholder="Asura Scans, WeebCentral, ComicK..."
                        value={providerOrUrl}
                        onChange={(e) => setProviderOrUrl(e.target.value)}
                        className="w-full rounded-lg border border-[#342f49] bg-[#131118] px-3 py-2.5 text-white outline-none focus:border-[#9333ea]"
                      />
                    </label>
                  </div>

                  <label className="block space-y-1">
                    <span className="font-semibold text-[#ddd9ea]">Additional Details (Optional)</span>
                    <textarea
                      rows={3}
                      maxLength={1000}
                      placeholder="Alternative title, author name, or any notes for the admin..."
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="w-full rounded-lg border border-[#342f49] bg-[#131118] px-3 py-2 text-white outline-none focus:border-[#9333ea]"
                    />
                  </label>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className="rounded-lg border border-white/15 px-3.5 py-2 text-[#a39db8] hover:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={busy}
                      className="rounded-lg bg-[#9333ea] px-4 py-2 font-semibold text-white hover:bg-[#a855f7] disabled:opacity-50"
                    >
                      {busy ? "Sending Request…" : "Send Request to Admin"}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
