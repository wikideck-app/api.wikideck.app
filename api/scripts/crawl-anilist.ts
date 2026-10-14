import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Pool } from "pg";
import { ANILIST_ID_OFFSET, cleanDescription } from "../lib/anilist";

// Ajoute à la base les personnages d'AniList au-delà des 5 000 plus aimés.
//
// AniList refuse de lister plus de 5 000 résultats par requête triée (« Page depth exceeds maximum allowed »).
// On passe donc par les identifiants : `characters(id_in: [...50 identifiants])`, de 1 jusqu'au dernier. Le
// débit est limité (30 requêtes par minute en ce moment, 90 en temps normal) : l'exploration est longue,
// reprend là où elle s'est arrêtée (fichier .anilist-crawl.json) et peut être relancée sans risque.
//
// Les personnages ajoutés ont moins de favoris que le 5 000e : ils sont tous « Communs » (le rang de rareté
// des 5 000 premiers ne change pas). Ceux d'œuvres pour adultes, sans image ou sous le seuil de favoris sont ignorés.
//
// Usage : pnpm anime:crawl [--min-fav 10] [--from 1] [--to 410000] [--rate 28] [--dry] [--reset]
//   --min-fav  nombre de favoris minimum (10 par défaut : environ 25 000 personnages de plus)
//   --rate     requêtes par minute (28 par défaut, sous la limite de 30)
//   --dry      n'écrit rien en base : affiche seulement ce qui serait ajouté
const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) || fallback : fallback;
};
const MIN_FAV = arg("min-fav", 10);
const FROM = arg("from", 1);
const TO = arg("to", 0);
const RATE = Math.min(85, Math.max(1, arg("rate", 28)));
const DRY = process.argv.includes("--dry");
const CHECKPOINT = ".anilist-crawl.json";
const BATCH = 50;
const DEFAULT_IMAGE = /default\.(jpg|png)$/;

const QUERY = `query ($ids: [Int]) {
  Page(perPage: ${BATCH}) {
    characters(id_in: $ids) {
      id
      name { full }
      image { large }
      favourites
      description(asHtml: false)
      media(perPage: 1, sort: POPULARITY_DESC) { nodes { isAdult title { romaji english } } }
    }
  }
}`;

type Raw = {
  id: number;
  name: { full: string | null };
  image: { large: string | null } | null;
  favourites: number;
  description: string | null;
  media: { nodes: { isAdult: boolean; title: { romaji: string | null; english: string | null } }[] };
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "Wikideck/1.0 (https://wikideck.app)" },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 429) {
        const pause = (Number(res.headers.get("retry-after")) || 60) + 2;
        console.log(`limite de débit atteinte, pause de ${pause} s`);
        await wait(pause * 1000);
        continue;
      }
      if (res.ok) return ((await res.json()) as { data: T }).data;
      console.log(`HTTP ${res.status}, nouvelle tentative`);
    } catch (e) {
      console.log(`erreur réseau (${e instanceof Error ? e.message : e}), nouvelle tentative`);
    }
    await wait(3000 * (attempt + 1));
  }
  throw new Error("AniList ne répond pas : relancez le script, il reprendra où il s'est arrêté");
}

async function lastId(): Promise<number> {
  const data = await graphql<{ Page: { characters: { id: number }[] } }>(
    "query { Page(perPage: 1) { characters(sort: ID_DESC) { id } } }",
    {},
  );
  return data.Page.characters[0]?.id ?? 0;
}

async function main() {
  const to = TO || (await lastId());
  const saved = !process.argv.includes("--reset") && existsSync(CHECKPOINT) ? (JSON.parse(readFileSync(CHECKPOINT, "utf8")) as { next: number; added: number; seen: number }) : null;
  let next = Math.max(FROM, saved?.next ?? FROM);
  let added = saved?.added ?? 0;
  let seen = saved?.seen ?? 0;
  const batches = Math.ceil((to - next + 1) / BATCH);
  console.log(`identifiants ${next} à ${to} : ${batches} requêtes, environ ${Math.round(batches / RATE)} min (${RATE} requêtes/min), favoris >= ${MIN_FAV}${DRY ? " (simulation)" : ""}`);

  const pool = DRY ? null : new Pool({ connectionString: process.env.DATABASE_URL });
  const delay = 60_000 / RATE;
  let done = 0;
  while (next <= to) {
    const started = Date.now();
    const ids = Array.from({ length: BATCH }, (_, i) => next + i);
    const data = await graphql<{ Page: { characters: Raw[] } }>(QUERY, { ids });
    const rows = data.Page.characters.flatMap((c) => {
      seen++;
      const media = c.media.nodes[0];
      const image = c.image?.large;
      const name = c.name.full?.trim();
      if (!name || !image || DEFAULT_IMAGE.test(image) || media?.isAdult || c.favourites < MIN_FAV) return [];
      const series = media?.title.english ?? media?.title.romaji ?? null;
      return [{ id: c.id, name, series, image, favourites: c.favourites, extract: cleanDescription(c.description, series) }];
    });

    if (rows.length && pool) {
      const values: unknown[] = [];
      const tuples = rows.map((r, i) => {
        values.push(ANILIST_ID_OFFSET + r.id, r.name, r.series, r.extract, r.image, `https://anilist.co/character/${r.id}`, r.favourites);
        const b = i * 7;
        return `(gen_random_uuid(), 'ANILIST', $${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, 0, 1, 'COMMON', now())`;
      });
      const res = await pool.query(
        `INSERT INTO "Card" (id, source, "pageId", title, description, extract, "imageUrl", url, views, length, languages, rarity, "createdAt")
         VALUES ${tuples.join(", ")} ON CONFLICT ("pageId") DO NOTHING`,
        values,
      );
      added += res.rowCount ?? 0;
    } else added += rows.length;

    next += BATCH;
    done++;
    if (!DRY) writeFileSync(CHECKPOINT, JSON.stringify({ next, added, seen }));
    if (done % 20 === 0 || next > to)
      console.log(`${Math.min(next - 1, to)} / ${to} : ${seen} personnages vus, ${added} ${DRY ? "à ajouter" : "ajoutés"}`);
    await wait(Math.max(0, delay - (Date.now() - started)));
  }
  console.log(`terminé : ${added} personnage(s) ${DRY ? "seraient ajoutés" : "ajoutés"} sur ${seen} vus`);
  await pool?.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
