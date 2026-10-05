import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { notifyStaff } from "@/lib/staff-alerts";
import { isUuid, readJson } from "@/lib/tags";

export const POST = withRateLimit(
  "message-report",
  { limit: 10, windowSec: 60 },
  async (request) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const body = await readJson(request);
    if (!isUuid(body?.messageId)) return Response.json({ error: "invalid" }, { status: 400 });

    const message = await prisma.message.findUnique({ where: { id: body.messageId as string } });
    if (!message || message.recipientId !== user.id)
      return Response.json({ error: "not_found" }, { status: 404 });

    const previous = await prisma.message.findMany({
      where: {
        createdAt: { lt: message.createdAt },
        OR: [
          { senderId: message.senderId, recipientId: user.id },
          { senderId: user.id, recipientId: message.senderId },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    const context = previous.reverse().map((m) => ({
      from: m.senderId === message.senderId ? "sender" : "reporter",
      body: m.body,
      at: m.createdAt.toISOString(),
    }));

    try {
      await prisma.messageReport.create({
        data: {
          messageId: message.id,
          reporterId: user.id,
          senderId: message.senderId,
          body: message.body,
          context,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
        return Response.json({ error: "already_reported" }, { status: 409 });
      throw e;
    }
    await notifyStaff({ type: "staff", kind: "report" });
    return new Response(null, { status: 201 });
  },
);
