import {
  BULK_LIST_MAX,
  BULK_MAX_CARD_IDS,
  DROP_RARITIES,
  RECYCLE_MAX_LINES,
  RECYCLE_VALUES,
  type Rarity,
  type RecycleResponse,
} from "@wikideck/shared";
import { bulkCandidates } from "@/lib/bulk-recycle";
import { lockedCards } from "@/lib/card-locks";
import { MarketError, takeCard } from "@/lib/market";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid, readJson } from "@/lib/tags";

export const POST = withRateLimit(
  "collection-recycle",
  { limit: 20, windowSec: 60 },
  async (request) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const body = (await readJson(request)) as {
      cards?: { cardId: string; quantity: number }[];
      duplicates?: unknown[];
      bulk?: { maxViews?: unknown; rarities?: unknown; cardIds?: unknown; excludeIds?: unknown };
    } | null;
    const invalid = () => Response.json({ error: "invalid" }, { status: 400 });

    if (body?.bulk && typeof body.bulk === "object") {
      const { maxViews, rarities, cardIds, excludeIds } = body.bulk;
      const known: string[] = DROP_RARITIES.map((r) => r.value);
      if (
        typeof maxViews !== "number" ||
        !Number.isInteger(maxViews) ||
        maxViews < 1 ||
        maxViews > 10_000_000 ||
        !Array.isArray(rarities) ||
        !rarities.length ||
        !rarities.every((r) => known.includes(r as string)) ||
        (cardIds !== undefined &&
          (!Array.isArray(cardIds) ||
            cardIds.length > BULK_MAX_CARD_IDS ||
            !cardIds.every((i) => isUuid(i)))) ||
        (excludeIds !== undefined &&
          (!Array.isArray(excludeIds) ||
            excludeIds.length > BULK_LIST_MAX ||
            !excludeIds.every((i) => isUuid(i))))
      )
        return invalid();
      return recycleBulk(user.id, {
        maxViews,
        rarities: rarities as Rarity[],
        cardIds: cardIds as string[] | undefined,
        excludeIds: excludeIds as string[] | undefined,
      });
    }

    if (body && Array.isArray(body.duplicates)) {
      const known: string[] = DROP_RARITIES.map((r) => r.value);
      if (!body.duplicates.length || !body.duplicates.every((r) => known.includes(r as string)))
        return invalid();
      return recycle(user.id, [...new Set(body.duplicates as Rarity[])]);
    }

    if (!body || !Array.isArray(body.cards) || !body.cards.length) return invalid();
    const wanted = new Map<string, number>();
    for (const line of body.cards) {
      if (
        !line ||
        !isUuid(line.cardId) ||
        !Number.isInteger(line.quantity) ||
        line.quantity < 1 ||
        line.quantity > 100_000
      )
        return invalid();
      wanted.set(line.cardId, (wanted.get(line.cardId) ?? 0) + line.quantity);
    }
    if (wanted.size > RECYCLE_MAX_LINES) return invalid();
    // cartes protégées : favori, vitrine, échange, enchère
    const locks = await lockedCards(user.id);
    if ([...wanted.keys()].some((id) => locks.has(id)))
      return Response.json({ error: "card_locked" }, { status: 409 });
    return recycle(user.id, wanted);
  },
);

type Line = { id: string; rarity: Rarity; quantity: number };

async function recycle(userId: string, wanted: Map<string, number> | Rarity[]) {
  try {
    const result = await prisma.$transaction(async (tx) => {
      let lines: Line[];
      if (Array.isArray(wanted)) {
        const rows = await tx.userCard.findMany({
          where: { userId, quantity: { gt: 1 }, card: { rarity: { in: wanted } } },
          select: { cardId: true, quantity: true, card: { select: { rarity: true } } },
        });
        if (!rows.length) throw new MarketError("nothing_to_recycle", 400);
        lines = rows.map((r) => ({
          id: r.cardId,
          rarity: r.card.rarity,
          quantity: r.quantity - 1,
        }));
      } else {
        const cards = await tx.card.findMany({
          where: { id: { in: [...wanted.keys()] } },
          select: { id: true, rarity: true },
        });
        if (cards.length !== wanted.size) throw new MarketError("not_owned", 400);
        lines = cards.map((c) => ({ id: c.id, rarity: c.rarity, quantity: wanted.get(c.id)! }));
      }

      let gained = 0;
      let copies = 0;
      for (const line of lines) {
        await takeCard(tx, userId, line.id, line.quantity);
        gained += RECYCLE_VALUES[line.rarity] * line.quantity;
        copies += line.quantity;
      }
      const updated = await tx.user.update({
        where: { id: userId },
        data: { wikibits: { increment: gained } },
        select: { wikibits: true },
      });
      return { gained, copies, wikibits: updated.wikibits } satisfies RecycleResponse;
    });
    return Response.json(result);
  } catch (e) {
    if (e instanceof MarketError) return Response.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

async function recycleBulk(
  userId: string,
  filter: { maxViews: number; rarities: Rarity[]; cardIds?: string[]; excludeIds?: string[] },
) {
  const { candidates } = await bulkCandidates(userId, filter);
  const picked = candidates.filter((c) => filter.rarities.includes(c.rarity));
  if (!picked.length) return Response.json({ error: "nothing_to_recycle" }, { status: 400 });
  const rarityOf = new Map(picked.map((c) => [c.cardId, c.rarity]));
  const ids = [...rarityOf.keys()];

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        // un seul DELETE ... RETURNING : le gain colle à ce qui est vraiment parti
        const removed = await tx.$queryRaw<{ cardId: string; quantity: number }[]>`
        DELETE FROM "UserCard"
        WHERE "userId" = ${userId}::uuid AND "cardId" = ANY(${ids}::uuid[])
        RETURNING "cardId", "quantity"`;
        let gained = 0;
        let copies = 0;
        for (const row of removed) {
          gained += RECYCLE_VALUES[rarityOf.get(row.cardId)!] * row.quantity;
          copies += row.quantity;
        }
        if (copies === 0) throw new MarketError("nothing_to_recycle", 400);
        const updated = await tx.user.update({
          where: { id: userId },
          data: { wikibits: { increment: gained } },
          select: { wikibits: true },
        });
        return { gained, copies, wikibits: updated.wikibits } satisfies RecycleResponse;
      },
      { timeout: 30_000 },
    );
    return Response.json(result);
  } catch (e) {
    if (e instanceof MarketError) return Response.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
