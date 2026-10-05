import type { OpenPackResponse } from "@wikideck/shared";
import { toCardDto } from "@/lib/cards";
import { checkAchievements } from "@/lib/achievements";
import { toTagDto } from "@/lib/tags";
import { GODPACK_RATE, PACK_MAX, PACK_SIZE } from "@wikideck/shared";
import { refill, status } from "@/lib/packs";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { currentUser } from "@/lib/session";
import { takeFromPool } from "@/lib/card-pool";
import { acquireOpenSlot, releaseOpenSlot } from "@/lib/load";
import { godpackEntries } from "@/lib/catalog";
import { cardsFromIds, drawRandomCards, type WikiCard } from "@/lib/wikipedia";
import { randomInt, randomUUID } from "node:crypto";
import { withRateLimit } from "@/lib/rate-limit";

export const POST = withRateLimit("packs-open", { limit: 6, windowSec: 60 }, async () => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const lock = `lock:open-pack:${user.id}`;
  if (!(await redis.set(lock, "1", "EX", 30, "NX"))) {
    return Response.json({ error: "busy" }, { status: 409 });
  }

  const slot = randomUUID();
  let slotHeld = false;
  try {
    const state = refill(user);
    if (state.packs < 1)
      return Response.json({ error: "no_packs", ...status(state) }, { status: 403 });

    if (!(await acquireOpenSlot(slot))) {
      return Response.json(
        { error: "overloaded", retryAfter: 3 },
        { status: 503, headers: { "Retry-After": "3" } },
      );
    }
    slotHeld = true;

    let drawn: WikiCard[] = [];
    let godpack = false;
    // godpack : si le tirage spécial échoue on retombe sur un paquet normal
    if (randomInt(1_000_000) < GODPACK_RATE * 1_000_000) {
      try {
        const entries = await godpackEntries(PACK_SIZE);
        if (entries) drawn = await cardsFromIds(entries);
        godpack = drawn.length === PACK_SIZE;
      } catch {}
      if (!godpack) drawn = [];
    }
    if (!godpack) drawn = await takeFromPool(PACK_SIZE);
    if (drawn.length < PACK_SIZE) {
      const known = new Set(drawn.map((c) => c.pageId));
      const extra = await drawRandomCards(PACK_SIZE - drawn.length);
      drawn.push(...extra.filter((c) => !known.has(c.pageId)));
    }
    if (drawn.length < PACK_SIZE)
      return Response.json({ error: "wikipedia_unavailable" }, { status: 502 });
    drawn.sort((a, b) => a.views - b.views);

    const next = {
      packs: state.packs - 1,
      packsRefilledAt: state.packs >= PACK_MAX ? new Date() : state.packsRefilledAt,
    };

    const openingId = randomUUID();
    const cards = await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: next });
      const result = [];
      for (const wiki of drawn) {
        const card = await tx.card.upsert({
          where: { pageId: wiki.pageId },
          update: {},
          create: wiki,
        });
        const owned = await tx.userCard.upsert({
          where: { userId_cardId: { userId: user.id, cardId: card.id } },
          update: { quantity: { increment: 1 } },
          create: { userId: user.id, cardId: card.id },
          include: { tags: { orderBy: { name: "asc" } } },
        });
        await tx.pull.create({
          data: { userId: user.id, cardId: card.id, openingId, rarity: card.rarity },
        });
        result.push({
          ...toCardDto(card),
          isNew: owned.quantity === 1,
          quantity: owned.quantity,
          tags: owned.tags.map(toTagDto),
        });
      }
      return result;
    });

    checkAchievements(user.id);
    return Response.json({
      ...status(next),
      cards,
      ...(godpack && { godpack }),
    } satisfies OpenPackResponse);
  } finally {
    if (slotHeld) await releaseOpenSlot(slot);
    await redis.del(lock);
  }
});
