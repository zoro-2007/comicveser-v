import { htmlText } from "./html";
import { slugify } from "../common/util";

export interface KnownSeriesMeta {
  title: string;
  aliases?: string[];
  description: string;
  genres: string[];
  rating: number | null;
  contentType: "manga" | "manhwa" | "manhua";
  author?: string;
  artist?: string;
  year?: number;
  status?: "ongoing" | "completed" | "hiatus";
}

/**
 * Canonical comic/manga/manhwa genres supported by WeebCentral, Asura Scans, and ComicVerse.
 * Keeps real genres (like WeebCentral's Tags(s): Action, Adventure, Comedy, Drama, Fantasy, Shounen)
 * while rejecting MangaUpdates/Baka-Updates micro-tags and format descriptors.
 */
export const CANONICAL_COMIC_GENRES: readonly string[] = [
  "Action",
  "Adventure",
  "Comedy",
  "Drama",
  "Fantasy",
  "Shounen",
  "Shoujo",
  "Seinen",
  "Josei",
  "Romance",
  "Sci-Fi",
  "Supernatural",
  "Mystery",
  "Psychological",
  "Horror",
  "Thriller",
  "Slice of Life",
  "School Life",
  "Sports",
  "Martial Arts",
  "Mecha",
  "Historical",
  "Military",
  "Music",
  "Ecchi",
  "Harem",
  "Isekai",
  "Mature",
  "Adult",
  "Smut",
  "Gender Bender",
  "Yaoi",
  "Yuri",
  "Shounen Ai",
  "Shoujo Ai",
  "Doujinshi",
  "One Shot",
  "Tragedy",
  "Super Power",
  "Vampire",
  "Magic",
  "Monsters",
  "Demons",
  "Ghosts",
  "Cooking",
  "Medical",
  "Police",
  "Post-Apocalyptic",
  "Apocalyptic",
  "Samurai",
  "Zombies",
  "Reincarnation",
  "Regression",
  "Time Travel",
  "System",
  "Dungeon",
  "Murim",
  "Wuxia",
  "Cultivation",
  "Villainess",
  "Video Games",
  "Virtual Reality",
  "Overpowered",
  "Necromancer",
  "Returner",
  "Delinquents",
  "Mafia",
  "Crime",
  "Philosophical",
  "Superhero",
  "Magical Girls",
  "Reverse Harem",
  "Survival",
  "Adaptation",
  "Webtoon",
  "Tower",
  "Hunter",
  "Academy",
  "Parody",
  "Space",
  "Cyberpunk",
  "Steampunk",
  "Mythology",
  "Detective",
  "Gaming",
  "Revenge",
  "Dark Fantasy",
  "Urban Fantasy",
];

const CANONICAL_GENRE_BY_SLUG = new Map<string, string>();
for (const name of CANONICAL_COMIC_GENRES) {
  CANONICAL_GENRE_BY_SLUG.set(slugify(name), name);
}

const GENRE_SYNONYM_BY_SLUG: Record<string, string> = {
  shonen: "Shounen",
  shojo: "Shoujo",
  "sci-fi": "Sci-Fi",
  scifi: "Sci-Fi",
  "science-fiction": "Sci-Fi",
  school: "School Life",
  "school-life": "School Life",
  "slice-of-life": "Slice of Life",
  "martial-art": "Martial Arts",
  "martial-arts": "Martial Arts",
  "super-powers": "Super Power",
  "super-power": "Super Power",
  superpowers: "Super Power",
  superpower: "Super Power",
  "video-game": "Video Games",
  "video-games": "Video Games",
  "post-apocalyptic": "Post-Apocalyptic",
  "boys-love": "Yaoi",
  "girls-love": "Yuri",
  "one-shot": "One Shot",
  oneshot: "One Shot",
};

