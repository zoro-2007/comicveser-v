# ComicVerse offline downloads

A reader can save individual published comic chapters on this browser. Open a published ComicVerse comic, select the gold **Read Offline** action, and click the download icon next to a chapter. Wait for the saved message before closing the tab. Select a different chapter to save it too.

**Online** → Open **Downloads** below **Messages** in the avatar menu. The chapter panel also has an **Open Downloads** link.

**Offline** → Open ComicVerse in the same browser profile. After the offline service has installed on an earlier online visit, ComicVerse opens its standalone Downloads page when the browser goes offline or a normal page navigation cannot reach the server. Select a comic cover card, pick a saved chapter, and scroll to read. Tap the artwork to toggle the chapter toolbar, or use the chapter links at the bottom. Next and Previous navigate only between chapters saved on this device.

The download action uses the existing publish checks. Only chapters published under ComicVerse comics are eligible. Uploaded content and approved provider-backed chapters published into ComicVerse use the same download UI. Drafts, deleted chapters, and chapters that are listed only in a provider catalog do not receive a download action. Downloading public chapters is not a Premium subscription feature.

## Deploy or run the update

- Keep your existing API, database, and object storage configuration. The feature adds no database migration and does not change the backend.
- From the extracted `comicverse` folder, restore your existing environment files privately. The ZIP keeps example files, not private environment files or the database dump.
- Install web dependencies if needed with `npm --prefix apps/web ci`. Start the API as usual, then run `npm run dev` or build with `npm run build` and start with `npm run start`.
- For a deployed site, use HTTPS. For local testing, use `http://localhost:3000`. An HTTP LAN URL such as `http://192.168.1.5:3000` is not a secure context for service workers.
- Open the updated site once online in the browser you plan to read in. Download one chapter, wait for the checkmark, disable Wi-Fi or use browser offline mode, and reload the site. You should see **Downloads** and be able to open the comic card and read the chapter, including its last page.

Downloads are not files in Windows' Downloads folder and do not sync to another account, browser, device, or site domain. They are local to the browser profile and site origin. Use **Remove** in Downloads to free the associated space. Clearing site data or browser eviction removes saved chapters. The browser can refuse persistent storage. If a particular provider does not serve a readable image to the browser, the download fails without marking the chapter saved. Try again later or use a published chapter with accessible image files.

## Files

| Path | Purpose |
| --- | --- |
| `apps/web/src/app/comics/[slug]/page.tsx` | Gold Read Offline shortcut on published comic detail |
| `apps/web/src/components/ChapterList.tsx` | Per-chapter download, progress, cancel, retry and saved states |
| `apps/web/src/components/ProfileMenu.tsx` | Downloads menu item under Messages |
| `apps/web/src/lib/download-chapter.ts` | Validates chapter ownership, fetches all ordered images and verifies they decode before committing |
| `apps/web/src/components/OfflineNavigation.tsx` | Installs the offline worker and handles disconnect on an open tab |
| `apps/web/public/offline-sw.js` and `apps/web/public/offline/` | Self-contained downloads library, reader, and local media storage |
| `apps/web/e2e/offline-downloads.spec.ts` | End-to-end test using a local fixture API and real browser offline mode |

The worker precaches the Downloads page and its local assets. Image responses go into a per-download Cache Storage cache. IndexedDB tracks completed downloads and only receives a record after every page has been written and verified. To deploy a revised offline shell later, increment the shell cache version in `offline-sw.js`.

## Automated test

The offline browser test uses a fixture API on localhost port 4310 and a web app on port 3000. It does not require live provider traffic or a test database.

PowerShell, from `apps/web`:

```powershell
npx playwright install chromium
$env:NEXT_PUBLIC_API_URL = "http://localhost:4310/api"
$env:API_INTERNAL_URL = "http://localhost:4310/api"
npm run build
npm run start
```

In a second PowerShell window, also in `apps/web`:

```powershell
$env:E2E_NO_SERVER = "1"
npm run test:e2e -- e2e/offline-downloads.spec.ts
```
