import { DROP_RARITIES } from "@wikideck/shared";
import type { Rarity } from "@/generated/prisma/client";

const API = "https://fr.wikipedia.org/w/api.php";
const HEADERS = { "User-Agent": "Wikideck/1.0 (https://wikideck.fr)" };

export type WikiCard = {
  pageId: number;
  title: string;
  description: string | null;
  extract: string;
  imageUrl: string | null;
  url: string;
  views: number;
  length: number;
  languages: number;
  rarity: Rarity;
};

export class WikipediaUnavailableError extends Error {
  constructor(detail: string) {
    super(`Wikipédia indisponible : ${detail}`);
  }
}

export function rarityFromViews(views: number): Rarity {
  return DROP_RARITIES.findLast((r) => views >= r.minViews)!.value;
}

const MAX_PARALLEL = 4;
let running = 0;
const waiting: (() => void)[] = [];

async function throttled<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson<T>(url: string, notFoundIsNull?: false): Promise<T>;
async function getJson<T>(url: string, notFoundIsNull: true): Promise<T | null>;
async function getJson<T>(url: string, notFoundIsNull = false): Promise<T | null> {
  let lastError = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await throttled(() => fetch(url, { headers: HEADERS, cache: "no-store" }));
      if (res.ok) return (await res.json()) as T;
      if (res.status === 404 && notFoundIsNull) return null;
      lastError = `HTTP ${res.status}`;
      if (res.status !== 429 && res.status < 500) break;
      const retryAfter = Number(res.headers.get("retry-after"));
      await wait(Math.min(8000, retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt));
    } catch (e) {
      lastError = e instanceof Error ? e.message : "réseau";
      await wait(1000 * 2 ** attempt);
    }
  }
  throw new WikipediaUnavailableError(lastError);
}

type Page = {
  pageid: number;
  title: string;
  extract?: string;
  description?: string;
  length?: number;
  thumbnail?: { source: string };
  pageprops?: { wikibase_item?: string };
};

const query = (params: Record<string, string>) =>
  `${API}?${new URLSearchParams({ action: "query", format: "json", ...params })}`;

const day = (d: Date) => d.toISOString().slice(0, 10).replaceAll("-", "");

async function monthlyViewsOf(title: string): Promise<number> {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 86_400_000);
  const data = await getJson<{ items: { views: number }[] }>(
    `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/fr.wikipedia/all-access/user/${encodeURIComponent(
      title.replaceAll(" ", "_"),
    )}/daily/${day(start)}/${day(end)}`,
    true,
  );
  return data?.items.reduce((sum, i) => sum + i.views, 0) ?? 0;
}

async function monthlyViews(pages: Page[]): Promise<Map<number, number>> {
  const views = new Map<number, number>();
  let missing = pages;
  for (let attempt = 0; attempt < 3 && missing.length; attempt++) {
    if (attempt > 0) await wait(1200);
    const data = await getJson<{
      query?: { pages?: Record<string, { pageviews?: Record<string, number | null> }> };
    }>(
      query({ prop: "pageviews", pvipdays: "30", pageids: missing.map((p) => p.pageid).join("|") }),
    );
    for (const [id, page] of Object.entries(data.query?.pages ?? {})) {
      if (!page.pageviews) continue;
      views.set(
        Number(id),
        Object.values(page.pageviews).reduce<number>((sum, v) => sum + (v ?? 0), 0),
      );
    }
    missing = missing.filter((p) => !views.has(p.pageid));
  }
  await Promise.all(missing.map(async (p) => views.set(p.pageid, await monthlyViewsOf(p.title))));
  return views;
}

async function languageCounts(pageIds: number[]): Promise<Map<number, number>> {
  const counts = new Map(pageIds.map((id) => [id, 1]));
  let cont: Record<string, string> = {};
  for (let round = 0; round < 12; round++) {
    const data = await getJson<{
      continue?: Record<string, string>;
      query?: { pages?: Record<string, { langlinks?: unknown[] }> };
    }>(query({ prop: "langlinks", lllimit: "max", pageids: pageIds.join("|"), ...cont }));
    for (const [id, page] of Object.entries(data.query?.pages ?? {})) {
      counts.set(Number(id), (counts.get(Number(id)) ?? 1) + (page.langlinks?.length ?? 0));
    }
    if (!data.continue) break;
    cont = data.continue;
  }
  return counts;
}

