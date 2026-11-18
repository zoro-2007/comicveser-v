# Automatic 10-Minute Chapter Synchronization (`SourcesService`)

## Overview
ComicVerse includes an automatic, lifecycle-managed chapter synchronization engine that checks published comics for newly released chapters every **10 minutes** by default and publishes genuinely new chapters without duplicating existing chapters or overwriting manually uploaded chapters.

---

## Configuration & Environment Variables

Defined in `apps/api/src/sources/sources.config.ts` (`loadSourceSyncConfig`) and documented in `.env.example`, `apps/api/.env.example`, and `render.yaml`:

| Environment Variable | Default | Description |
|---|---|---|
| `SOURCES_ENABLED` | `true` (in `.env.example` / `render.yaml`) | Master switch enabling external manga providers (`asurascans`, `comick`, `weebcentral`). |
| `SOURCE_SYNC_ENABLED` | `true` | Enables automatic background chapter synchronization on API startup. |
| `SOURCE_SYNC_INTERVAL_MINUTES` | `10` | Interval in minutes between automatic synchronization cycles (`10` minutes = `600,000` ms). Clamped between `1` and `1440`. |
| `SOURCE_SYNC_BATCH_SIZE` | `20` | Maximum number of published comics synchronized per cycle (`1`–`200`). |
| `SOURCES_TIMEOUT_MS` | `10000` | Per-request HTTP timeout in milliseconds (`1000`–`60000`). |
| `DISABLE_JOBS` | unset (`false`) | Set to `true` on secondary read-only replicas or test runners to disable background timers. |

---

## Lifecycle & Scheduler Architecture

1. **Startup & Shutdown (`SourcesService.onModuleInit` / `onModuleDestroy`)**:
   - Located in `apps/api/src/sources/sources.service.ts`.
   - When the NestJS `SourcesModule` initializes (`NODE_ENV !== "test"` and `DISABLE_JOBS !== "true"`), `SourcesService.onModuleInit()` calls `startAutomaticSyncScheduler()`.
   - `startAutomaticSyncScheduler()` registers:
     - A recurring `setInterval` timer running every `SOURCE_SYNC_INTERVAL_MINUTES` (`10` minutes / `600,000` ms by default).
     - A one-shot warm-up `setTimeout` (15 seconds after startup) so newly deployed instances run an initial sync pass without blocking port binding.
   - `onModuleDestroy()` calls `stopAutomaticSyncScheduler()` to clear all active timers cleanly on shutdown.
   - `MaintenanceService` skips starting a duplicate timer if `this.sources.isSchedulerRunning()` is already `true`.

2. **Distributed Lock (`lock:sources:auto-chapter-sync`)**:
   - Before each cycle begins, `runAutomaticChapterSync()` acquires the distributed lock `lock:sources:auto-chapter-sync` (TTL `900` seconds / 15 minutes) via `CacheService.tryLock`.
   - If a cycle is already running (either from a slow upstream provider or a manual `POST /api/admin/sources/sync-chapters` trigger), the overlapping invocation immediately returns `{ skipped: true }` and is logged safely.
   - The lock is always released in a `finally` block (`CacheService.unlock`).

3. **Fair Batch Selection & Starvation Prevention**:
   - Each cycle queries all published comics (`publishState: "PUBLISHED"`, `deletedAt: null`) that have at least one approved (`state: "APPROVED"`) and enabled (`enabled: true`) `SourceTitle` link.
   - Comics are ordered by the earliest `lastSyncedAt` timestamp across their approved chapter-capable provider links (`NULLS FIRST`), with a rotating round-robin cursor (`syncRoundRobinCursor`) as a tie-breaker when multiple comics share the same timestamp.
   - Even when a provider times out, rate-limits, or returns an error for a link, `SourcesService` updates `lastSyncedAt = new Date()`, `lastSyncStatus = "FAILED"`, and `lastSyncError = <message>` on that `SourceTitle` row so failing titles rotate to the back of the queue and never starve comics outside the first batch (`batchSize = 20`).

4. **Single-Fetch Repair + New Chapter Import**:
   - For each eligible comic, `runAutomaticChapterSync()` evaluates its approved, enabled `SourceTitle` links in role order (`PRIMARY` first, then `CHAPTER_FALLBACK` ordered by `priority ASC`).
   - Provider chapter catalogues are fetched once per link and reused across `synchronizeAndRepairComic(..., prefetchedRows)` and `syncNewChaptersFromRows(...)`, cutting upstream HTTP requests in half while respecting provider rate limits (including WeebCentral's 10-second crawl delay and Asura Scans' canonical base-slug fallback).

5. **Validation, Deduplication & Manual Chapter Preservation**:
   - **No Empty/Invalid Chapters**: Chapters without a valid external ID or parseable chapter number/special label are skipped.
   - **No Duplicate Chapters**: Existing chapters are indexed by normalized `number`, `numberLabel`, and `(sourceTitleId, externalId)`. Only genuinely new chapters (`!existingNumbers.has(key)`) are created.
   - **Manual Chapters Preserved**: Chapters uploaded manually (`sourceChapter === null` or `pageStorage === "LOCAL"` / `"S3"`) are never deleted or overwritten.
   - **Metadata & Genre Backfill**: If the comic is missing genres or `providerRating`, the sync pass additively backfills `Genre` / `ComicGenre` and `providerRating` without removing existing genres.

6. **Post-Publication Notifications & Audit Tracking**:
   - Notifications (`NotificationsService.notifyNewChapterPublished`) are dispatched **only after** a new `Chapter` and `SourceChapter` transaction commits with `publishState: "PUBLISHED"`.
   - Each `SourceTitle` records `lastSyncedAt`, `lastSyncStatus` (`"SUCCESS"` or `"FAILED"`), and `lastSyncError` (`null` on success, error message on failure).
   - Cache keys (`comics:list`, `comics:slug:<slug>`, `comics:chapters:<comicId>`) are invalidated automatically whenever new chapters are published.

---

## Manual Trigger Endpoint
Administrators can also trigger an immediate sync cycle on demand:
```http
POST /api/admin/sources/sync-chapters
```
This endpoint uses the exact same `runAutomaticChapterSync()` method and distributed lock as the 10-minute background scheduler.
