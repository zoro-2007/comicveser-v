import { resolveChapterDisplayNumber, resolveChapterPublishedAt } from "../sources/chapter-display";
import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { ComicType, Prisma } from "@prisma/client";
import { CacheService } from "../cache/cache.service";
import { PrismaService } from "../prisma/prisma.service";
import { slugify } from "../common/util";
import { StorageService, IMAGE_TYPES } from "../storage/storage.service";
import { randomUUID } from "crypto";
import { CreateComicDto, ListComicsQuery, UpdateComicDto, UpdateComicRatingDto } from "./dto/comic.dto";
import {
  fetchExternalProviderMetadata,
  filterValidComicGenres,
  isPlaceholderComicDescription,
  lookupCuratedSeriesMetadata,
  normalizeCanonicalGenreName,
  purgeNonCanonicalGenresFromDb,
} from "../sources/known-metadata";

const include = { genres: { include: { genre: true } } } satisfies Prisma.ComicInclude;

function normalizeTitleKey(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/^official\s+/i, "")
    .replace(/[^a-z0-9]+/g, "");
}

function dedupeByTitle<T extends { id: string; title: string }>(rows: T[]): T[] {
  const seenIds = new Set<string>();
  const seenTitles = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seenIds.has(row.id)) continue;
    const key = normalizeTitleKey(row.title) || row.id;
    if (seenTitles.has(key)) continue;
    seenIds.add(row.id);
    seenTitles.add(key);
    out.push(row);
  }
  return out;
}

@Injectable()
export class ComicsService {
  constructor(private db: PrismaService, private cache: CacheService, private storage: StorageService) {}

  private get publicWhere(): Prisma.ComicWhereInput {
    return {
      publishState: "PUBLISHED",
      deletedAt: null,
    };
  }

  private mediaUrl(key?: string | null) { return key ? this.storage.readUrl(key) : Promise.resolve(null); }

  private invalidateHomeCaches() {
    return Promise.all(["comics:trending", "comics:popular", "comics:popular:weekly", "comics:popular:monthly", "comics:latest"].map((key) => this.cache.delete(key)));
  }

