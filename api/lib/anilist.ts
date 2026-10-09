import { randomInt } from "node:crypto";
import type { Rarity } from "@/generated/prisma/client";
import { redis } from "@/lib/redis";
import type { WikiCard } from "@/lib/wikipedia";

// Personnages d'anime / manga d'AniList (https://docs.anilist.co). L'API ne laisse lire que les
// 5 000 premiers résultats d'un tri ; on classe donc les personnages par favoris et on tire
// la rareté d'abord, puis un rang dans la tranche correspondante.
const ENDPOINT = "https://graphql.anilist.co";
const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "User-Agent": "Wikideck/1.0 (https://wikideck.app)",
};

/** pageId = décalage + identifiant AniList (le pageId négatif reste réservé aux variantes mythiques) */
export const ANILIST_ID_OFFSET = 2_000_000_000;

const PER_PAGE = 50;
const MAX_RANK = 5000;
const PAGE_TTL_SEC = 24 * 60 * 60;
const MIN_GAP_MS = 2300; // l'API est limitée à 30 requêtes par minute
const DEFAULT_IMAGE = /default\.(jpg|png)$/;

export class AnilistUnavailableError extends Error {
  constructor(detail: string) {
    super(`AniList indisponible : ${detail}`);
  }
}

// tranches de rang (1 = personnage le plus aimé) et probabilité de tirage de chaque rareté
const BANDS: { rarity: Rarity; from: number; to: number; weight: number }[] = [
  { rarity: "COMMON", from: 3501, to: 5000, weight: 0.42 },
  { rarity: "UNCOMMON", from: 2001, to: 3500, weight: 0.25 },
  { rarity: "RARE", from: 801, to: 2000, weight: 0.16 },
  { rarity: "SUPER_RARE", from: 201, to: 800, weight: 0.1 },
  { rarity: "ULTRA_RARE", from: 41, to: 200, weight: 0.05 },
  { rarity: "LEGENDARY", from: 1, to: 40, weight: 0.02 },
];

const rarityOfRank = (rank: number) =>
  BANDS.find((b) => rank >= b.from && rank <= b.to)?.rarity ?? "COMMON";

function pickBand() {
  let roll = randomInt(1_000_000) / 1_000_000;
  for (const band of BANDS) {
    if (roll < band.weight) return band;
    roll -= band.weight;
  }
  return BANDS[0];
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// une seule requête à la fois, espacées : on reste sous la limite de débit d'AniList
let chain: Promise<unknown> = Promise.resolve();
let lastCall = 0;
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const gap = lastCall + MIN_GAP_MS - Date.now();
    if (gap > 0) await wait(gap);
    lastCall = Date.now();
    return fn();
  });
  chain = run.catch(() => undefined);
  return run;
}

const QUERY = `query ($page: Int) {
  Page(page: $page, perPage: ${PER_PAGE}) {
    characters(sort: FAVOURITES_DESC) {
      id
      name { full }
      image { large }
      favourites
      description(asHtml: false)
      media(perPage: 1, sort: POPULARITY_DESC) { nodes { isAdult title { romaji english } } }
    }
  }
}`;

type RawCharacter = {
  id: number;
  name: { full: string | null };
  image: { large: string | null } | null;
  favourites: number;
  description: string | null;
  media: { nodes: { isAdult: boolean; title: { romaji: string | null; english: string | null } }[] };
};

export type AnimeChar = {
  rank: number;
  rarity: Rarity;
  id: number;
  name: string;
  series: string | null;
  image: string;
  favourites: number;
  extract: string;
};

export function cleanDescription(raw: string | null, series: string | null): string {
  const text = (raw ?? "")
    .replace(/~![\s\S]*?!~/g, "") // spoilers
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // liens markdown
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/[_*`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length < 20) return series ? `Personnage de ${series}.` : "Personnage d’anime ou de manga.";
  if (text.length <= 300) return text;
  const cut = text.slice(0, 300);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 200))}…`;
}

async function fetchPage(page: number): Promise<AnimeChar[]> {
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await throttled(() =>
        fetch(ENDPOINT, {
          method: "POST",
          headers: HEADERS,
          body: JSON.stringify({ query: QUERY, variables: { page } }),
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
        }),
      );
      if (res.ok) {
        const json = (await res.json()) as { data?: { Page: { characters: RawCharacter[] } } };
        const rows = json.data?.Page.characters ?? [];
        return rows.flatMap((c, i): AnimeChar[] => {
          const media = c.media.nodes[0];
          const image = c.image?.large;
          const name = c.name.full?.trim();
          // pas d'œuvre pour adultes, pas d'image par défaut
          if (!name || !image || DEFAULT_IMAGE.test(image) || media?.isAdult) return [];
          const series = media?.title.english ?? media?.title.romaji ?? null;
          const rank = (page - 1) * PER_PAGE + i + 1;
          return [
            {
              rank,
              rarity: rarityOfRank(rank),
              id: c.id,
              name,
              series,
              image,
              favourites: c.favourites,
              extract: cleanDescription(c.description, series),
            },
          ];
        });
      }
      lastError = `HTTP ${res.status}`;
      if (res.status !== 429 && res.status < 500) break;
      const retryAfter = Number(res.headers.get("retry-after"));
      await wait(Math.min(15_000, retryAfter > 0 ? retryAfter * 1000 : 3000 * (attempt + 1)));
    } catch (e) {
      lastError = e instanceof Error ? e.message : "réseau";
      await wait(1500 * (attempt + 1));
    }
  }
  throw new AnilistUnavailableError(lastError);
}

