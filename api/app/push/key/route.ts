import { vapidPublicKey } from "@/lib/web-push";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";

// clé publique VAPID : nécessaire au navigateur pour créer l'abonnement
export const GET = withRateLimit("push-key", { limit: 60, windowSec: 60 }, async () => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({ key: vapidPublicKey });
});
