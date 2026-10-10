import { randomInt } from "node:crypto";
import type { Rarity } from "@/generated/prisma/client";
import { cleanDescription } from "@/lib/anilist";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import type { WikiCard } from "@/lib/wikipedia";

// Personnages d'anime / manga de Kitsu (https://kitsu.docs.apiary.io) : environ 106 000. Ils complètent
// ceux d'AniList (les 5 000 plus aimés) avec des personnages moins connus.
const API = "https://kitsu.io/api/edge/characters";
const HEADERS = {
  Accept: "application/vnd.api+json",
  "User-Agent": "Wikideck/1.0 (https://wikideck.app)",
};

/** pageId = décalage + identifiant Kitsu (AniList utilise 2 000 000 000 + son identifiant) */
export const KITSU_ID_OFFSET = 2_100_000_000;

const PER_PAGE = 20; // maximum accepté par Kitsu
const CURSOR_KEY = "kitsu:cursor";
const DONE_KEY = "kitsu:done";
const BLOCK_KEY = "kitsu:blocked";
const LOCK_KEY = "lock:kitsu-crawl";
const ANILIST_PERSISTED_KEY = "anilist:persisted";
const RUN_MS = 60_000;
const GAP_MS = 500;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type KitsuMediaRef = { title: string; rank: number | null; role: string };
export type KitsuChar = {
  id: number;
  slug: string | null;
  name: string;
  image: string;
  description: string | null;
  media: KitsuMediaRef[];
};

type Resource = {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
  relationships?: Record<string, { data?: { id: string; type: string }[] | { id: string; type: string } | null }>;
};
type Payload = { data: Resource[]; included?: Resource[]; links?: { next?: string } };

export class KitsuUnavailableError extends Error {}

const QUERY = (offset: number) =>
  new URLSearchParams({
    "page[limit]": String(PER_PAGE),
    "page[offset]": String(offset),
    include: "mediaCharacters.media",
    "fields[characters]": "canonicalName,slug,description,image,mediaCharacters",
    "fields[mediaCharacters]": "role,media",
    "fields[anime]": "canonicalTitle,popularityRank,ageRating",
    "fields[manga]": "canonicalTitle,popularityRank,ageRating",
  });

