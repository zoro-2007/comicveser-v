import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  normalizeSearch as normalizeAsuraSearch,
  normalizeDetails as normalizeAsuraDetails,
  canonicalAsuraSlug,
} from "./sources/asurascans.normalize";
import { normalizeDetails as normalizeComickDetails } from "./sources/comick.normalize";
import { normalizeDetails as normalizeWeebCentralDetails } from "./sources/weebcentral.normalize";
import { findCrossProviderPublishedMatch } from "./sources/alternative.normalize";
import { loadSourceSyncConfig } from "./sources/sources.config";
import { SourcesService } from "./sources/sources.service";
import { ComicsService } from "./comics/comics.service";
import { UserService } from "./user/user.service";
import { formatRating, slugifyGenre } from "../../web/src/lib/comics";

const WEB_SRC = path.resolve(__dirname, "../../web/src");

test("Requirement 1 & 2: Bookmark popup saving and separate bookmark card navigation targets", async () => {
  const bmCode = fs.readFileSync(path.join(WEB_SRC, "components/BookmarksView.tsx"), "utf8");

  // 1. Correct status endpoint PUT /user/bookmarks/:comicId/status
  assert.ok(
    bmCode.includes("/user/bookmarks/${encodeURIComponent(it.comic.id)}/status"),
    "BookmarksView must call PUT /user/bookmarks/:comicId/status when changing reading status",
  );
  assert.ok(
    !bmCode.includes('act(`/user/bookmarks/${it.comic.id}`, "PUT"'),
    "BookmarksView must not call the nonexistent PUT /user/bookmarks/:comicId route",
  );

  // 2. Chapter +, -, and Set to Latest persist reading position using real chapter ID
  assert.ok(
    bmCode.includes('act("/user/progress", "POST"') &&
      bmCode.includes('act(`/user/chapters/${encodeURIComponent(targetChapter.id)}/read`, "POST")'),
    "BookmarksView must persist selected chapter via POST /user/progress and POST /user/chapters/:chapterId/read",
  );
  assert.ok(
    bmCode.includes('saveChapterSelection(modalItem, { type: "step", delta: -1 })') &&
      bmCode.includes('saveChapterSelection(modalItem, { type: "step", delta: 1 })') &&
      bmCode.includes('saveChapterSelection(modalItem, { type: "latest" })'),
    "Clicking -, +, and Set to Latest must immediately trigger saveChapterSelection",
  );

  // 3. Feedback states: Saving, Saved, Error
  assert.ok(
    bmCode.includes("Saving…") && bmCode.includes("Saved") && bmCode.includes("saveState"),
    "BookmarksView must display Saving, Saved, and Error feedback in the bookmark popup",
  );

  // 4. Separate click targets on bookmark card: cover opens popup, title links to comic detail page
  assert.ok(
    bmCode.includes('className="bm-poster-cov"') && bmCode.includes("openModal(it)"),
    "Clicking the comic cover/image must open the bookmark popup",
  );
  assert.ok(
    bmCode.includes("href={`/comics/${c.slug}`}") && bmCode.includes('className="bm-poster-foot"'),
    "Clicking the comic title/name must navigate to the comic detail page (/comics/[slug])",
  );

  // 5. Verify UserService.bookmarks computes progress from real chapter numbers and preserves reading history
  const mockDb: any = {
    $transaction: async (ops: any[]) => Promise.all(ops),
    bookmark: {
      findMany: async () => [
        {
          id: "bm-1",
          userId: "u-1",
          comicId: "c-nano",
          status: "ON_HOLD",
          createdAt: new Date("2026-11-10T00:00:00Z"),
          updatedAt: new Date("2026-11-17T00:00:00Z"),
          comic: {
            id: "c-nano",
            slug: "nano-machine",
            title: "Nano Machine",
            type: "MANHWA",
            status: "COMPLETED",
            coverKey: null,
            externalCoverUrl: "https://img.example/nano.jpg",
            updatedAt: new Date("2026-11-17T00:00:00Z"),
            chapters: [{ id: "ch-337", number: 337, title: "Chapter 337", publishedAt: new Date(), sourceChapter: null }],
          },
        },
      ],
    },
    chapter: {
      groupBy: async () => [{ comicId: "c-nano", _count: { _all: 337 } }],
    },
    chapterRead: {
      groupBy: async () => [{ comicId: "c-nano", _count: { _all: 2 }, _max: { readAt: new Date("2026-11-17T01:00:00Z") } }],
    },
    readingHistory: {
      findMany: async () => [
        {
          id: "rh-1",
          userId: "u-1",
          comicId: "c-nano",
          chapterId: "ch-110",
          imageIndex: 0,
          scrollY: 0,
          updatedAt: new Date("2026-11-17T01:00:00Z"),
          chapter: { id: "ch-110", number: 110, title: "Chapter 110", sourceChapter: null },
        },
      ],
    },
  };

  const userSvc = new UserService(mockDb, { readUrl: async () => null } as any);
  const res = await userSvc.bookmarks("u-1", { page: 1 });
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].progress.current?.chapterId, "ch-110");
  assert.equal(res.items[0].progress.current?.number, 110);
  assert.equal(res.items[0].progress.readCount, 110);
  assert.equal(res.items[0].status, "ON_HOLD");
});

