import { ALBUM_CARDS_MAX, type AlbumCandidatesResponse } from "@wikideck/shared";
import { Prisma } from "@/generated/prisma/client";
import {
  BEST_FIRST,
  PAGE,
  albumOf,
  clampPage,
  rarityFilter,
  textFilter,
  toCollectionCard,
} from "@/lib/albums";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid } from "@/lib/tags";

type Ctx = { params: Promise<{ id: string }> };

// mes cartes qui ne sont pas encore dans cet album, pour les y ajouter
export const GET = withRateLimit<Ctx>(
  "album-candidates",
  { limit: 90, windowSec: 60 },
  async (request, { params }) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!isUuid(id) || !(await albumOf(user.id, id)))
      return Response.json({ error: "not_found" }, { status: 404 });
    const sp = request.nextUrl.searchParams;
    const rarities = rarityFilter(sp.get("rarity"));
    const where: Prisma.UserCardWhereInput = {
      userId: user.id,
      card: {
        AND: [
          { albumCards: { none: { albumId: id } } },
          ...(rarities.length ? [{ rarity: { in: rarities } }] : []),
          ...textFilter((sp.get("q") ?? "").trim().slice(0, 100)),
        ],
      },
    };
    const [total, inAlbum] = await Promise.all([
      prisma.userCard.count({ where }),
      prisma.albumCard.count({ where: { albumId: id } }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / PAGE));
    const page = clampPage(sp.get("page"), totalPages);
    const rows = await prisma.userCard.findMany({
      where,
      include: { card: true },
      orderBy: BEST_FIRST,
      skip: (page - 1) * PAGE,
      take: PAGE,
    });
    return Response.json({
      cards: rows.map((r) => toCollectionCard(r)),
      total,
      page,
      totalPages,
      room: Math.max(0, ALBUM_CARDS_MAX - inAlbum),
    } satisfies AlbumCandidatesResponse);
  },
);
