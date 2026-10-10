import { WISHLIST_MAX, type WishlistCard, type WishlistResponse } from "@wikideck/shared";
import { toCardDto } from "@/lib/cards";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid, readJson } from "@/lib/tags";

export const GET = withRateLimit("wishlist-get", { limit: 60, windowSec: 60 }, async () => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const items = await prisma.wishlistItem.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: { card: true },
  });
  const owned = await prisma.userCard.findMany({
    where: { userId: user.id, cardId: { in: items.map((i) => i.cardId) } },
    select: { cardId: true, quantity: true },
  });
  const quantity = new Map(owned.map((o) => [o.cardId, o.quantity]));
  const cards: WishlistCard[] = items.map((i) => ({
    ...toCardDto(i.card),
    quantity: quantity.get(i.cardId) ?? 0,
    addedAt: i.createdAt.toISOString(),
  }));
  return Response.json({
    cards,
    max: WISHLIST_MAX + user.wishlistSlots,
  } satisfies WishlistResponse);
});

export const POST = withRateLimit("wishlist-add", { limit: 60, windowSec: 60 }, async (request) => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await readJson(request);
  const cardId = body?.cardId;
  if (!isUuid(cardId)) return Response.json({ error: "invalid" }, { status: 400 });
  if (!(await prisma.card.findUnique({ where: { id: cardId }, select: { id: true } })))
    return Response.json({ error: "not_found" }, { status: 404 });

  const exists = await prisma.wishlistItem.findUnique({
    where: { userId_cardId: { userId: user.id, cardId } },
    select: { id: true },
  });
  if (!exists) {
    if (
      (await prisma.wishlistItem.count({ where: { userId: user.id } })) >=
      WISHLIST_MAX + user.wishlistSlots
    )
      return Response.json({ error: "wishlist_full" }, { status: 409 });
    await prisma.wishlistItem
      .create({ data: { userId: user.id, cardId } })
      .catch((e: { code?: string }) => {
        // deux requêtes en même temps : la contrainte unique ne garde qu'une ligne
        if (e.code !== "P2002") throw e;
      });
  }
  return Response.json({ ok: true }, { status: 201 });
});