export function normalizeCanonicalGenreName(raw?: string | null): string | null {
  if (!raw || typeof raw !== "string") return null;
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > 35 || /^\d+$/.test(cleaned)) return null;
  // Reject MangaUpdates / Baka-Updates trope tags containing slashes or character-trope phrases
  if (cleaned.includes("/")) return null;
  const slug = slugify(cleaned);
  if (!slug) return null;
  if (GENRE_SYNONYM_BY_SLUG[slug]) return GENRE_SYNONYM_BY_SLUG[slug];
  return CANONICAL_GENRE_BY_SLUG.get(slug) ?? null;
}

export function isValidComicGenre(raw?: string | null): boolean {
  return normalizeCanonicalGenreName(raw) !== null;
}

export function filterValidComicGenres(rawGenres: unknown): string[] {
  if (!Array.isArray(rawGenres)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of rawGenres) {
    const strVal =
      typeof item === "string"
        ? item
        : typeof (item as any)?.genre?.name === "string"
        ? (item as any).genre.name
        : typeof (item as any)?.name === "string"
        ? (item as any).name
        : null;
    const canonical = normalizeCanonicalGenreName(strVal);
    if (!canonical) continue;
    const slug = slugify(canonical);
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push(canonical);
  }
  return out;
}

let lastGenrePurgeAt = 0;

/**
 * Purges non-canonical MangaUpdates trope tags from Genre, ComicGenre, and SourceTitle.genres
 * in PostgreSQL so existing live comics (e.g., One Piece, Quest Supremacy) only display real genres.
 */
export async function purgeNonCanonicalGenresFromDb(db: any, force = false): Promise<void> {
  if (!db || typeof db?.genre?.findMany !== "function") return;
  const now = Date.now();
  if (!force && now - lastGenrePurgeAt < 60_000) return;
  lastGenrePurgeAt = now;

  try {
    const allGenres: Array<{ id: string; name: string; slug: string }> = await db.genre
      .findMany({ select: { id: true, name: true, slug: true } })
      .catch(() => []);
    const invalidIds = allGenres
      .filter((g) => !isValidComicGenre(g.name) && !isValidComicGenre(g.slug))
      .map((g) => g.id);

    if (invalidIds.length > 0) {
      if (typeof db?.comicGenre?.deleteMany === "function") {
        await db.comicGenre.deleteMany({ where: { genreId: { in: invalidIds } } }).catch(() => {});
      }
      if (typeof db?.genre?.deleteMany === "function") {
        await db.genre.deleteMany({ where: { id: { in: invalidIds } } }).catch(() => {});
      }
    }

    // Also clean polluted SourceTitle.genres arrays and repair comics published from WeebCentral
    if (typeof db?.sourceTitle?.findMany === "function" && typeof db?.sourceTitle?.update === "function") {
      const sourceTitles: Array<{
        id: string;
        sourceId: string;
        title: string;
        comicId: string | null;
        genres: string[];
      }> = await db.sourceTitle
        .findMany({
          where: { comicId: { not: null } },
          select: { id: true, sourceId: true, title: true, comicId: true, genres: true },
        })
        .catch(() => []);

      for (const st of sourceTitles) {
        if (!Array.isArray(st.genres)) continue;
        let filtered = filterValidComicGenres(st.genres);
        const curated = lookupCuratedSeriesMetadata(st.title);
        // If this title was polluted with >8 tags (from ComicK/MU) and we have curated/WeebCentral tags, use the clean set
        if (st.sourceId === "weebcentral" && curated && (st.genres.length > 8 || filtered.length === 0)) {
          filtered = curated.genres;
        }
        if (filtered.length !== st.genres.length) {
          await db.sourceTitle
            .update({ where: { id: st.id }, data: { genres: filtered } })
            .catch(() => {});
        }
        // If this is a WeebCentral comic whose ComicGenre links were polluted by secondary providers, reset to clean WeebCentral genres
        if (st.sourceId === "weebcentral" && st.comicId && filtered.length > 0 && invalidIds.length > 0) {
          try {
            const targetGenreRows = await db.genre.findMany({
              where: { slug: { in: filtered.map((n) => slugify(n)) } },
              select: { id: true },
            });
            const validTargetIds = targetGenreRows.map((g: { id: string }) => g.id);
            if (validTargetIds.length > 0 && typeof db?.comicGenre?.deleteMany === "function") {
              await db.comicGenre.deleteMany({
                where: { comicId: st.comicId, genreId: { notIn: validTargetIds } },
              });
            }
          } catch {
            // ignore
          }
        }
      }
    }
  } catch {
    // Safe no-op in unit test mocks
  }
}

