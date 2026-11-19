"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { syncPendingOfflineReads } from "@/lib/offline-read-sync";

function collectStaticAssetUrls(): string[] {
  if (typeof document === "undefined") return [];
  const urls = new Set<string>(["/downloads"]);
  const origin = window.location.origin;

  document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]').forEach((el) => {
    try {
      const u = new URL(el.href, origin);
      if (u.origin === origin && u.pathname.startsWith("/_next/static/")) {
        urls.add(u.href);
      }
    } catch {
      // Ignore invalid URLs
    }
  });

  document.querySelectorAll<HTMLScriptElement>("script[src]").forEach((el) => {
    try {
      const u = new URL(el.src, origin);
      if (u.origin === origin && u.pathname.startsWith("/_next/static/")) {
        urls.add(u.href);
      }
    } catch {
      // Ignore invalid URLs
    }
  });

  return Array.from(urls);
}

export default function OfflineSwRegistrar() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const isSecure =
      window.location.protocol === "https:" ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";
    if (!isSecure) return;

    let cancelled = false;

    const registerAndWarm = async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
        if (navigator.storage?.persist) { void navigator.storage.persist().catch(() => {}); }
        if (cancelled) return;

        const postUrls = (target: ServiceWorker | null | undefined) => {
          if (!target) return;
          target.postMessage({ type: "CACHE_URLS", urls: collectStaticAssetUrls() });
        };

        void reg.update().catch(() => {});
        if (reg.active) postUrls(reg.active);
        if (reg.installing) {
          reg.installing.addEventListener("statechange", () => {
            if (reg.active) postUrls(reg.active);
          });
        }
        await navigator.serviceWorker.ready;
        if (!cancelled && navigator.serviceWorker.controller) {
          postUrls(navigator.serviceWorker.controller);
        }
      } catch {
        // Service worker registration is best-effort
      }
    };

    void registerAndWarm();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (navigator.onLine !== false) {
      void syncPendingOfflineReads();
    }
    const onOnline = () => {
      void syncPendingOfflineReads();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [pathname]);

  return null;
}
