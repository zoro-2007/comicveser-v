# ComicVerse Offline Chapter Downloads

## Requirements & Browser Constraints
- **HTTPS or localhost required**: Service Workers and IndexedDB offline persistence require a secure context (`https://` in production or `http://localhost` / `http://127.0.0.1` in local development).
- **Open once online before offline use**: The browser must load ComicVerse at least once while online so `/sw.js` registers and caches the `/downloads` shell and static assets.
- **Same-origin & device-local**: Downloaded chapters, page images, and cover images are stored locally in IndexedDB (`comicverse-offline-v1`) on the same browser profile and origin. Nothing is uploaded or synced across accounts or devices.

## Files Added / Changed
- `apps/web/public/sw.js` — Same-origin Service Worker caching `/downloads` and `/_next/static/*` assets (never caching `/api/*`, `/auth/*`, `/user/*`, `/admin/*`, or `Authorization` requests).
- `apps/web/src/components/OfflineSwRegistrar.tsx` — Registers `/sw.js` and warms `/downloads` + static assets.
- `apps/web/src/lib/offline-db.ts` — IndexedDB persistence (`comics`, `chapters`, `pages`, `covers`) with atomic saves and storage reclamation on delete.
- `apps/web/src/lib/offline-downloader.ts` — Bounded chapter downloader with `GET /chapters/:id` publication & comic-ownership recheck, paginated image batching, provider resolution, cancellation, bounded retries, and image render verification (`createImageBitmap` / `Image`).
- `apps/web/src/components/OfflineReader.tsx` — Standalone offline reader with zero API/CDN/font dependencies, local `ObjectURL` rendering, and Previous/Next restricted to downloaded chapters.
- `apps/web/src/components/DownloadsView.tsx` & `apps/web/src/app/downloads/page.tsx` — Responsive `/downloads` library, comic cover cards, downloaded-only chapter list, removal, and empty state.
- `apps/web/src/components/ProfileMenu.tsx` — Added **Downloads** directly below **Messages** linking to `/downloads`.
- `apps/web/src/components/ChromeGate.tsx` — Hides site header, footer, and mobile bottom nav while reading an offline chapter.
- `apps/web/src/app/comics/[slug]/page.tsx` & `apps/web/src/components/ChapterList.tsx` — Added gold **Read Offline** action and per-chapter Download / Progress / Cancel / Retry / Open Offline controls.
- `apps/web/src/app/layout.tsx` & `apps/web/src/app/globals.css` — Mounted `OfflineSwRegistrar` and added dark-purple & gold offline UI styles.
