import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid } from "@/lib/tags";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = withRateLimit<Ctx>(
  "guild-wish-cancel",
  { limit: 30, windowSec: 60 },
  async (_request, { params }) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!isUuid(id)) return Response.json({ error: "not_found" }, { status: 404 });
    const done = await prisma.guildWish.updateMany({
      where: { id, userId: user.id, status: "OPEN" },
      data: { status: "CANCELLED" },
    });
    return done.count
      ? new Response(null, { status: 204 })
      : Response.json({ error: "not_found" }, { status: 404 });
  },
);
