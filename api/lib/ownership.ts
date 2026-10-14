import { relationsWith } from "@/lib/friends";
import { prisma } from "@/lib/prisma";

/** exemplaires possédés par `userId`, par carte (absent : aucun) */
export async function quantitiesOf(userId: string, cardIds: string[]): Promise<Map<string, number>> {
  if (!cardIds.length) return new Map();
  const rows = await prisma.userCard.findMany({
    where: { userId, cardId: { in: cardIds } },
    select: { cardId: true, quantity: true },
  });
  return new Map(rows.map((r) => [r.cardId, r.quantity]));
}

/** peut-on voir les cartes de ce joueur ? profil public, ou profil privé d'un ami (même règle que pour proposer un échange) */
export async function canSeeCollection(viewerId: string, player: { id: string; isPublic: boolean }) {
  if (player.isPublic || player.id === viewerId) return true;
  return (await relationsWith(viewerId, [player.id]))(player.id) === "friend";
}
