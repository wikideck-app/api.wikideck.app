import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid, readJson } from "@/lib/tags";

type Ctx = { params: Promise<{ cardId: string }> };

export const PUT = withRateLimit<Ctx>(
  "card-favorite",
  { limit: 120, windowSec: 60 },
  async (request, { params }) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { cardId } = await params;
    if (!isUuid(cardId)) return Response.json({ error: "not_found" }, { status: 404 });
    const favorite = (await readJson(request))?.favorite;
    if (typeof favorite !== "boolean") return Response.json({ error: "invalid" }, { status: 400 });

    const updated = await prisma.userCard.updateMany({
      where: { userId: user.id, cardId },
      data: { favorite },
    });
    if (updated.count === 0) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ favorite });
  },
);
