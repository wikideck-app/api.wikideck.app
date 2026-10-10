import { QUESTS, type QuestDto, type QuestsResponse } from "@wikideck/shared";
import { prisma } from "@/lib/prisma";
import { cardsFor } from "@/lib/quests";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";

export const GET = withRateLimit("quests-list", { limit: 60, windowSec: 60 }, async () => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const [wikipediaCards, animeCards, claims] = await Promise.all([
    cardsFor(user.id, "wikipedia_cards"),
    cardsFor(user.id, "anime_cards"),
    prisma.questClaim.findMany({ where: { userId: user.id }, select: { questId: true } }),
  ]);
  const claimed = new Set(claims.map((c) => c.questId));
  const quests: QuestDto[] = QUESTS.map((q) => {
    const owned = q.kind === "anime_cards" ? animeCards : wikipediaCards;
    return {
      ...q,
      progress: Math.min(owned, q.target),
      claimed: claimed.has(q.id),
      claimable: !claimed.has(q.id) && owned >= q.target,
    };
  });
  return Response.json({ quests, wikibits: user.wikibits } satisfies QuestsResponse);
});
