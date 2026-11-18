# ComicVerse — Full Project Fix & Update Changelog (`CHANGELOG-FIXES.md`)

This document summarizes the root causes investigated and the changes implemented across the ComicVerse backend (`apps/api/`) and frontend (`apps/web/`) for all nine requirements.

---

## 1. Fix Bookmark Popup Saving
**Files Modified**:
- `apps/web/src/components/BookmarksView.tsx`
- `apps/api/src/user/user.service.ts`

**Root Cause**:
- Changing the reading status in the bookmark popup called `PUT /user/bookmarks/:comicId` instead of the backend's actual route `PUT /user/bookmarks/:comicId/status`.
- Clicking `−`, `+`, or `Set to Chapter X` (`Set to Latest`) only mutated local component state (`modalChapNum`) without resolving the real `chapterId` or persisting reading progress to `/user/progress` and `/user/chapters/:chapterId/read`.

**Fix Implemented**:
- Updated `updateStatus()` in `BookmarksView.tsx` to call `PUT /user/bookmarks/${encodeURIComponent(it.comic.id)}/status` with `{ status }` immediately on status selection.
- Added `ensureComicChapters(comicId)` (with per-comic caching and `AbortController` support) to load published chapters (`GET /comics/:id/chapters?order=asc`) and resolve the exact `chapterId` for any chapter number or step delta.
- Implemented `saveChapterSelection(it, target)` wired to the `−`, `+`, and `Set to Chapter X` buttons so every click immediately persists the selected chapter via `POST /user/progress` (`{ comicId, chapterId, imageIndex: 0, scrollY: 0 }`) and `POST /user/chapters/:chapterId/read`.
- Added live status feedback badge (`Saving…`, `Saved`, `Error: ...`) inside the bookmark modal header (`role="status"`, `aria-live="polite"`).
- Automatically updates and refreshes both the bookmark grid cards and the **Continue Reading** rail (`reload()` + `cv:bookmarks` event) while preserving existing reading history and `ChapterRead` records.
- Updated `UserService.library()` in `apps/api/src/user/user.service.ts` so `progress.readCount` reflects `effectiveReadCount` when `readingHistory` advances via the bookmark popup.

---

## 2. Fix Bookmark Card Navigation
**Files Modified**:
- `apps/web/src/components/BookmarksView.tsx`
- `apps/web/src/app/globals.css`

**Root Cause**:
- Each card in `.bm-poster-grid` was wrapped in a single `<button className="bm-poster-card">` that opened the bookmark popup regardless of whether the user clicked the cover image or the comic title.

**Fix Implemented**:
- Converted `.bm-poster-card` into a semantic `<article className="bm-poster-card">` with two distinct, accessible click targets:
  1. `<button type="button" className="bm-poster-cov" onClick={() => openModal(it)} aria-label="Manage bookmark for <Title>">` wrapping the cover image, badges, and progress bar to open the bookmark popup.
  2. `<Link href="/comics/${c.slug}" className="bm-poster-foot">` wrapping the comic title (`.bm-poster-title`) to navigate directly to the comic detail page.
- Updated `.bm-poster-card`, `.bm-poster-cov`, and `.bm-poster-foot` styles in `apps/web/src/app/globals.css` with independent hover/focus states.

---

## 3. Display Comic Genres on Detail Pages
**Files Modified**:
- `apps/api/src/sources/sources.service.ts`
- `apps/web/src/app/comics/[slug]/page.tsx`
- `apps/web/src/app/globals.css`

**Root Cause**:
- `SourcesService.approve()` created `Comic` records from provider metadata without persisting `details.genres` into the Prisma `Genre` and `ComicGenre` tables, leaving `comic.genres` empty on published comics.
- `apps/web/src/app/comics/[slug]/page.tsx` did not render a genre chips row in the hero metadata block.

**Fix Implemented**:
- Added `normalizeGenreEntries()` and `syncComicGenres(tx, comicId, rawGenres)` in `apps/api/src/sources/sources.service.ts` and invoked it during `approve()`, `linkFallbackSource()`, and `synchronizeAndRepairComic()`.
- `syncComicGenres()` upserts each valid provider genre into `Genre` (by consistent `slug`) and links it to the comic via `ComicGenre.upsert` **additively**, preserving all existing genres when another provider is linked as a fallback and never inventing genres.
- Updated `apps/web/src/app/comics/[slug]/page.tsx` to render clickable `.detail-genre-chip` links (`/browse?genre=<slug>`) for all genres on the comic detail page.