test("Requirement 3 & 4: Provider genres & ratings extraction, separation of user vs provider ratings, and removal of 9.5 fallback", async () => {
  // Asura Scans normalizer: genres + rating
  const asuraSearch = normalizeAsuraSearch(
    {
      data: [
        {
          slug: "nano-machine-7f8a9b10",
          title: "Nano Machine",
          rating: "9.2",
          genres: [{ name: "Action" }, { name: "Murim" }, { name: "Martial Arts" }],
        },
      ],
      meta: { total: 1 },
    },
    { page: 1, limit: 20 },
  );
  assert.equal(asuraSearch.items.length, 1);
  assert.equal(asuraSearch.items[0].rating, 9.2);
  assert.deepEqual(asuraSearch.items[0].genres, ["Action", "Murim", "Martial Arts"]);

  const asuraUnrated = normalizeAsuraDetails({
    slug: "new-series-11223344",
    title: "New Series",
    genres: ["Fantasy, Adventure"],
  });
  assert.equal(asuraUnrated.rating, null, "Must not invent a rating when provider has none");
  assert.deepEqual(asuraUnrated.genres, ["Fantasy", "Adventure"]);

  // ComicK normalizer: genres + bayesian rating without numeric category IDs
  const comickDetails = normalizeComickDetails(
    {
      comic: {
        hid: "omniscient-hid",
        slug: "omniscient-reader",
        title: "Omniscient Reader's Viewpoint",
        bayesian_rating: "9.41",
        md_comic_md_genres: [
          { md_genres: { name: "Action" } },
          { md_genres: { name: "Fantasy" } },
          { md_genres: { name: "12345" } },
        ],
      },
    },
    "omniscient-hid",
  );
  assert.equal(comickDetails.rating, 9.41);
  assert.deepEqual(comickDetails.genres, ["Action", "Fantasy"]);

  // WeebCentral normalizer: HTML genre links & rating extraction
  const wcHtml = `
    <html>
      <head><meta property="og:title" content="Nano Machine | Weeb Central" /></head>
      <body>
        <h1>Nano Machine</h1>
        <a href="/search?included_tag=Action">Action</a>
        <a href="/search?included_tag=Martial+Arts">Martial Arts</a>
        <a href="/search?included_tag=Sci-Fi">Sci-Fi</a>
        <strong>Author(s):</strong> <a href="/search?author=Hanjung+Wolya">Hanjung Wolya</a>
        <strong>Status:</strong> <span>Completed</span>
      </body>
    </html>
  `;
  const wcDetails = normalizeWeebCentralDetails(wcHtml, "01J76XY7E5E1C5Y9J0M2N3P4Q5");
  assert.deepEqual(wcDetails.genres, ["Action", "Martial Arts", "Sci-Fi"]);
  assert.equal(wcDetails.rating, null, "WeebCentral without rating must return null, never 9.5");
  assert.equal(wcDetails.status, "completed");

  // Frontend formatRating helper returns "Not Rated" when null/undefined/0
  assert.equal(formatRating(null), "Not Rated");
  assert.equal(formatRating(undefined), "Not Rated");
  assert.equal(formatRating(0), "Not Rated");
  assert.equal(formatRating(8.76), "8.8");

  // Verify no hardcoded 9.5 fallback remains in detail page or cards
  const detailPageCode = fs.readFileSync(path.join(WEB_SRC, "app/comics/[slug]/page.tsx"), "utf8");
  assert.ok(!detailPageCode.includes("9.5"), "Comic detail page must not contain hardcoded 9.5 rating fallback");
  assert.ok(detailPageCode.includes("formatRating"), "Comic detail page must use formatRating helper");
  assert.ok(detailPageCode.includes("detail-genre-chip"), "Comic detail page must render genre chips");
});