const pageKey = (page: number) => `anilist:page:${page}`;
const inFlight = new Map<number, Promise<AnimeChar[]>>();

async function getPage(page: number): Promise<AnimeChar[]> {
  try {
    const cached = await redis.get(pageKey(page));
    if (cached) return JSON.parse(cached) as AnimeChar[];
  } catch {}
  let pending = inFlight.get(page);
  if (!pending) {
    pending = fetchPage(page)
      .then(async (chars) => {
        await redis.set(pageKey(page), JSON.stringify(chars), "EX", PAGE_TTL_SEC).catch(() => {});
        return chars;
      })
      .finally(() => inFlight.delete(page));
    inFlight.set(page, pending);
  }
  return pending;
}

// pages déjà en cache dans une tranche : repli quand AniList ne répond pas
async function cachedPageIn(from: number, to: number): Promise<AnimeChar[] | null> {
  const pages: number[] = [];
  for (let p = Math.ceil(from / PER_PAGE); p <= Math.ceil(to / PER_PAGE); p++) pages.push(p);
  try {
    const raws = await redis.mget(pages.map(pageKey));
    const hits = raws.filter((r): r is string => r !== null);
    return hits.length ? (JSON.parse(hits[randomInt(hits.length)]) as AnimeChar[]) : null;
  } catch {
    return null;
  }
}

export const toAnimeCard = (c: AnimeChar): WikiCard => ({
  pageId: ANILIST_ID_OFFSET + c.id,
  title: c.name,
  description: c.series,
  extract: c.extract,
  imageUrl: c.image,
  url: `https://anilist.co/character/${c.id}`,
  views: c.favourites,
  length: 0,
  languages: 1,
  rarity: c.rarity,
  source: "ANILIST",
});

export async function drawAnimeCards(count: number): Promise<WikiCard[]> {
  const picked = new Map<number, WikiCard>();
  let failure: AnilistUnavailableError | null = null;
  for (let guard = 0; picked.size < count && guard < count * 10; guard++) {
    const band = pickBand();
    const rank = band.from + randomInt(band.to - band.from + 1);
    let chars: AnimeChar[] | null = null;
    try {
      chars = await getPage(Math.ceil(rank / PER_PAGE));
    } catch (e) {
      if (!(e instanceof AnilistUnavailableError)) throw e;
      failure = e;
      chars = await cachedPageIn(band.from, band.to);
    }
    if (!chars) continue;
    // un rang peut manquer (œuvre pour adultes, image par défaut) : on prend un autre personnage de la page
    const pool = chars.filter(
      (c) => c.rarity === band.rarity && !picked.has(ANILIST_ID_OFFSET + c.id),
    );
    const chosen = pool.find((c) => c.rank === rank) ?? pool[randomInt(pool.length || 1)];
    if (chosen) picked.set(ANILIST_ID_OFFSET + chosen.id, toAnimeCard(chosen));
  }
  if (picked.size < count) throw failure ?? new AnilistUnavailableError("pas assez de personnages");
  return [...picked.values()];
}

const WARM_LOCK = "lock:anilist-warm";

/** Remplit en arrière-plan le cache des pages (100 requêtes au total, une toutes les 2,3 s). */
export function warmAnimePages() {
  void (async () => {
    try {
      if (!(await redis.set(WARM_LOCK, "1", "EX", 75, "NX"))) return;
      const total = Math.ceil(MAX_RANK / PER_PAGE);
      const all = Array.from({ length: total }, (_, i) => i + 1);
      const have = await redis.mget(all.map(pageKey));
      const missing = all.filter((_, i) => have[i] === null);
      // dans le désordre : toutes les tranches de rareté se remplissent en même temps
      for (let i = missing.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [missing[i], missing[j]] = [missing[j], missing[i]];
      }
      for (const page of missing.slice(0, 25)) await getPage(page);
    } catch {
      /* le tirage retombe sur ce qui est déjà en cache */
    }
  })();
}
