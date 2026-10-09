import {
  TRADE_EXPIRY_DAYS,
  TRADE_MAX_CARDS,
  TRADE_MAX_PENDING,
  TRADE_MAX_PENDING_PER_PLAYER,
  type TradeLine,
} from "@wikideck/shared";
import type { User } from "@/generated/prisma/client";
import { notifyUser } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { isUuid } from "@/lib/tags";
import { TradeError, expireStale, toTradeDto, tradeInclude } from "@/lib/trades";

export function parseLines(value: unknown): TradeLine[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > TRADE_MAX_CARDS) return null;
  const lines: TradeLine[] = [];
  for (const raw of value) {
    const { cardId, quantity } = (raw ?? {}) as Record<string, unknown>;
    if (!isUuid(cardId) || !Number.isInteger(quantity)) return null;
    if ((quantity as number) < 1 || (quantity as number) > 99) return null;
    if (lines.some((l) => l.cardId === cardId)) return null;
    lines.push({ cardId, quantity: quantity as number });
  }
  return lines;
}

const owns = async (userId: string, lines: TradeLine[]) => {
  if (!lines.length) return true;
  const rows = await prisma.userCard.findMany({
    where: { userId, cardId: { in: lines.map((l) => l.cardId) } },
    select: { cardId: true, quantity: true },
  });
  const have = new Map(rows.map((r) => [r.cardId, r.quantity]));
  return lines.every((l) => (have.get(l.cardId) ?? 0) >= l.quantity);
};

/**
 * Crée une proposition d'échange. Avec `counterOf` (une proposition reçue par `user`), la crée
 * comme contre-proposition vers son auteur et clôt l'originale dans la même transaction.
 */
export async function proposeTrade(
  user: User,
  body: Record<string, unknown>,
  counterOf?: { id: string; proposerId: string; offeredCardIds: string[] },
): Promise<Response> {
  const offer = parseLines(body.offer);
  const ask = parseLines(body.request);
  const recipientId = counterOf ? counterOf.proposerId : body.recipientId;
  if (!isUuid(recipientId) || !offer || !ask || offer.length + ask.length === 0)
    return Response.json({ error: "invalid" }, { status: 400 });
  if (recipientId === user.id) return Response.json({ error: "self_trade" }, { status: 400 });
  if (offer.some((o) => ask.some((a) => a.cardId === o.cardId)))
    return Response.json({ error: "invalid" }, { status: 400 });

  const recipient = await prisma.user.findUnique({ where: { id: recipientId } });
  if (!recipient) return Response.json({ error: "player_not_found" }, { status: 404 });
  // les cartes que l'autre joueur a lui-même proposées dans l'original peuvent être redemandées
  const visible = new Set(counterOf?.offeredCardIds ?? []);
  if (!recipient.isPublic && ask.some((a) => !visible.has(a.cardId)))
    return Response.json({ error: "recipient_private" }, { status: 403 });

  const [mineOk, theirsOk] = await Promise.all([owns(user.id, offer), owns(recipient.id, ask)]);
  if (!mineOk) return Response.json({ error: "not_available_mine" }, { status: 400 });
  if (!theirsOk) return Response.json({ error: "not_available_theirs" }, { status: 400 });

  await expireStale(user.id);
  const [pending, pendingToPlayer] = await Promise.all([
    prisma.trade.count({ where: { proposerId: user.id, status: "PENDING" } }),
    prisma.trade.count({
      where: { proposerId: user.id, recipientId: recipient.id, status: "PENDING" },
    }),
  ]);
  if (pending >= TRADE_MAX_PENDING)
    return Response.json({ error: "too_many_pending" }, { status: 403 });
  if (pendingToPlayer >= TRADE_MAX_PENDING_PER_PLAYER)
    return Response.json({ error: "too_many_pending_player" }, { status: 403 });

  try {
    const trade = await prisma.$transaction(async (tx) => {
      if (counterOf) {
        const closed = await tx.trade.updateMany({
          where: {
            id: counterOf.id,
            recipientId: user.id,
            status: "PENDING",
            expiresAt: { gt: new Date() },
          },
          data: { status: "COUNTERED", respondedAt: new Date() },
        });
        if (closed.count === 0) throw new TradeError("already_resolved", 409);
      }
      return tx.trade.create({
        data: {
          proposerId: user.id,
          recipientId: recipient.id,
          counterOfId: counterOf?.id ?? null,
          expiresAt: new Date(Date.now() + TRADE_EXPIRY_DAYS * 86_400_000),
          items: {
            create: [
              ...offer.map((l) => ({ ...l, side: "OFFER" as const })),
              ...ask.map((l) => ({ ...l, side: "REQUEST" as const })),
            ],
          },
        },
        include: tradeInclude,
      });
    });
    notifyUser(recipient.id, { type: "trade", from: user.username });
    return Response.json(toTradeDto(trade, user.id), { status: 201 });
  } catch (e) {
    if (e instanceof TradeError) return Response.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
