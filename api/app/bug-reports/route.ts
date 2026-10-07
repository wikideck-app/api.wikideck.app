import { BUG_REPORT_MAX, BUG_REPORT_MIN, BUG_REPORT_OPEN_MAX } from "@wikideck/shared";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { notifyStaff } from "@/lib/staff-alerts";
import { readJson } from "@/lib/tags";

export const POST = withRateLimit("bug-report", { limit: 5, windowSec: 600 }, async (request) => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await readJson(request);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (message.length < BUG_REPORT_MIN || message.length > BUG_REPORT_MAX)
    return Response.json({ error: "invalid" }, { status: 400 });
  const page =
    typeof body?.page === "string" && body.page.startsWith("/") ? body.page.slice(0, 200) : null;

  const open = await prisma.bugReport.count({ where: { userId: user.id, status: "OPEN" } });
  if (open >= BUG_REPORT_OPEN_MAX) return Response.json({ error: "too_many_reports" }, { status: 429 });

  await prisma.bugReport.create({
    data: {
      userId: user.id,
      message,
      page,
      userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
    },
  });
  await notifyStaff({ type: "staff", kind: "bug" });
  return new Response(null, { status: 201 });
});
