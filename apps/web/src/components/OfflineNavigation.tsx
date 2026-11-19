"use client";

import { useEffect } from "react";
import { cleanupStaleDownloads, DOWNLOADS_PATH, installOfflineWorker } from "../../public/offline/storage.mjs";

export default function OfflineNavigation() {
  useEffect(() => {
    const redirect = () => {
      if (!navigator.onLine && navigator.serviceWorker?.controller?.scriptURL.endsWith("/offline-sw.js")) {
        window.location.replace(DOWNLOADS_PATH);
      }
    };
    window.addEventListener("offline", redirect);
    if (navigator.onLine) {
      void installOfflineWorker().then(cleanupStaleDownloads).catch(() => {});
    } else {
      redirect();
    }
    return () => window.removeEventListener("offline", redirect);
  }, []);
  return null;
}
