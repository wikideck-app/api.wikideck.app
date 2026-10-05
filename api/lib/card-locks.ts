import { loadProtection } from "@/lib/bulk-recycle";
import { prisma } from "@/lib/prisma";

export async function lockedCards(userId: string): Promise<Map<string, string>> {
  const [protection, listed] = await Promise.all([
    loadProtection(userId),
    prisma.auction.findMany({
      where: { sellerId: userId, status: "ACTIVE" },
      select: { cardId: true },
    }),
  ]);
  const locks = new Map<string, string>();
  const add = (ids: Iterable<string>, reason: string) => {
    for (const id of ids) if (!locks.has(id)) locks.set(id, reason);
  };
  add(protection.favorites, "Carte favorite (étoile)");
  add(protection.featured, "Mise en avant sur votre profil");
  if (protection.showcase) add([protection.showcase], "Carte vitrine de votre profil");
  add(
    listed.map((a) => a.cardId),
    "Déjà aux enchères",
  );
  add(protection.trade, "Dans un échange en attente");
  return locks;
}
