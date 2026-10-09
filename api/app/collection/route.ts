import {
  COLLECTION_PAGE_SIZE,
  DEFAULT_SORT_TO_COLLECTION,
  normalizeSettings,
  COLLECTION_SEARCH_MAX,
  RARITIES,
  COLLECTION_SORTS,
  type CollectionResponse,
  type CollectionSort,
  type PackKind,
} from "@wikideck/shared";
import type { Prisma } from "@/generated/prisma/client";
import { textFilter } from "@/lib/albums";
import { loadProtection, protectionReason } from "@/lib/bulk-recycle";
import { toCardDto } from "@/lib/cards";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid, toTagDto } from "@/lib/tags";

const ORDER: Record<CollectionSort, Prisma.UserCardOrderByWithRelationInput[]> = {
  recent: [{ createdAt: "desc" }, { id: "asc" }],
  oldest: [{ createdAt: "asc" }, { id: "asc" }],
  rarity_desc: [{ card: { rarity: "desc" } }, { card: { views: "desc" } }, { id: "asc" }],
  rarity_asc: [{ card: { rarity: "asc" } }, { card: { views: "asc" } }, { id: "asc" }],
  alpha: [{ card: { title: "asc" } }, { id: "asc" }],
};

export const GET = withRateLimit("collection", { limit: 60, windowSec: 60 }, async (request) => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const sortParam = params.get("sort");
  const sort =
    COLLECTION_SORTS.find((s) => s.value === sortParam)?.value ??
    DEFAULT_SORT_TO_COLLECTION[normalizeSettings(user.settings).collection.defaultSort];
  const tagParam = params.get("tag");
  const tag = isUuid(tagParam) ? tagParam : null;

  const query = (params.get("q") ?? "").trim().slice(0, COLLECTION_SEARCH_MAX);

  const rarities = RARITIES.filter((r) =>
    (params.get("rarity") ?? "").split(",").includes(r.code),
  ).map((r) => r.value);

  // sans paramètre : toutes les cartes (les sélecteurs d'échange, de vente... en ont besoin)
  const sourceParam = params.get("source");
  const source: PackKind | null =
    sourceParam === "anime" || sourceParam === "wikipedia" ? sourceParam : null;

  const favoritesOnly = params.get("fav") === "1";
  const where: Prisma.UserCardWhereInput = {
    userId: user.id,
    ...(favoritesOnly && { favorite: true }),
    // chaque mot doit se trouver dans le titre ou le sous-titre de l'article
    ...((rarities.length || query || source) && {
      card: {
        ...(rarities.length && { rarity: { in: rarities } }),
        ...(query && { AND: textFilter(query) }),
        ...(source && { source: source === "anime" ? "ANILIST" : "WIKIPEDIA" }),
      },
    }),
    ...(tag && { tags: { some: { id: tag, userId: user.id } } }),
  };

  const pageSize = COLLECTION_PAGE_SIZE;
  const [total, wikipediaCount, animeCount, tags] = await Promise.all([
    prisma.userCard.count({ where }),
    prisma.userCard.count({ where: { userId: user.id, card: { source: "WIKIPEDIA" } } }),
    prisma.userCard.count({ where: { userId: user.id, card: { source: "ANILIST" } } }),
    prisma.tag.findMany({
      where: { userId: user.id },
      orderBy: { name: "asc" },
      include: { _count: { select: { userCards: true } } },
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const requested = Number(params.get("page"));
  const page = Math.min(totalPages, Math.max(1, Number.isInteger(requested) ? requested : 1));

  const owned = await prisma.userCard.findMany({
    where,
    include: { card: true, tags: { orderBy: { name: "asc" } } },
    orderBy: ORDER[sort],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  const [protection, sales, inAlbums] = await Promise.all([
    loadProtection(user.id),
    prisma.auction.findMany({
      where: {
        cardId: { in: owned.map((o) => o.cardId) },
        status: "SOLD",
        currentBid: { not: null },
      },
      orderBy: { settledAt: "desc" },
      select: { cardId: true, currentBid: true },
      take: Math.max(1, owned.length) * 6,
    }),
    prisma.albumCard.findMany({
      where: { cardId: { in: owned.map((o) => o.cardId) }, album: { userId: user.id } },
      select: { cardId: true },
      distinct: ["cardId"],
    }),
  ]);
  const albumed = new Set(inAlbums.map((a) => a.cardId));
  const recent = new Map<string, number[]>();
  for (const s of sales) {
    const list = recent.get(s.cardId) ?? [];
    if (list.length < 3 && s.currentBid !== null) list.push(s.currentBid);
    recent.set(s.cardId, list);
  }
  const estimateOf = (cardId: string) => {
    const prices = recent.get(cardId);
    return prices?.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null;
  };

  return Response.json({
    favoritesOnly,
    cards: owned.map((o) => ({
      ...toCardDto(o.card),
      quantity: o.quantity,
      favorite: o.favorite,
      inAlbum: albumed.has(o.cardId),
      tags: o.tags.map(toTagDto),
      protectedReason:
        protectionReason(protection, {
          id: o.cardId,
          title: o.card.title,
          tagNames: o.tags.map((t) => t.name),
        })?.label ?? null,
      estimate: estimateOf(o.cardId),
    })),
    total,
    page,
    pageSize,
    totalPages,
    sort,
    tag,
    rarities,
    query,
    source,
    sourceCounts: { wikipedia: wikipediaCount, anime: animeCount },
    tags: tags.map((t) => ({ ...toTagDto(t), count: t._count.userCards })),
  } satisfies CollectionResponse);
});