function toCard(page: Page, views: number, languages: number): WikiCard {
  const length = page.length ?? 0;
  return {
    pageId: page.pageid,
    title: page.title,
    description: page.description ?? null,
    extract: page.extract ?? "",
    imageUrl: page.thumbnail?.source ?? null,
    url: `https://fr.wikipedia.org/?curid=${page.pageid}`,
    views,
    length,
    languages,
    rarity: rarityFromViews(views),
  };
}

async function toCards(pages: Page[]): Promise<WikiCard[]> {
  if (!pages.length) return [];
  const ids = pages.map((p) => p.pageid);
  const [views, languages] = await Promise.all([monthlyViews(pages), languageCounts(ids)]);
  return pages.map((p) => toCard(p, views.get(p.pageid) ?? 0, languages.get(p.pageid) ?? 1));
}

export async function drawRandomCards(count: number): Promise<WikiCard[]> {
  const cards: WikiCard[] = [];
  const seen = new Set<number>();

  for (let attempt = 0; attempt < 8 && cards.length < count; attempt++) {
    try {
      const data = await getJson<{ query?: { pages?: Record<string, Page> } }>(
        query({
          generator: "random",
          grnnamespace: "0",
          grnlimit: "20",
          prop: "extracts|pageimages|description|info|pageprops",
          ppprop: "wikibase_item",
          exintro: "1",
          explaintext: "1",
          exsentences: "2",
          exlimit: "max",
          piprop: "thumbnail",
          pithumbsize: "500",
        }),
      );
      const pages = Object.values(data.query?.pages ?? {})
        .filter((p) => p.extract && p.extract.length > 40 && !seen.has(p.pageid))
        .slice(0, count - cards.length);
      pages.forEach((p) => seen.add(p.pageid));
      await addFallbackImages(pages);
      cards.push(...(await toCards(pages)));
    } catch (e) {
      if (e instanceof WikipediaUnavailableError) break;
      throw e;
    }
  }
  return cards;
}

const IMAGE_LANGUAGES = ["en", "de", "es", "it"];

export async function foreignImages(
  entries: { pageId: number; qid: string }[],
): Promise<Map<number, string>> {
  const found = new Map<number, string>();
  if (!entries.length) return found;

  const titles = new Map<string, Record<string, string>>();
  for (let i = 0; i < entries.length; i += 50) {
    const data = await getJson<{
      entities?: Record<string, { sitelinks?: Record<string, { title: string }> }>;
    }>(
      `https://www.wikidata.org/w/api.php?${new URLSearchParams({
        action: "wbgetentities",
        format: "json",
        props: "sitelinks",
        sitefilter: IMAGE_LANGUAGES.map((l) => `${l}wiki`).join("|"),
        ids: entries
          .slice(i, i + 50)
          .map((e) => e.qid)
          .join("|"),
      })}`,
    );
    for (const [qid, entity] of Object.entries(data.entities ?? {})) {
      titles.set(
        qid,
        Object.fromEntries(
          Object.entries(entity.sitelinks ?? {}).map(([wiki, link]) => [wiki, link.title]),
        ),
      );
    }
  }

  for (const lang of IMAGE_LANGUAGES) {
    const todo = entries.filter((e) => !found.has(e.pageId) && titles.get(e.qid)?.[`${lang}wiki`]);
    for (let i = 0; i < todo.length; i += 40) {
      const batch = todo.slice(i, i + 40);
      const names = batch.map((e) => titles.get(e.qid)![`${lang}wiki`]);
      const data = await getJson<{
        query?: {
          redirects?: { from: string; to: string }[];
          pages?: Record<string, { title: string; thumbnail?: { source: string } }>;
        };
      }>(
        `https://${lang}.wikipedia.org/w/api.php?${new URLSearchParams({
          action: "query",
          format: "json",
          redirects: "1",
          prop: "pageimages",
          piprop: "thumbnail",
          pithumbsize: "500",
          titles: names.join("|"),
        })}`,
      );
      const thumbs = new Map(
        Object.values(data.query?.pages ?? {}).map((p) => [p.title, p.thumbnail?.source]),
      );
      const redirects = new Map((data.query?.redirects ?? []).map((r) => [r.from, r.to]));
      batch.forEach((entry, k) => {
        const source = thumbs.get(redirects.get(names[k]) ?? names[k]);
        if (source) found.set(entry.pageId, source);
      });
    }
  }

  // dernier recours : l'image que Wikidata associe à l'élément (Wikimedia Commons)
  const missing = entries.filter((e) => !found.has(e.pageId));
  const wikidata = await wikidataImages(missing.map((e) => e.qid));
  for (const e of missing) {
    const source = wikidata.get(e.qid);
    if (source) found.set(e.pageId, source);
  }
  return found;
}

