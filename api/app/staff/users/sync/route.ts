import { type StaffSyncResponse } from "@wikideck/shared";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { requireStaff, staffRoleOf } from "@/lib/staff";
import { avatarOf } from "@/lib/trades";
import { isUuid } from "@/lib/tags";

const MAX_LIMIT = 500;

// Export de tous les membres, par curseur, pour synchroniser un bot ou un serveur Discord :
//   GET /staff/users/sync?limit=500            → { users, next, total }
//   GET /staff/users/sync?limit=500&after=<next>
// L'identifiant Discord est une donnée personnelle : réservé aux administrateurs.
export const GET = withRateLimit(
  "staff-users-sync",
  { limit: 30, windowSec: 60 },
  async (request) => {
    const auth = await requireStaff("ADMIN");
    if (auth instanceof Response) return auth;

    const params = request.nextUrl.searchParams;
    const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(params.get("limit"))) || 100));
    const after = params.get("after");
    if (after !== null && !isUuid(after)) return Response.json({ error: "invalid" }, { status: 400 });

    // les identifiants sont ordonnés par date de création : le curseur ne saute ni ne répète personne
    const [total, rows] = await Promise.all([
      prisma.user.count(),
      prisma.user.findMany({
        where: after ? { id: { gt: after } } : {},
        orderBy: { id: "asc" },
        take: limit + 1,
        include: { _count: { select: { cards: true } } },
      }),
    ]);
    const page = rows.slice(0, limit);
    return Response.json({
      users: page.map((u) => ({
        id: u.id,
        username: u.username,
        discordId: u.discordId,
        discordName: u.discordName,
        avatarUrl: avatarOf(u),
        createdAt: u.createdAt.toISOString(),
        wikibits: u.wikibits,
        cards: u._count.cards,
        staff: staffRoleOf(u),
        banned: u.bannedAt !== null,
      })),
      next: rows.length > limit ? page[page.length - 1].id : null,
      total,
    } satisfies StaffSyncResponse);
  },
);
