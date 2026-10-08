import { ALBUM_MAX_DEPTH, RARITIES, type AlbumResponse, type Rarity } from "@wikideck/shared";
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

type Ctx = { params: Promise<{ id: string }> };

export const GET = withRateLimit<Ctx>(
  "album-get",
  { limit: 90, windowSec: 60 },
  async (request, { params }) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!isUuid(id)) return Response.json({ error: "not_found" }, { status: 404 });
    const album = await albumOf(user.id, id);
    if (!album) return Response.json({ error: "not_found" }, { status: 404 });
    await pruneAlbums(user.id);

    const sp = request.nextUrl.searchParams;
    const query = (sp.get("q") ?? "").trim().slice(0, 100);
    const rarities = rarityFilter(sp.get("rarity"));
    const tree = await loadTree(user.id);
    const scope = sp.get("scope") === "all" ? "all" : "own";
    const family = subtreeIds(tree, id);
    // « own » : les cartes rangées dans cet album ; « all » : aussi celles de ses sous-albums
    const inAlbum: Prisma.CardWhereInput = {
      albumCards: { some: { albumId: scope === "all" ? { in: family } : id } },
    };
    const inFamily: Prisma.CardWhereInput = { albumCards: { some: { albumId: { in: family } } } };
    const where: Prisma.UserCardWhereInput = {
      userId: user.id,
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
      prisma.userCard.count({ where: { userId: user.id, card: inFamily } }),
      prisma.userCard.count({ where }),
      prisma.userCard.findMany({
        where: { userId: user.id, card: inAlbum },
        select: { card: { select: { rarity: true } } },
      }),
      highlightsOf(user.id, family),
      summariesOf(user.id, tree, childIds),
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
        createdAt: album.createdAt.toISOString(),
      },
      trail: trailOf(tree, id),
      children,
      depth: depthOf(tree, id),
      scope,
      count,
      highlights,
      cards: rows.map((r) => toCollectionCard(r, true)),
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
    const data: { name?: string; parentId?: string | null } = {};
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
      return Response.json({ id, name: updated.name, parentId: updated.parentId });
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
