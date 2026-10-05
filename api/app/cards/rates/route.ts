import { GODPACK_RATE, PACK_SIZE, RARITIES, type DropRatesResponse } from "@wikideck/shared";
import { rarityCounts } from "@/lib/catalog";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";

export const GET = withRateLimit("cards-rates", { limit: 30, windowSec: 60 }, async () => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const counts = await rarityCounts();
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return Response.json({ error: "no_catalog" }, { status: 404 });
  return Response.json({
    total,
    godpack: GODPACK_RATE * 100,
    rates: RARITIES.map((r) => {
      const count = counts.get(r.value) ?? 0;
      const p = count / total;
      return {
        rarity: r.value,
        count,
        percent: p * 100,
        perPack: (1 - (1 - p) ** PACK_SIZE) * 100,
      };
    }),
  } satisfies DropRatesResponse);
});
