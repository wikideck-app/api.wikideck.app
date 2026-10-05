import { randomInt } from "node:crypto";
import type { BattleGameDto } from "@wikideck/shared";
import type { Rarity } from "@/generated/prisma/client";
import { rarityCounts } from "@/lib/catalog";
import { prisma } from "@/lib/prisma";

const BAD_TITLE = /^(liste |listes |portail|catégorie|wikipédia|modèle|aide|projet)\b|:|^\d{1,4}$/i;

export const normalizeTitle = (s: string) => s.replace(/_/g, " ").trim().toLowerCase();

async function randomTitle(pool: Rarity[]): Promise<string | null> {
  const counts = await rarityCounts();
  const size = (r: Rarity) => counts.get(r) ?? 0;
  const total = pool.reduce((n, r) => n + size(r), 0);
  if (total === 0) return null;
  for (let attempt = 0; attempt < 8; attempt++) {
    let roll = randomInt(total);
    const rarity = pool.find((r) => (roll -= size(r)) < 0) ?? pool[0];
    const [row] = await prisma.wikiArticle.findMany({
      where: { rarity },
      orderBy: { views: "desc" },
      skip: randomInt(size(rarity)),
      take: 1,
      select: { title: true },
    });
    if (row && !BAD_TITLE.test(row.title)) return row.title;
  }
  return null;
}

export async function pickPuzzle() {
  const start = await randomTitle(["RARE", "SUPER_RARE", "ULTRA_RARE"]);
  for (let i = 0; i < 5; i++) {
    const target = await randomTitle(["ULTRA_RARE", "LEGENDARY"]);
    if (start && target && normalizeTitle(start) !== normalizeTitle(target))
      return { start, target };
  }
  return null;
}

export function toBattleGameDto(g: {
  id: string;
  startArticle: string;
  targetArticle: string;
  path: unknown;
  clicks: number;
  timeSeconds: number;
  won: boolean;
  mode: string;
  playedAt: Date;
}): BattleGameDto {
  return {
    id: g.id,
    mode: g.mode === "multi" ? "multi" : "solo",
    start: g.startArticle,
    target: g.targetArticle,
    path: Array.isArray(g.path) ? (g.path as string[]) : [],
    clicks: g.clicks,
    timeSeconds: g.timeSeconds,
    won: g.won,
    playedAt: g.playedAt.toISOString(),
  };
}
