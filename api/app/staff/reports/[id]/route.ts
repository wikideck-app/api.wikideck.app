import type { StaffReportAction } from "@wikideck/shared";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { logStaff, requireStaff } from "@/lib/staff";
import { refreshStaffAlerts } from "@/lib/staff-alerts";
import { isUuid, readJson } from "@/lib/tags";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withRateLimit<Ctx>(
  "staff-report-action",
  { limit: 60, windowSec: 60 },
  async (request, { params }) => {
    const auth = await requireStaff("MODERATOR");
    if (auth instanceof Response) return auth;
    const { id } = await params;
    if (!isUuid(id)) return Response.json({ error: "not_found" }, { status: 404 });
    const body = (await readJson(request)) as StaffReportAction | null;
    if (body?.action !== "dismiss" && body?.action !== "deleteMessage")
      return Response.json({ error: "invalid" }, { status: 400 });

    const report = await prisma.messageReport.findUnique({
      where: { id },
      include: { sender: true },
    });
    if (!report) return Response.json({ error: "not_found" }, { status: 404 });
    if (report.status !== "OPEN")
      return Response.json({ error: "already_resolved" }, { status: 409 });

    const status = body.action === "dismiss" ? "DISMISSED" : "DELETED";
    const done = await prisma.messageReport.updateMany({
      where: { id, status: "OPEN" },
      data: { status, handledBy: auth.user.username, handledAt: new Date() },
    });
    if (done.count === 0) return Response.json({ error: "already_resolved" }, { status: 409 });
    if (body.action === "deleteMessage" && report.messageId)
      await prisma.message.deleteMany({ where: { id: report.messageId } });
    await logStaff(
      auth.user,
      body.action === "dismiss" ? "report_dismiss" : "report_delete",
      report.sender,
    );
    await refreshStaffAlerts();
    return new Response(null, { status: 204 });
  },
);
