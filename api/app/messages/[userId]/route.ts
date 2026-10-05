import { MESSAGE_MAX, THREAD_PAGE_SIZE, type ThreadResponse } from "@wikideck/shared";
import { checkAchievements } from "@/lib/achievements";
import { toMessageDto } from "@/lib/messages";
import { notifyUser } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid, readJson } from "@/lib/tags";
import { toPlayer } from "@/lib/trades";

type Ctx = { params: Promise<{ userId: string }> };

const areFriends = async (a: string, b: string) =>
  !!(await prisma.friendship.findFirst({
    where: {
      status: "ACCEPTED",
      OR: [
        { requesterId: a, addresseeId: b },
        { requesterId: b, addresseeId: a },
      ],
    },
    select: { id: true },
  }));

export const GET = withRateLimit<Ctx>(
  "messages-thread",
  { limit: 240, windowSec: 60 },
  async (_request, { params }) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { userId } = await params;
    if (!isUuid(userId) || userId === user.id)
      return Response.json({ error: "not_found" }, { status: 404 });
    const other = await prisma.user.findUnique({ where: { id: userId } });
    if (!other) return Response.json({ error: "not_found" }, { status: 404 });

    const [rows, canSend] = await Promise.all([
      prisma.message.findMany({
        where: {
          OR: [
            { senderId: user.id, recipientId: userId },
            { senderId: userId, recipientId: user.id },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: THREAD_PAGE_SIZE,
      }),
      areFriends(user.id, userId),
      prisma.message.updateMany({
        where: { senderId: userId, recipientId: user.id, readAt: null },
        data: { readAt: new Date() },
      }),
    ]);
    return Response.json({
      player: toPlayer(other),
      messages: rows.reverse().map((m) => toMessageDto(m, user.id)),
      canSend,
    } satisfies ThreadResponse);
  },
);

export const POST = withRateLimit<Ctx>(
  "messages-send",
  { limit: 30, windowSec: 60 },
  async (request, { params }) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { userId } = await params;
    if (!isUuid(userId) || userId === user.id)
      return Response.json({ error: "not_found" }, { status: 404 });

    const raw = (await readJson(request))?.body;
    const body = typeof raw === "string" ? raw.replace(/\r\n/g, "\n").trim() : "";
    if (!body || [...body].length > MESSAGE_MAX)
      return Response.json({ error: "invalid_message" }, { status: 400 });
    if (!(await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })))
      return Response.json({ error: "not_found" }, { status: 404 });
    if (!(await areFriends(user.id, userId)))
      return Response.json({ error: "not_friends" }, { status: 403 });

    const message = await prisma.message.create({
      data: { senderId: user.id, recipientId: userId, body },
    });
    checkAchievements(user.id);
    notifyUser(userId, { type: "message", from: user.username });
    return Response.json(toMessageDto(message, user.id), { status: 201 });
  },
);
