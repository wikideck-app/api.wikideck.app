import type { StaffAlert } from "@wikideck/shared";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { requireStaff } from "@/lib/staff";
import { isUnreviewed, refreshStaffAlerts } from "@/lib/staff-alerts";
import { isUuid, readJson } from "@/lib/tags";
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
    _max: { createdAt: true },
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
  const last = new Map(grouped.map((g) => [g.userId, g._max.createdAt]));
  const alerts: StaffAlert[] = [];
  for (const g of grouped) {
    const u = byId.get(g.userId);
    if (!u || !isUnreviewed(u.alertsReviewedAt, last.get(u.id))) continue;
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

// marque une alerte (userId) ou toutes (all) comme lues : elle ne revient que sur un nouvel indice
export const POST = withRateLimit("staff-alerts-read", { limit: 60, windowSec: 60 }, async (request) => {
  const auth = await requireStaff("MODERATOR");
  if (auth instanceof Response) return auth;
  const body = (await readJson(request)) as { userId?: unknown; all?: unknown } | null;
  const now = new Date();
  if (body?.all === true) {
    const flagged = await prisma.abuseSignal.groupBy({
      by: ["userId"],
      where: { createdAt: { gte: new Date(Date.now() - 30 * DAY) } },
      _sum: { weight: true },
      having: { weight: { _sum: { gte: 30 } } },
    });
    await prisma.user.updateMany({
      where: { id: { in: flagged.map((f) => f.userId) } },
      data: { alertsReviewedAt: now },
    });
  } else if (typeof body?.userId === "string" && isUuid(body.userId)) {
    await prisma.user.updateMany({ where: { id: body.userId }, data: { alertsReviewedAt: now } });
  } else {
    return Response.json({ error: "invalid" }, { status: 400 });
  }
  await refreshStaffAlerts();
  return new Response(null, { status: 204 });
});