// du plus au moins représentatif : photo, logo, drapeau, blason, carte de localisation
const WIKIDATA_IMAGE_PROPERTIES = ["P18", "P154", "P41", "P94", "P242"];

async function wikidataImages(qids: string[]): Promise<Map<string, string>> {
  const images = new Map<string, string>();
  for (let i = 0; i < qids.length; i += 50) {
    const batch = qids.slice(i, i + 50).filter((q) => /^Q\d+$/.test(q));
    if (!batch.length) continue;
    const sparql = `SELECT ?item ?prop ?file WHERE {
      VALUES ?item { ${batch.map((q) => `wd:${q}`).join(" ")} }
      VALUES ?prop { ${WIKIDATA_IMAGE_PROPERTIES.map((p) => `wdt:${p}`).join(" ")} }
      ?item ?prop ?file . }`;
    try {
      const data = await getJson<{
        results: { bindings: { item: { value: string }; prop: { value: string }; file: { value: string } }[] };
      }>(`https://query.wikidata.org/sparql?${new URLSearchParams({ query: sparql, format: "json" })}`);
      const best = new Map<string, { rank: number; file: string }>();
      for (const row of data.results.bindings) {
        const qid = row.item.value.split("/").pop()!;
        const rank = WIKIDATA_IMAGE_PROPERTIES.indexOf(row.prop.value.split("/").pop()!);
        if (rank < 0 || (best.get(qid) && best.get(qid)!.rank <= rank)) continue;
        best.set(qid, { rank, file: row.file.value });
      }
      for (const [qid, { file }] of best) {
        // Special:FilePath redirige vers la miniature demandée ; les SVG sont rastérisés
        images.set(qid, `${file.replace(/^http:/, "https:")}?width=500`);
      }
    } catch (e) {
      // l'image est un bonus : on ne bloque jamais l'ouverture d'un paquet pour elle
      if (!(e instanceof WikipediaUnavailableError)) throw e;
    }
  }
  return images;
}

/** Images de remplacement pour des pages déjà connues (voir scripts/backfill-images.ts). */
export async function imagesForPages(pageIds: number[]): Promise<Map<number, string>> {
  const found = new Map<number, string>();
  for (let i = 0; i < pageIds.length; i += 50) {
    const data = await getJson<{ query?: { pages?: Record<string, Page> } }>(
      query({
        prop: "pageimages|pageprops",
        ppprop: "wikibase_item",
        piprop: "thumbnail",
        pithumbsize: "500",
        pageids: pageIds.slice(i, i + 50).join("|"),
      }),
    );
    const pages = Object.values(data.query?.pages ?? {}).filter((p) => p.pageid);
    for (const p of pages) if (p.thumbnail) found.set(p.pageid, p.thumbnail.source);
    const without = pages.filter((p) => !p.thumbnail && p.pageprops?.wikibase_item);
    const fallback = await foreignImages(
      without.map((p) => ({ pageId: p.pageid, qid: p.pageprops!.wikibase_item! })),
    );
    fallback.forEach((url, id) => found.set(id, url));
  }
  return found;
}

