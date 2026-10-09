import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid, readJson } from "@/lib/tags";
import { proposeTrade } from "@/lib/trade-propose";
import { expireStale } from "@/lib/trades";
import { transactionBlock } from "@/lib/trust";

type Ctx = { params: Promise<{ id: string }> };

// { offer, request } du point de vue de celui qui répond : ce qu'il donne et ce qu'il demande
export const POST = withRateLimit<Ctx>(
  "trades-counter",
  { limit: 10, windowSec: 60 },
  async (request, { params }) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const blocked = await transactionBlock(user);
    if (blocked) return Response.json({ error: blocked }, { status: 403 });
    const { id } = await params;
    if (!isUuid(id)) return Response.json({ error: "not_found" }, { status: 404 });
    const body = await readJson(request);
    if (!body) return Response.json({ error: "invalid" }, { status: 400 });

    await expireStale(user.id);
    const original = await prisma.trade.findFirst({
      where: { id, recipientId: user.id },
      include: { items: { select: { cardId: true, side: true } } },
    });
    if (!original) return Response.json({ error: "not_found" }, { status: 404 });
    if (original.status !== "PENDING")
      return Response.json(
        { error: original.status === "EXPIRED" ? "expired" : "already_resolved" },
        { status: 409 },
      );
    return proposeTrade(user, body, {
      id: original.id,
      proposerId: original.proposerId,
      offeredCardIds: original.items.filter((i) => i.side === "OFFER").map((i) => i.cardId),
    });
  },
);
