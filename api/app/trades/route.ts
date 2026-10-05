import {
  TRADE_HISTORY_SIZE,
  TRADE_EXPIRY_DAYS,
  TRADE_MAX_CARDS,
  TRADE_MAX_PENDING,
  TRADE_MAX_PENDING_PER_PLAYER,
  type TradeBox,
  type TradeLine,
  type TradesResponse,
} from "@wikideck/shared";
import { notifyUser } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid, readJson } from "@/lib/tags";
import { expireStale, toTradeDto, tradeInclude } from "@/lib/trades";
import { transactionBlock } from "@/lib/trust";

export const GET = withRateLimit("trades-list", { limit: 60, windowSec: 60 }, async (request) => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const box = request.nextUrl.searchParams.get("box") as TradeBox | null;
  if (box !== "incoming" && box !== "outgoing" && box !== "history") {
    return Response.json({ error: "invalid" }, { status: 400 });
  }

  await expireStale(user.id);
  const where =
    box === "incoming"
      ? { recipientId: user.id, status: "PENDING" as const }
      : box === "outgoing"
        ? { proposerId: user.id, status: "PENDING" as const }
        : {
            status: { not: "PENDING" as const },
            OR: [{ proposerId: user.id }, { recipientId: user.id }],
          };

  const trades = await prisma.trade.findMany({
    where,
    include: tradeInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: box === "history" ? TRADE_HISTORY_SIZE : 100,
  });
  return Response.json({
    trades: trades.map((t) => toTradeDto(t, user.id)),
  } satisfies TradesResponse);
});

function parseLines(value: unknown): TradeLine[] | null {
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

export const POST = withRateLimit(
  "trades-create",
  { limit: 10, windowSec: 60 },
  async (request) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const blocked = await transactionBlock(user);
    if (blocked) return Response.json({ error: blocked }, { status: 403 });
    const body = await readJson(request);
    const offer = parseLines(body?.offer);
    const ask = parseLines(body?.request);
    if (!body || !isUuid(body.recipientId) || !offer || !ask || offer.length + ask.length === 0) {
      return Response.json({ error: "invalid" }, { status: 400 });
    }
    if (body.recipientId === user.id)
      return Response.json({ error: "self_trade" }, { status: 400 });
    if (offer.some((o) => ask.some((a) => a.cardId === o.cardId))) {
      return Response.json({ error: "invalid" }, { status: 400 });
    }

    const recipient = await prisma.user.findUnique({ where: { id: body.recipientId } });
    if (!recipient) return Response.json({ error: "player_not_found" }, { status: 404 });
    if (ask.length > 0 && !recipient.isPublic) {
      return Response.json({ error: "recipient_private" }, { status: 403 });
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
    if (pendingToPlayer >= TRADE_MAX_PENDING_PER_PLAYER) {
      return Response.json({ error: "too_many_pending_player" }, { status: 403 });
    }

    const trade = await prisma.trade.create({
      data: {
        proposerId: user.id,
        recipientId: recipient.id,
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
    notifyUser(recipient.id, { type: "trade", from: user.username });
    return Response.json(toTradeDto(trade, user.id), { status: 201 });
  },
);
