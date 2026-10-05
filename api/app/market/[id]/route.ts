import { AUCTION_BIDS_SHOWN, type AuctionDetail } from "@wikideck/shared";
import { auctionInclude, settleDue, toAuctionDto } from "@/lib/market";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid } from "@/lib/tags";
import { toPlayer } from "@/lib/trades";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withRateLimit<Ctx>(
  "market-detail",
  { limit: 120, windowSec: 60 },
  async (_request, { params }) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!isUuid(id)) return Response.json({ error: "not_found" }, { status: 404 });
    await settleDue(10);

    const [auction, me] = await Promise.all([
      prisma.auction.findUnique({
        where: { id },
        include: {
          ...auctionInclude(user.id),
          bids: {
            include: { bidder: true },
            orderBy: { createdAt: "desc" },
            take: AUCTION_BIDS_SHOWN,
          },
        },
      }),
      prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { wikibits: true } }),
    ]);
    if (!auction) return Response.json({ error: "not_found" }, { status: 404 });

    const { bids, ...rest } = auction;
    const dto = toAuctionDto(
      { ...rest, bids: bids.filter((b) => b.bidderId === user.id) },
      user.id,
    );
    return Response.json({
      ...dto,
      bids: bids.map((b) => ({
        id: b.id,
        bidder: toPlayer(b.bidder),
        amount: b.amount,
        createdAt: b.createdAt.toISOString(),
      })),
      wikibits: me.wikibits,
    } satisfies AuctionDetail);
  },
);
