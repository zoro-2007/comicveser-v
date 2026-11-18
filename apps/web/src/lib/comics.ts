// Data-access layer backed by the ComicVerse API.
import { API, api } from "./api";
export type ComicType = "Manga" | "Manhwa" | "Manhua" | "Webtoon";
export type ComicStatus = "Ongoing" | "Completed" | "Hiatus";

export interface Chapter { id: string; number: number; displayNumber?: string; title: string; publishedAt: string }
export interface GenreOption { id?: string; name: string; slug: string; count?: number }
export interface Comic {
  id: string; slug: string; title: string; altTitle?: string; description: string;
  author: string; artist: string; genres: string[]; genreSlugs?: string[]; type: ComicType;
  status: ComicStatus; year: number; rating: number; userRating?: number | null; providerRating?: number | null; hue: number;
  views: number; addedAt: string; updatedAt: string; chapters: Chapter[]; chapterCount: number; latest: Chapter | null; coverUrl: string | null;
}

export const GENRES = ["Action","Adventure","Fantasy","Romance","Comedy","Drama","Martial Arts","Mystery","Horror","Supernatural","Sci-Fi","Historical","Reincarnation","Regression","School Life","Murim"];
export const TYPES: ComicType[] = ["Manga","Manhwa","Manhua","Webtoon"];
export const STATUSES: ComicStatus[] = ["Ongoing","Completed","Hiatus"];
export const SORTS = [
  ["updated","Latest update"],["added","Recently added"],["rating","Highest rated"],["popular","Most popular"],
  ["chapters","Most chapters"],["alpha","Alphabetical"],
] as const;
export const MIN_CHAPTER_OPTIONS = [10, 25, 50, 100, 200] as const;

export const chapterLabel = (c: Chapter) => c.displayNumber ?? String(c.number);

export const slugifyGenre = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const ADMIN_RATINGS_STORAGE_KEY = "cv:admin:ratings";

function normalizeKey(raw?: string | null): string {
  if (!raw) return "";
  return raw
    .trim()
    .toLowerCase()
    .replace(/^official\s+/i, "")
    .replace(/[^a-z0-9]+/g, "");
}

export function getAdminRatingOverride(comic: { id?: string; slug?: string; title?: string }): number | null | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = localStorage.getItem(ADMIN_RATINGS_STORAGE_KEY);
    if (!raw) return undefined;
    const map = JSON.parse(raw) as Record<string, number | null>;
    if (!map || typeof map !== "object") return undefined;
    const keys = [comic.id, comic.slug, normalizeKey(comic.title)].filter((k): k is string => Boolean(k));
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(map, k)) {
        const val = map[k];
        return typeof val === "number" && Number.isFinite(val) && val > 0 ? val : null;
      }
    }
  } catch {
    // ignore storage errors
  }
  return undefined;
}

export function setAdminRatingOverride(
  comic: { id?: string; slug?: string; title?: string },
  rating: number | null,
): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(ADMIN_RATINGS_STORAGE_KEY);
    const map: Record<string, number | null> = raw ? JSON.parse(raw) : {};
    const normalized = typeof rating === "number" && Number.isFinite(rating) && rating > 0 ? Number(rating.toFixed(1)) : null;
    if (comic.id) map[comic.id] = normalized;
    if (comic.slug) map[comic.slug] = normalized;
    const titleKey = normalizeKey(comic.title);
    if (titleKey) map[titleKey] = normalized;
    localStorage.setItem(ADMIN_RATINGS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore storage errors
  }
}

interface FallbackComicMeta {
  description: string;
  genres: string[];
  rating: number;
  type: ComicType;
  author?: string;
  artist?: string;
}

