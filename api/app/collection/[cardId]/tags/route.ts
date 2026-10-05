import { TAG_MAX_PER_USER } from "@wikideck/shared";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid, readJson, toTagDto } from "@/lib/tags";

type Ctx = { params: Promise<{ cardId: string }> };

export const PUT = withRateLimit<Ctx>(
  "card-tags",
  { limit: 120, windowSec: 60 },
  async (request, { params }) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { cardId } = await params;
    if (!isUuid(cardId)) return Response.json({ error: "not_found" }, { status: 404 });

    const body = await readJson(request);
    const ids = body?.tagIds;
    if (!Array.isArray(ids) || ids.length > TAG_MAX_PER_USER || !ids.every(isUuid)) {
      return Response.json({ error: "invalid" }, { status: 400 });
    }

    const owned = await prisma.userCard.findUnique({
      where: { userId_cardId: { userId: user.id, cardId } },
    });
    if (!owned) return Response.json({ error: "not_found" }, { status: 404 });

    const tags = await prisma.tag.findMany({ where: { userId: user.id, id: { in: ids } } });
    await prisma.userCard.update({
      where: { id: owned.id },
      data: { tags: { set: tags.map((t) => ({ id: t.id })) } },
    });
    return Response.json({ tags: tags.map(toTagDto) });
  },
);
