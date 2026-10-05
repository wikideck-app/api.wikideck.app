import "dotenv/config";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { Pool } from "pg";
import { RARITIES } from "@wikideck/shared";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2)
  args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);

const MIRROR = args.get("mirror") ?? "https://ftp.acc.umu.se/mirror/wikimedia.org";
const LIMIT = Number(args.get("limit") ?? 0) || Infinity;
const BATCH = 5000;

function defaultMonth() {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}
const MONTH = args.get("month") ?? defaultMonth();
const compact = MONTH.replace("-", "");

const log = (msg: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

const ordered = [...RARITIES].sort((a, b) => b.minViews - a.minViews);
const rarityOf = (views: number) => ordered.find((r) => views >= r.minViews)!.value;

const cleanTitle = (raw: string) => raw.replace(/\\(.)/g, "$1").replaceAll("_", " ");

async function latestPageDump(): Promise<string> {
  const index = await (await fetch(`${MIRROR}/dumps/frwiki/`)).text();
  const dates = [...index.matchAll(/href="(\d{8})\/"/g)]
    .map((m) => m[1])
    .sort()
    .reverse();
  for (const date of dates) {
    const url = `${MIRROR}/dumps/frwiki/${date}/frwiki-${date}-page.sql.gz`;
    if ((await fetch(url, { method: "HEAD" })).ok) return url;
  }
  throw new Error("Aucun dump « page » trouvé sur le miroir");
}

async function loadArticles(): Promise<Map<number, string>> {
  const url = await latestPageDump();
  log(`Liste des articles : ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Téléchargement impossible (${res.status})`);
  const articles = new Map<number, string>();
  const row = /\((\d+),0,'((?:[^'\\]|\\.)*)',0,/g;
  const decoder = new StringDecoder("utf8");
  let tail = "";
  const stream = Readable.fromWeb(res.body as never).pipe(createGunzip());
  for await (const chunk of stream) {
    const text = tail + decoder.write(chunk as Buffer);
    row.lastIndex = 0;
    let end = 0;
    for (let m = row.exec(text); m; m = row.exec(text)) {
      articles.set(Number(m[1]), cleanTitle(m[2]));
      end = row.lastIndex;
    }
    tail = text.slice(Math.max(end, text.length - 4096));
    if (articles.size >= LIMIT) break;
  }
  log(`${articles.size.toLocaleString("fr-FR")} articles (hors redirections)`);
  return articles;
}

async function loadViews(articles: Map<number, string>): Promise<Map<number, number>> {
  const url = `${MIRROR}/other/pageview_complete/monthly/${MONTH.slice(0, 4)}/${MONTH}/pageviews-${compact}-user.bz2`;
  log(`Vues de ${MONTH} : ${url}`);
  const file = args.get("views-file");
  const pipeline = file
    ? `cat "${file}"`
    : `curl -sS --fail "${url}" | lbzip2 -dc | LC_ALL=C awk '/^fr\\.wikipedia /{f=1;print;next} f{exit}'`;
  const child = spawn("sh", ["-c", pipeline], { stdio: ["ignore", "pipe", "inherit"] });
  const views = new Map<number, number>();
  let lines = 0;
  for await (const line of createInterface({ input: child.stdout })) {
    const parts = line.split(" ");
    if (parts.length < 6) continue;
    const id = Number(parts[2]);
    const total = Number(parts[4]);
    if (!articles.has(id) || !Number.isFinite(total)) continue;
    views.set(id, (views.get(id) ?? 0) + total);
    if (++lines % 2_000_000 === 0) log(`  ${lines.toLocaleString("fr-FR")} lignes lues`);
  }
  log(`${views.size.toLocaleString("fr-FR")} articles avec au moins une vue`);
  return views;
}

async function main() {
  const started = Date.now();
  const articles = await loadArticles();
  const views = await loadViews(articles);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const counts = new Map<string, number>();
  const ids = [...articles.keys()];
  log(`Insertion de ${ids.length.toLocaleString("fr-FR")} articles…`);
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    const rarities = slice.map((id) => rarityOf(views.get(id) ?? 0));
    rarities.forEach((r) => counts.set(r, (counts.get(r) ?? 0) + 1));
    await pool.query(
      `INSERT INTO "WikiArticle" ("pageId", title, views, rarity)
       SELECT * FROM unnest($1::int[], $2::text[], $3::int[], $4::"Rarity"[])
       ON CONFLICT ("pageId") DO UPDATE
         SET title = EXCLUDED.title, views = EXCLUDED.views, rarity = EXCLUDED.rarity`,
      [slice, slice.map((id) => articles.get(id)), slice.map((id) => views.get(id) ?? 0), rarities],
    );
    if ((i / BATCH) % 40 === 0)
      log(
        `  ${Math.min(i + BATCH, ids.length).toLocaleString("fr-FR")} / ${ids.length.toLocaleString("fr-FR")}`,
      );
  }
  await pool.query(`ANALYZE "WikiArticle"`);
  await pool.end();

  log(`Terminé en ${Math.round((Date.now() - started) / 60000)} min. Répartition :`);
  for (const r of [...RARITIES].reverse())
    console.log(`  ${r.code.padEnd(2)} ${(counts.get(r.value) ?? 0).toLocaleString("fr-FR")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