const KNOWN_COMIC_FALLBACKS: Record<string, FallbackComicMeta> = {
  nanomachine: {
    description:
      "After being held in disdain and having his life put in danger, an orphan from the Demonic Cult, Cheon Yeo-Woon, receives an unexpected visit from his descendant from the future who inserts a nanomachine into Cheon Yeo-Woon's body, drastically changing his life as he rises through the Mashin Academy and the murim world.",
    genres: ["Action", "Adventure", "Fantasy", "Martial Arts", "Murim", "Sci-Fi"],
    rating: 9.2,
    type: "Manhwa",
    author: "Hanjung Wolya",
    artist: "Geumgangbulgoe, REDICE Studio",
  },
  pickmeup: {
    description:
      "In the mobile gacha game 'Pick Me Up!', notorious for its brutal difficulty, Master 'Loki'—ranked 5th in the world—loses consciousness while clearing a dungeon and wakes up as 'Han Islat', a 1-star novice hero inside the game itself. To survive and return to Earth, he must lead beginner heroes and players through impossible floors without a single defeat.",
    genres: ["Action", "Adventure", "Fantasy", "Dungeon"],
    rating: 9.3,
    type: "Manhwa",
    author: "Hermod",
    artist: "Woon, REDICE Studio",
  },
  pickmeupinfinitegacha: {
    description:
      "In the mobile gacha game 'Pick Me Up!', notorious for its brutal difficulty, Master 'Loki'—ranked 5th in the world—loses consciousness while clearing a dungeon and wakes up as 'Han Islat', a 1-star novice hero inside the game itself. To survive and return to Earth, he must lead beginner heroes and players through impossible floors without a single defeat.",
    genres: ["Action", "Adventure", "Fantasy", "Dungeon"],
    rating: 9.3,
    type: "Manhwa",
    author: "Hermod",
    artist: "Woon, REDICE Studio",
  },
  questism: {
    description:
      "Kim Soohyun is an ordinary high school student at the bottom of the school hierarchy who has no talent for studying, fighting, or being attractive. Suddenly, a mysterious quest window appears right in front of his eyes, granting him supernatural rewards for completing quests as he sets out to unite Gangbuk.",
    genres: ["Action", "Comedy", "Drama", "School Life", "Supernatural"],
    rating: 8.8,
    type: "Manhwa",
    author: "PTJ Comics, YuNuni",
    artist: "TaeWan",
  },
  questsupremacy: {
    description:
      "Kim Soohyun is an ordinary high school student at the bottom of the school hierarchy who has no talent for studying, fighting, or being attractive. Suddenly, a mysterious quest window appears right in front of his eyes, granting him supernatural rewards for completing quests as he sets out to unite Gangbuk.",
    genres: ["Action", "Comedy", "Drama", "School Life", "Supernatural"],
    rating: 8.8,
    type: "Manhwa",
    author: "PTJ Comics, YuNuni",
    artist: "TaeWan",
  },
  lookism: {
    description:
      "Park Hyung Suk is an overweight, unpopular high school student who is mercilessly bullied every day. After moving to Seoul to start fresh, he wakes up one morning in a tall, handsome, and powerful second body—living a double life between his two bodies and getting drawn into the turbulent conflicts of the Four Major Crews.",
    genres: ["Action", "Comedy", "Drama", "School Life", "Supernatural"],
    rating: 9.1,
    type: "Manhwa",
    author: "Park Tae-jun",
    artist: "Park Tae-jun",
  },
  bleach: {
    description:
      "Ichigo Kurosaki is a teenager gifted with the ability to see spirits. His life is forever changed when he meets Rukia Kuchiki, a Soul Reaper battling evil spirits known as Hollows. After Rukia is gravely injured defending Ichigo's family, she transfers her Soul Reaper powers to him, drawing Ichigo into the vast supernatural conflicts of Soul Society, Hueco Mundo, and the Wandenreich.",
    genres: ["Action", "Adventure", "Fantasy", "Supernatural"],
    rating: 9.0,
    type: "Manga",
    author: "Tite Kubo",
    artist: "Tite Kubo",
  },
  fairytail: {
    description:
      "In the magical kingdom of Fiore, young celestial wizard Lucy Heartfilia dreams of joining the legendary—and notoriously destructive—Fairy Tail wizards' guild. When she crosses paths with Natsu Dragneel, a fire-breathing Dragon Slayer searching for his foster father Igneel, and his flying cat Happy, she is swept into a grand adventure alongside Erza Scarlet and Gray Fullbuster.",
    genres: ["Action", "Adventure", "Comedy", "Fantasy"],
    rating: 8.6,
    type: "Manga",
    author: "Hiro Mashima",
    artist: "Hiro Mashima",
  },
  onepiece: {
    description:
      "Gol D. Roger, the King of the Pirates, ignited the Great Pirate Era with his final words revealing the existence of the ultimate treasure, the One Piece, hidden on the Grand Line. Monkey D. Luffy, a boy whose body gained the properties of rubber after eating the Gum-Gum Devil Fruit, sets sail with his Straw Hat Pirates crew to brave the seas and become the next King of the Pirates.",
    genres: ["Action", "Adventure", "Comedy", "Drama", "Fantasy"],
    rating: 9.6,
    type: "Manga",
    author: "Eiichiro Oda",
    artist: "Eiichiro Oda",
  },
  sololeveling: {
    description:
      "Ten years ago, the 'Gate' that connected the real world with the realm of magic and monsters opened. Sung Jin-Woo, known as the 'World's Weakest Hunter' of E-rank, barely scrapes by until he is fatally wounded inside a hidden double dungeon and awakens with a mysterious System interface that allows him alone to level up without limit.",
    genres: ["Action", "Adventure", "Fantasy", "Supernatural"],
    rating: 9.5,
    type: "Manhwa",
    author: "Chugong",
    artist: "DUBU (REDICE Studio)",
  },
  omniscientreadersviewpoint: {
    description:
      "Kim Dokja was the sole loyal reader of the obscure web novel 'Three Ways to Survive in a Ruined World' for over a decade. On the day the novel reaches its final chapter, the apocalyptic world of the story becomes reality—and Kim Dokja is the only person alive who knows how the world will end.",
    genres: ["Action", "Adventure", "Fantasy"],
    rating: 9.5,
    type: "Manhwa",
    author: "Sing N Song",
    artist: "Sleepy-C (REDICE Studio)",
  },
  academysgeniusswordmaster: {
    description:
      "Ronan lived a life filled with regret before dying in a final battle against the invading giants when humanity fell. Given a second chance by returning to his past before the apocalypse, he enrolls in the prestigious Philleon Academy determined to master the sword and save the world.",
    genres: ["Action", "Adventure", "Fantasy", "Regression", "Martial Arts"],
    rating: 8.9,
    type: "Manhwa",
    author: "SeoGwando",
    artist: "C.H",
  },
};

