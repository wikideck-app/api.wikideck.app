import type { WheelStatus } from "@wikideck/shared";
import { parisDay } from "@/lib/day";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";

export const GET = withRateLimit("wheel-status", { limit: 60, windowSec: 60 }, async () => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({ canSpin: user.lastWheelDay !== parisDay() } satisfies WheelStatus);
});
