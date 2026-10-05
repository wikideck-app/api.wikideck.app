import { MarketError, giveCard } from "@/lib/market";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid } from "@/lib/tags";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withRateLimit<Ctx>(
  "market-cancel",
  { limit: 30, windowSec: 60 },
  async (_request, { params }) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!isUuid(id)) return Response.json({ error: "not_found" }, { status: 404 });

    try {
      await prisma.$transaction(async (tx) => {
        const done = await tx.auction.updateMany({
          where: {
            id,
            sellerId: user.id,
            status: "ACTIVE",
            bidCount: 0,
            endsAt: { gt: new Date() },
          },
          data: { status: "CANCELLED", settledAt: new Date() },
        });
        if (done.count === 0) {
          const a = await tx.auction.findFirst({ where: { id, sellerId: user.id } });
          if (!a) throw new MarketError("not_found", 404);
          throw new MarketError(a.bidCount > 0 ? "has_bids" : "ended");
        }
        const a = await tx.auction.findUniqueOrThrow({ where: { id } });
        await giveCard(tx, user.id, a.cardId);
      });
    } catch (e) {
      if (e instanceof MarketError) return Response.json({ error: e.code }, { status: e.status });
      throw e;
    }
    return new Response(null, { status: 204 });
  },
);