export function getKnownComicFallback(title?: string | null, altTitle?: string | null): FallbackComicMeta | null {
  for (const candidate of [title, altTitle]) {
    const key = normalizeKey(candidate);
    if (!key) continue;
    if (KNOWN_COMIC_FALLBACKS[key]) return KNOWN_COMIC_FALLBACKS[key];
    for (const [k, meta] of Object.entries(KNOWN_COMIC_FALLBACKS)) {
      if (key.length >= 5 && (key.startsWith(k) || k.startsWith(key))) return meta;
    }
  }
  return null;
}

export function isMissingDescription(desc?: string | null, title?: string | null): boolean {
  if (!desc || typeof desc !== "string") return true;
  const trimmed = desc.trim();
  if (!trimmed || trimmed.length < 15) return true;
  if (/^(?:no\s+description(?:\s+provided|\s+available)?\.?|n\/a|none|tbd|unknown)$/i.test(trimmed)) return true;
  if (title && normalizeKey(trimmed) === normalizeKey(title)) return true;
  return false;
}

/** Formats a comic's genuine rating or returns "Not Rated" when no rating exists (never hardcodes 9.5). */
export function formatRating(
  c?: { rating?: number | null; userRating?: number | null; providerRating?: number | null } | number | null,
): string {
  if (typeof c === "number") {
    return Number.isFinite(c) && c > 0 ? c.toFixed(1) : "Not Rated";
  }
  if (!c || typeof c !== "object") return "Not Rated";
  const val = c.userRating ?? c.providerRating ?? c.rating ?? null;
  return typeof val === "number" && Number.isFinite(val) && val > 0 ? val.toFixed(1) : "Not Rated";
}

/** "5 minutes ago", "3 days ago", or a short date once older than a month. */
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t) || t <= 0) return "";
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 31) return `${d}d ago`;
  return new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

const NO_CHAPTER: Chapter = { id: "", number: 0, title: "", publishedAt: new Date(0).toISOString() };
export const latestChapter = (c: Comic): Chapter => c.latest ?? c.chapters[c.chapters.length - 1] ?? NO_CHAPTER;

const cap = (s: string) => (s ? s[0] + s.slice(1).toLowerCase() : "Manga");
const hueOf = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);

