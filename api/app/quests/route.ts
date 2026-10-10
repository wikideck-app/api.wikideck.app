import { QUESTS, type QuestDto, type QuestsResponse } from "@wikideck/shared";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";

export const GET = withRateLimit("quests-list", { limit: 60, windowSec: 60 }, async () => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const [wikipediaCards, claims] = await Promise.all([
    prisma.userCard.count({ where: { userId: user.id, card: { source: "WIKIPEDIA" } } }),
    prisma.questClaim.findMany({ where: { userId: user.id }, select: { questId: true } }),
  ]);
  const claimed = new Set(claims.map((c) => c.questId));
  const quests: QuestDto[] = QUESTS.map((q) => ({
    ...q,
    progress: Math.min(wikipediaCards, q.target),
    claimed: claimed.has(q.id),
    claimable: !claimed.has(q.id) && wikipediaCards >= q.target,
  }));
  return Response.json({ quests, wikibits: user.wikibits } satisfies QuestsResponse);
});
