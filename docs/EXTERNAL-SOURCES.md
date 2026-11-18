# External sources (WeebCentral, Asura Scans, and ComicK)

ComicVerse administrators can search external catalogs, inspect title details and chapters, and explicitly approve titles for publication. Approved chapters use ComicVerse's reader. Source retrieval runs through the API; chapter images are loaded directly from the providers and are never downloaded or stored by ComicVerse.

```
Admin -> ComicVerse web -> ComicVerse API -> WeebCentral / Asura Scans / ComicK
Reader -> ComicVerse API (chapter page list) -> provider image URLs in the browser
```

## Providers

| Provider | Catalog and chapter flow | Metadata & Limits |
|---|---|---|
| WeebCentral | Public quick-search form, series details, full chapter-list fragment, and chapter image fragment. | Extracts real genres (`included_tag` links & JSON-LD), ratings (when present), status, authors, artists, release year, and alternative titles. Honors the 10-second `robots.txt` crawl delay per API process. English only. |
| Asura Scans | Publicly linked series-search API with `offset` pagination; title details use search API + public series HTML metadata fallback; chapter links are read from the public series page and page URLs from the public chapter page. | Extracts real genres and provider ratings (`9.2`, etc., or `null` when unrated). Resolves rotating 8-character hex slug suffixes via `canonicalAsuraSlug` so published titles remain idempotent. |
| ComicK | JSON search, title details, language-filtered chapter listings, and chapter image-list routes. | Extracts real genres (`md_comic_md_genres`, `genres`, `categories` excluding numeric IDs) and provider ratings (`bayesian_rating` / `rating`). Supports automatic or explicit fallback chapter linking from Asura Scans or WeebCentral. |

## Enable & Configure Automatic 10-Minute Sync

Set these variables in `apps/api/.env` (or deployment environment):

```env
SOURCES_ENABLED=true
SOURCES_USER_AGENT=ComicVerse/1.0 (+https://your-site.example)
SOURCES_TIMEOUT_MS=10000

# Automatic Provider Chapter Synchronization (every 10 minutes by default)
SOURCE_SYNC_ENABLED=true
SOURCE_SYNC_INTERVAL_MINUTES=10
SOURCE_SYNC_BATCH_SIZE=20
```

- `SOURCES_ENABLED` enables provider catalog search, metadata extraction, and chapter synchronization.
- `SOURCE_SYNC_ENABLED` (`true` by default) starts the automatic chapter synchronization scheduler inside `SourcesService.onModuleInit()`.
- `SOURCE_SYNC_INTERVAL_MINUTES` defaults to `10` (600,000 ms).
- `SOURCE_SYNC_BATCH_SIZE` defaults to `20` published comics per cycle, ordered by oldest `lastSyncedAt` (`NULLS FIRST`) with round-robin cursor rotation so every published comic is checked fairly.

## Cross-Provider Duplicate Prevention & Fallback Linking

When searching any provider catalog (`/admin/comics/new` or `/admin/sources/catalog/[sourceId]/[externalId]`):
- `SourcesService` cross-checks all existing published ComicVerse comics and their linked `SourceTitle` records using normalized titles and alternative titles (`findCrossProviderPublishedMatch`).
- Confirmed matches return `alreadyPublishedFrom` and `alreadyPublishedMessage` (`"Already published on ComicVerse from: <Provider>"`), hide the duplicate **Approve & publish** button, link directly to `/comics/[slug]`, and expose **Link as Fallback Source** (`POST /api/admin/sources/catalog/:sourceId/:externalId/link-fallback`).
- Uncertain or sequel/spin-off titles (e.g., *Solo Leveling* vs. *Solo Leveling: Ragnarok*) are surfaced in `ambiguousMatches` and are never automatically merged.

## Tests

- `cd apps/api && npm test` runs provider, normalization, configuration, automatic sync, cross-provider matching, and regression tests with mocked provider responses.
- `cd apps/web && npm test` runs the reader chapter-navigation tests.
