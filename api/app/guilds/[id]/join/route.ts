import { Prisma } from "@/generated/prisma/client";
import { GuildError, joinGuild } from "@/lib/guild";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid } from "@/lib/tags";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withRateLimit<Ctx>(
  "guild-join",
  { limit: 10, windowSec: 60 },
  async (_request, { params }) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!isUuid(id)) return Response.json({ error: "not_found" }, { status: 404 });
    try {
      await joinGuild(user.id, id);
    } catch (e) {
      if (e instanceof GuildError) return Response.json({ error: e.code }, { status: e.status });
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
        return Response.json({ error: "already_in_guild" }, { status: 409 });
      throw e;
    }
    return new Response(null, { status: 204 });
  },
);
