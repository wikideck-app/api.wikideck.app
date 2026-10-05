import type { StaffAlert } from "@wikideck/shared";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { requireStaff } from "@/lib/staff";
import { avatarOf } from "@/lib/trades";
import { trustOf } from "@/lib/trust";

const DAY = 86_400_000;

export const GET = withRateLimit("staff-alerts", { limit: 60, windowSec: 60 }, async () => {
  const auth = await requireStaff("MODERATOR");
  if (auth instanceof Response) return auth;
  const since = new Date(Date.now() - 30 * DAY);

  const grouped = await prisma.abuseSignal.groupBy({
    by: ["userId"],
    where: { createdAt: { gte: since } },
    _sum: { weight: true },
    having: { weight: { _sum: { gte: 30 } } },
    orderBy: { _sum: { weight: "desc" } },
    take: 50,
  });
  const ids = grouped.map((g) => g.userId);
  const [users, signals] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: ids } } }),
    prisma.abuseSignal.findMany({
      where: { userId: { in: ids }, createdAt: { gte: since } },
      select: { userId: true, type: true },
    }),
  ]);
  const byId = new Map(users.map((u) => [u.id, u]));
  const alerts: StaffAlert[] = [];
  for (const g of grouped) {
    const u = byId.get(g.userId);
    if (!u) continue;
    alerts.push({
      id: u.id,
      username: u.username,
      avatarUrl: avatarOf(u),
      riskScore: Math.min(100, g._sum.weight ?? 0),
      level: (await trustOf(u)).level,
      signals: [...new Set(signals.filter((s) => s.userId === u.id).map((s) => s.type))],
    });
  }
  return Response.json({ alerts });
});
