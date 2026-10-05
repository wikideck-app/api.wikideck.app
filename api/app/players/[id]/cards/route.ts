import {
  COLLECTION_PAGE_SIZE,
  COLLECTION_SEARCH_MAX,
  type CollectionResponse,
} from "@wikideck/shared";
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
    if (!player.isPublic && player.id !== user.id) {
      return Response.json({ error: "private" }, { status: 403 });
    }

    const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, COLLECTION_SEARCH_MAX);
    const where = {
      userId: id,
      ...(q && { card: { title: { contains: q, mode: "insensitive" as const } } }),
    };
    const total = await prisma.userCard.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / COLLECTION_PAGE_SIZE));
    const requested = Number(request.nextUrl.searchParams.get("page"));
    const page = Math.min(totalPages, Math.max(1, Number.isInteger(requested) ? requested : 1));

    const owned = await prisma.userCard.findMany({
      where,
      include: { card: true },
      orderBy: [{ card: { rarity: "desc" } }, { card: { views: "desc" } }, { id: "asc" }],
      skip: (page - 1) * COLLECTION_PAGE_SIZE,
      take: COLLECTION_PAGE_SIZE,
    });
    return Response.json({
      cards: owned.map((o) => ({ ...toCardDto(o.card), quantity: o.quantity, tags: [] })),
      total,
      page,
      pageSize: COLLECTION_PAGE_SIZE,
      totalPages,
      sort: "rarity_desc",
      tag: null,
      favoritesOnly: false,
      rarities: [],
      query: q,
      tags: [],
    } satisfies CollectionResponse);
  },
);
