import {
  ALBUM_MAX_DEPTH,
  ALBUM_FREE_PER_USER,
  ALBUM_MAX_PER_USER,
  ALBUM_NAME_MAX,
  type AlbumsResponse,
} from "@wikideck/shared";
import { Prisma } from "@/generated/prisma/client";
import {
  depthOf,
  fitsDepth,
  loadTree,
  parseAlbumName,
  pruneAlbums,
  summariesOf,
} from "@/lib/albums";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid, readJson } from "@/lib/tags";

// nombre d'albums (sous-albums compris) que le joueur peut avoir : gratuits + emplacements achetés
const albumLimit = (user: { albumSlots: number }) =>
  Math.min(ALBUM_MAX_PER_USER, ALBUM_FREE_PER_USER + user.albumSlots);

export const GET = withRateLimit("albums-list", { limit: 60, windowSec: 60 }, async (request) => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  await pruneAlbums(user.id);

  const cardParam = request.nextUrl.searchParams.get("card");
  const card = isUuid(cardParam) ? cardParam : null;
  // tous les albums, sous-albums compris : le sélecteur d'une carte en a besoin ; la page des
  // albums n'affiche que ceux du premier niveau et leurs couvertures
  const tree = await loadTree(user.id);
  const withCard = card
    ? new Set(
        (
          await prisma.albumCard.findMany({
            where: { cardId: card, albumId: { in: tree.map((a) => a.id) } },
            select: { albumId: true },
          })
        ).map((r) => r.albumId),
      )
    : null;
  const roots = new Set(tree.filter((a) => a.parentId === null).map((a) => a.id));
  const [rootSummaries, otherSummaries] = await Promise.all([
    summariesOf(user.id, tree, [...roots], { withCard }),
    summariesOf(
      user.id,
      tree,
      tree.filter((a) => !roots.has(a.id)).map((a) => a.id),
      { withTop: false, withCard },
    ),
  ]);
  const summaries = [...rootSummaries, ...otherSummaries];
  return Response.json({ albums: summaries, max: albumLimit(user) } satisfies AlbumsResponse);
});

export const POST = withRateLimit(
  "albums-create",
  { limit: 20, windowSec: 60 },
  async (request) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const body = await readJson(request);
    const name = parseAlbumName(body?.name);
    if (!name)
      return Response.json({ error: "invalid_name", max: ALBUM_NAME_MAX }, { status: 400 });
    const parentId = body?.parentId ?? null;
    if (parentId !== null && !isUuid(parentId))
      return Response.json({ error: "not_found" }, { status: 404 });
    const tree = await loadTree(user.id);
    if (tree.length >= albumLimit(user))
      return Response.json({ error: "too_many_albums" }, { status: 403 });
    if (parentId !== null) {
      if (!tree.some((a) => a.id === parentId))
        return Response.json({ error: "not_found" }, { status: 404 });
      if (!fitsDepth(depthOf(tree, parentId)))
        return Response.json({ error: "album_too_deep", max: ALBUM_MAX_DEPTH }, { status: 409 });
    }
    try {
      const album = await prisma.album.create({ data: { userId: user.id, name, parentId } });
      if (parentId) await prisma.album.update({ where: { id: parentId }, data: { updatedAt: new Date() } });
      return Response.json({ id: album.id, name: album.name, parentId }, { status: 201 });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
        return Response.json({ error: "album_exists" }, { status: 409 });
      throw e;
    }
  },
);
