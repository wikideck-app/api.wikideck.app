import {
  CATALOG_OWNERSHIP,
  CATALOG_SORTS,
  COLLECTION_PAGE_SIZE,
  COLLECTION_SEARCH_MAX,
  RARITIES,
  type CatalogCard,
  type CatalogResponse,
  type CatalogSort,
} from "@wikideck/shared";
import { Prisma, type Rarity } from "@/generated/prisma/client";
import { rarityCounts } from "@/lib/catalog";
import { toCardDto } from "@/lib/cards";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { WikipediaUnavailableError, cardsFromIds } from "@/lib/wikipedia";

const ORDER: Record<CatalogSort, Prisma.Sql> = {
  rarity_desc: Prisma.sql`a.views DESC, a."pageId" ASC`,
  rarity_asc: Prisma.sql`a.views ASC, a."pageId" ASC`,
  alpha: Prisma.sql`a.title ASC, a."pageId" ASC`,
};

type Row = { pageId: number; title: string; views: number; rarity: Rarity; cardId: string | null };

export const GET = withRateLimit("cards-catalog", { limit: 60, windowSec: 60 }, async (request) => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const sort = CATALOG_SORTS.find((s) => s.value === params.get("sort"))?.value ?? "rarity_desc";
  const ownership = CATALOG_OWNERSHIP.find((o) => o.value === params.get("show"))?.value ?? "all";
  const query = (params.get("q") ?? "").trim().slice(0, COLLECTION_SEARCH_MAX);
  const rarities = RARITIES.filter((r) =>
    (params.get("rarity") ?? "").split(",").includes(r.code),
  ).map((r) => r.value);

  const counts = await rarityCounts();
  const catalog = [...counts.values()].reduce((a, b) => a + b, 0);

  const needsJoin = ownership !== "all";
  const where: Prisma.Sql[] = [];
  if (rarities.length) where.push(Prisma.sql`a.rarity = ANY(${rarities}::"Rarity"[])`);
  if (query) {
    const like = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    where.push(Prisma.sql`a.title ILIKE ${like}`);
  }
  if (ownership === "mine") where.push(Prisma.sql`uc."cardId" IS NOT NULL`);
  if (ownership === "missing") where.push(Prisma.sql`uc."cardId" IS NULL`);
  if (ownership === "drawn")
    where.push(
      Prisma.sql`(EXISTS (SELECT 1 FROM "UserCard" o WHERE o."cardId" = c.id) OR EXISTS (SELECT 1 FROM "Pull" p WHERE p."cardId" = c.id))`,
    );
  const whereSql = where.length ? Prisma.sql`WHERE ${Prisma.join(where, " AND ")}` : Prisma.empty;
  const from = needsJoin
    ? Prisma.sql`FROM "WikiArticle" a
        LEFT JOIN "Card" c ON c."pageId" = a."pageId"
        LEFT JOIN "UserCard" uc ON uc."cardId" = c.id AND uc."userId" = ${user.id}::uuid`
    : Prisma.sql`FROM "WikiArticle" a`;

  let total: number;
  if (!query && !needsJoin) {
    total = rarities.length ? rarities.reduce((sum, r) => sum + (counts.get(r) ?? 0), 0) : catalog;
  } else {
    const [{ n }] = await prisma.$queryRaw<
      { n: bigint }[]
    >`SELECT count(*) AS n ${from} ${whereSql}`;
    total = Number(n);
  }

  const pageSize = COLLECTION_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const requested = Number(params.get("page"));
  const page = Math.min(totalPages, Math.max(1, Number.isInteger(requested) ? requested : 1));

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT a."pageId", a.title, a.views, a.rarity, ${needsJoin ? Prisma.sql`c.id` : Prisma.sql`NULL`}::uuid AS "cardId"
    ${from} ${whereSql}
    ORDER BY ${ORDER[sort]}
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;

  const known = await prisma.card.findMany({
    where: { pageId: { in: rows.map((r) => r.pageId) } },
  });
  const byPage = new Map(known.map((c) => [c.pageId, c]));
  const missing = rows.filter((r) => !byPage.has(r.pageId));
  if (missing.length) {
    try {
      const fresh = await cardsFromIds(missing.map((r) => ({ pageId: r.pageId, views: r.views })));
      await prisma.card.createMany({ data: fresh, skipDuplicates: true });
      const created = await prisma.card.findMany({
        where: { pageId: { in: fresh.map((c) => c.pageId) } },
      });
      created.forEach((c) => byPage.set(c.pageId, c));
    } catch (e) {
      if (e instanceof WikipediaUnavailableError)
        return Response.json({ error: "wikipedia_unavailable" }, { status: 502 });
      throw e;
    }
  }

  const cardIds = [...byPage.values()].map((c) => c.id);
  const [owners, mine, owned] = await Promise.all([
    prisma.userCard.groupBy({ by: ["cardId"], where: { cardId: { in: cardIds } }, _count: true }),
    prisma.userCard.findMany({
      where: { userId: user.id, cardId: { in: cardIds } },
      select: { cardId: true, quantity: true },
    }),
    prisma.userCard.count({ where: { userId: user.id } }),
  ]);
  const ownerCount = new Map(owners.map((o) => [o.cardId, o._count]));
  const quantity = new Map(mine.map((m) => [m.cardId, m.quantity]));

  const cards: CatalogCard[] = rows.flatMap((r) => {
    const card = byPage.get(r.pageId);
    return card
      ? [
          {
            ...toCardDto(card),
            owners: ownerCount.get(card.id) ?? 0,
            mine: quantity.get(card.id) ?? 0,
          },
        ]
      : [];
  });

  return Response.json({
    cards,
    total,
    page,
    pageSize,
    totalPages,
    sort,
    ownership,
    rarities,
    query,
    counts: [...RARITIES]
      .reverse()
      .map((r) => ({ rarity: r.value, count: counts.get(r.value) ?? 0 })),
    catalog,
    owned,
  } satisfies CatalogResponse);
});
