import { notifyUser } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid } from "@/lib/tags";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withRateLimit<Ctx>(
  "trades-decline",
  { limit: 30, windowSec: 60 },
  async (_request, { params }) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!isUuid(id)) return Response.json({ error: "not_found" }, { status: 404 });

    const done = await prisma.trade.updateMany({
      where: { id, recipientId: user.id, status: "PENDING" },
      data: { status: "DECLINED", respondedAt: new Date() },
    });
    if (done.count === 0) {
      const exists = await prisma.trade.findFirst({
        where: { id, recipientId: user.id },
        select: { id: true },
      });
      return Response.json(
        { error: exists ? "already_resolved" : "not_found" },
        { status: exists ? 409 : 404 },
      );
    }
    const trade = await prisma.trade.findUnique({ where: { id }, select: { proposerId: true } });
    notifyUser(trade?.proposerId, { type: "trade", from: user.username });
    return new Response(null, { status: 204 });
  },
);
