import type { StaffBugReportAction } from "@wikideck/shared";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { logStaff, requireStaff } from "@/lib/staff";
import { refreshStaffAlerts } from "@/lib/staff-alerts";
import { isUuid, readJson } from "@/lib/tags";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withRateLimit<Ctx>(
  "staff-bug-report-action",
  { limit: 60, windowSec: 60 },
  async (request, { params }) => {
    const auth = await requireStaff("MODERATOR");
    if (auth instanceof Response) return auth;
    const { id } = await params;
    if (!isUuid(id)) return Response.json({ error: "not_found" }, { status: 404 });
    const body = (await readJson(request)) as StaffBugReportAction | null;
    if (body?.action !== "resolve" && body?.action !== "dismiss")
      return Response.json({ error: "invalid" }, { status: 400 });

    const report = await prisma.bugReport.findUnique({ where: { id }, include: { user: true } });
    if (!report) return Response.json({ error: "not_found" }, { status: 404 });
    const done = await prisma.bugReport.updateMany({
      where: { id, status: "OPEN" },
      data: {
        status: body.action === "resolve" ? "RESOLVED" : "DISMISSED",
        handledBy: auth.user.username,
        handledAt: new Date(),
      },
    });
    if (done.count === 0) return Response.json({ error: "already_resolved" }, { status: 409 });
    await logStaff(
      auth.user,
      body.action === "resolve" ? "bug_resolve" : "bug_dismiss",
      report.user,
    );
    await refreshStaffAlerts();
    return new Response(null, { status: 204 });
  },
);
