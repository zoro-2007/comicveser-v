"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { API } from "@/lib/api";
import access, { type DownloadAccessRecord } from "../../public/offline/access.js";
import { usePathname } from "next/navigation";

type Status = "checking" | "enabled" | "disabled" | "locked";
type Value = { status: Status; purgeRevision: number; refresh: () => Promise<void> };
const DownloadContext = createContext<Value>({ status: "checking", purgeRevision: 0, refresh: async () => {} });

export function useDownloadAccess() {
  return useContext(DownloadContext);
}

export default function DownloadAccessProvider({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [status, setStatus] = useState<Status>("checking");
  const [record, setRecord] = useState<DownloadAccessRecord | null>(null);
  const requestId = useRef(0);

  const apply = useCallback((value: DownloadAccessRecord | null) => {
    setRecord(value);
    setStatus(value?.enabled === false ? "disabled" : access.isAllowed(value) ? "enabled" : "locked");
  }, []);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const current = navigator.onLine === false ? await access.read() : await access.checkOnline(API);
      if (id === requestId.current) apply(current);
    } catch {
      if (id === requestId.current) apply(null);
    }
  }, [apply]);

  useEffect(() => {
    const unsubscribe = access.onChange(apply);
    const onRefresh = () => { void refresh(); };
    const onVisible = () => { if (document.visibilityState === "visible") onRefresh(); };
    onRefresh();
    window.addEventListener("online", onRefresh);
    window.addEventListener("offline", onRefresh);
    window.addEventListener("focus", onRefresh);
    window.addEventListener("pageshow", onRefresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      requestId.current++;
      unsubscribe();
      window.removeEventListener("online", onRefresh);
      window.removeEventListener("offline", onRefresh);
      window.removeEventListener("focus", onRefresh);
      window.removeEventListener("pageshow", onRefresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [apply, refresh]);

  useEffect(() => {
    if (path === "/admin/settings" || /^\/comics\/[^/]+$/.test(path ?? "")) {
      void refresh();
    }
    if (path !== "/downloads") return;
    // Recheck a saved reader left open on a connected device. Do not poll other pages.
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine !== false) void refresh();
    }, 60000);
    return () => window.clearInterval(timer);
  }, [path, refresh]);

  useEffect(() => {
    if (!record?.enabled || status !== "enabled") return;
    const timer = window.setTimeout(() => {
      setStatus("locked");
      if (navigator.onLine !== false) void refresh();
    }, Math.max(0, record.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [record, refresh, status]);

  return <DownloadContext.Provider value={{ status, purgeRevision: record?.purgeRevision ?? 0, refresh }}>
    {children}
  </DownloadContext.Provider>;
}
