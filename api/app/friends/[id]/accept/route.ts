import { FRIENDS_MAX } from "@wikideck/shared";
import { checkAchievements } from "@/lib/achievements";
import { notifyUser } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid } from "@/lib/tags";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withRateLimit<Ctx>(
  "friends-accept",
  { limit: 30, windowSec: 60 },
  async (_request, { params }) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!isUuid(id)) return Response.json({ error: "not_found" }, { status: 404 });

    const request = await prisma.friendship.findFirst({
      where: { id, addresseeId: user.id, status: "PENDING" },
    });
    if (!request) return Response.json({ error: "not_found" }, { status: 404 });
    const count = (userId: string) =>
      prisma.friendship.count({
        where: { status: "ACCEPTED", OR: [{ requesterId: userId }, { addresseeId: userId }] },
      });
    if ((await count(user.id)) >= FRIENDS_MAX)
      return Response.json({ error: "too_many_friends" }, { status: 409 });
    if ((await count(request.requesterId)) >= FRIENDS_MAX)
      return Response.json({ error: "target_too_many_friends" }, { status: 409 });

    const done = await prisma.friendship.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "ACCEPTED", respondedAt: new Date() },
    });
    if (done.count) {
      checkAchievements(user.id, request.requesterId);
      notifyUser(request.requesterId, { type: "friend", from: user.username, accepted: true });
    }
    return done.count
      ? new Response(null, { status: 204 })
      : Response.json({ error: "not_found" }, { status: 404 });
  },
);