export function normalizeSeriesLookupKey(raw?: string | null): string {
  if (!raw) return "";
  return raw
    .trim()
    .toLowerCase()
    .replace(/^official\s+/i, "")
    .replace(/\s*\((?:official|manhwa|manga|manhua|webtoon)\)\s*$/i, "")
    .replace(/[^a-z0-9]+/g, "");
}

export function isPlaceholderComicDescription(desc?: string | null, title?: string | null): boolean {
  if (!desc || typeof desc !== "string") return true;
  const trimmed = desc.trim();
  if (!trimmed || trimmed.length < 15) return true;
  if (/^(?:no\s+description(?:\s+provided|\s+available)?\.?|n\/a|none|tbd|unknown|coming\s+soon\.?|description\s+unavailable\.?)$/i.test(trimmed)) {
    return true;
  }
  if (/^read\s+.+\s+online\s+for\s+free/i.test(trimmed) && trimmed.length < 140) {
    return true;
  }
  if (title && normalizeSeriesLookupKey(trimmed) === normalizeSeriesLookupKey(title)) {
    return true;
  }
  return false;
}

export const CURATED_SERIES_METADATA: KnownSeriesMeta[] = [
  {
    title: "Nano Machine",
    aliases: ["Nanomachine", "나노 마신"],
    description:
      "After being held in disdain and having his life put in danger, an orphan from the Demonic Cult, Cheon Yeo-Woon, receives an unexpected visit from his descendant from the future who inserts a nanomachine into Cheon Yeo-Woon's body, drastically changing his life as he rises through the Mashin Academy and the murim world.",
    genres: ["Action", "Adventure", "Fantasy", "Martial Arts", "Murim", "Sci-Fi"],
    rating: 9.2,
    contentType: "manhwa",
    author: "Hanjung Wolya",
    artist: "Geumgangbulgoe, REDICE Studio",
    year: 2020,
    status: "completed",
  },
  {
    title: "Pick Me Up",
    aliases: ["Pick Me Up, Infinite Gacha", "Pick Me Up!", "픽 미 업!"],
    description:
      "In the mobile gacha game 'Pick Me Up!', notorious for its brutal difficulty, Master 'Loki'—ranked 5th in the world—loses consciousness while clearing a dungeon and wakes up as 'Han Islat', a 1-star novice hero inside the game itself. To survive and return to Earth, he must lead beginner heroes and players through impossible floors without a single defeat.",
    genres: ["Action", "Adventure", "Fantasy", "Dungeon"],
    rating: 9.3,
    contentType: "manhwa",
    author: "Hermod",
    artist: "Woon, REDICE Studio",
    year: 2022,
    status: "ongoing",
  },
  {
    title: "QUESTISM",
    aliases: ["Quest Supremacy", "퀘스트지상주의"],
    description:
      "Kim Soohyun is an ordinary high school student at the bottom of the school hierarchy who has no talent for studying, fighting, or being attractive. Suddenly, a mysterious quest window appears right in front of his eyes, granting him supernatural rewards for completing quests as he sets out to unite Gangbuk.",
    genres: ["Action", "Comedy", "Drama", "Fantasy", "Martial Arts", "School Life", "Supernatural"],
    rating: 8.8,
    contentType: "manhwa",
    author: "PTJ Comics, YuNuni",
    artist: "TaeWan",
    year: 2021,
    status: "ongoing",
  },
  {
    title: "Lookism",
    aliases: ["외모지상주의"],
    description:
      "Park Hyung Suk is an overweight, unpopular high school student who is mercilessly bullied every day. After moving to Seoul to start fresh, he wakes up one morning in a tall, handsome, and powerful second body—living a double life between his two bodies and getting drawn into the turbulent conflicts of the Four Major Crews.",
    genres: ["Action", "Comedy", "Drama", "School Life", "Supernatural"],
    rating: 9.1,
    contentType: "manhwa",
    author: "Park Tae-jun",
    artist: "Park Tae-jun",
    year: 2014,
    status: "ongoing",
  },
  {
    title: "Bleach",
    aliases: ["ブリーチ", "Bleach: Thousand-Year Blood War"],
    description:
      "Ichigo Kurosaki is a teenager gifted with the ability to see spirits. His life is forever changed when he meets Rukia Kuchiki, a Soul Reaper battling evil spirits known as Hollows. After Rukia is gravely injured defending Ichigo's family, she transfers her Soul Reaper powers to him, drawing Ichigo into the vast supernatural conflicts of Soul Society, Hueco Mundo, and the Wandenreich.",
    genres: ["Action", "Adventure", "Comedy", "Drama", "Fantasy", "Shounen", "Supernatural"],
    rating: 9.0,
    contentType: "manga",
    author: "Tite Kubo",
    artist: "Tite Kubo",
    year: 2001,
    status: "completed",
  },
  {
    title: "Fairy Tail",
    aliases: ["フェアリーテイル"],
    description:
      "In the magical kingdom of Fiore, young celestial wizard Lucy Heartfilia dreams of joining the legendary—and notoriously destructive—Fairy Tail wizards' guild. When she crosses paths with Natsu Dragneel, a fire-breathing Dragon Slayer searching for his foster father Igneel, and his flying cat Happy, she is swept into a grand adventure alongside Erza Scarlet and Gray Fullbuster.",
    genres: ["Action", "Adventure", "Comedy", "Drama", "Fantasy", "Shounen"],
    rating: 8.6,
    contentType: "manga",
    author: "Hiro Mashima",
    artist: "Hiro Mashima",
    year: 2006,
    status: "completed",
  },
  {
    title: "One Piece",
    aliases: ["ワンピース", "Ван Пис"],
    description:
      "Gol D. Roger, the King of the Pirates, ignited the Great Pirate Era with his final words revealing the existence of the ultimate treasure, the One Piece, hidden on the Grand Line. Monkey D. Luffy, a boy whose body gained the properties of rubber after eating the Gum-Gum Devil Fruit, sets sail with his Straw Hat Pirates crew to brave the seas and become the next King of the Pirates.",
    genres: ["Action", "Adventure", "Comedy", "Drama", "Fantasy", "Shounen"],
    rating: 9.6,
    contentType: "manga",
    author: "Eiichiro Oda",
    artist: "Eiichiro Oda",
    year: 1997,
    status: "ongoing",
  },
  {
    title: "Solo Leveling",
    aliases: ["Only I Level Up", "Na Honjaman Level Up", "나 혼자만 레벨업"],
    description:
      "Ten years ago, the 'Gate' that connected the real world with the realm of magic and monsters opened. Sung Jin-Woo, known as the 'World's Weakest Hunter' of E-rank, barely scrapes by until he is fatally wounded inside a hidden double dungeon and awakens with a mysterious System interface that allows him alone to level up without limit.",
    genres: ["Action", "Adventure", "Fantasy", "Supernatural"],
    rating: 9.5,
    contentType: "manhwa",
    author: "Chugong",
    artist: "DUBU (REDICE Studio)",
    year: 2018,
    status: "completed",
  },
  {
    title: "Omniscient Reader's Viewpoint",
    aliases: ["Omniscient Reader", "전지적 독자 시점"],
    description:
      "Kim Dokja was the sole loyal reader of the obscure web novel 'Three Ways to Survive in a Ruined World' for over a decade. On the day the novel reaches its final chapter, the apocalyptic world of the story becomes reality—and Kim Dokja is the only person alive who knows how the world will end.",
    genres: ["Action", "Adventure", "Fantasy", "Apocalyptic"],
    rating: 9.5,
    contentType: "manhwa",
    author: "Sing N Song",
    artist: "Sleepy-C (REDICE Studio)",
    year: 2020,
    status: "ongoing",
  },
  {
    title: "The Beginning After The End",
    aliases: ["TBATE"],
    description:
      "King Grey has unrivaled strength, wealth, and prestige in a world governed by martial ability, yet solitude lingers closely behind those with great power. Reincarnated into a new world filled with magic and monsters as Arthur Leywin, the king has a second chance to relive his life and protect the ones he loves.",
    genres: ["Action", "Adventure", "Drama", "Fantasy", "Reincarnation"],
    rating: 9.2,
    contentType: "manhwa",
    author: "TurtleMe",
    artist: "Fuyuki23",
    year: 2018,
    status: "ongoing",
  },
  {
    title: "Academy's Genius Swordmaster",
    aliases: ["The Academy's Genius Swordsman", "아카데미 천재 칼잡이"],
    description:
      "Ronan lived a life filled with regret before dying in a final battle against the invading giants when humanity fell. Given a second chance by returning to his past before the apocalypse, he enrolls in the prestigious Philleon Academy determined to master the sword and save the world.",
    genres: ["Action", "Adventure", "Fantasy", "Regression", "Martial Arts"],
    rating: 8.9,
    contentType: "manhwa",
    author: "SeoGwando",
    artist: "C.H",
    year: 2023,
    status: "ongoing",
  },
  {
    title: "The Greatest Estate Developer",
    aliases: ["The World's Best Engineer", "역대급 영지 설계사"],
    description:
      "When civil engineering student Kim Suho falls asleep reading a fantasy novel, he wakes up as Lloyd Frontera, a lazy noble son deep in debt. Armed with modern engineering knowledge and a magical construction system, Lloyd sets out to rebuild his family's territory and secure a wealthy, peaceful life.",
    genres: ["Action", "Adventure", "Comedy", "Fantasy", "Reincarnation"],
    rating: 9.6,
    contentType: "manhwa",
    author: "BK_Moon",
    artist: "Kim Hyunsoo",
    year: 2021,
    status: "ongoing",
  },
  {
    title: "Return of the Mount Hua Sect",
    aliases: ["Return of the Blossoming Blade", "화산귀환"],
    description:
      "Chung Myung, the 13th disciple of the Great Mount Hua Sect and the Plum Blossom Sword Saint, defeats the Heavenly Demon at the cost of his own life—only to awaken a hundred years later in the body of a beggar boy to find his beloved sect fallen into ruin.",
    genres: ["Action", "Adventure", "Comedy", "Martial Arts", "Murim", "Reincarnation"],
    rating: 9.5,
    contentType: "manhwa",
    author: "Biga",
    artist: "LICO",
    year: 2021,
    status: "ongoing",
  },
  {
    title: "Wind Breaker",
    aliases: ["윈드브레이커"],
    description:
      "Jay Jo is the model student body president of Sunny High—and an extraordinarily skilled extreme street cyclist. When he joins the Hummingbird crew for the League of Streets tournament, he discovers friendship, rivalry, and freedom on two wheels.",
    genres: ["Action", "Drama", "School Life", "Sports"],
    rating: 9.3,
    contentType: "manhwa",
    author: "Jo Yongseok",
    artist: "Jo Yongseok",
    year: 2013,
    status: "ongoing",
  },
  {
    title: "Eleceed",
    aliases: ["일렉시드"],
    description:
      "Jiwoo is a kind-hearted teenager who harnesses the lightning-fast reflexes of a cat to secretly rescue people and animals. His quiet life changes when he takes in Kayden, the world's most feared awakened ability user, who is stuck in the body of a chubby street cat.",
    genres: ["Action", "Comedy", "Fantasy", "Supernatural"],
    rating: 9.4,
    contentType: "manhwa",
    author: "Son Jeho",
    artist: "ZHENA",
    year: 2018,
    status: "ongoing",
  },
  {
    title: "Tower of God",
    aliases: ["신의 탑"],
    description:
      "Twenty-Fifth Bam has spent his life trapped beneath a mysterious Tower with only his friend Rachel for company. When Rachel enters the Tower to see the stars, Bam forces open its doors himself, facing deadly tests on every floor to find her.",
    genres: ["Action", "Adventure", "Drama", "Fantasy", "Mystery"],
    rating: 9.1,
    contentType: "manhwa",
    author: "SIU",
    artist: "SIU",
    year: 2010,
    status: "ongoing",
  },
  {
    title: "Jujutsu Kaisen",
    aliases: ["呪術廻戦"],
    description:
      "Yuji Itadori is a high schooler with extraordinary physical strength who swallows a rotting cursed talisman—the finger of Ryomen Sukuna, the King of Curses—to save his friends, becoming Sukuna's host and entering Tokyo Jujutsu High School.",
    genres: ["Action", "Fantasy", "Horror", "Shounen", "Supernatural"],
    rating: 9.1,
    contentType: "manga",
    author: "Gege Akutami",
    artist: "Gege Akutami",
    year: 2018,
    status: "completed",
  },
  {
    title: "Chainsaw Man",
    aliases: ["チェンソーマン"],
    description:
      "Denji is an impoverished young man working off his late father's debt to the yakuza by hunting devils with his chainsaw devil dog, Pochita. Betrayed and killed, Denji merges with Pochita and revives as Chainsaw Man.",
    genres: ["Action", "Comedy", "Horror", "Shounen", "Supernatural"],
    rating: 9.1,
    contentType: "manga",
    author: "Tatsuki Fujimoto",
    artist: "Tatsuki Fujimoto",
    year: 2018,
    status: "ongoing",
  },
  {
    title: "Sakamoto Days",
    aliases: ["サカモトデイズ"],
    description:
      "Taro Sakamoto was the ultimate hitman, feared by villains and admired by assassins alike. Until one day he fell in love, retired, got married, had a daughter, and opened a quiet neighborhood convenience store—where his past refuses to leave him alone.",
    genres: ["Action", "Comedy", "Shounen"],
    rating: 9.0,
    contentType: "manga",
    author: "Yuto Suzuki",
    artist: "Yuto Suzuki",
    year: 2020,
    status: "ongoing",
  },
];

