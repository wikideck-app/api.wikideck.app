import { leaveGuild } from "@/lib/guild";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";

export const POST = withRateLimit("guild-leave", { limit: 10, windowSec: 60 }, async () => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  await prisma.$transaction((tx) => leaveGuild(tx, user.id));
  return new Response(null, { status: 204 });
});
