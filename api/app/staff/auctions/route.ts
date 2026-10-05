import type { AuctionStatus, StaffAuctionRow } from "@wikideck/shared";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { requireStaff } from "@/lib/staff";

const PAGE = 20;

export const GET = withRateLimit(
  "staff-auctions",
  { limit: 120, windowSec: 60 },
  async (request) => {
    const auth = await requireStaff("MODERATOR");
    if (auth instanceof Response) return auth;
    const params = request.nextUrl.searchParams;
    const q = params.get("q")?.trim().slice(0, 64) ?? "";
    const page = Math.max(1, Math.floor(Number(params.get("page"))) || 1);

    const where = {
      ...(params.get("status") !== "all" && { status: "ACTIVE" as const }),
      ...(q && {
        OR: [
          { card: { title: { contains: q, mode: "insensitive" as const } } },
          { seller: { username: { contains: q, mode: "insensitive" as const } } },
        ],
      }),
    };
    const [total, rows] = await Promise.all([
      prisma.auction.count({ where }),
      prisma.auction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE,
        take: PAGE,
        include: { card: true, seller: true, leader: true },
      }),
    ]);
    const auctions: StaffAuctionRow[] = rows.map((a) => ({
      id: a.id,
      card: { id: a.card.id, title: a.card.title, rarity: a.card.rarity },
      seller: { id: a.seller.id, username: a.seller.username },
      leader: a.leader ? { id: a.leader.id, username: a.leader.username } : null,
      startPrice: a.startPrice,
      currentBid: a.currentBid,
      bidCount: a.bidCount,
      endsAt: a.endsAt.toISOString(),
      status: a.status as AuctionStatus,
      createdAt: a.createdAt.toISOString(),
    }));
    return Response.json({
      auctions,
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / PAGE)),
    });
  },
);
