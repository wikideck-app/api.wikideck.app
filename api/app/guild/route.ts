import { weekStartOf, type GuildHome } from "@wikideck/shared";
import { WEEK_MS, membershipOf, settleWeeks, toMemberDto, weekScores } from "@/lib/guild";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";

export const GET = withRateLimit("guild-home", { limit: 60, windowSec: 60 }, async () => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  await settleWeeks();

  const membership = await membershipOf(user.id);
  if (!membership) return Response.json({ guild: null });
  const guildId = membership.guildId;
  const weekStart = weekStartOf(new Date());
  const previous = new Date(weekStart.getTime() - WEEK_MS);

  const [ranking, byKind, byMember, members, lastWeek] = await Promise.all([
    weekScores(weekStart),
    prisma.guildScoreEvent.groupBy({
      by: ["kind"],
      where: { guildId, weekStart },
      _sum: { points: true },
    }),
    prisma.guildScoreEvent.groupBy({
      by: ["userId"],
      where: { guildId, weekStart, kind: "INFLUENCE" },
      _sum: { points: true },
    }),
    prisma.guildMember.findMany({
      where: { guildId },
      include: { user: true },
      orderBy: { joinedAt: "asc" },
    }),
    prisma.guildWeekResult.findUnique({
      where: { weekStart_guildId: { weekStart: previous, guildId } },
    }),
  ]);

  const kind = (k: "INFLUENCE" | "AUCTION") => byKind.find((r) => r.kind === k)?._sum.points ?? 0;
  const ipWeek = new Map(byMember.map((r) => [r.userId, r._sum.points ?? 0]));
  const mine = ranking.find((r) => r.guildId === guildId);
  const me = members.find((m) => m.userId === user.id)!;

  return Response.json({
    guild: {
      id: membership.guild.id,
      name: membership.guild.name,
      description: membership.guild.description,
      createdAt: membership.guild.createdAt.toISOString(),
    },
    role: membership.role,
    weekStart: weekStart.toISOString(),
    weekEndsAt: new Date(weekStart.getTime() + WEEK_MS).toISOString(),
    rank: mine?.rank ?? null,
    points: mine?.points ?? 0,
    guilds: ranking.length,
    influence: kind("INFLUENCE"),
    auctions: kind("AUCTION"),
    me: { ipWeek: ipWeek.get(user.id) ?? 0, ipTotal: me.ipTotal },
    members: members
      .map((m) => toMemberDto(m, ipWeek.get(m.userId) ?? 0))
      .sort(
        (a, b) => Number(b.role === "OWNER") - Number(a.role === "OWNER") || b.ipWeek - a.ipWeek,
      ),
    lastWeek: lastWeek
      ? {
          weekStart: lastWeek.weekStart.toISOString(),
          rank: lastWeek.rank,
          points: lastWeek.points,
          reward: lastWeek.reward,
        }
      : null,
  } satisfies GuildHome);
});
