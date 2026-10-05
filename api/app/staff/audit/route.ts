import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { requireStaff } from "@/lib/staff";
import { toAuditRow } from "@/lib/staff-dto";

const PAGE = 30;

export const GET = withRateLimit("staff-audit", { limit: 60, windowSec: 60 }, async (request) => {
  const auth = await requireStaff("MODERATOR");
  if (auth instanceof Response) return auth;
  const page = Math.max(1, Math.floor(Number(request.nextUrl.searchParams.get("page"))) || 1);
  const [total, rows] = await Promise.all([
    prisma.staffAction.count(),
    prisma.staffAction.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE,
      take: PAGE,
    }),
  ]);
  return Response.json({
    actions: rows.map(toAuditRow),
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / PAGE)),
  });
});
