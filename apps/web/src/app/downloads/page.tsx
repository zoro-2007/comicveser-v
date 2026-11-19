import { Suspense } from "react";
import type { Metadata } from "next";
import DownloadsView from "@/components/DownloadsView";

export const metadata: Metadata = {
  title: "Downloads",
  description: "Read your saved ComicVerse chapters offline.",
};

export default function DownloadsPage() {
  return (
    <Suspense
      fallback={
        <section className="panel">
          <p className="py-8 text-center text-sm text-[#a49fb5]">Loading Downloads…</p>
        </section>
      }
    >
      <DownloadsView />
    </Suspense>
  );
}
