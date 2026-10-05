import { RARITIES, RECYCLE_VALUES, type DuplicatesResponse } from "@wikideck/shared";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";

export const GET = withRateLimit(
  "collection-duplicates",
  { limit: 60, windowSec: 60 },
  async () => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

    const rows = await prisma.userCard.findMany({
      where: { userId: user.id, quantity: { gt: 1 } },
      select: { quantity: true, card: { select: { rarity: true } } },
    });
    const rarities = RARITIES.map((r) => {
      const mine = rows.filter((x) => x.card.rarity === r.value);
      const copies = mine.reduce((n, x) => n + x.quantity - 1, 0);
      return {
        rarity: r.value,
        cards: mine.length,
        copies,
        wikibits: copies * RECYCLE_VALUES[r.value],
      };
    }).filter((r) => r.copies > 0);
    return Response.json({ rarities } satisfies DuplicatesResponse);
  },
);
