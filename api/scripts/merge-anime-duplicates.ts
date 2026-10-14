import "dotenv/config";
import { appendFileSync, writeFileSync } from "node:fs";
import { Pool, type PoolClient } from "pg";
import { matchCharacters, nameKeyLoose, nameTokens } from "../lib/anime-match";

// Fusionne les personnages présents à la fois dans AniList et dans Kitsu sous des noms différents.
// La carte d'AniList est conservée ; celle de Kitsu est supprimée et tout ce qui la référençait est reporté :
// les joueurs qui l'avaient reçoivent un exemplaire de la carte conservée (un doublon s'ils la possédaient déjà),
// avec leurs étiquettes et favoris ; l'historique des tirages, les albums, les envies, les enchères, les échanges,
// la vitrine et les cartes en vedette suivent. Une carte supprimée est mémorisée (CardAlias) pour ne pas revenir.
//
// Sans --apply : simulation (rapport dans anime-duplicates.csv). Avec --apply : fusion, chaque paire dans sa propre
// transaction, après sauvegarde (anime-merge-backup.jsonl). Sans danger à relancer.
//
// Usage : pnpm anime:merge [--apply] [--include-maybe] [--limit 200]
//   --include-maybe  fusionne aussi les correspondances « probables » (nom inclus dans l'autre, même œuvre)
//   --limit          ne traite que les N premières paires (pour essayer)
const APPLY = process.argv.includes("--apply");
const MAYBE = process.argv.includes("--include-maybe");
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > 0 ? Number(process.argv[limitArg + 1]) || Infinity : Infinity;

type Row = { id: string; pageId: number; title: string; description: string | null; views: number; rarity: string };
type Pair = { twin: Row; keep: Row; kind: "sure" | "maybe" };

class Skip extends Error {}

