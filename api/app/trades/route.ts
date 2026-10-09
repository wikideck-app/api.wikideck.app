import { TRADE_HISTORY_SIZE, type TradeBox, type TradesResponse } from "@wikideck/shared";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { readJson } from "@/lib/tags";
import { proposeTrade } from "@/lib/trade-propose";
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

export const POST = withRateLimit(
  "trades-create",
  { limit: 10, windowSec: 60 },
  async (request) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const blocked = await transactionBlock(user);
    if (blocked) return Response.json({ error: blocked }, { status: 403 });
    const body = await readJson(request);
    if (!body) return Response.json({ error: "invalid" }, { status: 400 });
    return proposeTrade(user, body);
  },
);
