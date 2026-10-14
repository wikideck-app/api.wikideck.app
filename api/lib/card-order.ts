import type { CollectionSort } from "@wikideck/shared";
import type { Prisma } from "@/generated/prisma/client";

// ordre des cartes possédées (collection du joueur, cartes d'un autre joueur dans un échange)
export const COLLECTION_ORDER: Record<CollectionSort, Prisma.UserCardOrderByWithRelationInput[]> = {
  recent: [{ createdAt: "desc" }, { id: "asc" }],
  oldest: [{ createdAt: "asc" }, { id: "asc" }],
  rarity_desc: [{ card: { rarity: "desc" } }, { card: { views: "desc" } }, { id: "asc" }],
  rarity_asc: [{ card: { rarity: "asc" } }, { card: { views: "asc" } }, { id: "asc" }],
  alpha: [{ card: { title: "asc" } }, { id: "asc" }],
  alpha_desc: [{ card: { title: "desc" } }, { id: "asc" }],
  // doublons : le plus d'exemplaires d'abord, puis par rareté
  quantity_desc: [{ quantity: "desc" }, { card: { rarity: "desc" } }, { card: { views: "desc" } }, { id: "asc" }],
  quantity_asc: [{ quantity: "asc" }, { card: { rarity: "desc" } }, { card: { views: "desc" } }, { id: "asc" }],
  // popularité : fréquentation de l'article (Wikipédia) ou favoris du personnage (anime et manga)
  views_desc: [{ card: { views: "desc" } }, { id: "asc" }],
  views_asc: [{ card: { views: "asc" } }, { id: "asc" }],
  favorites: [{ favorite: "desc" }, { card: { rarity: "desc" } }, { card: { views: "desc" } }, { id: "asc" }],
};
