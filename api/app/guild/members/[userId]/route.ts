import { leaveGuild, membershipOf } from "@/lib/guild";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid } from "@/lib/tags";

type Ctx = { params: Promise<{ userId: string }> };

export const DELETE = withRateLimit<Ctx>(
  "guild-kick",
  { limit: 20, windowSec: 60 },
  async (_request, { params }) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { userId } = await params;
    if (!isUuid(userId)) return Response.json({ error: "not_found" }, { status: 404 });

    const me = await membershipOf(user.id);
    if (!me || me.role !== "OWNER") return Response.json({ error: "forbidden" }, { status: 403 });
    if (userId === user.id) return Response.json({ error: "invalid" }, { status: 400 });
    const target = await prisma.guildMember.findUnique({ where: { userId } });
    if (!target || target.guildId !== me.guildId)
      return Response.json({ error: "not_found" }, { status: 404 });

    await prisma.$transaction((tx) => leaveGuild(tx, userId));
    return new Response(null, { status: 204 });
  },
);
