import { randomInt } from "node:crypto";
import { DUPLICATE_REDUCTION_CHANCE } from "@wikideck/shared";
import type { User } from "@/generated/prisma/client";
import { drawFromDb } from "@/lib/anilist";
import { takeFromPool } from "@/lib/card-pool";
import { prisma } from "@/lib/prisma";
import type { WikiCard } from "@/lib/wikipedia";

const ownedPageIds = async (userId: string, pageIds: number[]) =>
  new Set(
    (
      await prisma.userCard.findMany({
        where: { userId, card: { pageId: { in: pageIds } } },
        select: { card: { select: { pageId: true } } },
      })
    ).map((o) => o.card.pageId),
  );

/** Quels effets de la boutique s'appliquent à ce paquet ? */
export function duplicateEffects(user: Pick<User, "dupShieldPacks" | "dupReduceUntil">, now = new Date()) {
  return {
    shield: user.dupShieldPacks > 0,
    reduce: user.dupReduceUntil !== null && user.dupReduceUntil > now,
  };
}

// cartes de même rareté que `card`, susceptibles de la remplacer
async function candidates(card: WikiCard, anime: boolean, taken: Set<number>): Promise<WikiCard[]> {
  if (anime) {
    const found: WikiCard[] = [];
    for (let i = 0; i < 6; i++) {
      const c = await drawFromDb(card.rarity, new Set([...taken, ...found.map((f) => f.pageId)]));
      if (c) found.push(c);
    }
    return found;
  }
  return (await takeFromPool(12)).filter((c) => c.rarity === card.rarity && !taken.has(c.pageId));
}

/**
 * Remplace les cartes que le joueur possède déjà par des cartes qu'il n'a pas, de même rareté quand c'est
 * possible. `always` : protection (toutes les cartes) ; sinon réduction (une carte sur deux environ).
 */
export async function avoidDuplicates(
  userId: string,
  drawn: WikiCard[],
  { always, anime }: { always: boolean; anime: boolean },
): Promise<{ cards: WikiCard[]; avoided: number }> {
  const owned = await ownedPageIds(userId, drawn.map((c) => c.pageId));
  const taken = new Set(drawn.map((c) => c.pageId));
  const cards = [...drawn];
  let avoided = 0;
  for (let i = 0; i < cards.length; i++) {
    if (!owned.has(cards[i].pageId)) continue;
    if (!always && randomInt(1_000_000) >= DUPLICATE_REDUCTION_CHANCE * 1_000_000) continue;
    const options = await candidates(cards[i], anime, taken);
    if (!options.length) continue;
    const mine = await ownedPageIds(userId, options.map((o) => o.pageId));
    const fresh = options.find((o) => !mine.has(o.pageId));
    if (!fresh) continue;
    taken.add(fresh.pageId);
    cards[i] = fresh;
    avoided++;
  }
  return { cards, avoided };
}
