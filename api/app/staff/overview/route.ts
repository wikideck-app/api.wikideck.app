import type { StaffOverview } from "@wikideck/shared";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { requireStaff } from "@/lib/staff";

const DAY = 86_400_000;

export const GET = withRateLimit("staff-overview", { limit: 60, windowSec: 60 }, async () => {
  const auth = await requireStaff("MODERATOR");
  if (auth instanceof Response) return auth;
  const now = Date.now();
  const day = new Date(now - DAY);

  const [
    users,
    newUsers7d,
    banned,
    staff,
    packsOpened24h,
    wallets,
    auctionsActive,
    tradesPending,
    battleGames24h,
    flagged,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: new Date(now - 7 * DAY) } } }),
    prisma.user.count({ where: { bannedAt: { not: null } } }),
    prisma.user.count({ where: { staffRole: { not: null } } }),
    prisma.pull
      .groupBy({ by: ["openingId"], where: { createdAt: { gte: day } } })
      .then((r) => r.length),
    prisma.user.aggregate({ _sum: { wikibits: true } }),
    prisma.auction.count({ where: { status: "ACTIVE" } }),
    prisma.trade.count({ where: { status: "PENDING", expiresAt: { gt: new Date() } } }),
    prisma.battleGame.count({ where: { playedAt: { gte: day } } }),
    prisma.abuseSignal
      .groupBy({
        by: ["userId"],
        where: { createdAt: { gte: new Date(now - 30 * DAY) } },
        _sum: { weight: true },
        having: { weight: { _sum: { gte: 30 } } },
      })
      .then((r) => r.length),
  ]);

  return Response.json({
    users,
    newUsers7d,
    banned,
    staff,
    packsOpened24h,
    wikibitsTotal: wallets._sum.wikibits ?? 0,
    auctionsActive,
    tradesPending,
    battleGames24h,
    flagged,
  } satisfies StaffOverview);
});
