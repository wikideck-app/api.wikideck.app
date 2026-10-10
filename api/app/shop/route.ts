import type { ShopResponse } from "@wikideck/shared";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { parisDayStart } from "@/lib/day";
import { toShopItemDto } from "@/lib/shop";

export const GET = withRateLimit("shop-list", { limit: 60, windowSec: 60 }, async () => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const [items, bought, boughtToday] = await Promise.all([
    prisma.shopItem.findMany({
      where: {
        active: true,
        AND: [
          { OR: [{ availableFrom: null }, { availableFrom: { lte: new Date() } }] },
          { OR: [{ availableUntil: null }, { availableUntil: { gt: new Date() } }] },
        ],
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    prisma.shopPurchase.groupBy({
      by: ["itemId"],
      where: { userId: user.id, itemId: { not: null } },
      _count: true,
    }),
    prisma.shopPurchase.groupBy({
      by: ["itemId"],
      where: { userId: user.id, itemId: { not: null }, createdAt: { gte: parisDayStart() } },
      _count: true,
    }),
  ]);
  const count = new Map(bought.map((b) => [b.itemId, b._count]));
  const today = new Map(boughtToday.map((b) => [b.itemId, b._count]));
  return Response.json({
    items: items.map((i) => toShopItemDto(i, count.get(i.id) ?? 0, today.get(i.id) ?? 0)),
    wikibits: user.wikibits,
  } satisfies ShopResponse);
});
