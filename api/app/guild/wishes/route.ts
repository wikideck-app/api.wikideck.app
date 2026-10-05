import type { WishDto, WishesResponse } from "@wikideck/shared";
import { toCardDto } from "@/lib/cards";
import { dayStartOf, membershipOf } from "@/lib/guild";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid, readJson } from "@/lib/tags";
import { toPlayer } from "@/lib/trades";

export const GET = withRateLimit("guild-wishes", { limit: 60, windowSec: 60 }, async () => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const membership = await membershipOf(user.id);
  if (!membership) return Response.json({ error: "no_guild" }, { status: 404 });

  const today = dayStartOf();
  const [wishes, received] = await Promise.all([
    prisma.guildWish.findMany({
      where: { guildId: membership.guildId, status: "OPEN" },
      include: { card: true, user: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.guildWish.count({
      where: { userId: user.id, status: "FULFILLED", fulfilledAt: { gte: today } },
    }),
  ]);
  const owned = new Set(
    (
      await prisma.userCard.findMany({
        where: { userId: user.id, cardId: { in: wishes.map((w) => w.cardId) } },
        select: { cardId: true },
      })
    ).map((o) => o.cardId),
  );
  const dto = (w: (typeof wishes)[number]): WishDto => ({
    id: w.id,
    card: toCardDto(w.card),
    player: toPlayer(w.user),
    createdAt: w.createdAt.toISOString(),
    isMine: w.userId === user.id,
    canGift: w.userId !== user.id && owned.has(w.cardId),
  });

  return Response.json({
    wishes: wishes.filter((w) => w.userId !== user.id).map(dto),
    mine: wishes.filter((w) => w.userId === user.id).map(dto)[0] ?? null,
    receivedToday: received > 0,
    resetsAt: new Date(today.getTime() + 86_400_000).toISOString(),
  } satisfies WishesResponse);
});

export const POST = withRateLimit(
  "guild-wish-create",
  { limit: 15, windowSec: 60 },
  async (request) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const membership = await membershipOf(user.id);
    if (!membership) return Response.json({ error: "no_guild" }, { status: 404 });
    const cardId = (await readJson(request))?.cardId;
    if (!isUuid(cardId)) return Response.json({ error: "invalid" }, { status: 400 });

    const card = await prisma.card.findUnique({ where: { id: cardId } });
    if (!card) return Response.json({ error: "not_found" }, { status: 404 });
    if (await prisma.userCard.findUnique({ where: { userId_cardId: { userId: user.id, cardId } } }))
      return Response.json({ error: "already_owned" }, { status: 409 });
    if (await prisma.guildWish.findFirst({ where: { userId: user.id, status: "OPEN" } }))
      return Response.json({ error: "has_open_wish" }, { status: 409 });

    await prisma.guildWish.create({
      data: { guildId: membership.guildId, userId: user.id, cardId },
    });
    return new Response(null, { status: 201 });
  },
);
