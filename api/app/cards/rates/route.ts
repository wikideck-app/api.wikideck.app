import {
  ANIME_DROP_BANDS,
  DROP_RARITIES,
  GODPACK_RATE,
  PACK_SIZE,
  type DropRatesResponse,
} from "@wikideck/shared";
import { prisma } from "@/lib/prisma";
import { rarityCounts } from "@/lib/catalog";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";

export const GET = withRateLimit("cards-rates", { limit: 30, windowSec: 60 }, async (request) => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  // paquets anime / manga : la chance de chaque rareté est fixée (voir ANIME_DROP_BANDS) ; le nombre de
  // personnages de chaque rareté vient du catalogue (AniList + Kitsu)
  if (request.nextUrl.searchParams.get("source") === "anime") {
    const groups = await prisma.card.groupBy({
      by: ["rarity"],
      where: { source: { in: ["ANILIST", "KITSU"] }, baseCardId: null },
      _count: true,
    });
    const owned = new Map(groups.map((g) => [g.rarity, g._count]));
    return Response.json({
      total: groups.reduce((sum, g) => sum + g._count, 0),
      godpack: 0,
      rates: DROP_RARITIES.map((r) => {
        const p = ANIME_DROP_BANDS.find((b) => b.rarity === r.value)?.weight ?? 0;
        return {
          rarity: r.value,
          count: owned.get(r.value) ?? 0,
          percent: p * 100,
          perPack: (1 - (1 - p) ** PACK_SIZE) * 100,
        };
      }),
    } satisfies DropRatesResponse);
  }

  const counts = await rarityCounts();
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return Response.json({ error: "no_catalog" }, { status: 404 });
  return Response.json({
    total,
    godpack: GODPACK_RATE * 100,
    rates: DROP_RARITIES.map((r) => {
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
