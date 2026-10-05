import { RARITIES } from "@wikideck/shared";
import { marketStats } from "@/lib/market";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";

export const GET = withRateLimit(
  "market-stats-all",
  { limit: 60, windowSec: 60 },
  async (request) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const code = request.nextUrl.searchParams.get("rarity");
    const rarity = RARITIES.find((r) => r.code === code)?.value ?? null;
    return Response.json(await marketStats(rarity));
  },
);
