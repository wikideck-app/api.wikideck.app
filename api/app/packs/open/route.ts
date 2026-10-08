import type { OpenPackResponse } from "@wikideck/shared";
import { toCardDto } from "@/lib/cards";
import { checkAchievements } from "@/lib/achievements";
import { toTagDto } from "@/lib/tags";
import {
  BOOST_MYTHIC_RATE,
  GODPACK_RATE,
  MYTHIC_RATE,
  PACK_MAX,
  PACK_SIZE,
} from "@wikideck/shared";
import { refill, status } from "@/lib/packs";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { sessionUser } from "@/lib/session";
import { takeFromPool } from "@/lib/card-pool";
import { acquireOpenSlot, releaseOpenSlot } from "@/lib/load";
import { godpackEntries, legendaryEntry } from "@/lib/catalog";
import { cardsFromIds, drawRandomCards, type WikiCard } from "@/lib/wikipedia";
import { randomInt, randomUUID } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { withRateLimit } from "@/lib/rate-limit";
import { readJson } from "@/lib/tags";

export const POST = withRateLimit("packs-open", { limit: 6, windowSec: 60 }, async (request) => {
  const user = await sessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const lock = `lock:open-pack:${user.id}`;
  if (!(await redis.set(lock, "1", "EX", 30, "NX"))) {
    return Response.json({ error: "busy" }, { status: 409 });
  }

  const slot = randomUUID();
  let slotHeld = false;
  try {
    const wantBoost = (await readJson(request))?.boost === true;
    if (wantBoost && user.dropBoosts < 1)
      return Response.json({ error: "no_boost" }, { status: 409 });

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
    // booster : une légendaire garantie, elle remplace la carte la moins vue du paquet
    let boosted = false;
    if (wantBoost && !godpack) {
      boosted = true;
      if (!drawn.some((c) => c.rarity === "LEGENDARY")) {
        try {
          const entry = await legendaryEntry();
          const [card] = entry ? await cardsFromIds([entry]) : [];
          if (card && !drawn.some((c) => c.pageId === card.pageId)) {
            drawn.sort((a, b) => a.views - b.views);
            drawn[0] = card;
          } else boosted = false;
        } catch {
          boosted = false;
        }
      }
    }
    // dev uniquement : un fichier .dev-force-pack à la racine de l'API force, une seule fois,
    // une légendaire et une mythique dans le prochain paquet (pour tester les animations)
    const forcedMythic = new Set<number>();
    const forceFile = join(process.cwd(), ".dev-force-pack");
    if (process.env.NODE_ENV !== "production" && !godpack && existsSync(forceFile)) {
      unlinkSync(forceFile);
      const picks: WikiCard[] = [];
      for (let i = 0; i < 20 && picks.length < 2; i++) {
        const entry = await legendaryEntry();
        const [card] = entry ? await cardsFromIds([entry]) : [];
        if (card && !picks.some((c) => c.pageId === card.pageId)) picks.push(card);
      }
      if (picks.length === 2) {
        drawn.sort((a, b) => a.views - b.views);
        drawn.splice(0, 2, ...picks);
        forcedMythic.add(picks[0].pageId);
      }
    }
    const mythicRate = forcedMythic.size ? 0 : boosted ? BOOST_MYTHIC_RATE : MYTHIC_RATE;
    drawn.sort((a, b) => a.views - b.views);

    const next = {
      packs: state.packs - 1,
      packsRefilledAt: state.packs >= PACK_MAX ? new Date() : state.packsRefilledAt,
    };

    const openingId = randomUUID();
    const cards = await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: next });
      if (boosted) {
        const used = await tx.user.updateMany({
          where: { id: user.id, dropBoosts: { gt: 0 } },
          data: { dropBoosts: { decrement: 1 } },
        });
        if (used.count === 0) throw new Error("no_boost");
      }
      const result = [];
      for (const wiki of drawn) {
        let card = await tx.card.upsert({
          where: { pageId: wiki.pageId },
          update: {},
          create: wiki,
        });
        // une légendaire sur 1/MYTHIC_RATE sort en version mythique
        if (
          card.rarity === "LEGENDARY" &&
          (forcedMythic.has(wiki.pageId) || randomInt(1_000_000) < mythicRate * 1_000_000)
        ) {
          card = await tx.card.upsert({
            where: { pageId: -card.pageId },
            update: {},
            create: {
              pageId: -card.pageId,
              title: card.title,
              description: card.description,
              extract: card.extract,
              imageUrl: card.imageUrl,
              url: card.url,
              views: card.views,
              length: card.length,
              languages: card.languages,
              rarity: "MYTHIC",
              baseCardId: card.id,
            },
          });
        }
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
      boosts: user.dropBoosts - (boosted ? 1 : 0),
      cards,
      ...(godpack && { godpack }),
    } satisfies OpenPackResponse);
  } catch (e) {
    if (e instanceof Error && e.message === "no_boost")
      return Response.json({ error: "no_boost" }, { status: 409 });
    throw e;
  } finally {
    if (slotHeld) await releaseOpenSlot(slot);
    await redis.del(lock);
  }
});
