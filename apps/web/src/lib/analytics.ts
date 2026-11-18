import { API, buildAuthHeaders } from "./api";

export type Evt = {
  type: "PAGE_VIEW" | "COMIC_VIEW" | "CHAPTER_VIEW" | "SEARCH" | "READ_SESSION";
  comicId?: string;
  chapterId?: string;
  path?: string;
  query?: string;
};

export const getConsent = () => {
  try {
    return localStorage.getItem("cv:consent");
  } catch {
    return null;
  }
};

/**
 * Records first-party view & search counters (no IP address or third-party tracking cookie is stored).
 * Skips only if the visitor explicitly opted out ("denied").
 */
export function track(e: Evt) {
  if (getConsent() === "denied") return;
  fetch(`${API}/analytics/event`, {
    method: "POST",
    credentials: "include",
    keepalive: true,
    headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(e),
  }).catch(() => {});
}
