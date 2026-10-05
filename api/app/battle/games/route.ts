import {
  BATTLE_PATH_MAX,
  type BattleGameInput,
  type BattleHistoryResponse,
} from "@wikideck/shared";
import { normalizeTitle, toBattleGameDto } from "@/lib/battle";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { readJson } from "@/lib/tags";

const HISTORY = 15;

export const GET = withRateLimit("battle-history", { limit: 60, windowSec: 60 }, async () => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const [games, played, wins, best] = await Promise.all([
    prisma.battleGame.findMany({
      where: { userId: user.id },
      orderBy: { playedAt: "desc" },
      take: HISTORY,
    }),
    prisma.battleGame.count({ where: { userId: user.id } }),
    prisma.battleGame.count({ where: { userId: user.id, won: true } }),
    prisma.battleGame.aggregate({
      where: { userId: user.id, won: true },
      _min: { clicks: true, timeSeconds: true },
    }),
  ]);
  return Response.json({
    stats: {
      played,
      wins,
      bestClicks: best._min.clicks,
      bestTime: best._min.timeSeconds,
    },
    games: games.map(toBattleGameDto),
  } satisfies BattleHistoryResponse);
});

const title = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 300 ? v : null);

export const POST = withRateLimit("battle-save", { limit: 30, windowSec: 60 }, async (request) => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await readJson(request)) as Partial<BattleGameInput> | null;
  const start = title(body?.start);
  const target = title(body?.target);
  const path = body?.path;
  if (
    !start ||
    !target ||
    !Array.isArray(path) ||
    path.length < 1 ||
    path.length > BATTLE_PATH_MAX ||
    !path.every((p) => title(p)) ||
    !Number.isInteger(body?.clicks) ||
    typeof body?.timeSeconds !== "number" ||
    !Number.isFinite(body.timeSeconds) ||
    typeof body?.won !== "boolean"
  )
    return Response.json({ error: "invalid" }, { status: 400 });

  const clicks = body.clicks as number;
  const won = body.won;
  if (
    clicks < path.length - 1 ||
    clicks > 5000 ||
    body.timeSeconds < 0 ||
    body.timeSeconds > 86_400 ||
    (won && normalizeTitle(path[path.length - 1] as string) !== normalizeTitle(target))
  )
    return Response.json({ error: "invalid" }, { status: 400 });

  const game = await prisma.battleGame.create({
    data: {
      userId: user.id,
      startArticle: start,
      targetArticle: target,
      path: path as string[],
      clicks,
      timeSeconds: Math.round(body.timeSeconds * 10) / 10,
      won,
    },
  });
  return Response.json({ id: game.id }, { status: 201 });
});
