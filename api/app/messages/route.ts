import type { ConversationDto, ConversationsResponse } from "@wikideck/shared";
import { toMessageDto } from "@/lib/messages";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { toPlayer } from "@/lib/trades";

export const GET = withRateLimit("messages-list", { limit: 120, windowSec: 60 }, async () => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const [lasts, unread] = await Promise.all([
    prisma.$queryRaw<
      {
        id: string;
        senderId: string;
        recipientId: string;
        body: string;
        createdAt: Date;
        readAt: Date | null;
        other: string;
      }[]
    >`
      SELECT * FROM (
        SELECT DISTINCT ON (other) m.id, m."senderId", m."recipientId", m.body, m."createdAt", m."readAt", other
        FROM (
          SELECT *, CASE WHEN "senderId" = ${user.id}::uuid THEN "recipientId" ELSE "senderId" END AS other
          FROM "Message"
          WHERE "senderId" = ${user.id}::uuid OR "recipientId" = ${user.id}::uuid
        ) m
        ORDER BY other, m."createdAt" DESC
      ) t
      ORDER BY "createdAt" DESC
      LIMIT 100`,
    prisma.message.groupBy({
      by: ["senderId"],
      where: { recipientId: user.id, readAt: null },
      _count: true,
    }),
  ]);
  const players = await prisma.user.findMany({ where: { id: { in: lasts.map((l) => l.other) } } });
  const byId = new Map(players.map((p) => [p.id, p]));
  const unreadBy = new Map(unread.map((u) => [u.senderId, u._count]));

  const conversations = lasts.flatMap((l): ConversationDto[] => {
    const player = byId.get(l.other);
    return player
      ? [
          {
            player: toPlayer(player),
            last: toMessageDto(l, user.id),
            unread: unreadBy.get(l.other) ?? 0,
          },
        ]
      : [];
  });
  return Response.json({ conversations } satisfies ConversationsResponse);
});
