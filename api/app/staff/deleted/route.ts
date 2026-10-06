import type { DeletedAccountRow } from "@wikideck/shared";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { requireStaff } from "@/lib/staff";

const PAGE = 30;
const ACTIONS = ["delete_user", "self_delete"];

export const GET = withRateLimit("staff-deleted", { limit: 60, windowSec: 60 }, async (request) => {
  const auth = await requireStaff("MODERATOR");
  if (auth instanceof Response) return auth;
  const page = Math.max(1, Math.floor(Number(request.nextUrl.searchParams.get("page"))) || 1);
  const where = { action: { in: ACTIONS } };
  const [total, rows] = await Promise.all([
    prisma.staffAction.count({ where }),
    prisma.staffAction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE,
      take: PAGE,
    }),
  ]);
  const accounts = rows.map((a): DeletedAccountRow => {
    const d = (a.detail ?? {}) as { reason?: unknown; discordId?: unknown };
    return {
      id: a.id,
      username: a.targetName ?? "?",
      at: a.createdAt.toISOString(),
      by: a.action === "self_delete" ? null : a.actorName,
      reason: typeof d.reason === "string" ? d.reason : null,
      discordId: typeof d.discordId === "string" ? d.discordId : null,
    };
  });
  return Response.json({
    accounts,
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / PAGE)),
  });
});
