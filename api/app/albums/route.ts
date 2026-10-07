import {
  ALBUM_MAX_PER_USER,
  ALBUM_NAME_MAX,
  type AlbumSummary,
  type AlbumsResponse,
} from "@wikideck/shared";
import { Prisma } from "@/generated/prisma/client";
import { highlightsOf, parseAlbumName, pruneAlbums } from "@/lib/albums";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid, readJson } from "@/lib/tags";

export const GET = withRateLimit("albums-list", { limit: 60, windowSec: 60 }, async (request) => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  await pruneAlbums(user.id);

  const cardParam = request.nextUrl.searchParams.get("card");
  const card = isUuid(cardParam) ? cardParam : null;
  const albums = await prisma.album.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { cards: true } } },
  });
  const withCard = card
    ? new Set(
        (
          await prisma.albumCard.findMany({
            where: { cardId: card, albumId: { in: albums.map((a) => a.id) } },
            select: { albumId: true },
          })
        ).map((r) => r.albumId),
      )
    : null;
  const summaries: AlbumSummary[] = await Promise.all(
    albums.map(async (a) => ({
      id: a.id,
      name: a.name,
      cards: a._count.cards,
      top: await highlightsOf(user.id, a.id),
      ...(withCard && { hasCard: withCard.has(a.id) }),
      updatedAt: a.updatedAt.toISOString(),
    })),
  );
  return Response.json({ albums: summaries, max: ALBUM_MAX_PER_USER } satisfies AlbumsResponse);
});

export const POST = withRateLimit(
  "albums-create",
  { limit: 20, windowSec: 60 },
  async (request) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const name = parseAlbumName((await readJson(request))?.name);
    if (!name)
      return Response.json({ error: "invalid_name", max: ALBUM_NAME_MAX }, { status: 400 });
    if ((await prisma.album.count({ where: { userId: user.id } })) >= ALBUM_MAX_PER_USER)
      return Response.json({ error: "too_many_albums" }, { status: 403 });
    try {
      const album = await prisma.album.create({ data: { userId: user.id, name } });
      return Response.json({ id: album.id, name: album.name }, { status: 201 });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
        return Response.json({ error: "album_exists" }, { status: 409 });
      throw e;
    }
  },
);
