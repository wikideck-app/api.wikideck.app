import {
  MARKET_FEE_PERCENT,
  nextMinBid,
  sellerProceeds,
  type AuctionDto,
  type AuctionStatus,
  type MarketStats,
} from "@wikideck/shared";
import type { Auction, Card, Prisma, Rarity, User } from "@/generated/prisma/client";
import { toCardDto } from "@/lib/cards";
import { prisma } from "@/lib/prisma";
import { checkAchievements } from "@/lib/achievements";
import { notifyUser } from "@/lib/notify";
import { addScore } from "@/lib/guild";
import { toPlayer } from "@/lib/trades";

export class MarketError extends Error {
  constructor(
    public code: string,
    public status = 409,
  ) {
    super(code);
  }
}

export type AuctionWithRelations = Auction & {
  card: Card;
  seller: User;
  leader: User | null;
  bids?: { id: string }[];
};

export const auctionInclude = (viewerId: string) =>
  ({
    card: true,
    seller: true,
    leader: true,
    bids: { where: { bidderId: viewerId }, select: { id: true }, take: 1 },
  }) satisfies Prisma.AuctionInclude;

export function toAuctionDto(a: AuctionWithRelations, viewerId: string): AuctionDto {
  return {
    id: a.id,
    card: toCardDto(a.card),
    seller: toPlayer(a.seller),
    startPrice: a.startPrice,
    currentBid: a.currentBid,
    leader: a.leader ? toPlayer(a.leader) : null,
    bidCount: a.bidCount,
    minBid: nextMinBid(a.startPrice, a.currentBid),
    endsAt: a.endsAt.toISOString(),
    status: a.status as AuctionStatus,
    createdAt: a.createdAt.toISOString(),
    viewer: {
      isSeller: a.sellerId === viewerId,
      isLeader: a.leaderId === viewerId,
      hasBid: (a.bids?.length ?? 0) > 0,
    },
  };
}

export async function takeCard(
  tx: Prisma.TransactionClient,
  userId: string,
  cardId: string,
  quantity: number,
) {
  const taken = await tx.userCard.updateMany({
    where: { userId, cardId, quantity: { gte: quantity } },
    data: { quantity: { decrement: quantity } },
  });
  // le where vérifie la quantité au moment d'écrire, pas de double dépense
  if (taken.count === 0) throw new MarketError("not_owned", 400);
  await tx.userCard.deleteMany({ where: { userId, cardId, quantity: 0 } });
  await tx.user.updateMany({
    where: { id: userId, showcaseCardId: cardId, cards: { none: { cardId } } },
    data: { showcaseCardId: null },
  });
}

export const giveCard = (tx: Prisma.TransactionClient, userId: string, cardId: string) =>
  tx.userCard.upsert({
    where: { userId_cardId: { userId, cardId } },
    update: { quantity: { increment: 1 } },
    create: { userId, cardId },
  });

async function settle(id: string) {
  const parties = await prisma.$transaction(async (tx) => {
    const due = await tx.auction.findUnique({ where: { id } });
    if (!due) return;
    const claimed = await tx.auction.updateMany({
      where: { id, status: "ACTIVE", endsAt: { lte: new Date() } },
      data: { status: due.leaderId ? "SOLD" : "UNSOLD", settledAt: new Date() },
    });
    if (claimed.count === 0) return;
    const a = await tx.auction.findUniqueOrThrow({ where: { id } });
    if (a.leaderId && a.currentBid !== null) {
      await tx.user.update({
        where: { id: a.sellerId },
        data: { wikibits: { increment: sellerProceeds(a.currentBid) } },
      });
      await giveCard(tx, a.leaderId, a.cardId);
      const [seller, buyer] = await Promise.all([
        tx.guildMember.findUnique({ where: { userId: a.sellerId } }),
        tx.guildMember.findUnique({ where: { userId: a.leaderId } }),
      ]);
      if (seller && seller.guildId !== buyer?.guildId) {
        await addScore(
          tx,
          seller.guildId,
          a.sellerId,
          "AUCTION",
          a.currentBid,
          a.settledAt ?? new Date(),
        );
      }
      return [a.sellerId, a.leaderId];
    }
    await giveCard(tx, a.sellerId, a.cardId);
    return [a.sellerId];
  });
  if (parties) {
    checkAchievements(...parties);
    for (const party of parties) notifyUser(party, { type: "auction", auction: id });
  }
}

export async function settleDue(limit = 50) {
  const due = await prisma.auction.findMany({
    where: { status: "ACTIVE", endsAt: { lte: new Date() } },
    select: { id: true },
    orderBy: { endsAt: "asc" },
    take: limit,
  });
  for (const { id } of due) {
    try {
      await settle(id);
    } catch (e) {
      console.error("Clôture d'enchère échouée", id, e);
    }
  }
  return due.length;
}

export const FEE_LABEL = `${MARKET_FEE_PERCENT} %`;

export async function marketStats(rarity: Rarity | null): Promise<MarketStats> {
  const where = { status: "SOLD" as const, ...(rarity && { card: { rarity } }) };
  const [agg, latest] = await Promise.all([
    prisma.auction.aggregate({
      where,
      _count: true,
      _avg: { currentBid: true },
      _min: { currentBid: true },
      _max: { currentBid: true },
    }),
    prisma.auction.findMany({
      where,
      orderBy: { settledAt: "desc" },
      take: 60,
      select: { currentBid: true, settledAt: true, card: { select: { rarity: true } } },
    }),
  ]);
  const sales = latest.map((s) => ({
    at: (s.settledAt ?? new Date()).toISOString(),
    price: s.currentBid ?? 0,
    rarity: s.card.rarity,
  }));
  return {
    rarity,
    sales: agg._count,
    last: sales[0]?.price ?? null,
    average: agg._avg.currentBid === null ? null : Math.round(agg._avg.currentBid),
    min: agg._min.currentBid,
    max: agg._max.currentBid,
    points: [...sales].reverse(),
    recent: sales.slice(0, 10),
  };
}
