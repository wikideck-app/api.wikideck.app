import {
  ALBUM_HIGHLIGHTS,
  ALBUM_NAME_MAX,
  COLLECTION_PAGE_SIZE,
  RARITIES,
  searchTokens,
  type CollectionCard,
  type Rarity,
} from "@wikideck/shared";
import type { Prisma } from "@/generated/prisma/client";
import { toCardDto } from "@/lib/cards";
import { prisma } from "@/lib/prisma";

export const parseAlbumName = (value: unknown) => {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= ALBUM_NAME_MAX ? name : null;
};

export const albumOf = (userId: string, id: string) =>
  prisma.album.findFirst({ where: { id, userId } });

// les cartes recyclées, vendues ou échangées sortent des albums : on nettoie à la lecture
export async function pruneAlbums(userId: string) {
  await prisma.$executeRaw`
    DELETE FROM "AlbumCard" ac USING "Album" a
    WHERE ac."albumId" = a.id AND a."userId" = ${userId}::uuid
      AND NOT EXISTS (
        SELECT 1 FROM "UserCard" uc WHERE uc."userId" = ${userId}::uuid AND uc."cardId" = ac."cardId"
      )`;
}

export const rarityFilter = (code: string | null): Rarity[] =>
  RARITIES.filter((r) => (code ?? "").split(",").includes(r.code)).map((r) => r.value);

export function textFilter(query: string): Prisma.CardWhereInput[] {
  return searchTokens(query).map((t) => ({
    OR: [
      { title: { contains: t, mode: "insensitive" as const } },
      { description: { contains: t, mode: "insensitive" as const } },
    ],
  }));
}

export const BEST_FIRST: Prisma.UserCardOrderByWithRelationInput[] = [
  { card: { rarity: "desc" } },
  { card: { views: "desc" } },
  { card: { title: "asc" } },
];

export async function highlightsOf(userId: string, albumId: string) {
  const rows = await prisma.userCard.findMany({
    where: { userId, card: { albumCards: { some: { albumId } } } },
    include: { card: true },
    orderBy: BEST_FIRST,
    take: ALBUM_HIGHLIGHTS,
  });
  return rows.map((r) => toCollectionCard(r, true));
}

export const toCollectionCard = (
  o: { quantity: number; favorite: boolean; card: Parameters<typeof toCardDto>[0] },
  inAlbum?: boolean,
): CollectionCard => ({
  ...toCardDto(o.card),
  quantity: o.quantity,
  favorite: o.favorite,
  tags: [],
  ...(inAlbum !== undefined && { inAlbum }),
});

export const PAGE = COLLECTION_PAGE_SIZE;

export const clampPage = (raw: string | null, totalPages: number) => {
  const n = Number(raw);
  return Math.min(totalPages, Math.max(1, Number.isInteger(n) ? n : 1));
};
