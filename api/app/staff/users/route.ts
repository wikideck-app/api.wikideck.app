import type { StaffMemberRow } from "@wikideck/shared";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { requireStaff } from "@/lib/staff";
import { toMemberRow } from "@/lib/staff-dto";

const PAGE = 20;

export const GET = withRateLimit("staff-users", { limit: 120, windowSec: 60 }, async (request) => {
  const auth = await requireStaff("MODERATOR");
  if (auth instanceof Response) return auth;

  const params = request.nextUrl.searchParams;
  const q = params.get("q")?.trim().slice(0, 64) ?? "";
  const filter = params.get("filter");
  const page = Math.max(1, Math.floor(Number(params.get("page"))) || 1);

  const where = {
    ...(q && {
      OR: [
        { username: { contains: q, mode: "insensitive" as const } },
        { discordId: { equals: q } },
      ],
    }),
    ...(filter === "banned" && { bannedAt: { not: null } }),
    ...(filter === "staff" && { OR: [{ staffRole: { not: null } }] }),
  };
  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: { _count: { select: { cards: true } } },
    }),
  ]);
  const rows: StaffMemberRow[] = await Promise.all(users.map((u) => toMemberRow(u)));
  return Response.json({
    users: rows,
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / PAGE)),
  });
});
