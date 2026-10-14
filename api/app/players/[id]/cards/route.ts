import {
  COLLECTION_PAGE_SIZE,
  COLLECTION_SEARCH_MAX,
  COLLECTION_SORTS,
  type CollectionResponse,
} from "@wikideck/shared";
import type { Prisma } from "@/generated/prisma/client";
import { rarityFilter, textFilter } from "@/lib/albums";
import { COLLECTION_ORDER } from "@/lib/card-order";
import { relationsWith } from "@/lib/friends";
import { quantitiesOf } from "@/lib/ownership";
import { toCardDto } from "@/lib/cards";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid } from "@/lib/tags";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withRateLimit<Ctx>(
  "players-cards",
  { limit: 60, windowSec: 60 },
  async (request, { params }) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!isUuid(id)) return Response.json({ error: "not_found" }, { status: 404 });

    const player = await prisma.user.findUnique({ where: { id } });
    if (!player) return Response.json({ error: "not_found" }, { status: 404 });
    // profil privé : seuls ses amis peuvent consulter ses cartes (pour proposer un échange)
    if (!player.isPublic && player.id !== user.id) {
      const relation = await relationsWith(user.id, [player.id]);
      if (relation(player.id) !== "friend")
        return Response.json({ error: "private" }, { status: 403 });
    }

    const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, COLLECTION_SEARCH_MAX);
    // source=wikipedia | anime : une seule des deux collections (absent = toutes)
    const sourceParam = request.nextUrl.searchParams.get("source");
    const source: Prisma.CardWhereInput["source"] | null =
      sourceParam === "anime"
        ? { in: ["ANILIST", "KITSU"] }
        : sourceParam === "wikipedia"
          ? "WIKIPEDIA"
          : null;
    // même recherche que dans sa propre collection : chaque mot dans le titre ou le sous-titre
    const rarities = rarityFilter(request.nextUrl.searchParams.get("rarity"));
    const sortParam = request.nextUrl.searchParams.get("sort");
    const sort = COLLECTION_SORTS.find((s) => s.value === sortParam)?.value ?? "rarity_desc";
    const where: Prisma.UserCardWhereInput = {
      userId: id,
      ...((q || source || rarities.length) && {
        card: {
          ...(q && { AND: textFilter(q) }),
          ...(rarities.length && { rarity: { in: rarities } }),
          ...(source && { source }),
        },
      }),
    };
    const total = await prisma.userCard.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / COLLECTION_PAGE_SIZE));
    const requested = Number(request.nextUrl.searchParams.get("page"));
    const page = Math.min(totalPages, Math.max(1, Number.isInteger(requested) ? requested : 1));

    const owned = await prisma.userCard.findMany({
      where,
      include: { card: true },
      orderBy: COLLECTION_ORDER[sort],
      skip: (page - 1) * COLLECTION_PAGE_SIZE,
      take: COLLECTION_PAGE_SIZE,
    });
    const mine = await quantitiesOf(user.id, owned.map((o) => o.cardId));
    return Response.json({
      cards: owned.map((o) => ({ ...toCardDto(o.card), quantity: o.quantity, viewerOwned: mine.get(o.cardId) ?? 0, tags: [] })),
      total,
      page,
      pageSize: COLLECTION_PAGE_SIZE,
      totalPages,
      sort: "rarity_desc",
      tag: null,
      favoritesOnly: false,
      rarities: [],
      query: q,
      source: null,
      sourceCounts: { wikipedia: 0, anime: 0 },
      tags: [],
    } satisfies CollectionResponse);
  },
);
