import type { StaffGuildRow } from "@wikideck/shared";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { requireStaff } from "@/lib/staff";

const PAGE = 20;

export const GET = withRateLimit("staff-guilds", { limit: 120, windowSec: 60 }, async (request) => {
  const auth = await requireStaff("MODERATOR");
  if (auth instanceof Response) return auth;
  const params = request.nextUrl.searchParams;
  const q = params.get("q")?.trim().slice(0, 64) ?? "";
  const page = Math.max(1, Math.floor(Number(params.get("page"))) || 1);
  const where = q ? { name: { contains: q, mode: "insensitive" as const } } : {};

  const [total, rows] = await Promise.all([
    prisma.guild.count({ where }),
    prisma.guild.findMany({
      where,
      orderBy: [{ members: { _count: "desc" } }, { createdAt: "asc" }],
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: {
        _count: { select: { members: true } },
        members: { where: { role: "OWNER" }, include: { user: true }, take: 1 },
      },
    }),
  ]);
  const guilds: StaffGuildRow[] = rows.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    members: g._count.members,
    owner: g.members[0]?.user.username ?? null,
    createdAt: g.createdAt.toISOString(),
  }));
  return Response.json({ guilds, total, page, totalPages: Math.max(1, Math.ceil(total / PAGE)) });
});
