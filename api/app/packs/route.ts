import type { PackStatus } from "@wikideck/shared";
import { prisma } from "@/lib/prisma";
import { refill, status } from "@/lib/packs";
import { currentUser } from "@/lib/session";
import { withRateLimit } from "@/lib/rate-limit";
import { warmPool } from "@/lib/card-pool";

export const GET = withRateLimit("packs-status", { limit: 60, windowSec: 60 }, async () => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  warmPool();

  const state = refill(user);
  if (state !== user) {
    await prisma.user.update({ where: { id: user.id }, data: state });
  }
  return Response.json({ ...status(state), boosts: user.dropBoosts } satisfies PackStatus);
});
