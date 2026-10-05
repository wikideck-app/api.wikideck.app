import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";

export const POST = withRateLimit("achievements-seen", { limit: 30, windowSec: 60 }, async () => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  await prisma.userAchievement.updateMany({
    where: { userId: user.id, seen: false },
    data: { seen: true },
  });
  return new Response(null, { status: 204 });
});
