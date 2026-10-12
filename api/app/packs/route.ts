import type { PackStatus } from "@wikideck/shared";
import { prisma } from "@/lib/prisma";
import { refill, status } from "@/lib/packs";
import { currentUser } from "@/lib/session";
import { withRateLimit } from "@/lib/rate-limit";
import { warmPool } from "@/lib/card-pool";
import { warmAnimePages } from "@/lib/anilist";

export const GET = withRateLimit("packs-status", { limit: 60, windowSec: 60 }, async () => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  warmPool();
  warmAnimePages();

  const speed = user.packSpeedUntil;
  const state = refill(user, new Date(), speed);
  const anime = refill({ packs: user.animePacks, packsRefilledAt: user.animePacksRefilledAt }, new Date(), speed);
  const data = {
    ...(state !== user && state),
    ...(anime.packs !== user.animePacks || anime.packsRefilledAt !== user.animePacksRefilledAt
      ? { animePacks: anime.packs, animePacksRefilledAt: anime.packsRefilledAt }
      : {}),
  };
  if (Object.keys(data).length) await prisma.user.update({ where: { id: user.id }, data });
  return Response.json({
    ...status(state, new Date(), speed),
    boosts: user.dropBoosts,
    anime: status(anime, new Date(), speed),
    bonus: user.bonusPacks,
    duplicateShield: user.dupShieldPacks,
    duplicateReductionUntil:
      user.dupReduceUntil && user.dupReduceUntil > new Date() ? user.dupReduceUntil.toISOString() : null,
  } satisfies PackStatus);
});
