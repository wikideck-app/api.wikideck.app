import type { StaffBugReportRow } from "@wikideck/shared";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { requireStaff } from "@/lib/staff";

const PAGE = 20;

export const GET = withRateLimit(
  "staff-bug-reports",
  { limit: 120, windowSec: 60 },
  async (request) => {
    const auth = await requireStaff("MODERATOR");
    if (auth instanceof Response) return auth;
    const params = request.nextUrl.searchParams;
    const page = Math.max(1, Math.floor(Number(params.get("page"))) || 1);
    const where = params.get("status") === "all" ? {} : { status: "OPEN" };
    const [total, rows] = await Promise.all([
      prisma.bugReport.count({ where }),
      prisma.bugReport.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE,
        take: PAGE,
        include: { user: true },
      }),
    ]);
    const reports: StaffBugReportRow[] = rows.map((r) => ({
      id: r.id,
      status: r.status as StaffBugReportRow["status"],
      createdAt: r.createdAt.toISOString(),
      reporter: { id: r.user.id, username: r.user.username },
      message: r.message,
      page: r.page,
      userAgent: r.userAgent,
      handledBy: r.handledBy,
      handledAt: r.handledAt?.toISOString() ?? null,
    }));
    return Response.json({
      reports,
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / PAGE)),
    });
  },
);