const CURATED_MAP = new Map<string, KnownSeriesMeta>();
for (const entry of CURATED_SERIES_METADATA) {
  const keys = [entry.title, ...(entry.aliases ?? [])]
    .map((t) => normalizeSeriesLookupKey(t))
    .filter(Boolean);
  for (const k of keys) {
    if (!CURATED_MAP.has(k)) CURATED_MAP.set(k, entry);
  }
}

export function lookupCuratedSeriesMetadata(
  title?: string | null,
  altTitles?: Array<string | null | undefined>,
): KnownSeriesMeta | null {
  const candidates = [title, ...(altTitles ?? [])]
    .flatMap((raw) => (raw ? raw.split(/[|/•·]+/) : []))
    .map((t) => normalizeSeriesLookupKey(t))
    .filter(Boolean);

  for (const key of candidates) {
    const exact = CURATED_MAP.get(key);
    if (exact) return exact;
  }

  for (const key of candidates) {
    if (key.length < 5) continue;
    for (const [knownKey, meta] of CURATED_MAP.entries()) {
      if (knownKey.length >= 5 && (key.startsWith(knownKey) || knownKey.startsWith(key))) {
        return meta;
      }
    }
  }
  return null;
}

const externalCache = new Map<string, KnownSeriesMeta | null>();

