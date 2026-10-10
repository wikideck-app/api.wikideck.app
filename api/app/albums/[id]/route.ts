import { ALBUM_MAX_DEPTH, PROFILE_ALBUMS_MAX, RARITIES, type AlbumResponse, type Rarity } from "@wikideck/shared";
import { Prisma } from "@/generated/prisma/client";
import {
  BEST_FIRST,
  PAGE,
  albumOf,
  clampPage,
  depthOf,
  fitsDepth,
  heightOf,
  highlightsOf,
  loadTree,
  parseAlbumName,
  pruneAlbums,
  rarityFilter,
  subtreeIds,
  summariesOf,
  textFilter,
  toCollectionCard,
  trailOf,
} from "@/lib/albums";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid, readJson } from "@/lib/tags";
import { toPlayer } from "@/lib/trades";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withRateLimit<Ctx>(
  "album-get",
  { limit: 90, windowSec: 60 },
  async (request, { params }) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!isUuid(id)) return Response.json({ error: "not_found" }, { status: 404 });
    const found = await prisma.album.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });
    const album = found;
    const ownerId = found.userId;
    const readOnly = ownerId !== user.id;
    if (readOnly) {
      // un autre joueur : profil public, et album affiché sur le profil (ou rangé dans l'un d'eux)
      if (!found.user.isPublic) return Response.json({ error: "not_found" }, { status: 404 });
      const ownerTree = await prisma.album.findMany({
        where: { userId: ownerId },
        select: { id: true, parentId: true, onProfile: true },
      });
      const byId = new Map(ownerTree.map((n) => [n.id, n]));
      let shown = false;
      for (let n = byId.get(id); n && !shown; n = n.parentId ? byId.get(n.parentId) : undefined)
        shown = n.onProfile;
      if (!shown) return Response.json({ error: "not_found" }, { status: 404 });
    } else {
      await pruneAlbums(user.id);
    }

    const sp = request.nextUrl.searchParams;
    const query = (sp.get("q") ?? "").trim().slice(0, 100);
    const rarities = rarityFilter(sp.get("rarity"));
    const tree = await loadTree(ownerId);
    const scope = sp.get("scope") === "all" ? "all" : "own";
    const family = subtreeIds(tree, id);
    // « own » : les cartes rangées dans cet album ; « all » : aussi celles de ses sous-albums
    const inAlbum: Prisma.CardWhereInput = {
      albumCards: { some: { albumId: scope === "all" ? { in: family } : id } },
    };
    const inFamily: Prisma.CardWhereInput = { albumCards: { some: { albumId: { in: family } } } };
    const where: Prisma.UserCardWhereInput = {
      userId: ownerId,
      card: {
        AND: [
          inAlbum,
          ...(rarities.length ? [{ rarity: { in: rarities } }] : []),
          ...textFilter(query),
        ],
      },
    };

    const childIds = tree.filter((n) => n.parentId === id).map((n) => n.id);
    const [count, total, byRarity, highlights, children] = await Promise.all([
      prisma.userCard.count({ where: { userId: ownerId, card: inFamily } }),
      prisma.userCard.count({ where }),
      prisma.userCard.findMany({
        where: { userId: ownerId, card: inAlbum },
        select: { card: { select: { rarity: true } } },
      }),
      highlightsOf(ownerId, family),
      summariesOf(ownerId, tree, childIds),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / PAGE));
    const page = clampPage(sp.get("page"), totalPages);
    const rows = await prisma.userCard.findMany({
      where,
      include: { card: true },
      orderBy: BEST_FIRST,
      skip: (page - 1) * PAGE,
      take: PAGE,
    });
    const tally = new Map<Rarity, number>();
    for (const r of byRarity) tally.set(r.card.rarity, (tally.get(r.card.rarity) ?? 0) + 1);

    return Response.json({
      album: {
        id: album.id,
        name: album.name,
        parentId: album.parentId,
        onProfile: album.onProfile,
        createdAt: album.createdAt.toISOString(),
      },
      readOnly,
      owner: toPlayer(found.user),
      trail: trailOf(tree, id),
      children,
      depth: depthOf(tree, id),
      scope,
      count,
      highlights,
      cards: rows.map((r) => ({ ...toCollectionCard(r, true), ...(readOnly && { favorite: false }) })),
      total,
      page,
      pageSize: PAGE,
      totalPages,
      rarities,
      query,
      counts: [...RARITIES]
        .reverse()
        .map((r) => ({ rarity: r.value, count: tally.get(r.value) ?? 0 })),
    } satisfies AlbumResponse);
  },
);

// renomme et/ou déplace : { name?: string, parentId?: string | null }
export const PATCH = withRateLimit<Ctx>(
  "album-rename",
  { limit: 30, windowSec: 60 },
  async (request, { params }) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { id } = await params;
    const album = isUuid(id) ? await albumOf(user.id, id) : null;
    if (!album) return Response.json({ error: "not_found" }, { status: 404 });
    const body = await readJson(request);
    const data: { name?: string; parentId?: string | null; onProfile?: boolean } = {};
    if (body?.onProfile !== undefined) {
      if (typeof body.onProfile !== "boolean") return Response.json({ error: "invalid" }, { status: 400 });
      if (body.onProfile && !album.onProfile) {
        const shown = await prisma.album.count({ where: { userId: user.id, onProfile: true } });
        if (shown >= PROFILE_ALBUMS_MAX)
          return Response.json({ error: "profile_albums_full", max: PROFILE_ALBUMS_MAX }, { status: 409 });
      }
      data.onProfile = body.onProfile;
    }
    if (body?.name !== undefined) {
      const name = parseAlbumName(body.name);
      if (!name) return Response.json({ error: "invalid_name" }, { status: 400 });
      data.name = name;
    }
    if (body && "parentId" in body) {
      const parentId = body.parentId;
      if (parentId !== null && !isUuid(parentId))
        return Response.json({ error: "not_found" }, { status: 404 });
      const tree = await loadTree(user.id);
      if (parentId !== null) {
        if (!tree.some((a) => a.id === parentId))
          return Response.json({ error: "not_found" }, { status: 404 });
        // on ne range pas un album dans lui-même ni dans l'un de ses sous-albums
        if (subtreeIds(tree, id).includes(parentId))
          return Response.json({ error: "album_cycle" }, { status: 409 });
        if (!fitsDepth(depthOf(tree, parentId), heightOf(tree, id)))
          return Response.json({ error: "album_too_deep", max: ALBUM_MAX_DEPTH }, { status: 409 });
      }
      data.parentId = parentId;
    }
    if (Object.keys(data).length === 0) return Response.json({ error: "invalid" }, { status: 400 });
    try {
      const updated = await prisma.album.update({ where: { id }, data });
      return Response.json({
        id,
        name: updated.name,
        parentId: updated.parentId,
        onProfile: updated.onProfile,
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
        return Response.json({ error: "album_exists" }, { status: 409 });
      throw e;
    }
  },
);

export const DELETE = withRateLimit<Ctx>(
  "album-delete",
  { limit: 30, windowSec: 60 },
  async (_request, { params }) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!isUuid(id)) return Response.json({ error: "not_found" }, { status: 404 });
    const gone = await prisma.album.deleteMany({ where: { id, userId: user.id } });
    if (gone.count === 0) return Response.json({ error: "not_found" }, { status: 404 });
    return new Response(null, { status: 204 });
  },
);