  /**
   * Filters a comic row's genres to canonical comic genres (stripping any MangaUpdates trope tags)
   * and repairs missing description, genres, or rating in-place.
   */
  private async repairComicRowIfNeeded(row: any, allowNetworkLookup = false): Promise<void> {
    if (!row || !row.id || !row.title) return;

    // 1. Strip any non-canonical trope tags from row.genres and from PostgreSQL if polluted
    if (Array.isArray(row.genres) && row.genres.length > 0) {
      const originalLen = row.genres.length;
      const validGenreObjs: Array<{ genre: { id?: string; name: string; slug: string } }> = [];
      const invalidGenreIds: string[] = [];
      const seenSlugs = new Set<string>();

      for (const cg of row.genres) {
        const rawName = typeof cg === "string" ? cg : cg?.genre?.name ?? cg?.name;
        const gId = cg?.genre?.id ?? cg?.genreId;
        const canonical = normalizeCanonicalGenreName(rawName);
        if (!canonical) {
          if (gId) invalidGenreIds.push(gId);
          continue;
        }
        const gSlug = slugify(canonical);
        if (seenSlugs.has(gSlug)) continue;
        seenSlugs.add(gSlug);
        validGenreObjs.push({
          ...(typeof cg === "object" ? cg : {}),
          genre: {
            ...(typeof cg?.genre === "object" ? cg.genre : {}),
            name: canonical,
            slug: gSlug,
          },
        });
      }

      // If this comic had polluted tags (e.g. >10 tags from MU/ComicK) and matches curated WeebCentral metadata, use the exact WeebCentral tags
      const curatedForClean = lookupCuratedSeriesMetadata(row.title, row.altTitle ? [String(row.altTitle)] : []);
      if (originalLen > 10 && curatedForClean && curatedForClean.genres.length > 0) {
        const allowedSlugs = new Set(curatedForClean.genres.map((n) => slugify(n)));
        const extraIds = validGenreObjs
          .filter((cg) => !allowedSlugs.has(cg.genre.slug))
          .map((cg) => cg.genre.id)
          .filter((id): id is string => Boolean(id));
        invalidGenreIds.push(...extraIds);
        row.genres = curatedForClean.genres.map((name) => ({
          genre: { name, slug: slugify(name) },
        }));
      } else {
        row.genres = validGenreObjs;
      }

      if (invalidGenreIds.length > 0 && typeof (this.db as any)?.comicGenre?.deleteMany === "function") {
        void (this.db as any).comicGenre
          .deleteMany({ where: { comicId: row.id, genreId: { in: invalidGenreIds } } })
          .catch(() => {});
      }
    }

    const needsDesc = isPlaceholderComicDescription(row.description, row.title);
    const hasGenres = Array.isArray(row.genres) && row.genres.length > 0;
    const hasRating = typeof row.providerRating === "number" && row.providerRating > 0;
    const needsAuthor = !row.author || row.author === "Unknown";
    if (!needsDesc && hasGenres && hasRating && !needsAuthor) return;

    const altTitles = row.altTitle ? [String(row.altTitle)] : [];
    const meta = allowNetworkLookup
      ? await fetchExternalProviderMetadata(row.title, altTitles)
      : lookupCuratedSeriesMetadata(row.title, altTitles);
    if (!meta) return;

    const patch: Record<string, unknown> = {};
    if (needsDesc && meta.description && !isPlaceholderComicDescription(meta.description, row.title)) {
      row.description = meta.description;
      patch.description = meta.description.slice(0, 5000);
    }
    if (!hasRating && typeof meta.rating === "number" && meta.rating > 0) {
      row.providerRating = meta.rating;
      patch.providerRating = meta.rating;
    }
    if (needsAuthor && meta.author) {
      row.author = meta.author;
      patch.author = meta.author.slice(0, 120);
    }
    if ((!row.artist || row.artist === "Unknown") && meta.artist) {
      row.artist = meta.artist;
      patch.artist = meta.artist.slice(0, 120);
    }
    if (row.type === "MANGA" && meta.contentType === "manhwa") {
      row.type = ComicType.MANHWA;
      patch.type = ComicType.MANHWA;
    }

    const cleanMetaGenres = filterValidComicGenres(meta.genres);
    if (!hasGenres && cleanMetaGenres.length > 0) {
      row.genres = cleanMetaGenres.map((name) => ({
        genre: { name, slug: slugify(name) },
      }));
      if (typeof (this.db as any)?.genre?.upsert === "function" && typeof (this.db as any)?.comicGenre?.createMany === "function") {
        try {
          const genreIds: string[] = [];
          for (const gName of cleanMetaGenres) {
            const gSlug = slugify(gName);
            if (!gSlug) continue;
            const gRow = await (this.db as any).genre.upsert({
              where: { slug: gSlug },
              update: {},
              create: { slug: gSlug, name: gName },
            });
            if (gRow?.id) genreIds.push(gRow.id);
          }
          if (genreIds.length > 0) {
            await (this.db as any).comicGenre.createMany({
              data: genreIds.map((genreId) => ({ comicId: row.id, genreId })),
              skipDuplicates: true,
            });
          }
        } catch {
          // Ignore in unit tests with partial mocks
        }
      }
    }

    if (Object.keys(patch).length > 0 && typeof (this.db.comic as any)?.update === "function") {
      if (row.updatedAt) patch.updatedAt = row.updatedAt;
      await (this.db.comic as any)
        .update({ where: { id: row.id }, data: patch })
        .catch(() => {});
    }
  }

