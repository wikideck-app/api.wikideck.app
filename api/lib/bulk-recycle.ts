import { RECYCLE_VALUES, foldText, normalizeSettings, type Rarity } from "@wikideck/shared";
import { prisma } from "@/lib/prisma";

export type BulkCandidate = {
  cardId: string;
  title: string;
  rarity: Rarity;
  views: number;
  quantity: number;
};

export type Protection = {
  favorites: Set<string>;
  featured: Set<string>;
  showcase: string | null;
  trade: Set<string>;
  words: { word: string; key: string }[];
};
export type ProtectionKind = "favorite" | "featured" | "showcase" | "trade" | "word";
export type ProtectionReason = { kind: ProtectionKind; label: string };

export async function loadProtection(userId: string): Promise<Protection> {
  const [user, tradeItems, favorites] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { featuredCardIds: true, showcaseCardId: true, settings: true },
    }),
    prisma.tradeItem.findMany({
      where: {
        OR: [
          { side: "OFFER", trade: { status: "PENDING", proposerId: userId } },
          { side: "REQUEST", trade: { status: "PENDING", recipientId: userId } },
        ],
      },
      select: { cardId: true },
    }),
    prisma.userCard.findMany({
      where: { userId, favorite: true },
      select: { cardId: true },
    }),
  ]);
  return {
    favorites: new Set(favorites.map((f) => f.cardId)),
    featured: new Set(user.featuredCardIds),
    showcase: user.showcaseCardId,
    trade: new Set(tradeItems.map((t) => t.cardId)),
    words: normalizeSettings(user.settings).collection.protectedWords.map((word) => ({
      word,
      key: foldText(word),
    })),
  };
}

export function protectionReason(
  protection: Protection,
  card: { id: string; title: string; tagNames: string[] },
): ProtectionReason | null {
  if (protection.favorites.has(card.id)) return { kind: "favorite", label: "Favori" };
  if (protection.featured.has(card.id)) return { kind: "featured", label: "Mise en avant" };
  if (protection.showcase === card.id) return { kind: "showcase", label: "Vitrine" };
  if (protection.trade.has(card.id)) return { kind: "trade", label: "En échange" };
  if (protection.words.length) {
    // sous-chaîne sans accents ni casse : « chanteur » attrape « chanteurs »
    const fields = [card.title, ...card.tagNames].map(foldText);
    const hit = protection.words.find((w) => fields.some((f) => f.includes(w.key)));
    if (hit) return { kind: "word", label: `Mot protégé : ${hit.word}` };
  }
  return null;
}

export async function bulkCandidates(
  userId: string,
  filter: { maxViews: number; cardIds?: string[]; excludeIds?: string[] },
) {
  const [protection, rows] = await Promise.all([
    loadProtection(userId),
    prisma.userCard.findMany({
      where: {
        userId,
        card: { views: { lt: filter.maxViews } },
        ...(filter.cardIds && { cardId: { in: filter.cardIds } }),
      },
      select: {
        cardId: true,
        quantity: true,
        card: { select: { title: true, rarity: true, views: true } },
        tags: { select: { name: true } },
      },
    }),
  ]);

  const excluded = new Set(filter.excludeIds ?? []);
  const reasons = { favorite: 0, featured: 0, showcase: 0, trade: 0, word: 0 };
  const candidates: BulkCandidate[] = [];
  let protectedCards = 0;
  for (const r of rows) {
    const why = protectionReason(protection, {
      id: r.cardId,
      title: r.card.title,
      tagNames: r.tags.map((t) => t.name),
    });
    if (why) {
      protectedCards++;
      reasons[why.kind]++;
    } else if (!excluded.has(r.cardId)) {
      candidates.push({
        cardId: r.cardId,
        title: r.card.title,
        rarity: r.card.rarity,
        views: r.card.views,
        quantity: r.quantity,
      });
    }
  }
  return { candidates, protectedCards, reasons };
}

export const valueOf = (c: BulkCandidate) => RECYCLE_VALUES[c.rarity] * c.quantity;