/** Une page de personnages, sans ceux qui n'ont pas d'image, pas d'œuvre ou seulement des œuvres pour adultes. */
export async function fetchKitsuPage(offset: number): Promise<{ chars: KitsuChar[]; last: boolean }> {
  let res: Response;
  try {
    res = await fetch(`${API}?${QUERY(offset)}`, {
      headers: HEADERS,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new KitsuUnavailableError(e instanceof Error ? e.message : "réseau");
  }
  if (res.status === 429) {
    const ms = (Number(res.headers.get("retry-after")) || 60) * 1000;
    await redis.set(BLOCK_KEY, "1", "PX", ms).catch(() => {});
    throw new KitsuUnavailableError("HTTP 429");
  }
  if (!res.ok) throw new KitsuUnavailableError(`HTTP ${res.status}`);
  const json = (await res.json()) as Payload;

  const included = new Map((json.included ?? []).map((r) => [`${r.type}:${r.id}`, r]));
  const chars: KitsuChar[] = [];
  for (const c of json.data) {
    const image = (c.attributes.image as { original?: string } | null)?.original;
    const name = String(c.attributes.canonicalName ?? "").trim();
    if (!image || !name) continue;
    const links = (c.relationships?.mediaCharacters?.data as { id: string }[] | undefined) ?? [];
    const media: KitsuMediaRef[] = [];
    for (const link of links) {
      const mc = included.get(`mediaCharacters:${link.id}`);
      const ref = mc?.relationships?.media?.data as { id: string; type: string } | undefined;
      const m = ref ? included.get(`${ref.type}:${ref.id}`) : undefined;
      if (!mc || !m || m.attributes.ageRating === "R18") continue;
      media.push({
        title: String(m.attributes.canonicalTitle ?? ""),
        rank: typeof m.attributes.popularityRank === "number" ? m.attributes.popularityRank : null,
        role: String(mc.attributes.role ?? "supporting"),
      });
    }
    if (!media.length) continue;
    chars.push({
      id: Number(c.id),
      slug: (c.attributes.slug as string | null) ?? null,
      name,
      image,
      description: (c.attributes.description as string | null) ?? null,
      media,
    });
  }
  return { chars, last: !json.links?.next || json.data.length < PER_PAGE };
}

/** Rareté d'un personnage de Kitsu : rôle et popularité de la meilleure œuvre où il apparaît. */
export function kitsuRarity(media: KitsuMediaRef[]): Rarity {
  const best = (role: (r: string) => boolean) =>
    Math.min(...media.filter((m) => role(m.role)).map((m) => m.rank ?? Infinity), Infinity);
  const main = best((r) => r === "main");
  const other = best((r) => r !== "main");
  if (main <= 300) return "RARE";
  if (main <= 3000 || other <= 100) return "UNCOMMON";
  return "COMMON";
}

const norm = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .sort() // « Gojou Satoru » et « Satoru Gojou » sont le même personnage
    .join(" ");

// noms des personnages d'AniList : un personnage déjà présent n'est pas ajouté une seconde fois
let anilistNames: { at: number; names: Set<string> } | null = null;
async function knownNames(): Promise<Set<string>> {
  if (anilistNames && Date.now() - anilistNames.at < 30 * 60_000) return anilistNames.names;
  const rows = await prisma.card.findMany({
    where: { source: "ANILIST", baseCardId: null },
    select: { title: true },
  });
  anilistNames = { at: Date.now(), names: new Set(rows.map((r) => norm(r.title))) };
  return anilistNames.names;
}

export function toKitsuCard(c: KitsuChar): WikiCard {
  const ranked = [...c.media].sort(
    (a, b) => Number(b.role === "main") - Number(a.role === "main") || (a.rank ?? 1e9) - (b.rank ?? 1e9),
  );
  const series = ranked[0]?.title || null;
  return {
    pageId: KITSU_ID_OFFSET + c.id,
    title: c.name,
    description: series,
    extract: cleanDescription(c.description, series),
    imageUrl: c.image,
    url: `https://kitsu.app/characters/${c.slug ?? c.id}`,
    views: 0,
    length: 0,
    languages: 1,
    rarity: kitsuRarity(c.media),
    source: "KITSU",
  };
}

/**
 * Parcourt Kitsu en arrière-plan, par lots, et enregistre chaque personnage comme carte. La position
 * est gardée dans Redis : un redémarrage reprend où l'on s'était arrêté. Attend qu'AniList ait fini
 * pour pouvoir écarter les doublons.
 */
export function warmKitsu() {
  void (async () => {
    try {
      if (await redis.get(DONE_KEY)) return;
      if ((await redis.scard(ANILIST_PERSISTED_KEY)) < 90) return;
      if ((await redis.pttl(BLOCK_KEY)) > 0) return;
      if (!(await redis.set(LOCK_KEY, "1", "PX", RUN_MS + 15_000, "NX"))) return;

      const known = await knownNames();
      let offset = Number(await redis.get(CURSOR_KEY)) || 0;
      const deadline = Date.now() + RUN_MS;
      while (Date.now() < deadline) {
        const { chars, last } = await fetchKitsuPage(offset);
        const fresh = chars.filter((c) => !known.has(norm(c.name)));
        if (fresh.length) {
          await prisma.card.createMany({ data: fresh.map(toKitsuCard), skipDuplicates: true });
        }
        offset += PER_PAGE;
        await redis.set(CURSOR_KEY, String(offset));
        if (last) {
          await redis.set(DONE_KEY, "1");
          break;
        }
        await wait(GAP_MS + randomInt(200));
      }
      await redis.del(LOCK_KEY);
    } catch {
      /* on reprend au prochain passage, à la même position */
    }
  })();
}
