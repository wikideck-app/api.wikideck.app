import {
  FRIENDS_MAX,
  FRIEND_REQUESTS_MAX,
  type FriendDto,
  type FriendsResponse,
} from "@wikideck/shared";
import { Prisma } from "@/generated/prisma/client";
import { checkAchievements } from "@/lib/achievements";
import { toCardDto } from "@/lib/cards";
import { notifyUser } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid, readJson } from "@/lib/tags";
import { toPlayer } from "@/lib/trades";

export const GET = withRateLimit("friends-list", { limit: 60, windowSec: 60 }, async () => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const rows = await prisma.friendship.findMany({
    where: { OR: [{ requesterId: user.id }, { addresseeId: user.id }] },
    include: {
      requester: { include: { showcaseCard: true } },
      addressee: { include: { showcaseCard: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const friendRows = rows.filter((r) => r.status === "ACCEPTED");
  const publicIds = friendRows
    .map((r) => (r.requesterId === user.id ? r.addressee : r.requester))
    .filter((p) => p.isPublic)
    .map((p) => p.id);
  const counts = await prisma.userCard.groupBy({
    by: ["userId"],
    where: { userId: { in: publicIds } },
    _count: true,
  });
  const cardCount = new Map(counts.map((c) => [c.userId, c._count]));

  const friends: FriendDto[] = friendRows
    .map((r) => {
      const other = r.requesterId === user.id ? r.addressee : r.requester;
      return {
        id: r.id,
        player: toPlayer(other),
        since: (r.respondedAt ?? r.createdAt).toISOString(),
        cards: other.isPublic ? (cardCount.get(other.id) ?? 0) : null,
        showcase: other.isPublic && other.showcaseCard ? toCardDto(other.showcaseCard) : null,
      };
    })
    .sort((a, b) => a.player.username.localeCompare(b.player.username, "fr"));

  const pending = rows.filter((r) => r.status === "PENDING");
  return Response.json({
    friends,
    incoming: pending
      .filter((r) => r.addresseeId === user.id)
      .map((r) => ({
        id: r.id,
        player: toPlayer(r.requester),
        createdAt: r.createdAt.toISOString(),
      })),
    outgoing: pending
      .filter((r) => r.requesterId === user.id)
      .map((r) => ({
        id: r.id,
        player: toPlayer(r.addressee),
        createdAt: r.createdAt.toISOString(),
      })),
  } satisfies FriendsResponse);
});

export const POST = withRateLimit(
  "friends-request",
  { limit: 20, windowSec: 60 },
  async (request) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const targetId = (await readJson(request))?.userId;
    if (!isUuid(targetId)) return Response.json({ error: "invalid" }, { status: 400 });
    if (targetId === user.id) return Response.json({ error: "self_friend" }, { status: 400 });
    if (!(await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } })))
      return Response.json({ error: "player_not_found" }, { status: 404 });

    try {
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.friendship.findFirst({
          where: {
            OR: [
              { requesterId: user.id, addresseeId: targetId },
              { requesterId: targetId, addresseeId: user.id },
            ],
          },
        });
        if (existing?.status === "ACCEPTED") return { error: "already_friends" as const };
        if (existing && existing.requesterId === user.id)
          return { error: "already_requested" as const };

        const [mine, theirs] = await Promise.all(
          [user.id, targetId].map((id) =>
            tx.friendship.count({
              where: { status: "ACCEPTED", OR: [{ requesterId: id }, { addresseeId: id }] },
            }),
          ),
        );
        if (mine >= FRIENDS_MAX) return { error: "too_many_friends" as const };
        if (existing) {
          if (theirs >= FRIENDS_MAX) return { error: "target_too_many_friends" as const };
          await tx.friendship.update({
            where: { id: existing.id },
            data: { status: "ACCEPTED", respondedAt: new Date() },
          });
          return { status: "accepted" as const };
        }
        const outgoing = await tx.friendship.count({
          where: { requesterId: user.id, status: "PENDING" },
        });
        if (outgoing >= FRIEND_REQUESTS_MAX) return { error: "too_many_requests" as const };
        await tx.friendship.create({ data: { requesterId: user.id, addresseeId: targetId } });
        return { status: "requested" as const };
      });
      if ("error" in result) return Response.json({ error: result.error }, { status: 409 });
      if (result.status === "accepted") checkAchievements(user.id, targetId);
      notifyUser(targetId, {
        type: "friend",
        from: user.username,
        accepted: result.status === "accepted",
      });
      return Response.json(result, { status: 201 });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
        return Response.json({ error: "already_requested" }, { status: 409 });
      throw e;
    }
  },
);
