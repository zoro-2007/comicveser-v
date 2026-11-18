import type { ChapterItem, ChapterPages, ChaptersResponse, ContentType, MangaDetails, MangaSummary, SearchQuery, SearchResponse } from "./provider.interface";
import { SourceError } from "./provider.interface";
import { attributes, elements, htmlText } from "./html";
import { extractReleaseDateFromMarkup, parseExplicitReleaseDate } from "./weebcentral.normalize";

const SITE = "https://asurascans.com";
const CDN_HOST = "cdn.asurascans.com";
type Obj = Record<string, unknown>;

const obj = (value: unknown): Obj => value && typeof value === "object" ? value as Obj : {};
const str = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

/**
 * Strips Asura Scans' rotating 8-character hex suffix (e.g. "nano-machine-7f3a9b12" -> "nano-machine")
 * so canonical title identity remains stable across catalogue refreshes and server restarts.
 */
export function canonicalAsuraSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/-[a-f0-9]{8}$/i, "")
    .replace(/^\/+|\/+$/g, "");
}

export function contentType(value: unknown): ContentType {
  const type = typeof value === "string" ? value.toLowerCase() : "";
  return ["manga", "manhwa", "manhua", "webtoon", "novel"].includes(type) ? type as ContentType : "unknown";
}

function externalId(row: Obj): string | null {
  const publicUrl = str(row.public_url);
  if (publicUrl) {
    try {
      const path = new URL(publicUrl, SITE).pathname.split("/").filter(Boolean);
      if ((path[0] === "comics" || path[0] === "series") && path[1] && /^[a-z0-9-]+$/i.test(path[1])) return path[1];
    } catch { /* use the source's slug below */ }
  }
  return str(row.slug);
}

function normalizeGenreName(raw: string): string | null {
  const cleaned = htmlText(raw).replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > 50 || /^\d+$/.test(cleaned)) return null;
  if (/^(?:all|genres?|tags?|categories|none|n\/a|unknown)$/i.test(cleaned)) return null;
  return cleaned;
}

export function extractAsuraGenres(row: Obj): string[] {
  const candidates: unknown[] = [
    ...list(row.genres),
    ...list(row.tags),
    ...list(row.categories),
  ];
  if (typeof row.genres === "string") candidates.push(...row.genres.split(","));
  if (typeof row.genre === "string") candidates.push(...row.genre.split(","));
  if (Array.isArray(row.genre)) candidates.push(...row.genre);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of candidates) {
    const rawName =
      typeof entry === "string"
        ? entry
        : str(obj(entry).name) ?? str(obj(entry).title) ?? str(obj(entry).label) ?? str(obj(entry).slug);
    if (!rawName) continue;
    for (const part of rawName.split(",")) {
      const normalized = normalizeGenreName(part);
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(normalized);
    }
  }
  return out;
}

export function extractAsuraRating(row: Obj): number | null {
  const candidates: unknown[] = [
    row.rating,
    row.average_rating,
    row.avg_rating,
    row.score,
    row.stars,
    obj(row.rating).average,
    obj(row.rating).value,
    obj(row.rating).score,
    obj(row.ratings).average,
    obj(row.ratings).value,
  ];
  for (const candidate of candidates) {
    const parsed =
      typeof candidate === "number"
        ? candidate
        : typeof candidate === "string" && candidate.trim()
        ? Number.parseFloat(candidate.trim())
        : Number.NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) continue;
    if (parsed <= 10) return Number(parsed.toFixed(2));
    if (parsed <= 100) return Number((parsed / 10).toFixed(2));
  }
  return null;
}

