import "dotenv/config";
import { Pool } from "pg";
import { imagesForPages } from "../lib/wikipedia";

// Cherche une image (Wikipédia, autres langues, puis Wikidata / Commons) pour les cartes qui n'en ont pas.
// Usage : pnpm images:backfill [--limit 500]
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > 0 ? Number(process.argv[limitArg + 1]) || 500 : 500;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const { rows } = await pool.query<{ pageId: number }>(
    `SELECT "pageId" FROM "Card" WHERE "imageUrl" IS NULL ORDER BY "views" DESC LIMIT $1`,
    [LIMIT],
  );
  console.log(`${rows.length} carte(s) sans image`);

  let updated = 0;
  for (let i = 0; i < rows.length; i += 50) {
    const ids = rows.slice(i, i + 50).map((r) => r.pageId);
    const images = await imagesForPages(ids);
    for (const [pageId, url] of images) {
      await pool.query(`UPDATE "Card" SET "imageUrl" = $1 WHERE "pageId" = $2 AND "imageUrl" IS NULL`, [
        url,
        pageId,
      ]);
      updated++;
    }
    console.log(`${Math.min(i + 50, rows.length)} / ${rows.length} traitées, ${updated} image(s) trouvée(s)`);
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
