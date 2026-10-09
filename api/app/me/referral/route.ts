import { withRateLimit } from "@/lib/rate-limit";
import { referralInfo } from "@/lib/referral";
import { currentUser } from "@/lib/session";

export const GET = withRateLimit("me-referral", { limit: 30, windowSec: 60 }, async () => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await referralInfo(user));
});
