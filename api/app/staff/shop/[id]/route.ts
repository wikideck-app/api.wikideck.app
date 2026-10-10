import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { logStaff, requireStaff } from "@/lib/staff";
import { parseShopInput, toStaffShopItem } from "@/lib/shop";
import { isUuid, readJson } from "@/lib/tags";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = withRateLimit<Ctx>(
  "staff-shop-update",
  { limit: 60, windowSec: 60 },
  async (request, { params }) => {
    const auth = await requireStaff("ADMIN");
    if (auth instanceof Response) return auth;
    const { id } = await params;
    if (!isUuid(id)) return Response.json({ error: "not_found" }, { status: 404 });
    const input = parseShopInput(await readJson(request));
    if (!input) return Response.json({ error: "invalid" }, { status: 400 });
    const exists = await prisma.shopItem.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return Response.json({ error: "not_found" }, { status: 404 });
    const item = await prisma.shopItem.update({ where: { id }, data: input });
    const sold = await prisma.shopPurchase.count({ where: { itemId: id } });
    await logStaff(auth.user, "shop_update", null, { name: item.name, active: item.active });
    return Response.json(toStaffShopItem(item, sold));
  },
);

// supprime l'article ; les achats déjà faits gardent une copie de son nom et de son prix
export const DELETE = withRateLimit<Ctx>(
  "staff-shop-delete",
  { limit: 30, windowSec: 60 },
  async (_request, { params }) => {
    const auth = await requireStaff("ADMIN");
    if (auth instanceof Response) return auth;
    const { id } = await params;
    if (!isUuid(id)) return Response.json({ error: "not_found" }, { status: 404 });
    const item = await prisma.shopItem.findUnique({ where: { id } });
    if (!item) return Response.json({ error: "not_found" }, { status: 404 });
    await prisma.shopItem.delete({ where: { id } });
    await logStaff(auth.user, "shop_delete", null, { name: item.name });
    return new Response(null, { status: 204 });
  },
);
