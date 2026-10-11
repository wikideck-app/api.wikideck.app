import { ALBUM_HIGHLIGHTS } from "@wikideck/shared";
import { albumOf } from "@/lib/albums";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid, readJson } from "@/lib/tags";

type Ctx = { params: Promise<{ id: string }> };

// choisit les pièces maîtresses de l'album : { cardIds: cardId[] } (vide : retour à la sélection automatique)
export const PUT = withRateLimit<Ctx>(
  "album-highlights",
  { limit: 60, windowSec: 60 },
  async (request, { params }) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!isUuid(id) || !(await albumOf(user.id, id)))
      return Response.json({ error: "not_found" }, { status: 404 });
    const body = await readJson(request);
    const raw = body?.cardIds;
    if (!Array.isArray(raw) || raw.length > ALBUM_HIGHLIGHTS || !raw.every((x) => isUuid(x)))
      return Response.json({ error: "invalid" }, { status: 400 });
    const cardIds = [...new Set(raw as string[])];

    if (cardIds.length) {
      const inAlbum = await prisma.albumCard.count({ where: { albumId: id, cardId: { in: cardIds } } });
      if (inAlbum !== cardIds.length) return Response.json({ error: "not_found" }, { status: 400 });
    }
    const now = Date.now();
    await prisma.$transaction([
      prisma.albumCard.updateMany({ where: { albumId: id }, data: { highlightedAt: null } }),
      ...cardIds.map((cardId, i) =>
        prisma.albumCard.update({
          where: { albumId_cardId: { albumId: id, cardId } },
          data: { highlightedAt: new Date(now + i) },
        }),
      ),
      prisma.album.update({ where: { id }, data: { updatedAt: new Date() } }),
    ]);
    return Response.json({ cardIds });
  },
);
