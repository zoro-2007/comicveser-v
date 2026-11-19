"use client";

import { API, buildAuthHeaders } from "./api";

export interface PendingOfflineRead {
  comicId: string;
  chapterId: string;
  number: number;
  displayNumber?: string;
  imageIndex: number;
  markRead: boolean;
  updatedAt: number;
}

const PENDING_KEY = "cv:offline:pending-reads";
const readKey = (comicId: string) => `cv:read:${comicId}`;
const progressKey = (comicId: string) => `cv:progress:${comicId}`;

export function getLocalReadIds(comicId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const v = JSON.parse(localStorage.getItem(readKey(comicId)) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function getPendingOfflineReads(): PendingOfflineRead[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function recordOfflineReadProgress(input: {
  comicId: string;
  chapterId: string;
  number: number;
  displayNumber?: string;
  imageIndex: number;
  markRead: boolean;
}): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      progressKey(input.comicId),
      JSON.stringify({
        comicId: input.comicId,
        chapterId: input.chapterId,
        number: input.number,
        displayNumber: input.displayNumber,
        imageIndex: input.imageIndex,
        scrollY: Math.round(window.scrollY),
      }),
    );

    if (input.markRead) {
      const existing = getLocalReadIds(input.comicId);
      if (!existing.includes(input.chapterId)) {
        localStorage.setItem(
          readKey(input.comicId),
          JSON.stringify([...existing, input.chapterId].slice(-3000)),
        );
      }
    }

    const pending = getPendingOfflineReads().filter(
      (p) => !(p.comicId === input.comicId && p.chapterId === input.chapterId),
    );
    pending.push({
      ...input,
      updatedAt: Date.now(),
    });
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending.slice(-500)));
  } catch {
    // Ignore storage quota errors
  }

  if (typeof navigator !== "undefined" && navigator.onLine !== false) {
    void syncPendingOfflineReads();
  }
}

let syncing = false;

export async function syncPendingOfflineReads(): Promise<void> {
  if (typeof window === "undefined" || syncing) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;

  const queue = getPendingOfflineReads();
  if (queue.length === 0) return;

  syncing = true;
  try {
    const remaining: PendingOfflineRead[] = [];
    for (const item of queue) {
      try {
        const progRes = await fetch(`${API}/user/progress`, {
          method: "POST",
          credentials: "include",
          headers: buildAuthHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            comicId: item.comicId,
            chapterId: item.chapterId,
            imageIndex: item.imageIndex,
            scrollY: 0,
          }),
        });
        if (progRes.status === 401) {
          // User not logged in; keep local state and stop retrying server sync
          remaining.push(item);
          continue;
        }
        if (!progRes.ok) {
          remaining.push(item);
          continue;
        }
        if (item.markRead) {
          await fetch(`${API}/user/chapters/${encodeURIComponent(item.chapterId)}/read`, {
            method: "POST",
            credentials: "include",
            headers: buildAuthHeaders(),
          }).catch(() => {});
        }
      } catch {
        remaining.push(item);
      }
    }
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify(remaining));
    } catch {
      // Ignore storage errors
    }
  } finally {
    syncing = false;
  }
}
