import { PACK_SHARE_MAX_PER_DAY, type CreatePackShareResponse, type PackShareCard } from "@wikideck/shared";
import { toCardDto } from "@/lib/cards";
import { newShareId } from "@/lib/pack-share";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid, readJson } from "@/lib/tags";

// crée le lien public d'un tirage : { cardIds: string[] (5 au plus), newIds?: string[] } -> { id }
export const POST = withRateLimit("packs-share", { limit: 10, windowSec: 60 }, async (request) => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await readJson(request);
  const ids = body?.cardIds;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 5 || !ids.every(isUuid) || new Set(ids).size !== ids.length)
    return Response.json({ error: "invalid" }, { status: 400 });
  const fresh = new Set<string>(Array.isArray(body?.newIds) ? body.newIds.filter(isUuid) : []);

  // seules les cartes que le joueur possède
  const owned = await prisma.card.findMany({
    where: { id: { in: ids }, owners: { some: { userId: user.id } } },
  });
  const byId = new Map(owned.map((c) => [c.id, c]));
  const cards: PackShareCard[] = ids.flatMap((id) => {
    const c = byId.get(id);
    return c ? [{ ...toCardDto(c), isNew: fresh.has(c.id) }] : [];
  });
  if (cards.length === 0) return Response.json({ error: "not_found" }, { status: 404 });

  // le même tirage partagé deux fois garde le même lien
  const key = cards.map((c) => c.id).sort().join(",");
  const existing = await prisma.packShare.findFirst({ where: { userId: user.id, key }, select: { id: true } });
  if (existing) return Response.json({ id: existing.id } satisfies CreatePackShareResponse);

  const today = await prisma.packShare.count({
    where: { userId: user.id, createdAt: { gte: new Date(Date.now() - 86_400_000) } },
  });
  if (today >= PACK_SHARE_MAX_PER_DAY) return Response.json({ error: "too_many_shares" }, { status: 429 });

  const share = await prisma.packShare.create({
    data: {
      id: newShareId(),
      userId: user.id,
      key,
      // le pseudo n'est affiché que pour un profil public
      ownerName: user.isPublic ? user.username : null,
      cards,
    },
    select: { id: true },
  });
  return Response.json({ id: share.id } satisfies CreatePackShareResponse, { status: 201 });
});
