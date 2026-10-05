import type { BattlePuzzle } from "@wikideck/shared";
import { pickPuzzle } from "@/lib/battle";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";

export const GET = withRateLimit("battle-puzzle", { limit: 30, windowSec: 60 }, async () => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const puzzle = await pickPuzzle();
  if (!puzzle) return Response.json({ error: "no_catalog" }, { status: 503 });
  return Response.json(puzzle satisfies BattlePuzzle);
});
