import type { StaffAuctionAction } from "@wikideck/shared";
import { MarketError, giveCard } from "@/lib/market";
import { notifyUser } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { logStaff, requireStaff } from "@/lib/staff";
import { isUuid, readJson } from "@/lib/tags";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withRateLimit<Ctx>(
  "staff-auction-action",
  { limit: 30, windowSec: 60 },
  async (request, { params }) => {
    const auth = await requireStaff("MODERATOR");
    if (auth instanceof Response) return auth;
    const { id } = await params;
    if (!isUuid(id)) return Response.json({ error: "not_found" }, { status: 404 });

    const body = (await readJson(request)) as StaffAuctionAction | null;
    const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 200) : "";
    if (body?.action !== "cancel" || reason.length < 3)
      return Response.json({ error: "invalid_reason" }, { status: 400 });

    try {
      const result = await prisma.$transaction(async (tx) => {
        const claimed = await tx.auction.updateMany({
          where: { id, status: "ACTIVE" },
          data: { status: "CANCELLED", settledAt: new Date() },
        });
        if (claimed.count === 0) {
          const exists = await tx.auction.findUnique({ where: { id }, select: { id: true } });
          throw new MarketError(exists ? "ended" : "not_found", exists ? 409 : 404);
        }
        const a = await tx.auction.findUniqueOrThrow({
          where: { id },
          include: { card: { select: { title: true } }, seller: true, leader: true },
        });
        if (a.leaderId && a.currentBid !== null) {
          await tx.user.update({
            where: { id: a.leaderId },
            data: { wikibits: { increment: a.currentBid } },
          });
        }
        await giveCard(tx, a.sellerId, a.cardId);
        return a;
      });
      await logStaff(auth.user, "cancel_auction", result.seller, {
        auction: id,
        card: result.card.title,
        reason,
        refunded: result.leader ? { to: result.leader.username, amount: result.currentBid } : null,
      });
      notifyUser(result.sellerId, { type: "auction", auction: id });
      notifyUser(result.leaderId, { type: "auction", auction: id });
      return new Response(null, { status: 204 });
    } catch (e) {
      if (e instanceof MarketError) return Response.json({ error: e.code }, { status: e.status });
      throw e;
    }
  },
);
