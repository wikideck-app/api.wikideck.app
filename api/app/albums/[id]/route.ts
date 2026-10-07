import { RARITIES, type AlbumResponse, type Rarity } from "@wikideck/shared";
import { Prisma } from "@/generated/prisma/client";
import {
  BEST_FIRST,
  PAGE,
  albumOf,
  clampPage,
  highlightsOf,
  parseAlbumName,
  pruneAlbums,
  rarityFilter,
  textFilter,
  toCollectionCard,
} from "@/lib/albums";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid, readJson } from "@/lib/tags";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withRateLimit<Ctx>(
  "album-get",
  { limit: 90, windowSec: 60 },
  async (request, { params }) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!isUuid(id)) return Response.json({ error: "not_found" }, { status: 404 });
    const album = await albumOf(user.id, id);
    if (!album) return Response.json({ error: "not_found" }, { status: 404 });
    await pruneAlbums(user.id);

    const sp = request.nextUrl.searchParams;
    const query = (sp.get("q") ?? "").trim().slice(0, 100);
    const rarities = rarityFilter(sp.get("rarity"));
    const inAlbum: Prisma.CardWhereInput = { albumCards: { some: { albumId: id } } };
    const where: Prisma.UserCardWhereInput = {
      userId: user.id,
      card: {
        AND: [
          inAlbum,
          ...(rarities.length ? [{ rarity: { in: rarities } }] : []),
          ...textFilter(query),
        ],
      },
    };

    const [count, total, byRarity, highlights] = await Promise.all([
      prisma.userCard.count({ where: { userId: user.id, card: inAlbum } }),
      prisma.userCard.count({ where }),
      prisma.userCard.findMany({
        where: { userId: user.id, card: inAlbum },
        select: { card: { select: { rarity: true } } },
      }),
      highlightsOf(user.id, id),
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
    const tally = new Map<Rarity, number>();
    for (const r of byRarity) tally.set(r.card.rarity, (tally.get(r.card.rarity) ?? 0) + 1);

    return Response.json({
      album: { id: album.id, name: album.name, createdAt: album.createdAt.toISOString() },
      count,
      highlights,
      cards: rows.map((r) => toCollectionCard(r, true)),
      total,
      page,
      pageSize: PAGE,
      totalPages,
      rarities,
      query,
      counts: [...RARITIES]
        .reverse()
        .map((r) => ({ rarity: r.value, count: tally.get(r.value) ?? 0 })),
    } satisfies AlbumResponse);
  },
);

export const PATCH = withRateLimit<Ctx>(
  "album-rename",
  { limit: 30, windowSec: 60 },
  async (request, { params }) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!isUuid(id) || !(await albumOf(user.id, id)))
      return Response.json({ error: "not_found" }, { status: 404 });
    const name = parseAlbumName((await readJson(request))?.name);
    if (!name) return Response.json({ error: "invalid_name" }, { status: 400 });
    try {
      await prisma.album.update({ where: { id }, data: { name } });
      return Response.json({ id, name });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
        return Response.json({ error: "album_exists" }, { status: 409 });
      throw e;
    }
  },
);

export const DELETE = withRateLimit<Ctx>(
  "album-delete",
  { limit: 30, windowSec: 60 },
  async (_request, { params }) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!isUuid(id)) return Response.json({ error: "not_found" }, { status: 404 });
    const gone = await prisma.album.deleteMany({ where: { id, userId: user.id } });
    if (gone.count === 0) return Response.json({ error: "not_found" }, { status: 404 });
    return new Response(null, { status: 204 });
  },
);