export function extractAsuraHtmlMetadata(html: string): { genres: string[]; rating: number | null } {
  const seen = new Set<string>();
  const genres: string[] = [];
  const addGenre = (val: string | null) => {
    if (!val) return;
    const g = normalizeGenreName(val);
    if (!g) return;
    const key = g.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    genres.push(g);
  };

  for (const anchor of elements(html, "a")) {
    const href = anchor.attrs.href ?? "";
    if (/[?&]genres?=/i.test(href) || /\/(?:genres?|tags?)\//i.test(href)) {
      addGenre(anchor.innerHtml);
    }
  }

  const normalizedHtml = html.replace(/\\"/g, '"');
  for (const m of normalizedHtml.matchAll(/"genres"\s*:\s*\[([^\]]+)\]/gi)) {
    const block = m[1] ?? "";
    for (const nm of block.matchAll(/"name"\s*:\s*"([^"]+)"/gi)) {
      addGenre(nm[1]);
    }
  }

  let rating: number | null = null;
  const ratingMatch =
    normalizedHtml.match(/"(?:rating|average_rating|avg_rating|score)"\s*:\s*"?(\d+(?:\.\d+)?)"?/i) ??
    html.match(/itemprop=["']ratingValue["'][^>]*>\s*(\d+(?:\.\d+)?)\s*</i);
  if (ratingMatch?.[1]) {
    const parsed = Number.parseFloat(ratingMatch[1]);
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= 10) {
      rating = Number(parsed.toFixed(2));
    }
  }

  return { genres, rating };
}

export function normalizeSummary(raw: unknown): MangaSummary | null {
  const row = obj(raw);
  const id = externalId(row);
  const title = str(row.title) ?? str(row.name);
  if (!id || !title) return null;
  const publicUrl = str(row.public_url) ?? `/comics/${id}`;
  let sourceUrl: string;
  try {
    const url = new URL(publicUrl, SITE);
    if (url.protocol !== "https:" || url.hostname !== "asurascans.com") return null;
    sourceUrl = url.toString();
  } catch { return null; }
  const description = str(row.description);
  const altTitlesRaw = [
    ...list(row.alt_titles),
    ...list(row.alternative_titles),
    ...(typeof row.alt_title === "string" ? row.alt_title.split(/[|/,;]+/) : []),
  ];
  const alternativeTitles = [
    ...new Set(
      altTitlesRaw
        .filter((value): value is string => typeof value === "string" && !!value.trim())
        .map((v) => v.trim())
        .filter((v) => v.toLowerCase() !== title.toLowerCase()),
    ),
  ];
  const rating = extractAsuraRating(row);
  return {
    id,
    externalId: id,
    sourceId: "asurascans",
    title,
    alternativeTitles,
    coverUrl: str(row.cover) ?? str(row.cover_url) ?? str(row.thumb),
    description: description ? htmlText(description) : null,
    status: str(row.status),
    genres: extractAsuraGenres(row),
    contentType: contentType(row.type),
    language: "en",
    sourceUrl,
    rating,
  };
}

export function normalizeSearch(raw: unknown, query: SearchQuery): SearchResponse {
  const body = obj(raw);
  const meta = obj(body.meta);
  if (!Array.isArray(body.data) || typeof meta.total !== "number") {
    throw new SourceError("BAD_RESPONSE", "Asura Scans sent a response we could not read.");
  }
  const items = list(body.data).map(normalizeSummary).filter((item): item is MangaSummary => !!item);
  const total = meta.total;
  const limit = Math.min(Math.max(query.limit, 1), 24);
  return {
    items, total, page: query.page, limit,
    hasMore: (query.page - 1) * limit + items.length < total,
  };
}

export function normalizeDetails(raw: unknown): MangaDetails {
  const summary = normalizeSummary(raw);
  if (!summary) throw new SourceError("BAD_RESPONSE", "Asura Scans returned a title we could not read.");
  const row = obj(raw);
  const authors = [
    str(row.author),
    ...list(row.authors).map((a) => (typeof a === "string" ? str(a) : str(obj(a).name))),
  ].filter((value): value is string => !!value);
  const artists = [
    str(row.artist),
    ...list(row.artists).map((a) => (typeof a === "string" ? str(a) : str(obj(a).name))),
  ].filter((value): value is string => !!value);
  const rawYear = typeof row.year === "number" ? row.year : typeof row.released === "string" ? Number.parseInt(row.released, 10) : null;
  const year = rawYear && Number.isInteger(rawYear) && rawYear >= 1900 && rawYear <= 2100 ? rawYear : null;
  return {
    ...summary,
    authors: [...new Set(authors)],
    artists: [...new Set(artists)],
    year,
    availableLanguages: ["en"],
  };
}

