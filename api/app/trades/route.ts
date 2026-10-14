import { TRADE_HISTORY_SIZE, type TradeBox, type TradesResponse } from "@wikideck/shared";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { readJson } from "@/lib/tags";
import { proposeTrade } from "@/lib/trade-propose";
import { relationsWith } from "@/lib/friends";
import { quantitiesOf } from "@/lib/ownership";
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
  // la contre-proposition doit savoir si l'autre joueur est un ami (profil privé consultable)
  const dtos = trades.map((t) => toTradeDto(t, user.id));
  const relation = await relationsWith(
    user.id,
    dtos.map((d) => d.counterparty.id),
  );
  // cartes que celui qui les reçoit possède déjà : moi pour ce que je reçois, l'autre joueur (si on peut voir
  // sa collection) pour ce que je donne
  const cardIds = [...new Set(dtos.flatMap((d) => [...d.give, ...d.receive].map((c) => c.id)))];
  const mine = await quantitiesOf(user.id, cardIds);
  const visible = new Map(trades.map((t) => [t.id, t.proposerId === user.id ? t.recipient : t.proposer]));
  const theirs = new Map<string, Map<string, number>>();
  for (const d of dtos) {
    const other = visible.get(d.id);
    const cp = d.counterparty.id;
    if (!other || theirs.has(cp)) continue;
    const seen = other.isPublic || relation(cp) === "friend";
    if (seen) theirs.set(cp, await quantitiesOf(cp, cardIds));
  }
  return Response.json({
    trades: dtos.map((d) => {
      const theirCards = theirs.get(d.counterparty.id);
      return {
        ...d,
        give: d.give.map((c) => (theirCards ? { ...c, owned: theirCards.get(c.id) ?? 0 } : c)),
        receive: d.receive.map((c) => ({ ...c, owned: mine.get(c.id) ?? 0 })),
        counterparty: { ...d.counterparty, friend: relation(d.counterparty.id) === "friend" },
      };
    }),
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
