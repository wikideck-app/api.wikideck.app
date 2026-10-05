import { ACHIEVEMENTS, type AchievementStat } from "@wikideck/shared";
import { notifyUser } from "@/lib/notify";
import { prisma } from "@/lib/prisma";

export type Stats = Record<AchievementStat, number>;

export async function computeStats(userId: string): Promise<Stats> {
  const [
    user,
    byRarity,
    copies,
    openings,
    trades,
    sold,
    won,
    soldLegendary,
    bigWin,
    gifts,
    friends,
    messages,
    tags,
    guild,
  ] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { wikibits: true, showcaseCardId: true },
    }),
    prisma.$queryRaw<{ rarity: string; n: bigint }[]>`
      SELECT c.rarity::text AS rarity, count(*) AS n
      FROM "UserCard" uc JOIN "Card" c ON c.id = uc."cardId"
      WHERE uc."userId" = ${userId}::uuid GROUP BY c.rarity`,
    prisma.userCard.aggregate({ where: { userId }, _max: { quantity: true } }),
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(DISTINCT "openingId") AS n FROM "Pull" WHERE "userId" = ${userId}::uuid`,
    prisma.trade.count({
      where: { status: "ACCEPTED", OR: [{ proposerId: userId }, { recipientId: userId }] },
    }),
    prisma.auction.count({ where: { sellerId: userId, status: "SOLD" } }),
    prisma.auction.count({ where: { leaderId: userId, status: "SOLD" } }),
    prisma.auction.count({
      where: { sellerId: userId, status: "SOLD", card: { rarity: "LEGENDARY" } },
    }),
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "Auction"
      WHERE "leaderId" = ${userId}::uuid AND status = 'SOLD' AND "currentBid" > "startPrice" * 5`,
    prisma.guildWish.count({ where: { giverId: userId, status: "FULFILLED" } }),
    prisma.friendship.count({
      where: { status: "ACCEPTED", OR: [{ requesterId: userId }, { addresseeId: userId }] },
    }),
    prisma.message.count({ where: { senderId: userId } }),
    prisma.tag.count({ where: { userId } }),
    prisma.guildMember.count({ where: { userId } }),
  ]);

  const rarity = new Map(byRarity.map((r) => [r.rarity, Number(r.n)]));
  const distinct = [...rarity.values()].reduce((a, b) => a + b, 0);
  return {
    cards: distinct,
    superRare: rarity.get("SUPER_RARE") ?? 0,
    ultraRare: rarity.get("ULTRA_RARE") ?? 0,
    legendary: rarity.get("LEGENDARY") ?? 0,
    packs: Number(openings[0]?.n ?? 0),
    maxCopies: copies._max.quantity ?? 0,
    duplicates: (copies._max.quantity ?? 0) >= 2 ? 1 : 0,
    showcase: user.showcaseCardId ? 1 : 0,
    trades,
    sold,
    won,
    soldLegendary,
    bigWin: Number(bigWin[0]?.n ?? 0),
    balance: user.wikibits,
    guild,
    gifts,
    friends,
    messages,
    tags,
  };
}

export async function evaluateAchievements(userId: string): Promise<string[]> {
  const stats = await computeStats(userId);
  const have = new Set(
    (await prisma.userAchievement.findMany({ where: { userId }, select: { key: true } })).map(
      (u) => u.key,
    ),
  );
  const reached = ACHIEVEMENTS.filter((def) => !have.has(def.key) && stats[def.stat] >= def.goal);
  if (!reached.length) return [];
  await prisma.userAchievement.createMany({
    data: reached.map((def) => ({ userId, key: def.key })),
    skipDuplicates: true,
  });
  notifyUser(userId, { type: "achievement" });
  return reached.map((def) => def.key);
}

export async function claimAchievements(userId: string, keys?: string[]) {
  const claimed: { key: string; reward: number }[] = [];
  await prisma.$transaction(async (tx) => {
    const pending = await tx.userAchievement.findMany({
      where: { userId, claimedAt: null, ...(keys && { key: { in: keys } }) },
    });
    for (const row of pending) {
      const def = ACHIEVEMENTS.find((d) => d.key === row.key);
      if (!def) continue;
      const done = await tx.userAchievement.updateMany({
        where: { userId, key: row.key, claimedAt: null },
        data: { claimedAt: new Date(), seen: true },
      });
      if (done.count === 0) continue;
      await tx.user.update({
        where: { id: userId },
        data: { wikibits: { increment: def.reward } },
      });
      claimed.push({ key: def.key, reward: def.reward });
    }
  });
  return claimed;
}

export const checkAchievements = (...userIds: (string | null | undefined)[]) => {
  for (const id of new Set(userIds)) {
    if (id) void evaluateAchievements(id).catch((e) => console.error("Succès :", e));
  }
};
