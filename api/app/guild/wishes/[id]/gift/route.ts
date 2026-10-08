import { GUILD_IP_POINTS } from "@wikideck/shared";
import { notifyUser } from "@/lib/notify";
import { checkAchievements } from "@/lib/achievements";
import { Prisma } from "@/generated/prisma/client";
import { GuildError, addScore, dayStartOf } from "@/lib/guild";
import { MarketError, giveCard, takeCard } from "@/lib/market";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid } from "@/lib/tags";
import { transactionBlock } from "@/lib/trust";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withRateLimit<Ctx>(
  "guild-gift",
  { limit: 20, windowSec: 60 },
  async (_request, { params }) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!isUuid(id)) return Response.json({ error: "not_found" }, { status: 404 });
    const blocked = await transactionBlock(user);
    if (blocked) return Response.json({ error: blocked }, { status: 403 });

    try {
      let receiver = "";
      const points = await prisma.$transaction(async (tx) => {
        const wish = await tx.guildWish.findUnique({ where: { id }, include: { card: true } });
        if (!wish || wish.status !== "OPEN") throw new GuildError("not_found", 404);
        const donor = await tx.guildMember.findUnique({ where: { userId: user.id } });
        if (!donor || donor.guildId !== wish.guildId) throw new GuildError("forbidden", 403);
        if (wish.userId === user.id) throw new GuildError("own_wish", 403);
        if (!(await tx.guildMember.findUnique({ where: { userId: wish.userId } })))
          throw new GuildError("not_found", 404);

        const received = await tx.guildWish.count({
          where: { userId: wish.userId, status: "FULFILLED", fulfilledAt: { gte: dayStartOf() } },
        });
        if (received > 0) throw new GuildError("received_today");

        const claimed = await tx.guildWish.updateMany({
          where: { id, status: "OPEN" },
          data: { status: "FULFILLED", fulfilledAt: new Date(), giverId: user.id },
        });
        if (claimed.count === 0) throw new GuildError("not_found", 404);

        await takeCard(tx, user.id, wish.cardId, 1);
        await giveCard(tx, wish.userId, wish.cardId);
        receiver = wish.userId;

        const earned = GUILD_IP_POINTS[wish.card.rarity];
        await tx.guildMember.update({
          where: { userId: user.id },
          data: { ipTotal: { increment: earned } },
        });
        await addScore(tx, donor.guildId, user.id, "INFLUENCE", earned);
        return earned;
      });
      checkAchievements(user.id, receiver);
      notifyUser(receiver, { type: "gift", from: user.username });
      return Response.json({ points });
    } catch (e) {
      if (e instanceof GuildError || e instanceof MarketError)
        return Response.json({ error: e.code }, { status: e.status });
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034")
        return Response.json({ error: "busy" }, { status: 409 });
      throw e;
    }
  },
);
