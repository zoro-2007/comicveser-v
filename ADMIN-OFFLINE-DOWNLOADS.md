# ComicVerse global Downloads & Offline Reading switch

This update is based on the original project. The Vercel API proxy,
Render application, storage providers, and chapter-image destinations are
unchanged. No new environment variables are needed.

## Deploy

1. Merge the updated source into your current GitHub repository. Keep your
   production environment variables and database. The ZIP does not include
   local environment files, database dumps, or generated build output.
2. Deploy `apps/api` on Render first. The existing build and production
   startup run the migration deployment script. If you apply migrations
   manually, use `npm run db:migrate:deploy` from `apps/api` with the existing
   production `DATABASE_URL`. Confirm that the new migration applied and
   `GET /api/settings/offline-downloads` returns `enabled`, `revision`, and
   `purgeRevision`. For local development, run `npx prisma migrate deploy`
   from `apps/api`, then restart the API.
3. Deploy `apps/web` on Vercel. Keep the existing environment settings.
4. As an admin, go to **Admin → Settings → Downloads & Offline Reading**.
   The switch defaults to on and saves to the database immediately when
   changed. Other fields on the existing Settings page are unchanged.

## Verify after deployment

1. While enabled, download a chapter and verify it opens from Downloads.
   If testing a browser with an older cached worker, go to **Chrome DevTools
   → Application → Service Workers → Update**, then reload. Do not clear
   site data.
2. Turn the switch off. Open a comic and the profile menu. The download
   controls should be hidden. Open a saved Downloads link directly. It
   should show the lock screen without showing saved images. Confirm that
   the normal online reader still opens the chapter.
3. Turn it back on. The Downloads page should be empty, and the chapter
   must be downloaded again. Repeat with a device disconnected when you
   turn the switch off and back on. Its previously saved chapters should
   be erased the next time its updated app checks in.

Switching OFF requests permanent deletion of ComicVerse's local chapter
downloads, including saved pages and offline covers. A persistent deletion
counter makes this request apply even when the switch has been turned back
on by the time a device checks in. It does not delete server comics, accounts,
bookmarks, reading history, or unrelated browser caches.

A disconnected device cannot receive the request until it reconnects and
the updated ComicVerse app checks the setting. Its last verified offline
permission expires after at most 24 hours. This expiry locks access but
does not delete the files before the device receives the request.
