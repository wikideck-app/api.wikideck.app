import "dotenv/config";
import { Pool } from "pg";
import { ANIME_DROP_BANDS } from "@wikideck/shared";

// Recalcule la rareté des personnages d'AniList déjà en base d'après leur rang de favoris et les
// tranches actuelles (ANIME_DROP_BANDS). Sans --apply, affiche seulement ce qui changerait.
// Usage : pnpm anime:rerank [--apply]
const apply = process.argv.includes("--apply");

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const cases = ANIME_DROP_BANDS.map(
    (b) => `WHEN rank BETWEEN ${b.from} AND ${b.to} THEN '${b.rarity}'`,
  ).join(" ");
  // rang = place par nombre de favoris (les ex æquo départagés par identifiant), mythiques exclues
  const ranked = `
    WITH ranked AS (
      SELECT id, rarity::text AS old, ROW_NUMBER() OVER (ORDER BY views DESC, "pageId" ASC)::int AS rank
      FROM "Card" WHERE source = 'ANILIST' AND "baseCardId" IS NULL
    ), target AS (
      SELECT id, old, rank, CASE ${cases} ELSE 'COMMON' END AS new FROM ranked
    )`;
  const diff = await pool.query(`${ranked} SELECT old, new, COUNT(*)::int AS n FROM target WHERE old <> new GROUP BY old, new ORDER BY n DESC`);
  const after = await pool.query(`${ranked} SELECT new AS rarity, COUNT(*)::int AS n FROM target GROUP BY new ORDER BY n DESC`);
  console.log("changements :");
  for (const r of diff.rows) console.log(`  ${r.old.padEnd(11)} → ${r.new.padEnd(11)} ${r.n}`);
  const down = diff.rows.filter((r) => ANIME_DROP_BANDS.findIndex((b) => b.rarity === r.new) < ANIME_DROP_BANDS.findIndex((b) => b.rarity === r.old));
  console.log("descentes (devrait être vide) :", down.length ? down.map((d) => `${d.old}→${d.new} ${d.n}`).join(", ") : "aucune");
  console.log("répartition après :", after.rows.map((r) => `${r.rarity} ${r.n}`).join(" | "));
  if (apply) {
    const res = await pool.query(`${ranked} UPDATE "Card" c SET rarity = t.new::"Rarity" FROM target t WHERE c.id = t.id AND t.old <> t.new`);
    console.log(`appliqué : ${res.rowCount} carte(s) mise(s) à jour`);
    // l'historique des tirages garde la rareté d'origine : on la met en accord avec celle de la carte
    const pulls = await pool.query(
      `UPDATE "Pull" p SET rarity = c.rarity FROM "Card" c
       WHERE c.id = p."cardId" AND c.source = 'ANILIST' AND c."baseCardId" IS NULL AND p.rarity <> c.rarity`,
    );
    console.log(`historique des tirages : ${pulls.rowCount} ligne(s) mise(s) à jour`);
  } else {
    console.log("(simulation : relancez avec --apply pour appliquer)");
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
