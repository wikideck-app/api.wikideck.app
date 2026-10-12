import type { StaffOverview, StaffRecentEvent } from "@wikideck/shared";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { requireStaff } from "@/lib/staff";

const DAY = 86_400_000;
const DAYS = 7;

// nombre d'évènements par jour de Paris sur 14 jours : [jour (AAAA-MM-JJ), total]
type Daily = { day: string; n: bigint }[];

// 14 jours : les 7 derniers + les 7 précédents (pour l'évolution)
const FROM = (now: number) => new Date(now - 2 * DAYS * DAY);

function toSeries(rows: Daily, days: string[]) {
  const byDay = new Map(rows.map((r) => [r.day, Number(r.n)]));
  return days.map((d) => byDay.get(d) ?? 0);
}

const trend = (all: number[]) => {
  const prev = all.slice(0, DAYS).reduce((a, b) => a + b, 0);
  const last = all.slice(DAYS).reduce((a, b) => a + b, 0);
  return prev > 0 ? Math.round(((last - prev) / prev) * 100) : null;
};

export const GET = withRateLimit("staff-overview", { limit: 60, windowSec: 60 }, async () => {
  const auth = await requireStaff("MODERATOR");
  if (auth instanceof Response) return auth;
  const now = Date.now();
  const day = new Date(now - DAY);
  const from = FROM(now);

  // les 14 jours (Paris), du plus ancien au plus récent
  const days14 = Array.from({ length: DAYS * 2 }, (_, i) =>
    new Date(now - (DAYS * 2 - 1 - i) * DAY).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" }),
  );

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
    openReports,
    openBugs,
    dNewUsers,
    dPacks,
    dBattles,
    dAuctions,
    rSignups,
    rPulls,
    rReports,
    rBugs,
    rAuctions,
    rTrades,
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
    prisma.messageReport.count({ where: { status: "OPEN" } }),
    prisma.bugReport.count({ where: { status: "OPEN" } }),
    prisma.$queryRaw<Daily>`
      SELECT to_char("createdAt" AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS day, count(*) AS n
      FROM "User" WHERE "createdAt" >= ${from} GROUP BY 1`,
    prisma.$queryRaw<Daily>`
      SELECT to_char("createdAt" AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS day, count(DISTINCT "openingId") AS n
      FROM "Pull" WHERE "createdAt" >= ${from} GROUP BY 1`,
    prisma.$queryRaw<Daily>`
      SELECT to_char("playedAt" AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS day, count(*) AS n
      FROM "BattleGame" WHERE "playedAt" >= ${from} GROUP BY 1`,
    prisma.$queryRaw<Daily>`
      SELECT to_char("createdAt" AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS day, count(*) AS n
      FROM "Auction" WHERE "createdAt" >= ${from} GROUP BY 1`,
    prisma.user.findMany({ orderBy: { createdAt: "desc" }, take: 6, select: { username: true, createdAt: true } }),
    prisma.pull.findMany({
      where: { card: { rarity: { in: ["LEGENDARY", "MYTHIC"] } } },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { createdAt: true, user: { select: { username: true } }, card: { select: { title: true, rarity: true } } },
    }),
    prisma.messageReport.findMany({ orderBy: { createdAt: "desc" }, take: 6, select: { createdAt: true } }),
    prisma.bugReport.findMany({ orderBy: { createdAt: "desc" }, take: 6, select: { createdAt: true } }),
    prisma.auction.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { createdAt: true, card: { select: { title: true, rarity: true } } },
    }),
    prisma.trade.findMany({ orderBy: { createdAt: "desc" }, take: 6, select: { createdAt: true } }),
  ]);

  const last7 = days14.slice(DAYS);
  const all = (rows: Daily) => toSeries(rows, days14);
  const split = (rows: Daily) => all(rows).slice(DAYS);

  const recent: StaffRecentEvent[] = [
    ...rSignups.map((u) => ({ kind: "signup" as const, at: u.createdAt.toISOString(), name: u.username })),
    ...rPulls.map((p) => ({
      kind: "pull" as const,
      at: p.createdAt.toISOString(),
      name: p.user.username,
      rarity: p.card.rarity,
      card: p.card.title,
    })),
    ...rReports.map((r) => ({ kind: "report" as const, at: r.createdAt.toISOString() })),
    ...rBugs.map((r) => ({ kind: "bug" as const, at: r.createdAt.toISOString() })),
    ...rAuctions.map((a) => ({
      kind: "auction" as const,
      at: a.createdAt.toISOString(),
      rarity: a.card.rarity,
      card: a.card.title,
    })),
    ...rTrades.map((t) => ({ kind: "trade" as const, at: t.createdAt.toISOString() })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8);

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
    openReports,
    openBugs,
    days: last7,
    series: {
      newUsers: split(dNewUsers),
      packs: split(dPacks),
      battles: split(dBattles),
      auctions: split(dAuctions),
    },
    trends: {
      newUsers: trend(all(dNewUsers)),
      packs: trend(all(dPacks)),
      battles: trend(all(dBattles)),
      auctions: trend(all(dAuctions)),
    },
    recent,
  } satisfies StaffOverview);
});
