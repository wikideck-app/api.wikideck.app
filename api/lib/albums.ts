import {
  ALBUM_HIGHLIGHTS,
  ALBUM_MAX_DEPTH,
  ALBUM_NAME_MAX,
  type AlbumSummary,
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

// ---- arbre des albums : au plus ALBUM_MAX_PER_USER lignes, on le charge en entier ----
export type AlbumNode = { id: string; name: string; parentId: string | null; updatedAt: Date };

export const loadTree = (userId: string): Promise<AlbumNode[]> =>
  prisma.album.findMany({
    where: { userId },
    select: { id: true, name: true, parentId: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });

const byId = (tree: AlbumNode[]) => new Map(tree.map((n) => [n.id, n]));

/** Niveau d'un album : 1 pour le premier niveau. */
export function depthOf(tree: AlbumNode[], id: string) {
  const nodes = byId(tree);
  let depth = 0;
  for (let n = nodes.get(id); n; n = n.parentId ? nodes.get(n.parentId) : undefined) depth++;
  return depth;
}

/** Du premier niveau jusqu'au parent direct (l'album lui-même exclu). */
export function trailOf(tree: AlbumNode[], id: string) {
  const nodes = byId(tree);
  const trail: { id: string; name: string }[] = [];
  for (let n = nodes.get(id)?.parentId; n; n = nodes.get(n)?.parentId) {
    const parent = nodes.get(n);
    if (!parent) break;
    trail.unshift({ id: parent.id, name: parent.name });
  }
  return trail;
}

/** Identifiants de l'album et de tous ses descendants. */
export function subtreeIds(tree: AlbumNode[], id: string) {
  const ids = [id];
  for (let i = 0; i < ids.length; i++) {
    for (const n of tree) if (n.parentId === ids[i]) ids.push(n.id);
  }
  return ids;
}

/** Nombre de niveaux de l'arbre sous un album, lui compris. */
export function heightOf(tree: AlbumNode[], id: string): number {
  const kids = tree.filter((n) => n.parentId === id);
  return 1 + Math.max(0, ...kids.map((k) => heightOf(tree, k.id)));
}

export const fitsDepth = (parentDepth: number, height = 1) => parentDepth + height <= ALBUM_MAX_DEPTH;

/** Cartes distinctes de chaque album et de ses sous-albums, en une requête. */
export async function subtreeCounts(userId: string) {
  const rows = await prisma.$queryRaw<{ albumId: string; count: number }[]>`
    WITH RECURSIVE tree AS (
      SELECT id AS root, id FROM "Album" WHERE "userId" = ${userId}::uuid
      UNION ALL
      SELECT t.root, a.id FROM "Album" a JOIN tree t ON a."parentId" = t.id
    )
    SELECT t.root AS "albumId", COUNT(DISTINCT ac."cardId")::int AS count
    FROM tree t JOIN "AlbumCard" ac ON ac."albumId" = t.id
    GROUP BY t.root`;
  return new Map(rows.map((r) => [r.albumId, r.count]));
}

/** Résumés des albums donnés ; les cartes de couverture ne sont calculées que si `withTop`. */
export async function summariesOf(
  userId: string,
  tree: AlbumNode[],
  ids: string[],
  { withTop = true, withCard }: { withTop?: boolean; withCard?: Set<string> | null } = {},
): Promise<AlbumSummary[]> {
  const counts = await subtreeCounts(userId);
  return Promise.all(
    ids.map(async (id) => {
      const node = tree.find((n) => n.id === id)!;
      return {
        id,
        name: node.name,
        parentId: node.parentId,
        cards: counts.get(id) ?? 0,
        subAlbums: subtreeIds(tree, id).length - 1,
        top: withTop ? await highlightsOf(userId, subtreeIds(tree, id)) : [],
        ...(withCard && { hasCard: withCard.has(id) }),
        updatedAt: node.updatedAt.toISOString(),
      };
    }),
  );
}

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

export async function highlightsOf(userId: string, albumIds: string[]) {
  const rows = await prisma.userCard.findMany({
    where: { userId, card: { albumCards: { some: { albumId: { in: albumIds } } } } },
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