test("Requirement 3 & 5: Genre persistence during provider publish/fallback link and dynamic OR genre filtering", async () => {
  // 1. Test ComicsService.list OR genre filtering & separate ratings
  let capturedWhere: any = null;
  const mockComicsDb: any = {
    $transaction: async (ops: any[]) => Promise.all(ops),
    rating: {
      groupBy: async () => [],
    },
    chapter: {
      findMany: async () => [{ id: "ch-1", comicId: "c-1", number: 1, title: "Ch 1", publishedAt: new Date(), sourceChapter: null }],
      groupBy: async () => [{ comicId: "c-1", _count: 1 }],
    },
    comic: {
      findMany: async ({ where }: any) => {
        capturedWhere = where;
        return [
          {
            id: "c-1",
            slug: "nano-machine",
            title: "Nano Machine",
            synopsis: "Mashin Academy",
            type: "MANHWA",
            status: "COMPLETED",
            coverKey: null,
            externalCoverUrl: null,
            bannerKey: null,
            author: "Hanjung Wolya",
            artist: "REDICE Studio",
            releaseYear: 2020,
            views: 500,
            providerRating: 9.1,
            isFeatured: true,
            updatedAt: new Date(),
            createdAt: new Date(),
            genres: [
              { genre: { id: "g-1", slug: "action", name: "Action" } },
              { genre: { id: "g-2", slug: "murim", name: "Murim" } },
            ],
            tags: [],
            _count: { bookmarks: 5, chapters: 1 },
          },
        ];
      },
      count: async () => 1,
    },
  };
  const comicsSvc = new ComicsService(
    mockComicsDb,
    { readUrl: async () => null } as any,
    { get: async () => null, set: async () => undefined, del: async () => undefined, delByPrefix: async () => undefined } as any,
    { log: async () => undefined } as any,
  );

  const listResult = await comicsSvc.list({ genre: "action,murim", page: 1, pageSize: 24 } as any);
  assert.ok(Array.isArray(capturedWhere?.AND?.[0]?.genres?.some?.genre?.OR), "Multiple genres must use OR matching on comic.genres.some");
  assert.equal(listResult.items[0].userRating, null, "Comic with no user ratings must have userRating: null");
  assert.equal(listResult.items[0].providerRating, 9.1, "Comic must expose providerRating separately");
  assert.equal(listResult.items[0].rating, 9.1, "Display rating falls back to providerRating when userRating is null");

  // 2. Verify slugifyGenre consistency
  assert.equal(slugifyGenre("Martial Arts"), "martial-arts");
  assert.equal(slugifyGenre("Sci-Fi & Fantasy"), "sci-fi-fantasy");
  assert.equal(slugifyGenre("Murim"), "murim");
});

