import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid } from "@/lib/tags";
import { toPlayer } from "@/lib/trades";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withRateLimit<Ctx>(
  "player-get",
  { limit: 60, windowSec: 60 },
  async (_request, { params }) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!isUuid(id)) return Response.json({ error: "not_found" }, { status: 404 });
    const player = await prisma.user.findUnique({ where: { id } });
    return player
      ? Response.json(toPlayer(player))
      : Response.json({ error: "not_found" }, { status: 404 });
  },
);
