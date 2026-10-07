import { randomInt } from "node:crypto";
import type { Rarity } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";

export async function rarityCounts(): Promise<Map<Rarity, number>> {
  // cache redis 1h, si redis est down on recalcule
  const key = "catalog:counts";
  try {
    const cached = await redis.get(key);
    if (cached) return new Map(JSON.parse(cached) as [Rarity, number][]);
  } catch {}
  const rows = await prisma.wikiArticle.groupBy({ by: ["rarity"], _count: true });
  const counts = new Map(rows.map((r) => [r.rarity, r._count]));
  await redis.set(key, JSON.stringify([...counts]), "EX", 3600).catch(() => {});
  return counts;
}

export async function legendaryEntry(): Promise<{ pageId: number; views: number } | null> {
  const total = (await rarityCounts()).get("LEGENDARY") ?? 0;
  if (!total) return null;
  const [row] = await prisma.wikiArticle.findMany({
    where: { rarity: "LEGENDARY" },
    orderBy: { views: "desc" },
    skip: randomInt(total),
    take: 1,
    select: { pageId: true, views: true },
  });
  return row ?? null;
}

export async function godpackEntries(
  count: number,
): Promise<{ pageId: number; views: number }[] | null> {
  const counts = await rarityCounts();
  const top: Rarity[] = ["ULTRA_RARE", "LEGENDARY"];
  const rare: Rarity[] = ["SUPER_RARE", ...top];
  const size = (r: Rarity) => counts.get(r) ?? 0;
  if (top.every((r) => size(r) < count) || rare.reduce((n, r) => n + size(r), 0) < count * 4)
    return null;

  const pickRarity = (pool: Rarity[]) => {
    let roll = randomInt(pool.reduce((n, r) => n + size(r), 0));
    return pool.find((r) => (roll -= size(r)) < 0) ?? pool[0];
  };

  const picked = new Map<number, { pageId: number; views: number }>();
  for (let i = 0; i < count * 4 && picked.size < count; i++) {
    const rarity = pickRarity(picked.size === 0 ? top : rare);
    const [row] = await prisma.wikiArticle.findMany({
      where: { rarity },
      orderBy: { views: "desc" },
      skip: randomInt(size(rarity)),
      take: 1,
      select: { pageId: true, views: true },
    });
    if (row) picked.set(row.pageId, row);
  }
  return picked.size === count ? [...picked.values()] : null;
}