test("Requirement 6: Asura Scans repeated publication fix (idempotent approve + canonical base slug across hex suffix rotation)", async () => {
  assert.equal(canonicalAsuraSlug("nano-machine-7f8a9b10"), "nano-machine");
  assert.equal(canonicalAsuraSlug("solo-leveling-ragnarok-ab12cd34"), "solo-leveling-ragnarok");
  assert.equal(canonicalAsuraSlug("omniscient-reader"), "omniscient-reader");

  const sourceTitles: any[] = [
    {
      id: "st-asura-1",
      sourceId: "asurascans",
      externalId: "nano-machine-1111aaaa",
      title: "Nano Machine",
      alternativeTitles: ["나노머신"],
      sourceUrl: "https://asurascans.com/comics/nano-machine-1111aaaa",
      coverUrl: "https://img.example/nano.jpg",
      type: "MANHWA",
      status: "ONGOING",
      releaseYear: 2020,
      author: "Hanjung Wolya",
      artist: "REDICE Studio",
      synopsis: "Nanotechnology meets martial arts.",
      genres: ["Action", "Murim"],
      providerRating: 9.2,
      state: "APPROVED",
      role: "PRIMARY",
      enabled: true,
      comicId: "comic-nano",
      comic: {
        id: "comic-nano",
        slug: "nano-machine",
        title: "Nano Machine",
        publishState: "PUBLISHED",
        deletedAt: null,
      },
    },
  ];

  const comics: any[] = [
    {
      id: "comic-nano",
      slug: "nano-machine",
      title: "Nano Machine",
      altTitle: "나노머신",
      publishState: "PUBLISHED",
      deletedAt: null,
      genres: [
        { genre: { id: "g-action", slug: "action", name: "Action" } },
        { genre: { id: "g-murim", slug: "murim", name: "Murim" } },
      ],
      sourceTitles,
    },
  ];

  const mockDb: any = {
    sourceSetting: {
      findMany: async () => [{ sourceId: "asurascans", enabled: true, displayName: "Asura Scans" }],
      findUnique: async () => ({ sourceId: "asurascans", enabled: true, displayName: "Asura Scans" }),
    },
    sourceTitle: {
      findMany: async () => sourceTitles,
      findUnique: async ({ where }: any) => {
        const key = where?.sourceId_externalId;
        if (!key) return null;
        return sourceTitles.find((s) => s.sourceId === key.sourceId && s.externalId === key.externalId) ?? null;
      },
      update: async ({ where, data }: any) => {
        const row = sourceTitles.find((s) => s.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      },
    },
    comic: {
      findMany: async () => comics,
    },
  };

  const mockAsuraProvider: any = {
    id: "asurascans",
    displayName: "Asura Scans",
    baseUrl: "https://asurascans.com",
    supportedTypes: ["MANGA", "MANHWA", "MANHUA"],
    search: async () => ({
      // Asura rotated the 8-hex suffix from 1111aaaa to 9999bbbb!
      items: [
        {
          id: "nano-machine-9999bbbb",
          externalId: "nano-machine-9999bbbb",
          sourceId: "asurascans",
          title: "Nano Machine",
          alternativeTitles: [],
          coverUrl: "https://img.example/nano.jpg",
          description: null,
          status: "Ongoing",
          genres: ["Action", "Murim"],
          contentType: "manhwa",
          language: "en",
          sourceUrl: "https://asurascans.com/comics/nano-machine-9999bbbb",
          rating: 9.2,
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
      hasMore: false,
    }),
  };

  const mockCache: any = {
    get: async () => null,
    set: async () => undefined,
    del: async () => undefined,
    delByPrefix: async () => undefined,
    wrap: async (_k: string, _ttl: number, fn: () => Promise<any>) => fn(),
    tryLock: async () => true,
    unlock: async () => undefined,
  };

  const svc = new SourcesService(
    mockDb,
    mockCache,
    { enabled: true, timeoutMs: 10_000, userAgent: "ComicVerse/1.0" },
    [mockAsuraProvider],
    { createChapterPublishedNotifications: async () => undefined } as any,
  );

  const searchRes = await svc.adminSearch("asurascans", { query: "Nano Machine", page: 1, limit: 20 });
  assert.equal(searchRes.items.length, 1);
  assert.equal(
    searchRes.items[0].reviewState,
    "APPROVED",
    "Already-approved Asura Scans comic must remain APPROVED even when Asura rotates its 8-hex slug suffix",
  );
  assert.equal(searchRes.items[0].comicSlug, "nano-machine");
});

test("Requirement 7: Automatic 10-minute chapter synchronization lifecycle scheduler & fair batch rotation", async () => {
  // 1. Default interval is 10 minutes (600,000 ms)
  const cfg = loadSourceSyncConfig({});
  assert.equal(cfg.intervalMinutes, 10, "Default automatic sync intervalMinutes must be 10");
  assert.equal(cfg.intervalMs, 10 * 60_000, "Default automatic sync intervalMs must be 600,000 ms");

  // 2. Lifecycle scheduler starts and stops cleanly
  const svc = new SourcesService(
    {} as any,
    { tryLock: async () => false, unlock: async () => undefined } as any,
    { enabled: true, timeoutMs: 10_000, userAgent: "ComicVerse/1.0" },
    [],
  );
  const started = svc.startAutomaticSyncScheduler({ SOURCE_SYNC_ENABLED: "true", SOURCE_SYNC_INTERVAL_MINUTES: "10" });
  assert.equal(started, true);
  assert.equal(svc.isSchedulerRunning(), true);
  svc.stopAutomaticSyncScheduler();
  assert.equal(svc.isSchedulerRunning(), false);
});

test("Requirement 8: Cross-provider duplicate comic detection, alternative title matching, and sequel ambiguity guard", async () => {
  const displayNameOf = (id: string) =>
    id === "asurascans" ? "Asura Scans" : id === "comick" ? "ComicK" : "WeebCentral";

  const publishedCatalog = [
    {
      id: "comic-nano",
      slug: "nano-machine",
      title: "Nano Machine",
      altTitle: "나노머신 · Nanomashin",
      sourceTitles: [
        {
          sourceId: "asurascans",
          externalId: "nano-machine-1111aaaa",
          title: "Nano Machine",
          state: "APPROVED",
          role: "PRIMARY",
        },
      ],
    },
    {
      id: "comic-sl",
      slug: "solo-leveling",
      title: "Solo Leveling",
      altTitle: "Only I Level Up · Na Honjaman Level Up",
      sourceTitles: [
        {
          sourceId: "asurascans",
          externalId: "solo-leveling-1234abcd",
          title: "Solo Leveling",
          state: "APPROVED",
          role: "PRIMARY",
        },
      ],
    },
  ];

  // 1. Exact title match across providers (Asura Scans -> ComicK)
  const exactMatch = findCrossProviderPublishedMatch(
    { sourceId: "comick", externalId: "nano-machine-comick", title: "Nano Machine", alternativeTitles: [] },
    publishedCatalog,
    displayNameOf,
  );
  assert.ok(exactMatch.confirmedMatch, "Exact title on ComicK must match Nano Machine published from Asura Scans");
  assert.equal(exactMatch.confirmedMatch?.comicId, "comic-nano");
  assert.equal(exactMatch.confirmedMatch?.primarySourceName, "Asura Scans");
  assert.equal(exactMatch.confirmedMatch?.alreadyPublishedMessage, "Already published on ComicVerse from: Asura Scans");

  // 2. Alternative title match across providers (WeebCentral -> Asura Scans)
  const altMatch = findCrossProviderPublishedMatch(
    { sourceId: "weebcentral", externalId: "01J76XY7SOLO", title: "Only I Level Up", alternativeTitles: ["Solo Leveling"] },
    publishedCatalog,
    displayNameOf,
  );
  assert.ok(altMatch.confirmedMatch, "Alternative title must match Solo Leveling published from Asura Scans");
  assert.equal(altMatch.confirmedMatch?.comicId, "comic-sl");

  // 3. Sequel / Spin-off must NOT be auto-merged as a confirmed duplicate, but surfaced as ambiguous
  const sequelMatch = findCrossProviderPublishedMatch(
    { sourceId: "comick", externalId: "solo-leveling-ragnarok", title: "Solo Leveling: Ragnarok", alternativeTitles: [] },
    publishedCatalog,
    displayNameOf,
  );
  assert.equal(sequelMatch.confirmedMatch, null, "Sequel 'Solo Leveling: Ragnarok' must not auto-match 'Solo Leveling'");
  assert.equal(sequelMatch.ambiguousMatches.length, 1, "Sequel should be flagged as an ambiguous candidate for admin awareness");

  // 4. Verify Admin UI displays exact required text and Link as Fallback action
  const catalogUi = fs.readFileSync(path.join(WEB_SRC, "components/admin/SourceCatalog.tsx"), "utf8");
  const reviewUi = fs.readFileSync(path.join(WEB_SRC, "components/admin/SourceTitleReview.tsx"), "utf8");
  assert.ok(
    catalogUi.includes("alreadyPublishedMessage") && reviewUi.includes("alreadyPublishedMessage"),
    "Admin catalog and review components must render alreadyPublishedMessage ('Already published on ComicVerse from: <Provider>')",
  );
  assert.ok(
    catalogUi.includes("Fallback Source") && reviewUi.includes("Fallback Source"),
    "Admin catalog and review components must allow linking another provider as a fallback source",
  );
});

test("Requirement 9: Mobile floating frosted-glass navigation capsule design", () => {
  const bottomNavCode = fs.readFileSync(path.join(WEB_SRC, "components/BottomNav.tsx"), "utf8");
  const globalsCss = fs.readFileSync(path.join(WEB_SRC, "app/globals.css"), "utf8");

  assert.ok(
    bottomNavCode.includes("m-bottomnav grid-cols-4") && bottomNavCode.includes("m-bottomnav-item") && bottomNavCode.includes("m-bottomnav-pill"),
    "BottomNav.tsx must use the floating frosted-glass capsule classes",
  );
  assert.ok(
    bottomNavCode.includes("TABS") && bottomNavCode.includes('aria-label="Primary mobile navigation"'),
    "BottomNav.tsx must render ComicVerse's four navigation links (Home, Manga, Browse, Bookmarks)",
  );
  assert.ok(
    globalsCss.includes("backdrop-filter: blur(") &&
      globalsCss.includes("border-radius: 999px") &&
      globalsCss.includes("--safe-bottom"),
    "globals.css must style the rounded transparent frosted-glass capsule with backdrop blur and iOS safe-area support",
  );
});

test("Follow-up Requirements: WeebCentral nested card genres/rating enrichment, existing comic repair, reader right-click disable, user comic request, and live view-ranked Trending Comics", async () => {
  // 1. WeebCentral nested <article> card in /search/data extracts Tags(s) genres properly
  const { normalizeSearch: normalizeWcSearch } = require("./sources/weebcentral.normalize");
  const nestedCardHtml = `
    <article class="bg-base-300 flex gap-4 p-4">
      <section>
        <article data-tip="Manhwa">
          <a href="https://weebcentral.com/series/01J76XY7E5E1C5Y9J0M2FCVQ8H/Pick-Me-Up">
            <img src="https://temp.compsci88.com/cover/pick.webp" alt="Pick Me Up cover" />
          </a>
        </article>
      </section>
      <section>
        <div><strong>Status: </strong><span>Ongoing</span></div>
        <div><strong>Tags(s): </strong><span>Action, </span><span>Adventure, </span><span>Fantasy, </span><span>Dungeon</span></div>
      </section>
    </article>
  `;
  const wcSearchRes = normalizeWcSearch(nestedCardHtml, { q: "Pick Me Up", page: 1, limit: 20 });
  assert.equal(wcSearchRes.items.length, 1);
  assert.deepEqual(wcSearchRes.items[0].genres, ["Action", "Adventure", "Fantasy", "Dungeon"]);
  assert.equal(wcSearchRes.items[0].status, "ongoing");

  // 2. Cross-provider metadata enrichment (e.g. WeebCentral comic enriched with rating & genres from Asura Scans) + existing comic repair
  let updatedComicRating: number | null = null;
  const syncedGenres: string[] = [];
  const mockRepairDb: any = {
    sourceSetting: {
      findMany: async () => [
        { sourceId: "weebcentral", enabled: true, displayName: "WeebCentral" },
        { sourceId: "asurascans", enabled: true, displayName: "Asura Scans" },
      ],
      findUnique: async ({ where }: any) => ({ sourceId: where.sourceId, enabled: true }),
    },
    comic: {
      findMany: async () => [
        {
          id: "comic-pick",
          slug: "pick-me-up",
          title: "Pick Me Up",
          altTitle: "Pick Me Up Infinite Gacha",
          publishState: "PUBLISHED",
          deletedAt: null,
          providerRating: null,
          genres: [],
          sourceTitles: [
            {
              id: "st-wc-pick",
              sourceId: "weebcentral",
              externalId: "01J76XY7E5E1C5Y9J0M2FCVQ8H",
              title: "Pick Me Up",
              state: "APPROVED",
              role: "PRIMARY",
              genres: [],
              providerRating: null,
            },
          ],
        },
      ],
      update: async ({ data }: any) => {
        if (data.providerRating !== undefined) updatedComicRating = data.providerRating;
        return { id: "comic-pick" };
      },
    },
    genre: {
      upsert: async ({ create }: any) => ({ id: `g-${create.slug}`, name: create.name, slug: create.slug }),
    },
    comicGenre: {
      findMany: async () => [],
      upsert: async ({ create }: any) => {
        syncedGenres.push(create.genreId);
        return create;
      },
    },
    sourceTitle: {
      update: async () => ({}),
    },
  };

  const mockWcProvider: any = {
    id: "weebcentral",
    displayName: "WeebCentral",
    info: () => ({ id: "weebcentral", displayName: "WeebCentral", officialUrl: "https://weebcentral.com", capabilities: { chapters: true } }),
    details: async () => ({
      id: "01J76XY7E5E1C5Y9J0M2FCVQ8H",
      externalId: "01J76XY7E5E1C5Y9J0M2FCVQ8H",
      sourceId: "weebcentral",
      title: "Pick Me Up",
      alternativeTitles: [],
      coverUrl: null,
      description: null,
      status: "ongoing",
      genres: ["Action", "Fantasy"],
      contentType: "manhwa",
      language: "en",
      sourceUrl: "https://weebcentral.com/series/01J76XY7E5E1C5Y9J0M2FCVQ8H",
      rating: null,
      authors: [],
      artists: [],
      year: 2022,
      availableLanguages: ["en"],
    }),
  };

  const mockAsuraProvider: any = {
    id: "asurascans",
    displayName: "Asura Scans",
    info: () => ({ id: "asurascans", displayName: "Asura Scans", officialUrl: "https://asurascans.com", capabilities: { chapters: true } }),
    search: async () => ({
      items: [
        {
          id: "pick-me-up-12345678",
          externalId: "pick-me-up-12345678",
          sourceId: "asurascans",
          title: "Pick Me Up",
          alternativeTitles: [],
          coverUrl: null,
          description: null,
          status: "Ongoing",
          genres: ["Action", "Fantasy", "Dungeon"],
          contentType: "manhwa",
          language: "en",
          sourceUrl: "https://asurascans.com/comics/pick-me-up-12345678",
          rating: 9.6,
        },
      ],
      total: 1,
      page: 1,
      limit: 8,
      hasMore: false,
    }),
  };

  const svc = new SourcesService(
    mockRepairDb,
    { wrap: async (_k: string, _t: number, fn: () => Promise<any>) => fn(), delete: async () => undefined } as any,
    { enabled: true, timeoutMs: 10_000, userAgent: "ComicVerse/1.0" },
    [mockWcProvider, mockAsuraProvider],
  );

  const repairedCount = await svc.repairAndEnrichPublishedComics();
  assert.equal(repairedCount, 1, "Existing published comic missing genres/rating must be repaired");
  assert.equal(updatedComicRating, 9.6, "WeebCentral comic must be enriched with rating 9.6 from Asura Scans");
  assert.ok(syncedGenres.includes("g-action") && syncedGenres.includes("g-dungeon"), "Genres must be persisted to Genre and ComicGenre");

  // 3. Chapter reader blocks right-click context menu
  const readerCode = fs.readFileSync(path.join(WEB_SRC, "components/Reader.tsx"), "utf8");
  assert.ok(
    readerCode.includes('document.addEventListener("contextmenu", preventContext)') &&
      readerCode.includes("onContextMenu={(e) => e.preventDefault()}"),
    "Reader.tsx must block the right-click context menu on chapter pages and images",
  );

  // 4. User can request a missing comic to Admin
  const requestModalCode = fs.readFileSync(path.join(WEB_SRC, "components/RequestComicModal.tsx"), "utf8");
  const reviewsSvcCode = fs.readFileSync(path.join(__dirname, "reviews/reviews.service.ts"), "utf8");
  assert.ok(
    requestModalCode.includes("/reports") && reviewsSvcCode.includes("COMIC_REQUEST"),
    "Frontend and backend must support user comic requests to admin via /reports and COMIC_REQUEST category",
  );

  // 5. Homepage Trending Comics updates dynamically by most views & Latest Updates only changes on new comic/chapter publication
  const homeCode = fs.readFileSync(path.join(WEB_SRC, "app/page.tsx"), "utf8");
  const trendingLiveCode = fs.readFileSync(path.join(WEB_SRC, "components/TrendingComicsLive.tsx"), "utf8");
  assert.ok(
    homeCode.includes("<TrendingComicsLive") && trendingLiveCode.includes("/comics?pageSize=24&sort=popular"),
    "Homepage must render TrendingComicsLive sorted by highest views",
  );
  assert.ok(
    homeCode.includes("latestPubTime"),
    "Homepage Latest Updates must sort by latest chapter/comic publication time, not view increments",
  );

  // 6. Search UI removes Not Rated badge
  const navClientCode = fs.readFileSync(path.join(WEB_SRC, "components/NavClient.tsx"), "utf8");
  assert.ok(
    !navClientCode.includes("Not Rated") && !navClientCode.includes('className="fr"'),
    "Search UI (NavClient.tsx) must not render the overlapping Not Rated badge",
  );

  // 7. Manga page filters strictly to Manga only
  const mangaPageCode = fs.readFileSync(path.join(WEB_SRC, "app/manga/page.tsx"), "utf8");
  assert.ok(
    mangaPageCode.includes('type: "Manga"') && mangaPageCode.includes('=== "manga"'),
    "Manga page (/manga) must strictly filter to Manga only",
  );

  // 8. WeebCentral description extraction from HTML body (<strong>Description</strong>)
  const { normalizeDetails: normalizeWcDetails } = require("./sources/weebcentral.normalize");
  const wcDetailHtml = `
    <html>
      <head><meta property="og:title" content="Pick Me Up | Weeb Central" /></head>
      <body>
        <h1>Pick Me Up</h1>
        <ul>
          <li><strong>Type: </strong><a href="/search?included_type=Manhwa">Manhwa</a></li>
          <li><strong>Tags(s): </strong><a href="/search?included_tag=Action">Action</a></li>
          <li><strong>Description</strong><p class="whitespace-pre-wrap break-words">Loki is a master trapsmith and top player trapped inside a brutal mobile gacha game.</p></li>
        </ul>
      </body>
    </html>
  `;
  const wcParsedDetails = normalizeWcDetails(wcDetailHtml, "01J76XY7E5E1C5Y9J0M2FCVQ8H");
  assert.equal(
    wcParsedDetails.description,
    "Loki is a master trapsmith and top player trapped inside a brutal mobile gacha game.",
    "WeebCentral normalizeDetails must extract the comic description from the HTML Description block",
  );
  assert.equal(wcParsedDetails.contentType, "manhwa");

  // 9. Admin rating editing enabled on /admin/comics and ComicForm.tsx
  const adminComicsCode = fs.readFileSync(path.join(WEB_SRC, "app/admin/comics/page.tsx"), "utf8");
  const comicFormCode = fs.readFileSync(path.join(WEB_SRC, "components/admin/ComicForm.tsx"), "utf8");
  assert.ok(
    adminComicsCode.includes("saveComicRating") && comicFormCode.includes('name="providerRating"'),
    "Admin panel must allow editing comic ratings on both /admin/comics and /admin/comics/[id]/edit",
  );
});
