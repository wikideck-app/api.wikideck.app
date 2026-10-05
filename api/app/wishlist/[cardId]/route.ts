import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid } from "@/lib/tags";

type Ctx = { params: Promise<{ cardId: string }> };

export const DELETE = withRateLimit<Ctx>(
  "wishlist-remove",
  { limit: 60, windowSec: 60 },
  async (_request, { params }) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { cardId } = await params;
    if (!isUuid(cardId)) return Response.json({ error: "invalid" }, { status: 400 });
    await prisma.wishlistItem.deleteMany({ where: { userId: user.id, cardId } });
    return Response.json({ ok: true });
  },
);