async function addFallbackImages(pages: Page[]): Promise<void> {
  const withoutImage = pages.filter((p) => !p.thumbnail && p.pageprops?.wikibase_item);
  const fallback = await foreignImages(
    withoutImage.map((p) => ({ pageId: p.pageid, qid: p.pageprops!.wikibase_item! })),
  );
  for (const p of withoutImage) {
    const source = fallback.get(p.pageid);
    if (source) p.thumbnail = { source };
  }
}

type ResolvedPage = Page & { ns?: number; missing?: string; invalid?: string };

export async function resolveTitles(
  titles: string[],
): Promise<{ cards: WikiCard[]; notFound: number; sources: Map<number, string[]> }> {
  const data = await getJson<{
    query?: {
      normalized?: { from: string; to: string }[];
      redirects?: { from: string; to: string }[];
      pages?: Record<string, ResolvedPage>;
    };
  }>(
    query({
      redirects: "1",
      titles: titles.join("|"),
      prop: "extracts|pageimages|description|info|pageprops",
      ppprop: "wikibase_item",
      exintro: "1",
      explaintext: "1",
      exsentences: "2",
      exlimit: "max",
      piprop: "thumbnail",
      pithumbsize: "500",
    }),
  );
  if (!data.query?.pages) throw new WikipediaUnavailableError("réponse vide");

  const normalized = new Map((data.query.normalized ?? []).map((n) => [n.from, n.to]));
  const redirects = new Map((data.query.redirects ?? []).map((r) => [r.from, r.to]));
  const byTitle = new Map(Object.values(data.query.pages).map((p) => [p.title, p]));

  const found = new Map<number, ResolvedPage>();
  const sources = new Map<number, string[]>();
  let notFound = 0;
  for (const title of titles) {
    const normal = normalized.get(title) ?? title;
    const page = byTitle.get(redirects.get(normal) ?? normal);
    if (!page || page.missing !== undefined || page.invalid !== undefined || page.ns !== 0) {
      notFound++;
    } else {
      found.set(page.pageid, page);
      sources.set(page.pageid, [...(sources.get(page.pageid) ?? []), title]);
    }
  }

  const pages = [...found.values()];
  await addFallbackImages(pages);
  return { cards: await toCards(pages), notFound, sources };
}

export async function refreshStats(pageIds: number[]): Promise<WikiCard[]> {
  const data = await getJson<{ query?: { pages?: Record<string, Page> } }>(
    query({ prop: "info", pageids: pageIds.join("|") }),
  );
  const pages = Object.values(data.query?.pages ?? {}).filter((p) => p.pageid);
  return toCards(pages);
}

export async function cardsFromIds(
  entries: { pageId: number; views: number }[],
): Promise<WikiCard[]> {
  if (!entries.length) return [];
  const views = new Map(entries.map((e) => [e.pageId, e.views]));
  const ids = entries.map((e) => e.pageId);

  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += 20) chunks.push(ids.slice(i, i + 20));
  const results = await Promise.all(
    chunks.map((chunk) =>
      getJson<{ query?: { pages?: Record<string, Page> } }>(
        query({
          prop: "extracts|pageimages|description|info|pageprops",
          ppprop: "wikibase_item",
          exintro: "1",
          explaintext: "1",
          exsentences: "2",
          exlimit: "max",
          piprop: "thumbnail",
          pithumbsize: "500",
          pageids: chunk.join("|"),
        }),
      ),
    ),
  );
  const pages = results
    .flatMap((r) => Object.values(r.query?.pages ?? {}))
    .filter((p) => p.pageid && views.has(p.pageid));

  await addFallbackImages(pages);
  const languages = new Map<number, number>();
  const groups: number[][] = [];
  for (let i = 0; i < pages.length; i += 50) {
    groups.push(pages.slice(i, i + 50).map((p) => p.pageid));
  }
  (await Promise.all(groups.map((g) => languageCounts(g)))).forEach((counts) =>
    counts.forEach((n, id) => languages.set(id, n)),
  );
  return pages.map((p) => toCard(p, views.get(p.pageid) ?? 0, languages.get(p.pageid) ?? 1));
}
