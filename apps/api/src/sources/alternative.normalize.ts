import type {
  AlternativeChapterItem,
  AlternativeSourceMatch,
  ChapterItem,
  ChaptersResponse,
  MangaSummary,
} from "./provider.interface";

export const ALTERNATIVE_PROVIDER_IDS = ["weebcentral", "asurascans"] as const;
export const ALL_PROVIDER_IDS = ["weebcentral", "asurascans", "comick"] as const;

const PLACEHOLDER_ALT_TITLE = /^(?:n\/?a|none|unknown|tbd|null|undefined|-+|\.+|\?+)$/i;

export function normalizeMatchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/^official\s+/i, "")
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeCompactTitleKey(value: string): string {
  return normalizeMatchText(value).replace(/\s+/g, "");
}

export function splitCandidateTitles(raw?: string | null | string[]): string[] {
  if (!raw) return [];
  const items = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of items) {
    if (typeof entry !== "string") continue;
    const rawTrimmed = entry.trim();
    if (!rawTrimmed || PLACEHOLDER_ALT_TITLE.test(rawTrimmed)) continue;
    // Do not split "N/A" or short slash abbreviations into single-letter tokens
    for (const part of rawTrimmed.split(/\s*(?:\||\/|·|;|\n)\s*/)) {
      const trimmed = part.trim();
      if (!trimmed || trimmed.length < 3 || PLACEHOLDER_ALT_TITLE.test(trimmed)) continue;
      const norm = normalizeMatchText(trimmed);
      if (norm.length < 3) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(trimmed);
    }
  }
  return out;
}

export interface PublishedComicCandidate {
  id: string;
  slug: string;
  title: string;
  altTitle?: string | null;
  sourceTitles: Array<{
    id?: string;
    sourceId: string;
    externalId: string;
    title: string;
    state: string;
    role?: string;
  }>;
}

export interface CrossProviderMatchResult {
  /** Exact match on normalized title or alternative title to a single published ComicVerse comic. */
  confirmedMatch: {
    comicId: string;
    comicSlug: string;
    comicTitle: string;
    primarySourceId: string;
    primarySourceName: string;
    matchedOn: "title" | "altTitle";
    alreadyLinkedToSource: boolean;
    alreadyPublishedMessage: string;
  } | null;
  /** Partial or multi-comic ambiguous candidates that must NOT be auto-merged. */
  ambiguousMatches: Array<{
    comicId: string;
    comicSlug: string;
    comicTitle: string;
    primarySourceId: string;
    primarySourceName: string;
  }>;
}

const SEQUEL_OR_SPINOFF_TOKENS = new Set([
  "ragnarok",
  "shippuden",
  "boruto",
  "gt",
  "super",
  "zero",
  "gaiden",
  "side",
  "spin",
  "spinoff",
  "prequel",
  "sequel",
  "season",
  "part",
  "ii",
  "iii",
  "iv",
  "2",
  "3",
]);

const STOPWORDS = new Set([
  "the",
  "of",
  "and",
  "in",
  "to",
  "a",
  "an",
  "as",
  "is",
  "my",
  "i",
  "am",
  "for",
  "on",
  "at",
  "by",
  "with",
  "from",
]);

