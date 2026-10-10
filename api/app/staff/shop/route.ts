import { SHOP_MAX_ITEMS } from "@wikideck/shared";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { logStaff, requireStaff } from "@/lib/staff";
import { parseShopInput, toStaffShopItem } from "@/lib/shop";
import { readJson } from "@/lib/tags";

export const GET = withRateLimit("staff-shop", { limit: 60, windowSec: 60 }, async () => {
  const auth = await requireStaff("ADMIN");
  if (auth instanceof Response) return auth;
  const [items, sold] = await Promise.all([
    prisma.shopItem.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.shopPurchase.groupBy({ by: ["itemId"], where: { itemId: { not: null } }, _count: true }),
  ]);
  const count = new Map(sold.map((s) => [s.itemId, s._count]));
  return Response.json({ items: items.map((i) => toStaffShopItem(i, count.get(i.id) ?? 0)) });
});

export const POST = withRateLimit(
  "staff-shop-create",
  { limit: 30, windowSec: 60 },
  async (request) => {
    const auth = await requireStaff("ADMIN");
    if (auth instanceof Response) return auth;
    const input = parseShopInput(await readJson(request));
    if (!input) return Response.json({ error: "invalid" }, { status: 400 });
    if ((await prisma.shopItem.count()) >= SHOP_MAX_ITEMS)
      return Response.json({ error: "shop_full" }, { status: 409 });
    const item = await prisma.shopItem.create({ data: input });
    await logStaff(auth.user, "shop_create", null, { name: item.name, price: item.price });
    return Response.json(toStaffShopItem(item, 0), { status: 201 });
  },
);