async function findPairs(pool: Pool) {
  const { rows } = await pool.query<Row & { source: string }>(
    `SELECT id, "pageId", title, description, views, rarity::text AS rarity, source::text AS source
     FROM "Card" WHERE source IN ('ANILIST', 'KITSU') AND "baseCardId" IS NULL`,
  );
  const anilist = rows.filter((r) => r.source === "ANILIST");
  const kitsu = rows.filter((r) => r.source === "KITSU");
  console.log(`${anilist.length} personnages d'AniList, ${kitsu.length} de Kitsu`);

  const byKey = new Map<string, Row[]>();
  const byToken = new Map<string, Row[]>();
  for (const a of anilist) {
    const key = nameKeyLoose(a.title);
    (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(a);
    for (const t of new Set(nameTokens(a.title).filter((w) => w.length >= 3)))
      (byToken.get(t) ?? byToken.set(t, []).get(t)!).push(a);
  }

  const pairs: Pair[] = [];
  const ambiguous: { twin: Row; options: Row[] }[] = [];
  for (const k of kitsu) {
    const side = { title: k.title, series: k.description };
    const sure = (byKey.get(nameKeyLoose(k.title)) ?? []).filter((a) => matchCharacters({ title: a.title, series: a.description }, side) === "sure");
    if (sure.length === 1) {
      pairs.push({ twin: k, keep: sure[0], kind: "sure" });
      continue;
    }
    if (sure.length > 1) {
      ambiguous.push({ twin: k, options: sure });
      continue;
    }
    const seen = new Set<string>();
    const maybe = [...new Set(nameTokens(k.title).filter((w) => w.length >= 3))]
      .flatMap((t) => byToken.get(t) ?? [])
      .filter((a) => !seen.has(a.id) && seen.add(a.id))
      .filter((a) => matchCharacters({ title: a.title, series: a.description }, side) !== null);
    if (maybe.length === 1) pairs.push({ twin: k, keep: maybe[0], kind: "maybe" });
    else if (maybe.length > 1) ambiguous.push({ twin: k, options: maybe });
  }
  return { pairs, ambiguous };
}

async function report(pool: Pool, pairs: Pair[], ambiguous: { twin: Row; options: Row[] }[]) {
  const owners = await pool.query<{ cardId: string; n: number; q: number }>(
    `SELECT "cardId", COUNT(*)::int AS n, SUM(quantity)::int AS q FROM "UserCard" WHERE "cardId" = ANY($1) GROUP BY "cardId"`,
    [pairs.map((p) => p.twin.id)],
  );
  const held = new Map(owners.rows.map((r) => [r.cardId, r]));
  const sure = pairs.filter((p) => p.kind === "sure");
  const maybe = pairs.filter((p) => p.kind === "maybe");
  const owned = pairs.filter((p) => held.has(p.twin.id));
  console.log(`\n${sure.length} fusions sûres, ${maybe.length} probables, ${ambiguous.length} ambiguës (ignorées)`);
  console.log(`${owned.length} paires où la carte de Kitsu est déjà possédée par des joueurs (${owned.reduce((s, p) => s + (held.get(p.twin.id)?.q ?? 0), 0)} exemplaires à reporter)`);
  const csv = ["type;carte conservée (AniList);œuvre;carte supprimée (Kitsu);œuvre;joueurs concernés;exemplaires"];
  for (const p of pairs) {
    const h = held.get(p.twin.id);
    csv.push([p.kind, p.keep.title, p.keep.description ?? "", p.twin.title, p.twin.description ?? "", h?.n ?? 0, h?.q ?? 0].join(";"));
  }
  for (const a of ambiguous) csv.push(["ambigu", a.options.map((o) => o.title).join(" / "), "", a.twin.title, a.twin.description ?? "", 0, 0].join(";"));
  writeFileSync("anime-duplicates.csv", csv.join("\n"));
  console.log("rapport complet : anime-duplicates.csv");
  console.log("\nexemples (sûrs) :");
  for (const p of sure.slice(0, 12)) console.log(`  ${p.twin.title}  ->  ${p.keep.title}   [${p.keep.description ?? "?"}]`);
  console.log("exemples (probables) :");
  for (const p of maybe.slice(0, 8)) console.log(`  ${p.twin.title}  ->  ${p.keep.title}   [${p.keep.description ?? "?"}]`);
}

// reporte tout ce qui référence `twin` vers `keep`, puis supprime `twin` (et sa version mythique)
async function mergeInto(c: PoolClient, twin: string, keep: string, alias: { pageId: number } | null) {
  // un même échange ne peut pas contenir les deux cartes : on laisse ce cas à la main
  const clash = await c.query(
    `SELECT 1 FROM "TradeItem" t JOIN "TradeItem" k ON k."tradeId" = t."tradeId" WHERE t."cardId" = $1 AND k."cardId" = $2 LIMIT 1`,
    [twin, keep],
  );
  if (clash.rowCount) throw new Skip("les deux cartes figurent dans un même échange");

  // version mythique éventuelle (une seule par carte)
  const mythics = await c.query<{ id: string; base: string }>(`SELECT id, "baseCardId" AS base FROM "Card" WHERE "baseCardId" = ANY($1)`, [[twin, keep]]);
  const mt = mythics.rows.find((m) => m.base === twin);
  const mk = mythics.rows.find((m) => m.base === keep);
  if (mt && mk) await mergeInto(c, mt.id, mk.id, null);
  else if (mt) {
    await c.query(
      `UPDATE "Card" m SET "baseCardId" = k.id, "pageId" = -k."pageId", source = k.source, title = k.title, description = k.description, extract = k.extract, "imageUrl" = k."imageUrl", url = k.url, views = k.views
       FROM "Card" k WHERE k.id = $2 AND m.id = $1`,
      [mt.id, keep],
    );
  }

  // possesseurs : exemplaires et favoris ajoutés, étiquettes reprises ; sinon la ligne change simplement de carte
  await c.query(
    `UPDATE "UserCard" k SET quantity = k.quantity + t.quantity, favorite = k.favorite OR t.favorite, imported = k.imported OR t.imported
     FROM "UserCard" t WHERE t."cardId" = $1 AND k."cardId" = $2 AND k."userId" = t."userId"`,
    [twin, keep],
  );
  await c.query(
    `INSERT INTO "_TagToUserCard" ("A", "B")
     SELECT l."A", k.id FROM "_TagToUserCard" l
     JOIN "UserCard" t ON t.id = l."B" AND t."cardId" = $1
     JOIN "UserCard" k ON k."cardId" = $2 AND k."userId" = t."userId"
     ON CONFLICT DO NOTHING`,
    [twin, keep],
  );
  await c.query(`DELETE FROM "UserCard" t USING "UserCard" k WHERE t."cardId" = $1 AND k."cardId" = $2 AND k."userId" = t."userId"`, [twin, keep]);
  await c.query(`UPDATE "UserCard" SET "cardId" = $2 WHERE "cardId" = $1`, [twin, keep]);

  // listes à clé unique (une carte une seule fois par album / joueur) : on retire le doublon avant de déplacer
  await c.query(`DELETE FROM "AlbumCard" t USING "AlbumCard" k WHERE t."cardId" = $1 AND k."cardId" = $2 AND k."albumId" = t."albumId"`, [twin, keep]);
  await c.query(`UPDATE "AlbumCard" SET "cardId" = $2 WHERE "cardId" = $1`, [twin, keep]);
  await c.query(`DELETE FROM "WishlistItem" t USING "WishlistItem" k WHERE t."cardId" = $1 AND k."cardId" = $2 AND k."userId" = t."userId"`, [twin, keep]);
  await c.query(`UPDATE "WishlistItem" SET "cardId" = $2 WHERE "cardId" = $1`, [twin, keep]);
  await c.query(`DELETE FROM "ImportedCard" t USING "ImportedCard" k WHERE t."cardId" = $1 AND k."cardId" = $2 AND k."userId" = t."userId"`, [twin, keep]);
  await c.query(`UPDATE "ImportedCard" SET "cardId" = $2 WHERE "cardId" = $1`, [twin, keep]);

  // historique et opérations en cours
  await c.query(`UPDATE "Pull" SET "cardId" = $2, rarity = (SELECT rarity FROM "Card" WHERE id = $2) WHERE "cardId" = $1`, [twin, keep]);
  await c.query(`UPDATE "Auction" SET "cardId" = $2 WHERE "cardId" = $1`, [twin, keep]);
  await c.query(`UPDATE "TradeItem" SET "cardId" = $2 WHERE "cardId" = $1`, [twin, keep]);
  await c.query(`UPDATE "GuildWish" SET "cardId" = $2 WHERE "cardId" = $1`, [twin, keep]);
  await c.query(`UPDATE "User" SET "showcaseCardId" = $2 WHERE "showcaseCardId" = $1`, [twin, keep]);
  await c.query(
    `UPDATE "User" SET "featuredCardIds" = CASE WHEN $2::uuid = ANY("featuredCardIds") THEN array_remove("featuredCardIds", $1::uuid) ELSE array_replace("featuredCardIds", $1::uuid, $2::uuid) END
     WHERE $1::uuid = ANY("featuredCardIds")`,
    [twin, keep],
  );
  await c.query(`UPDATE "CardAlias" SET "cardId" = $2 WHERE "cardId" = $1`, [twin, keep]);
  if (alias) await c.query(`INSERT INTO "CardAlias" ("pageId", "cardId") VALUES ($1, $2) ON CONFLICT DO NOTHING`, [alias.pageId, keep]);
  await c.query(`DELETE FROM "Card" WHERE id = $1`, [twin]);
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const { pairs, ambiguous } = await findPairs(pool);
  await report(pool, pairs, ambiguous);
  if (!APPLY) {
    console.log("\n(simulation : relancez avec --apply pour fusionner ; --include-maybe pour inclure les probables)");
    await pool.end();
    return;
  }

  const todo = pairs.filter((p) => p.kind === "sure" || MAYBE).slice(0, LIMIT);
  console.log(`\nfusion de ${todo.length} paire(s)…`);
  writeFileSync("anime-merge-backup.jsonl", "");
  let merged = 0;
  const skipped: string[] = [];
  for (const p of todo) {
    const c = await pool.connect();
    try {
      // sauvegarde avant fusion : la carte supprimée et ses possesseurs
      const [card, owners] = await Promise.all([
        c.query(`SELECT * FROM "Card" WHERE id = $1`, [p.twin.id]),
        c.query(`SELECT * FROM "UserCard" WHERE "cardId" = $1`, [p.twin.id]),
      ]);
      appendFileSync("anime-merge-backup.jsonl", JSON.stringify({ keep: p.keep.id, card: card.rows[0], owners: owners.rows }) + "\n");
      await c.query("BEGIN");
      await mergeInto(c, p.twin.id, p.keep.id, { pageId: p.twin.pageId });
      await c.query("COMMIT");
      merged++;
      if (merged % 200 === 0) console.log(`${merged} / ${todo.length}`);
    } catch (e) {
      await c.query("ROLLBACK");
      skipped.push(`${p.twin.title} -> ${p.keep.title} : ${e instanceof Skip ? e.message : (e as Error).message}`);
    } finally {
      c.release();
    }
  }
  console.log(`${merged} fusion(s) faite(s), ${skipped.length} ignorée(s)`);
  for (const s of skipped.slice(0, 20)) console.log(`  - ${s}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