function chapterNumber(value: string): number | null {
  const match = value.match(/^\d+(?:\.\d+)?$/);
  if (!match) return null;
  const number = Number.parseFloat(match[0]);
  return Number.isFinite(number) ? number : null;
}

/**
 * Extracts structured chapter release dates from embedded Next.js / JSON script blocks in AsuraScans HTML if present.
 */
function extractStructuredChapterDates(html: string): Map<string, string> {
  const map = new Map<string, string>();
  const normalizedHtml = html.replace(/\\"/g, '"');
  const pattern = /"(?:name|slug|chapter_slug|number)"\s*:\s*"?([a-z0-9.-]+)"?[^{}]{0,260}?"(?:published_at|created_at|released_at|publishedAt)"\s*:\s*"([^"]+)"/gi;
  for (const m of normalizedHtml.matchAll(pattern)) {
    const chId = m[1]?.trim();
    const parsedDate = parseExplicitReleaseDate(m[2]);
    if (chId && parsedDate && !map.has(chId)) {
      map.set(chId, parsedDate);
    }
  }
  return map;
}

export function parseAsuraScansChapterMarkup(
  innerHtml: string,
  chapterId: string,
  surroundingHtml = "",
  structuredDates?: Map<string, string>,
): {
  number: number | null;
  numberLabel: string | null;
  originalLabel: string | null;
  title: string | null;
  publishedAt: string | null;
} {
  const publishedAt =
    extractReleaseDateFromMarkup(innerHtml) ??
    (surroundingHtml ? extractReleaseDateFromMarkup(surroundingHtml) : null) ??
    structuredDates?.get(chapterId) ??
    null;

  const withoutTime = innerHtml
    .replace(/<time\b[^>]*>[\s\S]*?<\/time>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ");

  let text = htmlText(withoutTime).trim();
  // Remove trailing date strings so they never become part of the title or chapter number
  text = text
    .replace(
      /\s*\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}(?:\s+\d{1,2}:\d{2}(?:\s*(?:AM|PM))?)?\b\s*$/i,
      "",
    )
    .replace(
      /\s*\b\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?,?\s+\d{4}\b\s*$/i,
      "",
    )
    .replace(/\s*\b\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?)?\b\s*$/i, "")
    .replace(/\s*\b\d+\s+(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+ago\b\s*$/i, "")
    .trim();

  const prefixed = text.match(/^((?:chapter|chap\.?|ch\.?|episode|ep\.?)\s*#?\s*(\d+(?:\.\d+)?))(?:\s*(?:[-–—:·]|\s+)\s*(.+))?$/i);
  if (prefixed) {
    const rawOriginal = prefixed[1].trim();
    const num = Number.parseFloat(prefixed[2]);
    if (Number.isFinite(num)) {
      const normalizedStr = String(num);
      const subtitle = prefixed[3]?.trim() || null;
      return {
        number: num,
        numberLabel: normalizedStr,
        originalLabel: rawOriginal,
        title: subtitle,
        publishedAt,
      };
    }
  }

  const idNumeric = chapterId.match(/^\d+(?:\.\d+)?$/)?.[0] ?? null;
  if (idNumeric) {
    const num = Number.parseFloat(idNumeric);
    const normalizedStr = String(num);
    const cleanedTitle = text && !new RegExp(`^(?:chapter|ep\\.?|episode)?\\s*0*${num}$`, "i").test(text) ? text : null;
    return {
      number: num,
      numberLabel: normalizedStr,
      originalLabel: text || `Chapter ${normalizedStr}`,
      title: cleanedTitle,
      publishedAt,
    };
  }

  return {
    number: null,
    numberLabel: null,
    originalLabel: text || null,
    title: text || null,
    publishedAt,
  };
}

function getChapterRows(html: string, mangaId: string): ChapterItem[] {
  const expectedPrefix = `/comics/${mangaId}/chapter/`;
  const baseSlug = canonicalAsuraSlug(mangaId);
  const rows = new Map<string, ChapterItem>();
  const structuredDates = extractStructuredChapterDates(html);
  const anchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  const matches = [...html.matchAll(anchorRegex)];

  for (let i = 0; i < matches.length; i++) {
    const fullMatch = matches[i];
    const openAttrs = attributes(`<a${fullMatch[1]}>`);
    const innerHtml = fullMatch[2];
    const href = openAttrs.href;
    if (!href) continue;
    let url: URL;
    try { url = new URL(href, SITE); } catch { continue; }
    if (url.protocol !== "https:" || url.hostname !== "asurascans.com") continue;

    let id: string | undefined;
    if (url.pathname.startsWith(expectedPrefix)) {
      id = url.pathname.slice(expectedPrefix.length).split("/")[0];
    } else if (baseSlug) {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "comics" && parts[2] === "chapter" && canonicalAsuraSlug(parts[1] ?? "") === baseSlug) {
        id = parts[3];
      }
    }
    if (!id || !/^[a-z0-9.-]+$/i.test(id)) continue;

    const endIdx = (fullMatch.index ?? 0) + fullMatch[0].length;
    const nextStartIdx = i + 1 < matches.length ? (matches[i + 1].index ?? endIdx + 350) : endIdx + 350;
    const siblingSnippet = html.slice(endIdx, Math.min(nextStartIdx, endIdx + 350));

    const parsed = parseAsuraScansChapterMarkup(innerHtml, id, siblingSnippet, structuredDates);
    rows.set(id, {
      id,
      sourceId: "asurascans",
      mangaId,
      number: parsed.number,
      numberLabel: parsed.numberLabel,
      originalLabel: parsed.originalLabel,
      title: parsed.title,
      volume: null,
      language: "en",
      publishedAt: parsed.publishedAt,
      groups: [],
      pageCount: null,
      sourceUrl: url.toString(),
      duplicateNumber: false,
    });
  }
  const items = [...rows.values()].sort((a, b) =>
    (a.number === null ? 1 : 0) - (b.number === null ? 1 : 0)
    || (a.number ?? 0) - (b.number ?? 0)
    || (a.id.localeCompare(b.id)));
  markDuplicateNumbers(items);
  return items;
}

function markDuplicateNumbers(items: ChapterItem[]): void {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.numberLabel) counts.set(item.numberLabel, (counts.get(item.numberLabel) ?? 0) + 1);
  }
  for (const item of items) item.duplicateNumber = !!item.numberLabel && (counts.get(item.numberLabel) ?? 0) > 1;
}