/**
 * Queries Curated Series Metadata first, then falls back to AniList GraphQL API and Jikan (MyAnimeList) REST API
 * when running outside unit tests so any Manga/Manhwa published from WeebCentral receives its real Description,
 * Genres, Rating, and ContentType.
 */
export async function fetchExternalProviderMetadata(
  title?: string | null,
  altTitles?: Array<string | null | undefined>,
): Promise<KnownSeriesMeta | null> {
  const curated = lookupCuratedSeriesMetadata(title, altTitles);
  if (curated) return curated;

  const cleanTitle = (title ?? "").replace(/^Official\s+/i, "").trim();
  const cacheKey = normalizeSeriesLookupKey(cleanTitle);
  if (!cacheKey || cacheKey.length < 2) return null;
  if (externalCache.has(cacheKey)) return externalCache.get(cacheKey) ?? null;

  // Avoid external network calls during Jest unit tests
  if (process.env.JEST_WORKER_ID || process.env.NODE_ENV === "test") {
    return null;
  }

  // 1. Try AniList GraphQL API
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3200);
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        query: `query ($search: String) {
          Media(search: $search, type: MANGA) {
            title { english romaji native }
            description(asHtml: false)
            genres
            averageScore
            countryOfOrigin
            status
            startDate { year }
          }
        }`,
        variables: { search: cleanTitle },
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (res.ok) {
      const json = (await res.json()) as any;
      const media = json?.data?.Media;
      if (media) {
        const desc = htmlText(String(media.description ?? ""))
          .replace(/\(Source:[^)]+\)/gi, "")
          .replace(/\[Written by[^\]]+\]/gi, "")
          .trim();
        const genres = filterValidComicGenres(Array.isArray(media.genres) ? media.genres : []);
        const score = typeof media.averageScore === "number" && media.averageScore > 0
          ? Number((media.averageScore / 10).toFixed(1))
          : null;
        const country = String(media.countryOfOrigin ?? "").toUpperCase();
        const contentType: "manga" | "manhwa" | "manhua" =
          country === "KR" ? "manhwa" : country === "CN" || country === "TW" ? "manhua" : "manga";
        if (desc || genres.length > 0 || score !== null) {
          const result: KnownSeriesMeta = {
            title: media.title?.english || media.title?.romaji || cleanTitle,
            description: desc || "No description provided.",
            genres,
            rating: score,
            contentType,
            year: typeof media.startDate?.year === "number" ? media.startDate.year : undefined,
          };
          externalCache.set(cacheKey, result);
          return result;
        }
      }
    }
  } catch {
    // Fall through to Jikan
  }

  // 2. Try Jikan (MyAnimeList) REST API
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3200);
    const url = `https://api.jikan.moe/v4/manga?q=${encodeURIComponent(cleanTitle)}&limit=3`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (res.ok) {
      const json = (await res.json()) as any;
      const items: any[] = Array.isArray(json?.data) ? json.data : [];
      const first = items[0];
      if (first) {
        const desc = String(first.synopsis ?? "")
          .replace(/\[Written by MAL Rewrite\]/gi, "")
          .trim();
        const rawGenres = [
          ...(Array.isArray(first.genres) ? first.genres : []),
          ...(Array.isArray(first.themes) ? first.themes : []),
          ...(Array.isArray(first.demographics) ? first.demographics : []),
        ]
          .map((g: any) => g?.name)
          .filter((n: any): n is string => typeof n === "string" && n.length > 0);
        const genres = filterValidComicGenres(rawGenres);
        const score = typeof first.score === "number" && first.score > 0 ? Number(first.score.toFixed(1)) : null;
        const rawType = String(first.type ?? "").toLowerCase();
        const contentType: "manga" | "manhwa" | "manhua" =
          rawType === "manhwa" ? "manhwa" : rawType === "manhua" ? "manhua" : "manga";
        if (desc || genres.length > 0 || score !== null) {
          const result: KnownSeriesMeta = {
            title: first.title_english || first.title || cleanTitle,
            description: desc || "No description provided.",
            genres,
            rating: score,
            contentType,
          };
          externalCache.set(cacheKey, result);
          return result;
        }
      }
    }
  } catch {
    // Ignore network errors
  }

  externalCache.set(cacheKey, null);
  return null;
}
