import { cookies } from "next/headers";
import {
  DELETE_CONFIRMATION,
  FEATURED_MAX,
  USERNAME_MAX,
  USERNAME_MIN,
  USERNAME_PATTERN,
  normalizeSettings,
  parseTitleId,
  titleId,
  type MeProfile,
} from "@wikideck/shared";
import { toCardDto } from "@/lib/cards";
import { checkAchievements } from "@/lib/achievements";
import { leaveGuild } from "@/lib/guild";
import { logStaff } from "@/lib/staff";
import { prisma } from "@/lib/prisma";
import { cardsFor } from "@/lib/quests";
import { withRateLimit } from "@/lib/rate-limit";
import { SESSION_COOKIE, cookieOptions, currentUser, destroySession, sessionUser } from "@/lib/session";
import { isUuid, readJson } from "@/lib/tags";
import { parseUsername } from "@/lib/usernames";

async function profileOf(userId: string): Promise<MeProfile | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { showcaseCard: true },
  });
  if (!user) return null;
  return {
    username: user.username,
    displayedTitle: user.displayedTitle,
    discordName: user.discordName,
    avatarUrl: user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.${
          user.avatar.startsWith("a_") ? "gif" : "png"
        }?size=128`
      : null,
    isPublic: user.isPublic,
    settings: normalizeSettings(user.settings),
    showcase: user.showcaseCard ? toCardDto(user.showcaseCard) : null,
    createdAt: user.createdAt.toISOString(),
  };
}

export const GET = withRateLimit("me-get", { limit: 60, windowSec: 60 }, async () => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await profileOf(user.id));
});

export const PATCH = withRateLimit("me-update", { limit: 20, windowSec: 60 }, async (request) => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await readJson(request);
  if (!body) return Response.json({ error: "invalid" }, { status: 400 });

  const data: {
    username?: string;
    isPublic?: boolean;
    showcaseCardId?: string | null;
    featuredCardIds?: string[];
    displayedTitle?: string | null;
  } = {};

  if (body.username !== undefined) {
    const username = parseUsername(body.username);
    if (!username) return Response.json({ error: "invalid_username" }, { status: 400 });
    const taken = await prisma.user.findFirst({
      where: { id: { not: user.id }, username: { equals: username, mode: "insensitive" } },
    });
    if (taken) return Response.json({ error: "username_taken" }, { status: 409 });
    data.username = username;
  }

  if (body.isPublic !== undefined) {
    if (typeof body.isPublic !== "boolean")
      return Response.json({ error: "invalid" }, { status: 400 });
    data.isPublic = body.isPublic;
  }

  if (body.showcaseCardId !== undefined) {
    if (body.showcaseCardId === null) {
      data.showcaseCardId = null;
    } else {
      if (!isUuid(body.showcaseCardId)) return Response.json({ error: "invalid" }, { status: 400 });
      const owned = await prisma.userCard.findUnique({
        where: { userId_cardId: { userId: user.id, cardId: body.showcaseCardId } },
      });
      if (!owned) return Response.json({ error: "not_owned" }, { status: 404 });
      data.showcaseCardId = body.showcaseCardId;
    }
  }

  if (body.featuredCardIds !== undefined) {
    const ids = body.featuredCardIds;
    if (
      !Array.isArray(ids) ||
      ids.length > FEATURED_MAX ||
      !ids.every(isUuid) ||
      new Set(ids).size !== ids.length
    )
      return Response.json({ error: "invalid" }, { status: 400 });
    const owned = await prisma.userCard.count({ where: { userId: user.id, cardId: { in: ids } } });
    if (owned !== ids.length) return Response.json({ error: "not_owned" }, { status: 404 });
    data.featuredCardIds = ids;
  }

  if (body.displayedTitle !== undefined) {
    if (body.displayedTitle === null) {
      data.displayedTitle = null;
    } else {
      const title = parseTitleId(body.displayedTitle);
      if (!title) return Response.json({ error: "invalid" }, { status: 400 });
      // on ne peut afficher qu'un titre déjà obtenu
      const cards = await cardsFor(user.id, title.kind === "anime" ? "anime_cards" : "wikipedia_cards");
      if (cards < title.min) return Response.json({ error: "title_locked" }, { status: 409 });
      data.displayedTitle = titleId(title.kind, title.key);
    }
  }

  await prisma.user.update({ where: { id: user.id }, data });
  if (data.showcaseCardId) checkAchievements(user.id);
  return Response.json(await profileOf(user.id));
});

export const DELETE = withRateLimit("me-delete", { limit: 3, windowSec: 60 }, async (request) => {
  const user = await sessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await readJson(request);
  if (body?.confirm !== DELETE_CONFIRMATION) {
    return Response.json({ error: "confirmation_required" }, { status: 400 });
  }

  const open = await prisma.auction.count({
    where: { status: "ACTIVE", OR: [{ sellerId: user.id }, { leaderId: user.id }] },
  });
  if (open > 0) return Response.json({ error: "active_auctions" }, { status: 409 });

  // trace minimale pour le staff : pseudo et date, ni identifiant Discord ni motif
  await logStaff(user, "self_delete", user);
  await prisma.$transaction(async (tx) => {
    await leaveGuild(tx, user.id);
    await tx.user.delete({ where: { id: user.id } });
  });

  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await destroySession(token);
  store.set(SESSION_COOKIE, "", cookieOptions(0));
  return new Response(null, { status: 204 });
});
