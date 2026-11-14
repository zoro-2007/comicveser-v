import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Track from "@/components/Track";
import Reader, { ChapterMeta, ImgPage } from "@/components/Reader";
import { ApiError, api } from "@/lib/api";
import type { ExtPages } from "@/lib/sources";

type Props = { params: { slug: string; chapterId: string } };
export const metadata: Metadata = { title: "Reader" };
export const dynamic = "force-dynamic";

export default async function ChapterPage({ params }: Props) {
  let meta: ChapterMeta, first: ImgPage, chapters: { id: string; number: number }[];
  try {
    meta = await api<ChapterMeta>(`/chapters/${params.chapterId}`, { cache: "no-store" });
    if (meta.external) {
      const { sourceId, mangaId, chapterId } = meta.external;
      try {
        const pages = await api<ExtPages>(
          `/sources/${encodeURIComponent(sourceId)}/manga/${encodeURIComponent(mangaId)}/chapters/${encodeURIComponent(chapterId)}/pages`,
          { cache: "no-store" },
        );
        first = {
          total: pages.pages.length,
          items: pages.pages.map((page) => ({
            id: `p${page.pageNumber}`,
            position: page.pageNumber - 1,
            width: page.width ?? 0,
            height: page.height ?? 0,
            url: page.imageUrl,
          })),
        };
      } catch (err) {
        if (err instanceof ApiError && (err.status === 404 || err.status === 400)) throw err;
        first = { total: 0, items: [] };
      }
      meta = { ...meta, imageCount: first.total };
    } else {
      first = await api<ImgPage>(`/chapters/${params.chapterId}/images?from=0&limit=10`, { cache: "no-store" });
    }
    chapters = await api(`/comics/${meta.comic.id}/chapters?order=asc`, { cache: "no-store" }).catch(() => []);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      notFound();
    }
    const msg =
      e instanceof ApiError && e.message
        ? e.message
        : "The server took too long to respond while loading this chapter.";
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="text-xl font-bold">Couldn&apos;t load chapter right now</h1>
        <p className="mt-2 text-sm text-muted">{msg}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            href={`/comics/${params.slug}/chapter/${params.chapterId}`}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white"
          >
            Try again
          </Link>
          <Link
            href={`/comics/${params.slug}`}
            className="rounded-md border border-line px-4 py-2 text-sm font-semibold"
          >
            Back to comic
          </Link>
        </div>
      </div>
    );
  }
  if (meta.comic.slug !== params.slug) notFound();
  return (
    <>
      <Track type="CHAPTER_VIEW" comicId={meta.comic.id} chapterId={meta.id} />
      <Reader key={meta.id} slug={params.slug} meta={meta} initial={first.items} chapters={chapters} />
    </>
  );
}
