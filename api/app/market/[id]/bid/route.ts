import { BID_EXTEND_S, BID_EXTEND_WINDOW_S, nextMinBid } from "@wikideck/shared";
import { Prisma } from "@/generated/prisma/client";
import { notifyUser } from "@/lib/notify";
import { MarketError } from "@/lib/market";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid, readJson } from "@/lib/tags";
import { transactionBlock } from "@/lib/trust";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withRateLimit<Ctx>(
  "market-bid",
  { limit: 30, windowSec: 60 },
  async (request, { params }) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const blocked = await transactionBlock(user);
    if (blocked) return Response.json({ error: blocked }, { status: 403 });
    const { id } = await params;
    if (!isUuid(id)) return Response.json({ error: "not_found" }, { status: 404 });
    const amount = (await readJson(request))?.amount;
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1) {
      return Response.json({ error: "invalid" }, { status: 400 });
    }

    let seller: string | null = null;
    let outbid: string | null = null;
    try {
      await prisma.$transaction(async (tx) => {
        const a = await tx.auction.findUnique({ where: { id } });
        const now = new Date();
        if (!a) throw new MarketError("not_found", 404);
        if (a.status !== "ACTIVE" || a.endsAt <= now) throw new MarketError("ended");
        if (a.sellerId === user.id) throw new MarketError("own_auction", 403);
        if (amount < nextMinBid(a.startPrice, a.currentBid)) throw new MarketError("bid_too_low");

        const alreadyPaid = a.leaderId === user.id ? (a.currentBid ?? 0) : 0;
        const debit = await tx.user.updateMany({
          where: { id: user.id, wikibits: { gte: amount - alreadyPaid } },
          data: { wikibits: { decrement: amount - alreadyPaid } },
        });
        if (debit.count === 0) throw new MarketError("insufficient_funds", 402);

        const extended = a.endsAt.getTime() - now.getTime() <= BID_EXTEND_WINDOW_S * 1000;
        const won = await tx.auction.updateMany({
          where: {
            id,
            status: "ACTIVE",
            endsAt: { gt: now },
            bidCount: a.bidCount,
            currentBid: a.currentBid,
          },
          data: {
            currentBid: amount,
            leaderId: user.id,
            bidCount: { increment: 1 },
            ...(extended && { endsAt: new Date(a.endsAt.getTime() + BID_EXTEND_S * 1000) }),
          },
        });
        if (won.count === 0) throw new MarketError("outbid");

        if (a.leaderId && a.leaderId !== user.id && a.currentBid !== null) {
          await tx.user.update({
            where: { id: a.leaderId },
            data: { wikibits: { increment: a.currentBid } },
          });
        }
        await tx.bid.create({ data: { auctionId: id, bidderId: user.id, amount } });
        seller = a.sellerId;
        outbid = a.leaderId && a.leaderId !== user.id ? a.leaderId : null;
      });
    } catch (e) {
      if (e instanceof MarketError) return Response.json({ error: e.code }, { status: e.status });
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        (e.code === "P2034" || e.code === "P2002")
      ) {
        // deux enchères en même temps : la perdante est traitée comme dépassée
        return Response.json({ error: "outbid" }, { status: 409 });
      }
      throw e;
    }
    notifyUser(outbid, { type: "outbid", auction: id });
    notifyUser(seller, { type: "auction", auction: id });
    return new Response(null, { status: 204 });
  },
);
