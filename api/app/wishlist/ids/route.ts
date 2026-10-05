import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";

export const GET = withRateLimit("wishlist-ids", { limit: 120, windowSec: 60 }, async () => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const items = await prisma.wishlistItem.findMany({
    where: { userId: user.id },
    select: { cardId: true },
  });
  return Response.json({ ids: items.map((i) => i.cardId) });
});
