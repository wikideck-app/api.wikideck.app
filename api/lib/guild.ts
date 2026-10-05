import {
  GUILD_MAX_MEMBERS,
  rewardForRank,
  weekStartOf,
  type GuildMemberDto,
} from "@wikideck/shared";
import type { Prisma, ScoreKind } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { toPlayer } from "@/lib/trades";

export class GuildError extends Error {
  constructor(
    public code: string,
    public status = 409,
  ) {
    super(code);
  }
}

export const WEEK_MS = 7 * 86_400_000;

export const membershipOf = (userId: string) =>
  prisma.guildMember.findUnique({ where: { userId }, include: { guild: true } });

export const dayStartOf = (date = new Date()) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

export function addScore(
  tx: Prisma.TransactionClient,
  guildId: string,
  userId: string | null,
  kind: ScoreKind,
  points: number,
  at = new Date(),
) {
  return tx.guildScoreEvent.create({
    data: { guildId, userId, kind, points, weekStart: weekStartOf(at) },
  });
}

export async function weekScores(weekStart: Date) {
  const rows = await prisma.guildScoreEvent.groupBy({
    by: ["guildId"],
    where: { weekStart },
    _sum: { points: true },
  });
  const ids = rows.map((r) => r.guildId);
  const guilds = await prisma.guild.findMany({
    where: { id: { in: ids } },
    select: { id: true, createdAt: true },
  });
  const created = new Map(guilds.map((g) => [g.id, g.createdAt.getTime()]));
  return rows
    .map((r) => ({ guildId: r.guildId, points: r._sum.points ?? 0 }))
    .filter((r) => r.points > 0 && created.has(r.guildId))
    .sort((a, b) => b.points - a.points || created.get(a.guildId)! - created.get(b.guildId)!)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

export async function settleWeeks() {
  const current = weekStartOf(new Date());
  const weeks = await prisma.guildScoreEvent.findMany({
    where: { weekStart: { lt: current } },
    distinct: ["weekStart"],
    select: { weekStart: true },
    orderBy: { weekStart: "asc" },
  });
  const done = new Set(
    (
      await prisma.guildWeekSettled.findMany({
        where: { weekStart: { in: weeks.map((w) => w.weekStart) } },
      })
    ).map((s) => s.weekStart.getTime()),
  );

  for (const { weekStart } of weeks) {
    if (done.has(weekStart.getTime())) continue;
    try {
      const ranking = await weekScores(weekStart);
      const names = new Map(
        (
          await prisma.guild.findMany({
            where: { id: { in: ranking.map((r) => r.guildId) } },
            select: { id: true, name: true },
          })
        ).map((g) => [g.id, g.name]),
      );
      const weekEnd = new Date(weekStart.getTime() + WEEK_MS);
      await prisma.$transaction(async (tx) => {
        await tx.guildWeekSettled.create({ data: { weekStart } });
        for (const r of ranking) {
          const reward = rewardForRank(r.rank, r.points);
          await tx.guildWeekResult.create({
            data: {
              weekStart,
              guildId: r.guildId,
              rank: r.rank,
              points: r.points,
              reward,
              guildName: names.get(r.guildId) ?? "",
            },
          });
          if (reward > 0) {
            await tx.user.updateMany({
              where: { guildMember: { guildId: r.guildId, joinedAt: { lt: weekEnd } } },
              data: { wikibits: { increment: reward } },
            });
          }
        }
      });
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") console.error("Clôture de semaine échouée", e);
    }
  }
}

export async function leaveGuild(tx: Prisma.TransactionClient, userId: string) {
  const member = await tx.guildMember.findUnique({ where: { userId } });
  if (!member) return;
  await tx.guildWish.updateMany({
    where: { userId, status: "OPEN" },
    data: { status: "CANCELLED" },
  });
  await tx.guildMember.delete({ where: { userId } });
  const rest = await tx.guildMember.findMany({
    where: { guildId: member.guildId },
    orderBy: { joinedAt: "asc" },
  });
  if (rest.length === 0) {
    await tx.guild.delete({ where: { id: member.guildId } });
  } else if (member.role === "OWNER") {
    await tx.guildMember.update({ where: { id: rest[0].id }, data: { role: "OWNER" } });
  }
}

export async function joinGuild(userId: string, guildId: string) {
  await prisma.$transaction(async (tx) => {
    if (await tx.guildMember.findUnique({ where: { userId } }))
      throw new GuildError("already_in_guild");
    const guild = await tx.guild.findUnique({ where: { id: guildId } });
    if (!guild) throw new GuildError("not_found", 404);
    const count = await tx.guildMember.count({ where: { guildId } });
    if (count >= GUILD_MAX_MEMBERS) throw new GuildError("guild_full");
    await tx.guildMember.create({ data: { guildId, userId } });
  });
}

export const toMemberDto = (
  m: Prisma.GuildMemberGetPayload<{ include: { user: true } }>,
  ipWeek: number,
): GuildMemberDto => ({
  player: toPlayer(m.user),
  role: m.role,
  joinedAt: m.joinedAt.toISOString(),
  ipWeek,
  ipTotal: m.ipTotal,
});
