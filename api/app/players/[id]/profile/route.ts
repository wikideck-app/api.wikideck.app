import {
  FEATURED_MAX,
  NO_TITLE,
  PROFILE_ALBUMS_MAX,
  RARITIES,
  WISHLIST_MAX,
  parseTitleId,
  type ProfileDto,
} from "@wikideck/shared";
import { ACHIEVEMENTS } from "@wikideck/shared";
import type { Rarity } from "@/generated/prisma/client";
import { loadTree, summariesOf } from "@/lib/albums";
import { toCardDto } from "@/lib/cards";
import { rarityCounts } from "@/lib/catalog";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid } from "@/lib/tags";
import { toPlayer } from "@/lib/trades";

type Ctx = { params: Promise<{ id: string }> };

const RARITY_ORDER = [...RARITIES].reverse().map((r) => r.value);

export const GET = withRateLimit<Ctx>(
  "player-profile",
  { limit: 60, windowSec: 60 },
  async (_request, { params }) => {
    const me = await currentUser();
    if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!isUuid(id)) return Response.json({ error: "not_found" }, { status: 404 });

    const player = await prisma.user.findUnique({
      where: { id },
      include: { showcaseCard: true, guildMember: { include: { guild: true } } },
    });
    if (!player) return Response.json({ error: "not_found" }, { status: 404 });

    const isSelf = player.id === me.id;
    const visible = isSelf || player.isPublic;

    const friendship = isSelf
      ? null
      : await prisma.friendship.findFirst({
          where: {
            OR: [
              { requesterId: me.id, addresseeId: id },
              { requesterId: id, addresseeId: me.id },
            ],
          },
        });
    const relation = !friendship
      ? "none"
      : friendship.status === "ACCEPTED"
        ? "friend"
        : friendship.requesterId === me.id
          ? "outgoing"
          : "incoming";

    const dto: ProfileDto = {
      player: toPlayer(player),
      displayedTitle: null,
      wishlistMax: WISHLIST_MAX + player.wishlistSlots,
      createdAt: player.createdAt.toISOString(),
      isSelf,
      relation,
      friendshipId: friendship?.id ?? null,
      guild: player.guildMember
        ? {
            id: player.guildMember.guild.id,
            name: player.guildMember.guild.name,
            role: player.guildMember.role,
          }
        : null,
      visible,
      stats: null,
      showcase: null,
      featured: [],
      featuredAuto: false,
      featuredHidden: false,
      wishlist: [],
      achievements: [],
      albums: [],
    };
    if (!visible) return Response.json(dto);

    const [
      byRarityRows,
      copies,
      rarest,
      packs,
      trades,
      sold,
      won,
      friends,
      unlocked,
      counts,
      wished,
      wikipediaCards,
      animeCards,
    ] = await Promise.all([
      prisma.$queryRaw<{ rarity: Rarity; n: bigint }[]>`
          SELECT c.rarity, count(*) AS n FROM "UserCard" uc JOIN "Card" c ON c.id = uc."cardId"
          WHERE uc."userId" = ${id}::uuid GROUP BY c.rarity`,
      prisma.userCard.aggregate({ where: { userId: id }, _sum: { quantity: true } }),
      player.featuredHidden
        ? Promise.resolve([])
        : player.featuredCardIds.length
        ? prisma.userCard.findMany({
            where: { userId: id, cardId: { in: player.featuredCardIds } },
            include: { card: true },
          })
        : prisma.userCard.findMany({
            where: { userId: id },
            include: { card: true },
            orderBy: [{ card: { rarity: "desc" } }, { card: { views: "desc" } }],
            take: FEATURED_MAX,
          }),
      prisma.$queryRaw<{ n: bigint }[]>`
          SELECT count(DISTINCT "openingId") AS n FROM "Pull" WHERE "userId" = ${id}::uuid`,
      prisma.trade.count({
        where: { status: "ACCEPTED", OR: [{ proposerId: id }, { recipientId: id }] },
      }),
      prisma.auction.count({ where: { sellerId: id, status: "SOLD" } }),
      prisma.auction.count({ where: { leaderId: id, status: "SOLD" } }),
      prisma.friendship.count({
        where: { status: "ACCEPTED", OR: [{ requesterId: id }, { addresseeId: id }] },
      }),
      prisma.userAchievement.findMany({ where: { userId: id }, select: { key: true } }),
      rarityCounts(),
      prisma.wishlistItem.findMany({
        where: { userId: id },
        orderBy: { createdAt: "desc" },
        include: { card: true },
      }),
      prisma.userCard.count({ where: { userId: id, card: { source: "WIKIPEDIA" } } }),
      prisma.userCard.count({ where: { userId: id, card: { source: { in: ["ANILIST", "KITSU"] } } } }),
    ]);

    const byRarity = Object.fromEntries(RARITY_ORDER.map((r) => [r, 0])) as Record<Rarity, number>;
    for (const row of byRarityRows) byRarity[row.rarity] = Number(row.n);
    const cards = Object.values(byRarity).reduce((a, b) => a + b, 0);
    const catalog = [...counts.values()].reduce((a, b) => a + b, 0);

    dto.stats = {
      cards,
      wikipediaCards,
      animeCards,
      completion: catalog ? Math.min(100, (cards / catalog) * 100) : 0,
      copies: copies._sum.quantity ?? 0,
      byRarity,
      packs: Number(packs[0]?.n ?? 0),
      trades,
      auctionsSold: sold,
      auctionsWon: won,
      friends,
    };
    // titre choisi : retenu seulement s'il est toujours mérité (le joueur a pu perdre des cartes)
    const chosen = parseTitleId(player.displayedTitle);
    if (player.displayedTitle === NO_TITLE) dto.displayedTitle = NO_TITLE;
    else if (chosen && (chosen.kind === "anime" ? animeCards : wikipediaCards) >= chosen.min)
      dto.displayedTitle = `${chosen.kind}:${chosen.key}`;
    dto.showcase = player.showcaseCard ? toCardDto(player.showcaseCard) : null;
    const order = new Map(player.featuredCardIds.map((cid, i) => [cid, i]));
    dto.featured = [...rarest]
      .sort((a, b) => (order.get(a.cardId) ?? 0) - (order.get(b.cardId) ?? 0))
      .map((r) => ({ ...toCardDto(r.card), quantity: r.quantity }));
    dto.featuredHidden = player.featuredHidden;
    dto.featuredAuto = !player.featuredHidden && player.featuredCardIds.length === 0;
    dto.wishlist = wished.map((w) => toCardDto(w.card));
    const tree = await loadTree(id);
    const shown = await prisma.album.findMany({
      where: { userId: id, onProfile: true },
      select: { id: true },
      orderBy: [{ profileOrder: "asc" }, { updatedAt: "desc" }],
      take: PROFILE_ALBUMS_MAX,
    });
    dto.albums = await summariesOf(
      id,
      tree,
      shown.map((n) => n.id),
    );
    dto.achievements = unlocked
      .map((u) => u.key)
      .filter((k) => ACHIEVEMENTS.some((a) => a.key === k));
    return Response.json(dto);
  },
);