---

## 4. Retrieve Provider Genres & Ratings and Remove Hardcoded `9.5` Fallback
**Files Modified**:
- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20261117000000_provider_metadata_and_sync_cursor/migration.sql`
- `apps/api/src/prisma/prisma.service.ts`
- `apps/api/src/sources/provider.interface.ts`
- `apps/api/src/sources/asurascans.normalize.ts`
- `apps/api/src/sources/asurascans.provider.ts`
- `apps/api/src/sources/comick.normalize.ts`
- `apps/api/src/sources/weebcentral.normalize.ts`
- `apps/api/src/comics/comics.service.ts`
- `apps/web/src/lib/comics.ts`
- `apps/web/src/app/comics/[slug]/page.tsx`
- `apps/web/src/components/ComicCard.tsx`
- `apps/web/src/components/FeaturedCarousel.tsx`
- `apps/web/src/components/PopularTabs.tsx`
- `apps/web/src/components/SearchPanel.tsx`
- `apps/web/src/components/NavClient.tsx`
- `apps/web/src/app/admin/comics/page.tsx`
- `apps/web/src/app/admin/page.tsx`

**Root Cause**:
- Provider normalizers did not extract ratings (`rating?: number | null` was absent from `MangaSummary`), `weebcentral.normalize.ts` hardcoded `genres: []`, and `asurascans.provider.ts` did not fall back to series page HTML metadata when the search API omitted genres/ratings.
- Frontend pages and cards hardcoded `"9.5"`, `"9.6"`, or fake arrays `[9.8, 9.1, ...]` whenever `comic.rating` was `null`.

**Fix Implemented**:
- Added additive Prisma migration `20261117000000_provider_metadata_and_sync_cursor` adding `providerRating Float?` to `Comic` and `providerRating Float?`, `genres String[] @default([])` to `SourceTitle`.
- Enhanced `asurascans.normalize.ts` (`extractAsuraGenres`, `extractAsuraRating`, `extractAsuraHtmlMetadata`) and `asurascans.provider.ts` to extract real genres and ratings from both the Asura JSON API and public series page HTML/JSON-LD.
- Enhanced `comick.normalize.ts` (`genresFrom`, `ratingFrom`) to extract genres across `md_comic_md_genres`, `genres`, `categories`, and `mu_categories` (filtering out numeric category IDs) and extract `bayesian_rating` / `rating` / `score`.
- Enhanced `weebcentral.normalize.ts` (`extractWeebCentralGenres`, `extractWeebCentralRating`, `extractLabelledValues`, `extractStatusFromMarkup`, `extractYearFromMarkup`) to extract real genres from `/search?included_tag=` anchors and JSON-LD, plus genuine ratings when present (`null` otherwise).
- Updated `ComicsService` to keep `userRating` (from ComicVerse `Rating` rows) and `providerRating` (from `Comic.providerRating`) separate while exposing `rating: userRating ?? providerRating ?? null`.
- Added `formatRating()` in `apps/web/src/lib/comics.ts` returning `"Not Rated"` whenever no genuine rating exists, and removed all hardcoded `9.5` / `9.6` fallbacks across the entire frontend.

---

## 5. Fix Browse and Manga Genre Filtering
**Files Modified**:
- `apps/api/src/comics/comics.service.ts`
- `apps/web/src/lib/comics.ts`
- `apps/web/src/app/browse/page.tsx`
- `apps/web/src/app/manga/page.tsx`

**Root Cause**:
- `browseComics()` in `apps/web/src/lib/comics.ts` filtered `p.genre` against a static `GENRES` array using exact case-sensitive string matching (`GENRES.includes(g)`), silently dropping lowercase genre slugs (e.g. `action`, `murim`) and any dynamic provider genres.
- `ComicsService.list()` in `apps/api/src/comics/comics.service.ts` required `AND` across multiple genres instead of `OR` and only matched `genre.slug`.

**Fix Implemented**:
- Added `getGenres()` in `apps/web/src/lib/comics.ts` to load dynamic genres from `GET /api/genres` and normalize them with consistent `slugifyGenre()` slugs.
- Updated `browseComics()` to normalize selected genres via `slugifyGenre()` without dropping dynamic provider genres, passing comma-separated slugs in `?genre=`.
- Updated `ComicsService.list()` to match any selected genre using **OR** matching (`genres: { some: { genre: { OR: [{ slug: { in: genreSlugs } }, ...] } } }`) while preserving search (`q`), `type`, `status`, `sort`, and pagination.
- Updated `apps/web/src/app/browse/page.tsx` and `apps/web/src/app/manga/page.tsx` to load genres dynamically from the API, support multi-genre chip toggling, sync URL query parameters, and filter published comics accurately.

---

## 6. Fix Asura Scans Repeated Publication
**Files Modified**:
- `apps/api/src/prisma/prisma.service.ts`
- `apps/api/src/sources/asurascans.normalize.ts`
- `apps/api/src/sources/asurascans.provider.ts`
- `apps/api/src/sources/sources.service.ts`

**Root Cause**:
1. Asura Scans appends a rotating 8-character random hex suffix to series slugs (e.g., `nano-machine-1111aaaa` rotating to `nano-machine-9999bbbb`). Exact `externalId` lookups missed when Asura rotated the suffix, causing already-approved comics to appear as new (`reviewState: null`).
2. `PrismaService.onModuleInit()` contained a destructive startup block that ran `DELETE FROM "SourceTitle"` and archived published comics whenever duplicate titles were detected on server restart.
3. `publicAlternatives()` upserted `SourceTitle` rows with `comicId: null`, which `adminSearch` treated as `archivedPublication = true` (`reviewState: null`).

**Fix Implemented**:
- Removed the destructive `DELETE FROM "SourceTitle"` startup block in `PrismaService.onModuleInit()`, replacing it with non-destructive orphan reconciliation that preserves all approved `SourceTitle` rows and published `Comic` relationships across server restarts.
- Added `canonicalAsuraSlug()` in `asurascans.normalize.ts` to strip rotating trailing 8-hex suffixes (`-[0-9a-f]{8}`) for canonical comparisons.
- Updated `SourcesService.findExistingSourceTitle()`, `adminSearch()`, `adminDetails()`, and `approve()` to match Asura Scans records by exact `externalId` first and canonical base slug second, updating the stored `externalId` and `sourceUrl` in-place when a suffix rotation occurs while keeping `state: "APPROVED"` and the linked `comicId` intact.
- Made `SourcesService.approve()` fully idempotent while preserving intentional `unpublish`, `archive`, and `republish` workflows.

---

## 7. Fix Automatic Sync and Chapter Publishing (Every 10 Minutes)
**Files Modified**:
- `apps/api/src/sources/sources.config.ts`
- `apps/api/src/sources/sources.service.ts`
- `apps/api/src/maintenance/maintenance.service.ts`
- `.env.example`, `apps/api/.env.example`, `render.yaml`
- `docs/AUTOMATIC-SYNC.md`, `docs/DEPLOYMENT.md`, `docs/EXTERNAL-SOURCES.md`

**Root Cause**:
- `loadSourceSyncConfig()` defaulted `SOURCE_SYNC_INTERVAL_MINUTES` to `30` instead of `10`.
- `SourcesService` did not manage its own lifecycle scheduler (`OnModuleInit` / `OnModuleDestroy`).
- Failing `SourceTitle` sync attempts did not update `lastSyncedAt`, causing failing comics to remain at the front of `orderBy: { lastSyncedAt: "asc" }` and starve comics outside the first batch (`batchSize = 20`).
- `runAutomaticChapterSync()` fetched each provider's chapter catalogue twice per comic (once in `synchronizeAndRepairComic`, once in `syncNewChaptersFromSource`).

**Fix Implemented**:
- Changed the default sync interval in `loadSourceSyncConfig()` to **10 minutes** (`SOURCE_SYNC_INTERVAL_MINUTES=10`, `600,000` ms).
- Implemented `OnModuleInit` and `OnModuleDestroy` on `SourcesService` with `startAutomaticSyncScheduler()` and `stopAutomaticSyncScheduler()`.
- Enforced distributed lock protection (`lock:sources:auto-chapter-sync` via `CacheService.tryLock`) to prevent overlapping sync runs.
- Implemented fair batch ordering (sorting comics by oldest `lastSyncedAt` `NULLS FIRST` with round-robin cursor tie-breaking) and guaranteed `lastSyncedAt`, `lastSyncStatus`, and `lastSyncError` updates on both success and failure so every published comic is checked fairly across batches.
- Reused prefetched chapter rows across repair and new-chapter import to halve provider requests, validated chapters before import, prevented duplicates, preserved manually uploaded chapters, and sent notifications only after successful publication.

---

## 8. Prevent Duplicate Comics Across Providers
**Files Modified**:
- `apps/api/src/sources/alternative.normalize.ts`
- `apps/api/src/sources/sources.service.ts`
- `apps/api/src/sources/sources.controller.ts`
- `apps/api/src/sources/sources.dto.ts`
- `apps/web/src/lib/sources.ts`
- `apps/web/src/components/admin/SourceCatalog.tsx`
- `apps/web/src/components/admin/SourceTitleReview.tsx`

**Root Cause**:
- `adminSearch()`, `adminDetails()`, and `approve()` only looked up `SourceTitle` rows for the current `sourceId`. Searching for an already-published comic (e.g., *Nano Machine* published from Asura Scans) under ComicK or WeebCentral showed it as a brand-new title eligible for **Approve & publish**, creating duplicate `Comic` rows.

**Fix Implemented**:
- Implemented `findCrossProviderPublishedMatch()` in `apps/api/src/sources/alternative.normalize.ts` to compare candidate titles and alternative titles against all published ComicVerse comics and their linked `SourceTitle` records, with sequel/spin-off conflict guards (`ragnarok`, `shippuden`, `season 2`, etc.) so uncertain or sequel titles are surfaced as `ambiguousMatches` and never auto-merged.
- Updated `adminSearch()` and `adminDetails()` in `SourcesService` to populate `existingComic`, `alreadyPublishedFrom`, `alreadyPublishedMessage` (`"Already published on ComicVerse from: <Provider>"`), and `ambiguousMatches`.
- Updated `approve()` in `SourcesService` to block duplicate `Comic` creation when a title is already published from another provider (unless `forceNewComic` is explicitly requested) and added `POST /api/admin/sources/catalog/:sourceId/:externalId/link-fallback` (`linkCatalogAsFallback`) to link the provider as a `CHAPTER_FALLBACK` source on the existing comic.
- Updated `SourceCatalog.tsx` and `SourceTitleReview.tsx` to display `Already published on ComicVerse from: <Provider>`, link directly to `/comics/[slug]`, hide the normal **Approve & publish** button for confirmed matches, and provide an explicit **Link as Fallback Source** button.

---

## 9. Redesign Mobile Navigation
**Files Modified**:
- `apps/web/src/components/BottomNav.tsx`
- `apps/web/src/app/globals.css`

**Root Cause**:
- `BottomNav.tsx` and `.m-bottomnav` rendered a flat edge-to-edge bar at `bottom: 0` without a floating frosted-glass capsule aesthetic or luminous active-tab pill indicator.

**Fix Implemented**:
- Redesigned `BottomNav.tsx` and `.m-bottomnav` in `apps/web/src/app/globals.css` following the fourth reference screenshot adapted to ComicVerse's purple theme:
  - Floating rounded transparent liquid-glass capsule (`border-radius: 999px`, `width: min(calc(100vw - 24px), 420px)`, `bottom: calc(12px + var(--safe-bottom))`).
  - Multi-layer frosted backdrop blur (`backdrop-filter: blur(24px) saturate(185%)`), subtle white specular border (`1px solid rgba(255, 255, 255, 0.2)`), soft drop shadow, and ambient purple glow.
  - Evenly spaced 4-column layout (`grid-cols-4`) preserving ComicVerse's exact four tabs: **Home**, **Manga**, **Browse**, and **Bookmarks**.
  - Luminous active-tab pill indicator (`.m-bottomnav-pill`) with top specular highlight bar, responsive touch targets (`min-height: 54px`), iOS safe-area inset support, sufficient page bottom padding (`padding-bottom: calc(96px + var(--safe-bottom))` on mobile `<main>`), and hidden on desktop (`@media (min-width: 1024px)`).