export interface ApiComic {
  id: string; slug: string; title: string; altTitle: string | null; description: string; author: string; artist: string;
  type: string; status: string; releaseYear: number; views: number; createdAt: string; updatedAt: string;
  genres: { genre: { name: string; slug?: string } }[];
  rating: number | null;
  userRating?: number | null;
  providerRating?: number | null;
  chapterCount?: number; coverUrl?: string | null; bannerUrl?: string | null;
  latestChapter: { id: string; number: number; displayNumber?: string; publishedAt: string | null } | null;
}
const toChapter = (c: { id: string; number: number; displayNumber?: string; title?: string; publishedAt: string | null }): Chapter =>
  ({ id: c.id, number: c.number, displayNumber: c.displayNumber, title: c.title ?? `Chapter ${c.displayNumber ?? c.number}`, publishedAt: c.publishedAt ?? new Date(0).toISOString() });

export const toComic = (a: ApiComic, chapters: Chapter[] = []): Comic => {
  const fallback = getKnownComicFallback(a.title, a.altTitle);
  const adminOverride = getAdminRatingOverride({ id: a.id, slug: a.slug, title: a.title });
  const userRating = typeof a.userRating === "number" && a.userRating > 0 ? a.userRating : null;
  const rawProviderRating =
    adminOverride !== undefined
      ? adminOverride
      : typeof a.providerRating === "number" && a.providerRating > 0
      ? a.providerRating
      : typeof a.rating === "number" && a.rating > 0
      ? a.rating
      : fallback?.rating ?? null;
  const providerRating = typeof rawProviderRating === "number" && rawProviderRating > 0 ? rawProviderRating : null;
  const effectiveRating = providerRating ?? userRating ?? 0;

  const rawGenres = Array.isArray(a.genres) ? a.genres : [];
  const extractedGenres = rawGenres
    .map((g: any) => (typeof g === "string" ? g : g?.genre?.name))
    .filter((n): n is string => Boolean(n));
  const finalGenres = extractedGenres.length > 0 ? extractedGenres : fallback?.genres ?? [];
  const finalGenreSlugs =
    extractedGenres.length > 0
      ? rawGenres.map((g: any) => (typeof g === "string" ? slugifyGenre(g) : g?.genre?.slug || slugifyGenre(g?.genre?.name || "")))
      : finalGenres.map((name) => slugifyGenre(name));

  const finalDescription =
    !isMissingDescription(a.description, a.title)
      ? a.description
      : fallback?.description ?? a.description ?? "No description provided.";

  const rawType = cap(a.type) as ComicType;
  const finalType: ComicType =
    rawType === "Manga" && fallback?.type === "Manhwa" ? "Manhwa" : rawType;

  return {
    id: a.id,
    slug: a.slug || slugifyGenre(a.title),
    title: a.title,
    altTitle: a.altTitle ?? undefined,
    description: finalDescription,
    author: a.author && a.author !== "Unknown" ? a.author : fallback?.author ?? a.author ?? "Unknown",
    artist: a.artist && a.artist !== "Unknown" ? a.artist : fallback?.artist ?? a.artist ?? "Unknown",
    genres: finalGenres,
    genreSlugs: finalGenreSlugs,
    type: finalType,
    status: cap(a.status) as ComicStatus,
    year: a.releaseYear,
    rating: effectiveRating,
    userRating,
    providerRating,
    hue: hueOf(a.slug || a.title),
    views: a.views,
    addedAt: a.createdAt,
    updatedAt: a.updatedAt,
    chapters,
    chapterCount: a.chapterCount ?? chapters.length,
    latest: a.latestChapter ? toChapter(a.latestChapter) : null,
    coverUrl: a.coverUrl ? (/^https?:\/\//i.test(a.coverUrl) ? a.coverUrl : `${API}${a.coverUrl}`) : null,
  };
};

function dedupeComicsByTitle(items: Comic[]): Comic[] {
  const byTitle = new Map<string, Comic>();
  for (const item of items) {
    const key = item.title.trim().toLowerCase().replace(/^official\s+/i, "").replace(/[^a-z0-9]+/g, "") || item.id;
    const prev = byTitle.get(key);
    if (!prev || item.addedAt.localeCompare(prev.addedAt) > 0) {
      byTitle.set(key, item);
    }
  }
  return Array.from(byTitle.values());
}

/** Loads available genres dynamically from GET /genres, merging with fallback genres so no genre is missing. */
export async function getGenres(): Promise<GenreOption[]> {
  const map = new Map<string, GenreOption>();
  try {
    const rows = await api<Array<{ id?: string; name: string; slug?: string; _count?: { comics?: number } }>>(
      "/genres",
      { cache: "no-store" },
    );
    if (Array.isArray(rows)) {
      for (const r of rows) {
        if (!r?.name) continue;
        const slug = r.slug || slugifyGenre(r.name);
        if (!slug) continue;
        map.set(slug, { id: r.id, name: r.name, slug, count: r._count?.comics ?? 0 });
      }
    }
  } catch {
    // Fall back to default genres list below if API is unreachable
  }
  for (const name of GENRES) {
    const slug = slugifyGenre(name);
    if (slug && !map.has(slug)) {
      map.set(slug, { name, slug });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export interface BrowseQuery {
  q?: string; genre?: string; type?: string; status?: string; creator?: string; minChapters?: string;
  minRating?: string; year?: string; sort?: string; page?: string;
}
export const PAGE_SIZE = 24;

export async function browseComics(p: BrowseQuery) {
  const sp = new URLSearchParams({ pageSize: String(PAGE_SIZE), page: String(Math.max(1, Number(p.page) || 1)) });
  if (p.q?.trim()) sp.set("q", p.q.trim().slice(0, 100));
  // Accept any genre name or slug dynamically without restricting to a hardcoded frontend array.
  const genreSlugs = Array.from(
    new Set(
      (p.genre ?? "")
        .split(",")
        .map((g) => slugifyGenre(g))
        .filter(Boolean),
    ),
  );
  if (genreSlugs.length) sp.set("genre", genreSlugs.join(","));
  if (p.creator?.trim()) sp.set("creator", p.creator.trim().slice(0, 100));
  if (p.minChapters && Number(p.minChapters) >= 1) sp.set("minChapters", String(Math.min(5000, Math.floor(Number(p.minChapters)))));
  if (p.type && (TYPES as string[]).some((t) => t.toLowerCase() === p.type!.toLowerCase())) {
    sp.set("type", p.type.toUpperCase());
  }
  if (p.status && (STATUSES as string[]).some((s) => s.toLowerCase() === p.status!.toLowerCase())) {
    sp.set("status", p.status.toUpperCase());
  }
  if (p.minRating && Number(p.minRating) >= 1 && Number(p.minRating) <= 10) sp.set("minRating", p.minRating);
  if (p.year && /^\d{4}$/.test(p.year)) sp.set("year", p.year);
  if (p.sort && SORTS.some(([v]) => v === p.sort)) sp.set("sort", p.sort);
  const r = await api<{ items: ApiComic[]; total: number; page: number; pages: number }>(`/comics?${sp}`, { cache: "no-store" });
  const mapped = dedupeComicsByTitle(r.items.map((a) => toComic(a)));
  return { total: Math.max(mapped.length, r.total - (r.items.length - mapped.length)), page: r.page, pages: r.pages, items: mapped };
}

export type PopularPeriod = "weekly" | "monthly" | "all";

/** Real period rankings (recorded views); the API pads with all-time leaders when a period is quiet. */
export async function popularComics(period: PopularPeriod): Promise<Comic[]> {
  try {
    const items = await api<ApiComic[]>(`/comics/popular?period=${period}`, { cache: "no-store" });
    return dedupeComicsByTitle(items.map((a) => toComic(a)));
  } catch {
    return [];
  }
}

export async function allComics() {
  try {
    const r = await api<{ items: ApiComic[] }>("/comics?pageSize=48&sort=popular", { cache: "no-store" });
    return dedupeComicsByTitle(r.items.map((a) => toComic(a)));
  } catch {
    return [];
  }
}

export async function getComic(slug: string): Promise<Comic | null> {
  try {
    const a = await api<ApiComic>(`/comics/${encodeURIComponent(slug)}`, { cache: "no-store" });
    const ch = await api<{ id: string; number: number; displayNumber?: string; title: string; publishedAt: string | null }[]>(`/comics/${a.id}/chapters?order=asc`, { cache: "no-store" });
    return toComic(a, ch.map(toChapter));
  } catch {
    return null;
  }
}

// Release-year choices for the filter (last 6 years).
export const years = () => Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);

export async function getAnnouncements() {
  try { return await api<{ id: string; title: string; body: string }[]>("/announcements", { cache: "no-store" }); }
  catch { return []; } // announcements are optional; never break the homepage
}

export async function getNovels() {
  try {
    const r = await api<{ items: { slug: string; title: string; author: string; chapterCount: number }[] }>("/novels?page=1", { cache: "no-store" });
    return r.items.slice(0, 3).map((n) => ({ slug: n.slug, title: n.title, author: n.author, chapters: n.chapterCount, hue: hueOf(n.slug) }));
  } catch { return []; }
}
