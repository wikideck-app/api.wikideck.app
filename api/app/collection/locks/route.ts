import { lockedCards } from "@/lib/card-locks";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";

export const GET = withRateLimit("collection-locks", { limit: 120, windowSec: 60 }, async () => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({ locks: Object.fromEntries(await lockedCards(user.id)) });
});