export function normalizeChapters(html: string, mangaId: string, page: number, limit: number): ChaptersResponse {
  const all = getChapterRows(html, mangaId);
  const items = all.slice((page - 1) * limit, page * limit);
  return { items, total: all.length, page, limit, hasMore: page * limit < all.length };
}

export function normalizePages(html: string, mangaId: string, chapterId: string): ChapterPages {
  const pages = voidImageTags(html).flatMap((attrs) => {
    const src = attrs.src;
    if (!src) return [];
    try {
      const url = new URL(src, SITE);
      if (url.protocol !== "https:" || url.hostname !== CDN_HOST || !url.pathname.startsWith("/asura-images/chapters/")) return [];
      return [{
        pageNumber: Number.parseInt(attrs.alt?.match(/page\s+(\d+)/i)?.[1] ?? "", 10) || 0,
        imageUrl: url.toString(),
        width: positiveInt(attrs.width),
        height: positiveInt(attrs.height),
      }];
    } catch { return []; }
  }).filter((page) => page.pageNumber > 0).sort((a, b) => a.pageNumber - b.pageNumber);
  if (!pages.length) throw new SourceError("BAD_RESPONSE", "Asura Scans did not return readable chapter pages.");
  const sourceUrl = `${SITE}/comics/${encodeURIComponent(mangaId)}/chapter/${encodeURIComponent(chapterId)}`;
  const title = elements(html, "h1").map((element) => htmlText(element.innerHtml)).find(Boolean) ?? null;
  return {
    sourceId: "asurascans", mangaId, chapterId, chapterTitle: title, chapterNumber: chapterNumber(chapterId)?.toString() ?? null,
    language: "en", pages, groups: [], sourceUrl,
  };
}

function voidImageTags(html: string): ReturnType<typeof attributes>[] {
  const tags: ReturnType<typeof attributes>[] = [];
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) tags.push(attributes(match[0]));
  return tags;
}

function positiveInt(value: string | undefined): number | null {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