function hasConflictingSequelMarker(a: string, b: string): boolean {
  const tokensA = new Set(normalizeMatchText(a).split(" ").filter(Boolean));
  const tokensB = new Set(normalizeMatchText(b).split(" ").filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return false;
  for (const tok of SEQUEL_OR_SPINOFF_TOKENS) {
    if (tokensA.has(tok) !== tokensB.has(tok)) return true;
  }
  return false;
}

function stripSequelMarkers(value: string): string {
  return normalizeMatchText(value)
    .split(" ")
    .filter((tok) => tok && !SEQUEL_OR_SPINOFF_TOKENS.has(tok))
    .join(" ")
    .trim();
}

/**
 * Returns true only when `a` and `b` share the exact same base title and differ only by a sequel/spin-off marker
 * (for example, "Solo Leveling" vs "Solo Leveling: Ragnarok").
 * Never matches unrelated titles such as "Solo Swordmaster" or "My Girlfriend Returned as a Dragon".
 */
function isSequelOrSpinoffOfSameSeries(a: string, b: string): boolean {
  const na = normalizeMatchText(a);
  const nb = normalizeMatchText(b);
  if (na.length < 5 || nb.length < 5) return false;
  if (!hasConflictingSequelMarker(na, nb)) return false;
  const baseA = stripSequelMarkers(na);
  const baseB = stripSequelMarkers(nb);
  if (baseA.length < 5 || baseB.length < 5) return false;
  return baseA === baseB;
}

/**
 * Evaluates whether a provider title (and its alternative titles) matches an existing
 * published ComicVerse comic across providers.
 * - Confirmed matches require an exact normalized title or alternative title match to a single comic
 *   with no conflicting sequel/spin-off markers.
 * - Uncertain/partial matches or multi-comic collisions are returned in `ambiguousMatches` and never auto-merged.
 */
export function findCrossProviderPublishedMatch(
  candidate: {
    sourceId: string;
    externalId: string;
    title: string;
    alternativeTitles?: string[];
  },
  publishedComics: PublishedComicCandidate[],
  displayNameOf: (sourceId: string) => string,
): CrossProviderMatchResult {
  const primaryTitleNorm = normalizeCompactTitleKey(candidate.title);
  const altTitleNorms = new Set(
    splitCandidateTitles(candidate.alternativeTitles)
      .map(normalizeCompactTitleKey)
      .filter((k) => k.length >= 3 && k !== primaryTitleNorm),
  );
  const allCandidateNorms = new Set(
    [primaryTitleNorm, ...altTitleNorms].filter((k) => k.length >= 3),
  );
  if (allCandidateNorms.size === 0) {
    return { confirmedMatch: null, ambiguousMatches: [] };
  }

  const exactMatches: Array<{
    comic: PublishedComicCandidate;
    matchedOn: "title" | "altTitle";
  }> = [];
  const roughMatches: PublishedComicCandidate[] = [];

  for (const comic of publishedComics) {
    const comicPrimaryNorm = normalizeCompactTitleKey(comic.title);
    const comicAltStrings = [
      ...splitCandidateTitles(comic.altTitle),
      ...comic.sourceTitles.flatMap((st) => splitCandidateTitles(st.title)),
    ];
    const comicAltNorms = new Set(
      comicAltStrings
        .map(normalizeCompactTitleKey)
        .filter((k) => k.length >= 3 && k !== comicPrimaryNorm),
    );

    const matchesPrimary =
      (comicPrimaryNorm.length >= 3 && comicPrimaryNorm === primaryTitleNorm) ||
      (comicPrimaryNorm.length >= 3 && altTitleNorms.has(comicPrimaryNorm));
    const matchesAlt =
      (primaryTitleNorm.length >= 3 && comicAltNorms.has(primaryTitleNorm)) ||
      [...altTitleNorms].some((k) => comicAltNorms.has(k));

    if (matchesPrimary || matchesAlt) {
      exactMatches.push({
        comic,
        matchedOn: matchesPrimary && comicPrimaryNorm === primaryTitleNorm ? "title" : "altTitle",
      });
      continue;
    }

    // Check if it is an uncertain/partial match (e.g. "Solo Leveling" vs "Solo Leveling: Ragnarok")
    const allComicStrings = [comic.title, ...comicAltStrings].filter((s) => normalizeMatchText(s).length >= 5);
    const allCandStrings = [candidate.title, ...splitCandidateTitles(candidate.alternativeTitles)].filter(
      (s) => normalizeMatchText(s).length >= 5,
    );
    const isRough = allCandStrings.some((ca) =>
      allComicStrings.some((co) => titlesRoughlyMatch(ca, co) || isSequelOrSpinoffOfSameSeries(ca, co)),
    );
    if (isRough) {
      roughMatches.push(comic);
    }
  }

  const resolvePrimarySource = (comic: PublishedComicCandidate) => {
    const primarySt =
      comic.sourceTitles.find((st) => st.role === "PRIMARY" && st.state === "APPROVED") ??
      comic.sourceTitles.find((st) => st.state === "APPROVED") ??
      comic.sourceTitles[0];
    const primarySourceId = primarySt?.sourceId ?? "comicverse";
    const primarySourceName = primarySt ? displayNameOf(primarySt.sourceId) : "ComicVerse";
    return { primarySourceId, primarySourceName };
  };

  if (exactMatches.length === 1) {
    const { comic, matchedOn } = exactMatches[0];
    const { primarySourceId, primarySourceName } = resolvePrimarySource(comic);
    const alreadyLinkedToSource = comic.sourceTitles.some(
      (st) => st.sourceId === candidate.sourceId && st.state === "APPROVED",
    );
    return {
      confirmedMatch: {
        comicId: comic.id,
        comicSlug: comic.slug,
        comicTitle: comic.title,
        primarySourceId,
        primarySourceName,
        matchedOn,
        alreadyLinkedToSource,
        alreadyPublishedMessage: `Already published on ComicVerse from: ${primarySourceName}`,
      },
      ambiguousMatches: roughMatches.map((c) => {
        const p = resolvePrimarySource(c);
        return {
          comicId: c.id,
          comicSlug: c.slug,
          comicTitle: c.title,
          primarySourceId: p.primarySourceId,
          primarySourceName: p.primarySourceName,
        };
      }),
    };
  }

  // If 0 exact matches or >1 exact matches (ambiguous collision), do not confirm a single auto-match
  const combinedAmbiguous = [...exactMatches.map((e) => e.comic), ...roughMatches];
  return {
    confirmedMatch: null,
    ambiguousMatches: combinedAmbiguous.map((c) => {
      const p = resolvePrimarySource(c);
      return {
        comicId: c.id,
        comicSlug: c.slug,
        comicTitle: c.title,
        primarySourceId: p.primarySourceId,
        primarySourceName: p.primarySourceName,
      };
    }),
  };
}

export function titlesRoughlyMatch(a: string, b: string): boolean {
  const na = normalizeMatchText(a);
  const nb = normalizeMatchText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (hasConflictingSequelMarker(a, b)) return false;

  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (
    shorter.length >= 10 &&
    shorter.split(" ").length >= 2 &&
    shorter.length / longer.length >= 0.65 &&
    ` ${longer} `.includes(` ${shorter} `)
  ) {
    return true;
  }

  const tokensA = na.split(" ").filter((t) => t.length > 2 && !STOPWORDS.has(t));
  const tokensB = new Set(nb.split(" ").filter((t) => t.length > 2 && !STOPWORDS.has(t)));
  if (tokensA.length < 2 || tokensB.size < 2) return false;
  const overlap = tokensA.filter((t) => tokensB.has(t)).length;
  return overlap / Math.max(tokensA.length, tokensB.size) >= 0.85;
}

export function chapterNumbersMatch(
  candidateLabel: string | null,
  candidateNum: number | null,
  targetLabel: string | null,
  targetNum: number | null,
): boolean {
  if (candidateLabel && targetLabel && candidateLabel.trim() === targetLabel.trim()) return true;
  if (targetNum !== null && !Number.isNaN(targetNum) && candidateNum !== null && !Number.isNaN(candidateNum)) {
    return Math.abs(candidateNum - targetNum) < 0.001;
  }
  return false;
}

export function buildSourceReaderUrl(
  sourceId: string,
  externalId: string,
  chapterId: string,
  language?: string | null,
): string {
  const lang = language || "en";
  return `/sources/${encodeURIComponent(sourceId)}/${encodeURIComponent(externalId)}/read/${encodeURIComponent(chapterId)}?lang=${encodeURIComponent(lang)}`;
}

export function findMatchingSummary(items: MangaSummary[], candidateTitles: string[]): MangaSummary | undefined {
  const cleanTitles = candidateTitles.map((t) => t?.trim() ?? "").filter(Boolean);
  if (!cleanTitles.length) return undefined;
  return items.find((item) =>
    [item.title, ...item.alternativeTitles].some((candidate) =>
      cleanTitles.some((target) => titlesRoughlyMatch(candidate, target)),
    ),
  );
}

/**
 * Builds an AlternativeSourceMatch from a matched WeebCentral or Asura Scans manga
 * and its chapter list, strictly preserving the alternative provider's own sourceId,
 * externalId (mangaId), chapter IDs, source URLs, and ComicVerse reader URLs.
 */
export function buildAlternativeSourceMatch(
  altSourceId: string,
  sourceName: string,
  matchedItem: MangaSummary,
  chRes: ChaptersResponse,
  language = "en",
  targetLabel: string | null = null,
  targetNum: number | null = null,
): AlternativeSourceMatch {
  const chapters: AlternativeChapterItem[] = chRes.items.map((ch: ChapterItem) => ({
    ...ch,
    id: ch.id,
    sourceId: altSourceId,
    mangaId: matchedItem.externalId,
    sourceUrl: ch.sourceUrl,
    readerUrl: buildSourceReaderUrl(altSourceId, matchedItem.externalId, ch.id, ch.language ?? language),
  }));

  const matchedChapter =
    targetLabel !== null || targetNum !== null
      ? chapters.find((ch) => chapterNumbersMatch(ch.numberLabel, ch.number, targetLabel, targetNum)) ?? null
      : null;

  return {
    sourceId: altSourceId,
    sourceName,
    externalId: matchedItem.externalId,
    title: matchedItem.title,
    coverUrl: matchedItem.coverUrl,
    sourceUrl: matchedItem.sourceUrl,
    catalogUrl: `/sources/${encodeURIComponent(altSourceId)}/${encodeURIComponent(matchedItem.externalId)}`,
    language,
    totalChapters: chRes.total,
    chapters,
    matchedChapter,
  };
}
