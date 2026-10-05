import { marketStats } from "@/lib/market";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid } from "@/lib/tags";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withRateLimit<Ctx>(
  "market-stats",
  { limit: 60, windowSec: 60 },
  async (_request, { params }) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!isUuid(id)) return Response.json({ error: "not_found" }, { status: 404 });
    const auction = await prisma.auction.findUnique({ where: { id }, include: { card: true } });
    if (!auction) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json(await marketStats(auction.card.rarity));
  },
);
