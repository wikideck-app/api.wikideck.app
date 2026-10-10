import { WISHLIST_MAX, type StaffWishlistsResponse } from "@wikideck/shared";
import { toCardDto } from "@/lib/cards";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { requireStaff } from "@/lib/staff";
import { isUuid } from "@/lib/tags";

const MAX_LIMIT = 200;

// Listes d'envies de tous les joueurs, qu'ils aient un profil public ou non (bot, synchronisation) :
//   GET /staff/wishlists?limit=200                → { wishlists, next }
//   GET /staff/wishlists?limit=200&after=<next>   (page suivante)
//   GET /staff/wishlists?discordId=<id>           (un seul joueur)
//   GET /staff/wishlists?cardId=<id>              (les joueurs qui veulent cette carte)
// Réservé aux administrateurs : elle contourne le réglage « profil privé ».
export const GET = withRateLimit("staff-wishlists", { limit: 30, windowSec: 60 }, async (request) => {
  const auth = await requireStaff("ADMIN");
  if (auth instanceof Response) return auth;

  const params = request.nextUrl.searchParams;
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(params.get("limit"))) || 100));
  const after = params.get("after");
  const discordId = params.get("discordId")?.trim() || null;
  const cardId = params.get("cardId");
  if ((after !== null && !isUuid(after)) || (cardId !== null && !isUuid(cardId)))
    return Response.json({ error: "invalid" }, { status: 400 });

  const users = await prisma.user.findMany({
    where: {
      bannedAt: null,
      wishlist: cardId ? { some: { cardId } } : { some: {} },
      ...(discordId && { discordId }),
      ...(after && { id: { gt: after } }),
    },
    orderBy: { id: "asc" },
    take: limit + 1,
    select: {
      id: true,
      discordId: true,
      discordName: true,
      username: true,
      wishlistSlots: true,
      wishlist: {
        orderBy: { createdAt: "desc" },
        include: { card: true },
      },
    },
  });
  const page = users.slice(0, limit);
  return Response.json({
    wishlists: page.map((u) => ({
      userId: u.id,
      discordId: u.discordId,
      discordName: u.discordName,
      username: u.username,
      max: WISHLIST_MAX + u.wishlistSlots,
      cards: u.wishlist.map((w) => toCardDto(w.card)),
    })),
    next: users.length > limit ? page[page.length - 1].id : null,
  } satisfies StaffWishlistsResponse);
});