  // User rating average comes from Rating rows; providerRating is stored separately on the comic/sourceTitle.
  async withRatings<T extends { id: string }>(items: T[]) {
    if (!items.length) return [];
    void purgeNonCanonicalGenresFromDb(this.db).catch(() => {});
    await Promise.all(items.map((item) => this.repairComicRowIfNeeded(item, false)));
    const g = await this.db.rating.groupBy({ by: ["comicId"], where: { comicId: { in: items.map((i) => i.id) } }, _avg: { value: true }, _count: true });
    const m = new Map(g.map((r) => [r.comicId, r]));
    const latest = await this.db.chapter.findMany({
      where: { comicId: { in: items.map((i) => i.id) }, publishState: "PUBLISHED", deletedAt: null },
      orderBy: [{ comicId: "asc" }, { number: "desc" }], distinct: ["comicId"],
      select: { id: true, comicId: true, number: true, title: true, publishedAt: true, sourceChapter: { select: { numberLabel: true, title: true, publishedAt: true } } },
    });
    const lm = new Map(latest.map((c) => [c.comicId, c]));
    const counts = await this.db.chapter.groupBy({
      by: ["comicId"], where: { comicId: { in: items.map((i) => i.id) }, publishState: "PUBLISHED", deletedAt: null }, _count: true,
    });
    const cm = new Map(counts.map((r) => [r.comicId, r._count]));
    return Promise.all(items.map(async (i) => {
      const latestChapter = lm.get(i.id);
      const userRating = m.get(i.id)?._avg.value ?? null;
      const rawProviderRating = (i as { providerRating?: number | null }).providerRating;
      const providerRating =
        typeof rawProviderRating === "number" && Number.isFinite(rawProviderRating) && rawProviderRating > 0
          ? rawProviderRating
          : null;
      const effectiveRating = providerRating ?? userRating ?? null;
      return {
        ...i,
        userRating,
        providerRating,
        rating: effectiveRating,
        ratingCount: m.get(i.id)?._count ?? 0,
        chapterCount: cm.get(i.id) ?? 0,
        latestChapter: latestChapter ? { id: latestChapter.id, number: latestChapter.number, displayNumber: resolveChapterDisplayNumber(latestChapter, latestChapter.sourceChapter), publishedAt: resolveChapterPublishedAt(latestChapter, latestChapter.sourceChapter) } : null,
        coverUrl: (i as { externalCoverUrl?: string | null }).externalCoverUrl ?? await this.mediaUrl((i as { coverKey?: string | null }).coverKey),
        bannerUrl: await this.mediaUrl((i as { bannerKey?: string | null }).bannerKey),
      };
    }));
  }

