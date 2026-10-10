import type { QuestKind } from "@wikideck/shared";
import { prisma } from "@/lib/prisma";

/** Cartes différentes que le joueur possède pour un type de quête. */
export const cardsFor = (userId: string, kind: QuestKind) =>
  prisma.userCard.count({
    where: {
      userId,
      card: { source: kind === "anime_cards" ? { in: ["ANILIST", "KITSU"] } : "WIKIPEDIA" },
    },
  });
