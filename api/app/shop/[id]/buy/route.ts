import { WISHLIST_EXTRA_MAX, type ShopBuyResponse } from "@wikideck/shared";
import { parisDayStart } from "@/lib/day";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { grantOf, isOnSale, toShopItemDto } from "@/lib/shop";
import { isUuid } from "@/lib/tags";
import { transactionBlock } from "@/lib/trust";

type Ctx = { params: Promise<{ id: string }> };

class ShopError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}

export const POST = withRateLimit<Ctx>(
  "shop-buy",
  { limit: 20, windowSec: 60 },
  async (_request, { params }) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const blocked = await transactionBlock(user);
    if (blocked) return Response.json({ error: blocked }, { status: 403 });
    const { id } = await params;
    if (!isUuid(id)) return Response.json({ error: "not_found" }, { status: 404 });

    try {
      const result = await prisma.$transaction(async (tx) => {
        // verrou sur le joueur : deux achats simultanés ne peuvent pas dépasser la limite par joueur
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id}::uuid FOR UPDATE`;
        const item = await tx.shopItem.findUnique({ where: { id } });
        if (!item || !item.active) throw new ShopError("not_found", 404);
        // offre à durée limitée : pas encore ouverte ou terminée
        if (!isOnSale(item)) throw new ShopError("shop_unavailable", 409);

        const purchased = await tx.shopPurchase.count({ where: { userId: user.id, itemId: id } });
        if (item.maxPerUser !== null && purchased >= item.maxPerUser)
          throw new ShopError("shop_limit_reached", 409);

        const purchasedToday = await tx.shopPurchase.count({
          where: { userId: user.id, itemId: id, createdAt: { gte: parisDayStart() } },
        });
        if (item.maxPerUserPerDay !== null && purchasedToday >= item.maxPerUserPerDay)
          throw new ShopError("shop_daily_limit_reached", 409);

        if (item.stock !== null) {
          const taken = await tx.shopItem.updateMany({
            where: { id, stock: { gt: 0 } },
            data: { stock: { decrement: 1 } },
          });
          if (taken.count === 0) throw new ShopError("shop_sold_out", 409);
        }

        const current = await tx.user.findUniqueOrThrow({
          where: { id: user.id },
          select: { dupReduceUntil: true, wishlistSlots: true },
        });
        // la liste d'envies ne grandit pas à l'infini
        if (item.kind === "WISHLIST_SLOT" && current.wishlistSlots + item.amount > WISHLIST_EXTRA_MAX)
          throw new ShopError("shop_wishlist_full", 409);
        const paid = await tx.user.updateMany({
          where: { id: user.id, wikibits: { gte: item.price } },
          data: {
            wikibits: { decrement: item.price },
            ...grantOf(item.kind, item.amount, current.dupReduceUntil),
          },
        });
        if (paid.count === 0) throw new ShopError("insufficient_funds", 409);

        await tx.shopPurchase.create({
          data: {
            userId: user.id,
            itemId: id,
            itemName: item.name,
            kind: item.kind,
            amount: item.amount,
            price: item.price,
          },
        });
        const [fresh, me] = await Promise.all([
          tx.shopItem.findUniqueOrThrow({ where: { id } }),
          tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { wikibits: true } }),
        ]);
        return { item: toShopItemDto(fresh, purchased + 1, purchasedToday + 1), wikibits: me.wikibits };
      });
      return Response.json(result satisfies ShopBuyResponse);
    } catch (e) {
      if (e instanceof ShopError) return Response.json({ error: e.code }, { status: e.status });
      throw e;
    }
  },
);