  async list(q: ListComicsQuery) {
    const rawGenreTokens = (q.genre ?? "")
      .split(",")
      .map((g) => g.trim())
      .filter(Boolean)
      .slice(0, 12);
    const genreSlugs = Array.from(new Set(rawGenreTokens.map((g) => slugify(g)).filter(Boolean)));
    const creator = q.creator?.trim();

    // Requirement 5: Match any selected genre (OR matching across selected genres) by slug or case-insensitive name.
    const genreFilter: Prisma.ComicWhereInput | null =
      genreSlugs.length > 0
        ? {
            genres: {
              some: {
                genre: {
                  OR: [
                    { slug: { in: genreSlugs } },
                    ...rawGenreTokens.map((name) => ({
                      name: { equals: name, mode: "insensitive" as const },
                    })),
                  ],
                },
              },
            },
          }
        : null;

    const and: Prisma.ComicWhereInput[] = [
      ...(genreFilter ? [genreFilter] : []),
      ...(creator ? [{ OR: [{ author: { contains: creator, mode: "insensitive" as const } }, { artist: { contains: creator, mode: "insensitive" as const } }] }] : []),
    ];
    const where: Prisma.ComicWhereInput = {
      ...this.publicWhere,
      ...(q.q && {
        OR: [
          { title: { contains: q.q, mode: "insensitive" } },
          { altTitle: { contains: q.q, mode: "insensitive" } },
          { author: { contains: q.q, mode: "insensitive" } },
          { artist: { contains: q.q, mode: "insensitive" } },
        ],
      }),
      ...(and.length ? { AND: and } : {}),
      ...(q.type && { type: q.type }), ...(q.status && { status: q.status }), ...(q.year && { releaseYear: q.year }),
    };
    const baseOrder = ({ updated: { updatedAt: "desc" }, added: { createdAt: "desc" }, popular: { views: "desc" }, alpha: { title: "asc" } } as Record<string, Prisma.ComicOrderByWithRelationInput>)[q.sort ?? "updated"] ?? { updatedAt: "desc" };
    const orderBy: Prisma.ComicOrderByWithRelationInput[] = [baseOrder, { createdAt: "desc" }];

    if (q.sort === "rating" || q.sort === "chapters" || q.minChapters || q.minRating) {
      const rows = await this.db.comic.findMany({ where, orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }], include, take: 1000 });
      let all = await this.withRatings(dedupeByTitle(rows));
      if (q.minRating) all = all.filter((i) => (i.rating ?? 0) >= q.minRating!);
      if (q.minChapters) all = all.filter((i) => i.chapterCount >= q.minChapters!);
      if (q.sort === "rating") all.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || b.ratingCount - a.ratingCount);
      else if (q.sort === "chapters") all.sort((a, b) => b.chapterCount - a.chapterCount);
      else if (q.sort === "popular") all.sort((a, b) => b.views - a.views);
      else if (q.sort === "added") all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      else if (q.sort === "alpha") all.sort((a, b) => a.title.localeCompare(b.title));
      const start = (q.page - 1) * q.pageSize;
      return { items: all.slice(start, start + q.pageSize), total: all.length, page: q.page, pageSize: q.pageSize, pages: Math.max(1, Math.ceil(all.length / q.pageSize)) };
    }

    const [total, rows] = await this.db.$transaction([
      this.db.comic.count({ where }),
      this.db.comic.findMany({ where, orderBy, include, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    const uniqueRows = dedupeByTitle(rows);
    const items = await this.withRatings(uniqueRows);
    const adjustedTotal = Math.max(items.length, total - (rows.length - uniqueRows.length));
    return { items, total: adjustedTotal, page: q.page, pageSize: q.pageSize, pages: Math.max(1, Math.ceil(adjustedTotal / q.pageSize)) };
  }

  private async top(orderBy: Prisma.ComicOrderByWithRelationInput, take = 12) {
    const rows = await this.db.comic.findMany({
      where: this.publicWhere,
      orderBy: [orderBy, { createdAt: "desc" }],
      include,
      take: take * 2,
    });
    return this.withRatings(dedupeByTitle(rows).slice(0, take));
  }
  trending() { return this.cache.wrap("comics:trending", 60, () => this.top({ views: "desc" })); }
  popular(period: "weekly" | "monthly" | "all" = "all") {
    if (period === "all") return this.cache.wrap("comics:popular", 60, () => this.top({ views: "desc" }));
    return this.cache.wrap(`comics:popular:${period}`, 60, () => this.popularSince(period === "weekly" ? 7 : 30));
  }

  private async popularSince(days: number, take = 12) {
    const since = new Date(Date.now() - days * 86_400_000);
    const groups = await this.db.analyticsEvent.groupBy({
      by: ["comicId"], where: { type: "COMIC_VIEW", comicId: { not: null }, createdAt: { gte: since } },
      _count: { _all: true }, orderBy: { _count: { comicId: "desc" } }, take: take * 2,
    });
    const ids = groups.map((g) => g.comicId).filter((id): id is string => !!id);
    const rows = ids.length ? await this.db.comic.findMany({ where: { ...this.publicWhere, id: { in: ids } }, include }) : [];
    const order = new Map(ids.map((id, i) => [id, i]));
    rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    const ranked = dedupeByTitle(rows);
    if (ranked.length < take) {
      const fill = await this.db.comic.findMany({ where: this.publicWhere, orderBy: [{ views: "desc" }, { createdAt: "desc" }], include, take: take * 2 });
      ranked.push(...fill.filter((f) => !ranked.some((r) => r.id === f.id)));
    }
    return this.withRatings(dedupeByTitle(ranked).slice(0, take));
  }
  latest() { return this.cache.wrap("comics:latest", 60, () => this.top({ updatedAt: "desc" })); }

  async bySlug(slug: string) {
    const c = await this.db.comic.findFirst({ where: { slug, ...this.publicWhere }, include });
    if (!c) throw new NotFoundException("Comic not found.");
    await this.repairComicRowIfNeeded(c, true);
    if (typeof (this.db.comic as any)?.updateMany === "function") {
      await (this.db.comic as any)
        .updateMany({ where: { id: c.id }, data: { views: { increment: 1 } } })
        .then(() => {
          (c as any).views = ((c as any).views ?? 0) + 1;
          return Promise.all(
            ["comics:trending", "comics:popular", "comics:popular:weekly", "comics:popular:monthly"].map((k) =>
              this.cache?.delete?.(k),
            ),
          );
        })
        .catch(() => {});
    }
    const [withRating] = await this.withRatings([c]);
    const chapterCount = await this.db.chapter.count({ where: { comicId: c.id, publishState: "PUBLISHED", deletedAt: null } });
    return { ...withRating, chapterCount };
  }

  async chapters(comicId: string, order: "asc" | "desc" = "desc") {
    const comic = await this.db.comic.findFirst({ where: { id: comicId, ...this.publicWhere }, select: { id: true } });
    if (!comic) throw new NotFoundException("Comic not found.");
    const rows = await this.db.chapter.findMany({
      where: { comicId, publishState: "PUBLISHED", deletedAt: null }, orderBy: { number: order },
      select: { id: true, number: true, title: true, publishedAt: true, sourceChapter: { select: { numberLabel: true, title: true, publishedAt: true } } },
    });
    return rows.map(({ sourceChapter, ...chapter }) => ({ ...chapter, publishedAt: resolveChapterPublishedAt(chapter, sourceChapter), displayNumber: resolveChapterDisplayNumber(chapter, sourceChapter) }));
  }

  async genreConnect(slugs: string[]) {
    const normalized = Array.from(new Set(slugs.map((s) => slugify(s)).filter(Boolean)));
    if (!normalized.length) return [];
    const found = await this.db.genre.findMany({ where: { slug: { in: normalized } } });
    if (found.length !== normalized.length) throw new BadRequestException("One or more genres do not exist.");
    return found.map((g) => ({ genre: { connect: { id: g.id } } }));
  }

  async uniqueSlug(title: string) {
    const base = slugify(title) || "comic";
    for (let n = 0; ; n++) {
      const slug = n ? `${base}-${n + 1}` : base;
      if (!(await this.db.comic.findUnique({ where: { slug }, select: { id: true } }))) return slug;
    }
  }

  async coverUploadUrl(contentType: string, size: number) {
    if (!IMAGE_TYPES[contentType] || !Number.isInteger(size) || size < 1 || size > 10 * 1024 * 1024)
      throw new BadRequestException("Cover must be JPEG, PNG, WebP or AVIF and no larger than 10 MB.");
    const key = `comics/covers/${randomUUID()}.${IMAGE_TYPES[contentType]}`;
    return { key, uploadUrl: await this.storage.presignPut(key, contentType), expiresInSeconds: 600 };
  }

  private async validateCoverKey(key?: string) {
    if (!key) return;
    if (!key.startsWith("comics/covers/") || key.includes("..")) throw new BadRequestException("Invalid cover image key.");
    await this.storage.inspect(key);
  }

  async create(dto: CreateComicDto, actor: string) {
    await this.validateCoverKey(dto.coverKey);
    await this.validateCoverKey(dto.bannerKey);
    const { genreSlugs, rating, providerRating, ...data } = dto as any;
    const resolvedRating = providerRating !== undefined ? providerRating : rating;
    const validProviderRating =
      typeof resolvedRating === "number" && Number.isFinite(resolvedRating) && resolvedRating > 0
        ? Number(resolvedRating.toFixed(2))
        : null;
    const genres = await this.genreConnect(genreSlugs ?? []);
    const slug = await this.uniqueSlug(dto.title);
    const comic = await this.db.$transaction(async (tx) => {
      const created = await (tx.comic as any).create({
        data: {
          ...data,
          ...(resolvedRating !== undefined ? { providerRating: validProviderRating } : {}),
          slug,
          genres: { create: genres },
        },
        include,
      });
      await tx.auditLog.create({ data: { actorId: actor, action: "comic.create", resource: "Comic", resourceId: created.id } });
      return created;
    });
    await this.invalidateHomeCaches();
    return comic;
  }

  async updateRating(id: string, dto: UpdateComicRatingDto, actor: string) {
    const rawRating = dto.providerRating !== undefined ? dto.providerRating : dto.rating;
    const validProviderRating =
      typeof rawRating === "number" && Number.isFinite(rawRating) && rawRating > 0
        ? Number(rawRating.toFixed(2))
        : null;
    const comic = await this.db.$transaction(async (tx) => {
      const exists = await tx.comic.findFirst({ where: { id, deletedAt: null }, select: { id: true, updatedAt: true } });
      if (!exists) throw new NotFoundException("Comic not found.");
      const updated = await (tx.comic as any).update({
        where: { id },
        data: {
          providerRating: validProviderRating,
          ...(exists.updatedAt ? { updatedAt: exists.updatedAt } : {}),
        },
        include,
      });
      if (typeof (tx as any).sourceTitle?.updateMany === "function") {
        await (tx as any).sourceTitle
          .updateMany({ where: { comicId: id }, data: { providerRating: validProviderRating } })
          .catch(() => {});
      }
      await tx.auditLog.create({
        data: {
          actorId: actor,
          action: "comic.rating.update",
          resource: "Comic",
          resourceId: id,
          meta: { providerRating: validProviderRating },
        },
      });
      return updated;
    });
    await this.invalidateHomeCaches();
    return { ...comic, rating: comic.providerRating ?? null };
  }

  async update(id: string, dto: UpdateComicDto, actor: string) {
    await this.validateCoverKey(dto.coverKey);
    await this.validateCoverKey(dto.bannerKey);
    const { genreSlugs, rating, providerRating, ...data } = dto as any;
    const hasRatingUpdate = providerRating !== undefined || rating !== undefined;
    const rawRating = providerRating !== undefined ? providerRating : rating;
    const validProviderRating =
      typeof rawRating === "number" && Number.isFinite(rawRating) && rawRating > 0
        ? Number(rawRating.toFixed(2))
        : null;
    const genres = genreSlugs ? await this.genreConnect(genreSlugs) : undefined;
    const comic = await this.db.$transaction(async (tx) => {
      const exists = await tx.comic.findFirst({ where: { id, deletedAt: null }, select: { id: true, updatedAt: true } });
      if (!exists) throw new NotFoundException("Comic not found.");
      if (genres) await tx.comicGenre.deleteMany({ where: { comicId: id } });
      const updated = await (tx.comic as any).update({
        where: { id },
        data: {
          ...data,
          ...(hasRatingUpdate ? { providerRating: validProviderRating } : {}),
          ...(genres && { genres: { create: genres } }),
          // Preserve updatedAt when editing metadata/rating so Latest Updates only changes on new comic/chapter publication
          ...(exists.updatedAt ? { updatedAt: exists.updatedAt } : {}),
        },
        include,
      });
      if (hasRatingUpdate && typeof (tx as any).sourceTitle?.updateMany === "function") {
        await (tx as any).sourceTitle
          .updateMany({ where: { comicId: id }, data: { providerRating: validProviderRating } })
          .catch(() => {});
      }
      await tx.auditLog.create({ data: { actorId: actor, action: "comic.update", resource: "Comic", resourceId: id, meta: { fields: Object.keys(dto) } } });
      return updated;
    });
    await this.invalidateHomeCaches();
    return comic;
  }

  async remove(id: string, actor: string) {
    await this.db.$transaction(async (tx) => {
      const current = await tx.comic.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, title: true, slug: true },
      });
      if (!current) throw new NotFoundException("Comic not found.");

      const normCurrent = normalizeTitleKey(current.title);
      const activeComics = await tx.comic.findMany({
        where: { deletedAt: null },
        select: { id: true, title: true, slug: true },
      });
      const sameTitleComics = activeComics.filter(
        (c) => c.id === current.id || (normCurrent && normalizeTitleKey(c.title) === normCurrent),
      );
      const targetIds = Array.from(new Set([current.id, ...sameTitleComics.map((c) => c.id)]));

      const sourceTitles = await tx.sourceTitle.findMany({
        where: { comicId: { in: targetIds } },
        select: { id: true, sourceId: true, externalId: true, comicId: true },
      });
      if (sourceTitles.length > 0) {
        await tx.sourceTitle.deleteMany({ where: { id: { in: sourceTitles.map((st) => st.id) } } });
        for (const st of sourceTitles) {
          await tx.auditLog.create({
            data: {
              actorId: actor,
              action: "source.title.detach_on_comic_delete",
              resource: "SourceTitle",
              resourceId: st.id,
              meta: { sourceId: st.sourceId, externalId: st.externalId, comicId: st.comicId ?? id },
            },
          });
        }
      }

      const now = new Date();
      await tx.chapter.updateMany({
        where: { comicId: { in: targetIds }, deletedAt: null },
        data: { deletedAt: now, publishState: "ARCHIVED" },
      });

      const targetRows = sameTitleComics.length ? sameTitleComics : [{ id: current.id, title: current.title, slug: current.slug }];
      for (const row of targetRows) {
        const archivedSlug = row.slug.includes("-deleted-")
          ? row.slug
          : `${row.slug.slice(0, 160)}-deleted-${row.id.slice(-8)}-${Date.now().toString(36)}`;
        await tx.comic.update({
          where: { id: row.id },
          data: {
            deletedAt: now,
            publishState: "ARCHIVED",
            slug: archivedSlug,
          },
        });
        await tx.auditLog.create({
          data: { actorId: actor, action: "comic.delete", resource: "Comic", resourceId: row.id },
        });
      }
    });

    await this.invalidateHomeCaches();
  }
}
