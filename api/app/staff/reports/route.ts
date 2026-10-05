import type { StaffReportRow } from "@wikideck/shared";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { requireStaff } from "@/lib/staff";
import { toReportRow } from "@/lib/staff-dto";

const PAGE = 20;

export const GET = withRateLimit(
  "staff-reports",
  { limit: 120, windowSec: 60 },
  async (request) => {
    const auth = await requireStaff("MODERATOR");
    if (auth instanceof Response) return auth;
    const params = request.nextUrl.searchParams;
    const page = Math.max(1, Math.floor(Number(params.get("page"))) || 1);
    const where = params.get("status") === "all" ? {} : { status: "OPEN" };
    const [total, rows] = await Promise.all([
      prisma.messageReport.count({ where }),
      prisma.messageReport.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE,
        take: PAGE,
        include: { reporter: true, sender: true },
      }),
    ]);
    const reports: StaffReportRow[] = rows.map(toReportRow);
    return Response.json({
      reports,
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / PAGE)),
    });
  },
);
