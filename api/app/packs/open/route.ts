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
import { AnilistUnavailableError, drawAnimeCards } from "@/lib/anilist";
import { avoidDuplicates, duplicateEffects } from "@/lib/duplicates";
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
    const body = await readJson(request);
    // paquets anime / manga : réserve séparée, sans booster de chance ni God Pack
    const anime = body?.kind === "anime";
    const wantBoost = !anime && body?.boost === true;
    if (wantBoost && user.dropBoosts < 1)
      return Response.json({ error: "no_boost" }, { status: 409 });

    const wikiState = refill(user);
    const animeState = refill({ packs: user.animePacks, packsRefilledAt: user.animePacksRefilledAt });
    const state = anime ? animeState : wikiState;
    if (state.packs < 1)
      return Response.json(
        { error: "no_packs", ...status(wikiState), anime: status(animeState) },
        { status: 403 },
      );

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
    if (!anime && randomInt(1_000_000) < GODPACK_RATE * 1_000_000) {
      try {
        const entries = await godpackEntries(PACK_SIZE);
        if (entries) drawn = await cardsFromIds(entries);
        godpack = drawn.length === PACK_SIZE;
      } catch {}
      if (!godpack) drawn = [];
    }
    if (anime) {
      try {
        drawn = await drawAnimeCards(PACK_SIZE);
      } catch (e) {
        if (e instanceof AnilistUnavailableError)
          return Response.json({ error: "anilist_unavailable" }, { status: 502 });
        throw e;
      }
    } else if (!godpack) drawn = await takeFromPool(PACK_SIZE);
    if (!anime && drawn.length < PACK_SIZE) {
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
    if (process.env.NODE_ENV !== "production" && !godpack && !anime && existsSync(forceFile)) {
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
    // articles de la boutique : protection ou réduction des doublons (pas sur un God Pack)
    const effects = duplicateEffects(user);
    let duplicatesAvoided = 0;
    if (!godpack && (effects.shield || effects.reduce)) {
      try {
        const result = await avoidDuplicates(user.id, drawn, { always: effects.shield, anime });
        drawn = result.cards;
        duplicatesAvoided = result.avoided;
      } catch {
        /* le paquet reste celui qui a été tiré */
      }
    }
    // la protection ne se consomme que si elle a servi
    const shieldUsed = effects.shield && duplicatesAvoided > 0;
    const mythicRate = forcedMythic.size ? 0 : boosted ? BOOST_MYTHIC_RATE : MYTHIC_RATE;
    drawn.sort((a, b) => a.views - b.views);

    const next = {
      packs: state.packs - 1,
      packsRefilledAt: state.packs >= PACK_MAX ? new Date() : state.packsRefilledAt,
    };
    const userData = {
      ...(anime ? { animePacks: next.packs, animePacksRefilledAt: next.packsRefilledAt } : next),
      ...(shieldUsed && { dupShieldPacks: { decrement: 1 } }),
    };

    const openingId = randomUUID();
    const cards = await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: userData });
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
              source: card.source,
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
      ...status(anime ? wikiState : next),
      anime: status(anime ? next : animeState),
      boosts: user.dropBoosts - (boosted ? 1 : 0),
      duplicateShield: user.dupShieldPacks - (shieldUsed ? 1 : 0),
      duplicateReductionUntil: user.dupReduceUntil?.toISOString() ?? null,
      duplicatesAvoided,
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
