import type { PlayerSummary, TradeDto, TradeStatus } from "@wikideck/shared";
import type { Card, Trade, TradeItem, User } from "@/generated/prisma/client";
import { toCardDto } from "@/lib/cards";
import { prisma } from "@/lib/prisma";

export function avatarOf(user: Pick<User, "discordId" | "avatar">) {
  if (!user.avatar) return null;
  const ext = user.avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.${ext}?size=128`;
}

export const toPlayer = (user: User): PlayerSummary => ({
  id: user.id,
  username: user.username,
  avatarUrl: avatarOf(user),
  isPublic: user.isPublic,
});

export type TradeWithRelations = Trade & {
  items: (TradeItem & { card: Card })[];
  proposer: User;
  recipient: User;
};

export const tradeInclude = {
  items: { include: { card: true } },
  proposer: true,
  recipient: true,
} as const;

export function toTradeDto(trade: TradeWithRelations, viewerId: string): TradeDto {
  const isProposer = trade.proposerId === viewerId;
  const cards = (side: "OFFER" | "REQUEST") =>
    trade.items
      .filter((i) => i.side === side)
      .map((i) => ({ ...toCardDto(i.card), quantity: i.quantity }));
  const offer = cards("OFFER");
  const request = cards("REQUEST");
  return {
    id: trade.id,
    status: trade.status as TradeStatus,
    counter: trade.counterOfId !== null,
    role: isProposer ? "proposer" : "recipient",
    createdAt: trade.createdAt.toISOString(),
    expiresAt: trade.expiresAt.toISOString(),
    respondedAt: trade.respondedAt?.toISOString() ?? null,
    counterparty: toPlayer(isProposer ? trade.recipient : trade.proposer),
    give: isProposer ? offer : request,
    receive: isProposer ? request : offer,
  };
}

export async function expireStale(userId: string) {
  await prisma.trade.updateMany({
    where: {
      status: "PENDING",
      expiresAt: { lt: new Date() },
      OR: [{ proposerId: userId }, { recipientId: userId }],
    },
    data: { status: "EXPIRED", respondedAt: new Date() },
  });
}

export class TradeError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}
