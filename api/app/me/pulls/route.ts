import { PULL_HISTORY_SIZE, type PullOpening, type PullsResponse } from "@wikideck/shared";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";

export const GET = withRateLimit("me-pulls", { limit: 30, windowSec: 60 }, async () => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const [pulls, total] = await Promise.all([
    prisma.pull.findMany({
      where: { userId: user.id },
      include: { card: { select: { title: true, url: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PULL_HISTORY_SIZE,
    }),
    prisma.pull.count({ where: { userId: user.id } }),
  ]);

  const openings = new Map<string, PullOpening>();
  for (const pull of pulls) {
    const opening = openings.get(pull.openingId) ?? {
      id: pull.openingId,
      openedAt: pull.createdAt.toISOString(),
      cards: [],
    };
    opening.cards.push({
      cardId: pull.cardId,
      title: pull.card.title,
      url: pull.card.url,
      rarity: pull.rarity,
    });
    openings.set(pull.openingId, opening);
  }
  for (const opening of openings.values()) opening.cards.reverse();

  return Response.json({ openings: [...openings.values()], total } satisfies PullsResponse);
});
