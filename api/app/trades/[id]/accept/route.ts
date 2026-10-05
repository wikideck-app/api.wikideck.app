import { checkAchievements } from "@/lib/achievements";
import { Prisma } from "@/generated/prisma/client";
import { notifyUser } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { checkFunnel, transactionBlock } from "@/lib/trust";
import { currentUser } from "@/lib/session";
import { isUuid } from "@/lib/tags";
import { TradeError, expireStale } from "@/lib/trades";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withRateLimit<Ctx>(
  "trades-accept",
  { limit: 20, windowSec: 60 },
  async (_request, { params }) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const blocked = await transactionBlock(user);
    if (blocked) return Response.json({ error: blocked }, { status: 403 });
    const { id } = await params;
    if (!isUuid(id)) return Response.json({ error: "not_found" }, { status: 404 });

    const existing = await prisma.trade.findUnique({ where: { id } });
    if (!existing || existing.recipientId !== user.id) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    if (existing.status === "PENDING" && existing.expiresAt < new Date()) {
      await expireStale(user.id);
      return Response.json({ error: "expired" }, { status: 410 });
    }

    try {
      await prisma.$transaction(
        async (tx) => {
          const trade = await tx.trade.findUnique({ where: { id }, include: { items: true } });
          if (!trade) throw new TradeError("not_found", 404);
          const claimed = await tx.trade.updateMany({
            where: { id, status: "PENDING" },
            data: { status: "ACCEPTED", respondedAt: new Date() },
          });
          if (claimed.count === 0) throw new TradeError("already_resolved", 409);

          for (const item of trade.items) {
            const giver = item.side === "OFFER" ? trade.proposerId : trade.recipientId;
            const taker = item.side === "OFFER" ? trade.recipientId : trade.proposerId;

            const taken = await tx.userCard.updateMany({
              where: { userId: giver, cardId: item.cardId, quantity: { gte: item.quantity } },
              data: { quantity: { decrement: item.quantity } },
            });
            if (taken.count === 0) throw new TradeError("not_available", 409);

            await tx.userCard.deleteMany({
              where: { userId: giver, cardId: item.cardId, quantity: 0 },
            });
            await tx.user.updateMany({
              where: {
                id: giver,
                showcaseCardId: item.cardId,
                cards: { none: { cardId: item.cardId } },
              },
              data: { showcaseCardId: null },
            });

            await tx.userCard.upsert({
              where: { userId_cardId: { userId: taker, cardId: item.cardId } },
              update: { quantity: { increment: item.quantity } },
              create: { userId: taker, cardId: item.cardId, quantity: item.quantity },
            });
          }
        },
        { timeout: 15_000 },
      );
    } catch (e) {
      if (e instanceof TradeError) return Response.json({ error: e.code }, { status: e.status });
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        (e.code === "P2002" || e.code === "P2034")
      ) {
        return Response.json({ error: "busy" }, { status: 409 });
      }
      throw e;
    }
    checkAchievements(user.id, existing.proposerId);
    notifyUser(existing.proposerId, { type: "trade", from: user.username });
    void flagOneSidedTrade(id, existing.proposerId, user.id).catch(() => {});
    return new Response(null, { status: 204 });
  },
);

async function flagOneSidedTrade(tradeId: string, proposerId: string, recipientId: string) {
  const items = await prisma.tradeItem.findMany({ where: { tradeId }, select: { side: true } });
  const offers = items.some((i) => i.side === "OFFER");
  const requests = items.some((i) => i.side === "REQUEST");
  if (offers === requests) return;
  const giverId = offers ? proposerId : recipientId;
  const takerId = offers ? recipientId : proposerId;
  const giver = await prisma.user.findUnique({ where: { id: giverId } });
  if (giver) await checkFunnel(giver, takerId, `trade:${tradeId}`);
}
