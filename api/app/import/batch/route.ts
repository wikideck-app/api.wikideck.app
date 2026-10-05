import { randomUUID } from "node:crypto";
import {
  IMPORT_BATCH_SIZE,
  IMPORT_MAX_CARDS,
  type ImportBatchResponse,
  type ImportItem,
} from "@wikideck/shared";
import { Prisma } from "@/generated/prisma/client";
import { acquireOpenSlot, releaseOpenSlot } from "@/lib/load";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { readJson } from "@/lib/tags";
import { WikipediaUnavailableError, resolveTitles } from "@/lib/wikipedia";

async function reserveQuota(userId: string, wanted: number): Promise<number> {
  const rows = await prisma.$queryRaw<{ granted: number }[]>`
    WITH old AS (SELECT "importedCount" AS c FROM "User" WHERE id = ${userId}::uuid FOR UPDATE)
    UPDATE "User" u
    SET "importedCount" = old.c + LEAST(${wanted}::int, GREATEST(${IMPORT_MAX_CARDS}::int - old.c, 0))
    FROM old
    WHERE u.id = ${userId}::uuid
    RETURNING (u."importedCount" - old.c) AS granted`;
  return Number(rows[0]?.granted ?? 0);
}

function parseItems(value: unknown): ImportItem[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > IMPORT_BATCH_SIZE) return null;
  const items: ImportItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const { title, lang, quantity } = raw as Record<string, unknown>;
    if (typeof title !== "string" || typeof lang !== "string") return null;
    const clean = title.trim().replace(/\s+/g, " ");
    if (!clean || clean.length > 255 || /[|\n\r]/.test(clean)) return null;
    const qty = Number.isInteger(quantity) ? (quantity as number) : 1;
    items.push({
      title: clean,
      lang: lang.slice(0, 8).toLowerCase(),
      quantity: Math.min(99, Math.max(1, qty)),
    });
  }
  return items;
}

export const POST = withRateLimit("import-batch", { limit: 60, windowSec: 60 }, async (request) => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const items = parseItems((await readJson(request))?.items);
  if (!items) return Response.json({ error: "invalid" }, { status: 400 });

  const remainingBefore = IMPORT_MAX_CARDS - user.importedCount;
  if (remainingBefore <= 0) return Response.json({ error: "import_limit" }, { status: 403 });

  const french = items.filter((i) => i.lang === "fr");
  const otherLanguage = items.length - french.length;
  if (french.length === 0) {
    return Response.json({
      imported: 0,
      alreadyImported: 0,
      notFound: 0,
      otherLanguage,
      remaining: remainingBefore,
    } satisfies ImportBatchResponse);
  }

  const slot = randomUUID();
  if (!(await acquireOpenSlot(slot))) {
    return Response.json(
      { error: "overloaded", retryAfter: 3 },
      { status: 503, headers: { "Retry-After": "3" } },
    );
  }

  try {
    let resolved;
    try {
      resolved = await resolveTitles(french.map((i) => i.title));
    } catch (e) {
      if (e instanceof WikipediaUnavailableError) {
        return Response.json(
          { error: "wikipedia_unavailable", retryAfter: 5 },
          { status: 502, headers: { "Retry-After": "5" } },
        );
      }
      throw e;
    }
    const { cards, notFound, sources } = resolved;
    const quantityByTitle = new Map(french.map((i) => [i.title, i.quantity]));

    const granted = await reserveQuota(user.id, cards.length);
    if (granted === 0 && cards.length > 0) {
      return Response.json({ error: "import_limit" }, { status: 403 });
    }

    let imported = 0;
    let alreadyImported = 0;
    try {
      for (const wiki of cards) {
        if (imported >= granted) break;
        await prisma.card.createMany({ data: [wiki], skipDuplicates: true });
        const card = await prisma.card.findUniqueOrThrow({ where: { pageId: wiki.pageId } });

        const quantity = Math.min(
          99,
          (sources.get(wiki.pageId) ?? []).reduce(
            (sum, t) => sum + (quantityByTitle.get(t) ?? 1),
            0,
          ) || 1,
        );
        const key = { userId: user.id, cardId: card.id };

        const first = await prisma.userCard.updateMany({
          where: { ...key, imported: false },
          data: { quantity: { increment: quantity }, imported: true },
        });
        if (first.count > 0) {
          imported++;
          continue;
        }
        try {
          await prisma.userCard.create({ data: { ...key, quantity, imported: true } });
          imported++;
        } catch (e) {
          if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
          const retry = await prisma.userCard.updateMany({
            where: { ...key, imported: false },
            data: { quantity: { increment: quantity }, imported: true },
          });
          if (retry.count > 0) imported++;
          else alreadyImported++;
        }
      }
    } finally {
      if (granted > imported) {
        await prisma.user.update({
          where: { id: user.id },
          data: { importedCount: { decrement: granted - imported } },
        });
      }
    }

    const { importedCount } = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { importedCount: true },
    });
    return Response.json({
      imported,
      alreadyImported,
      notFound,
      otherLanguage,
      remaining: Math.max(0, IMPORT_MAX_CARDS - importedCount),
    } satisfies ImportBatchResponse);
  } finally {
    await releaseOpenSlot(slot);
  }
});
