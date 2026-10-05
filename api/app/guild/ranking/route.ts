import {
  GUILD_RANKING_SIZE,
  weekStartOf,
  type RankingEntry,
  type RankingResponse,
} from "@wikideck/shared";
import { WEEK_MS, membershipOf, settleWeeks, weekScores } from "@/lib/guild";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";

export const GET = withRateLimit("guild-ranking", { limit: 60, windowSec: 60 }, async () => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  await settleWeeks();

  const weekStart = weekStartOf(new Date());
  const previous = new Date(weekStart.getTime() - WEEK_MS);
  const [membership, ranking, last] = await Promise.all([
    membershipOf(user.id),
    weekScores(weekStart),
    prisma.guildWeekResult.findMany({
      where: { weekStart: previous },
      orderBy: { rank: "asc" },
      take: 3,
    }),
  ]);

  const ids = ranking.map((r) => r.guildId);
  const [guilds, counts] = await Promise.all([
    prisma.guild.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    prisma.guildMember.groupBy({
      by: ["guildId"],
      where: { guildId: { in: ids } },
      _count: true,
    }),
  ]);
  const names = new Map(guilds.map((g) => [g.id, g.name]));
  const sizes = new Map(counts.map((c) => [c.guildId, c._count]));
  const entry = (r: (typeof ranking)[number]): RankingEntry => ({
    rank: r.rank,
    guildId: r.guildId,
    name: names.get(r.guildId) ?? "",
    members: sizes.get(r.guildId) ?? 0,
    points: r.points,
    isMine: r.guildId === membership?.guildId,
  });
  const entries = ranking.slice(0, GUILD_RANKING_SIZE).map(entry);
  const mine = ranking.find((r) => r.guildId === membership?.guildId);

  return Response.json({
    weekStart: weekStart.toISOString(),
    weekEndsAt: new Date(weekStart.getTime() + WEEK_MS).toISOString(),
    entries,
    mine: mine && mine.rank > GUILD_RANKING_SIZE ? entry(mine) : null,
    lastWeek: {
      weekStart: previous.toISOString(),
      entries: last.map((r) => ({
        rank: r.rank,
        name: r.guildName,
        points: r.points,
        reward: r.reward,
      })),
    },
  } satisfies RankingResponse);
});
