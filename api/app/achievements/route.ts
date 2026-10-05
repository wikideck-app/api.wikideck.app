import { ACHIEVEMENTS, type AchievementsResponse } from "@wikideck/shared";
import { computeStats, evaluateAchievements } from "@/lib/achievements";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";

export const GET = withRateLimit("achievements", { limit: 30, windowSec: 60 }, async () => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  await evaluateAchievements(user.id);
  const [stats, rows, me] = await Promise.all([
    computeStats(user.id),
    prisma.userAchievement.findMany({ where: { userId: user.id } }),
    prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { wikibits: true } }),
  ]);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const known = rows.filter((r) => ACHIEVEMENTS.some((d) => d.key === r.key));
  return Response.json({
    achievements: ACHIEVEMENTS.map((def) => {
      const row = byKey.get(def.key);
      return {
        key: def.key,
        progress: stats[def.stat],
        unlockedAt: row?.unlockedAt.toISOString() ?? null,
        claimed: !!row?.claimedAt,
        isNew: !!row && !row.seen,
      };
    }),
    unlocked: known.length,
    claimable: known.filter((r) => !r.claimedAt).length,
    total: ACHIEVEMENTS.length,
    wikibits: me.wikibits,
  } satisfies AchievementsResponse);
});
