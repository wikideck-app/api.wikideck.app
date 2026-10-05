import { ACHIEVEMENTS, type ClaimAchievementsResponse } from "@wikideck/shared";
import { claimAchievements } from "@/lib/achievements";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { readJson } from "@/lib/tags";

export const POST = withRateLimit(
  "achievements-claim",
  { limit: 30, windowSec: 60 },
  async (request) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

    const key = (await readJson(request))?.key as string | undefined;
    if (key !== undefined && !ACHIEVEMENTS.some((d) => d.key === key))
      return Response.json({ error: "not_found" }, { status: 404 });

    const claimed = await claimAchievements(user.id, key === undefined ? undefined : [key]);
    const me = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { wikibits: true },
    });
    return Response.json({ claimed, wikibits: me.wikibits } satisfies ClaimAchievementsResponse);
  },
);
