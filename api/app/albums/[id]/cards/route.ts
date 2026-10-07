import { ALBUM_ADD_BATCH, ALBUM_CARDS_MAX } from "@wikideck/shared";
import { albumOf } from "@/lib/albums";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid, readJson } from "@/lib/tags";

type Ctx = { params: Promise<{ id: string }> };

const idList = (v: unknown) =>
  v === undefined
    ? []
    : Array.isArray(v) && v.length <= ALBUM_ADD_BATCH && v.every((x) => isUuid(x))
      ? [...new Set(v as string[])]
      : null;

// ajoute et/ou retire des cartes : { add?: cardId[], remove?: cardId[] }
export const PUT = withRateLimit<Ctx>(
  "album-cards",
  { limit: 60, windowSec: 60 },
  async (request, { params }) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!isUuid(id) || !(await albumOf(user.id, id)))
      return Response.json({ error: "not_found" }, { status: 404 });
    const body = await readJson(request);
    const add = idList(body?.add);
    const remove = idList(body?.remove);
    if (add === null || remove === null || add.length + remove.length === 0)
      return Response.json({ error: "invalid" }, { status: 400 });

    if (remove.length)
      await prisma.albumCard.deleteMany({ where: { albumId: id, cardId: { in: remove } } });
    if (add.length) {
      const owned = await prisma.userCard.count({
        where: { userId: user.id, cardId: { in: add } },
      });
      if (owned !== add.length) return Response.json({ error: "not_owned" }, { status: 400 });
      const present = await prisma.albumCard.count({ where: { albumId: id } });
      const already = await prisma.albumCard.count({ where: { albumId: id, cardId: { in: add } } });
      if (present + add.length - already > ALBUM_CARDS_MAX)
        return Response.json({ error: "album_full" }, { status: 409 });
      await prisma.albumCard.createMany({
        data: add.map((cardId) => ({ albumId: id, cardId })),
        skipDuplicates: true,
      });
    }
    await prisma.album.update({ where: { id }, data: { updatedAt: new Date() } });
    return Response.json({ count: await prisma.albumCard.count({ where: { albumId: id } }) });
  },
);
