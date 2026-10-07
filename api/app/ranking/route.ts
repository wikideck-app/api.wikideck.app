import {
  RANKING_BOARDS,
  RANKING_SIZE,
  type PlayerRankEntry,
  type PlayerRankingResponse,
  type RankingBoard,
} from "@wikideck/shared";
import { avatarOf } from "@/lib/trades";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";

type Row = {
  id: string;
  discordId: string;
  username: string;
  avatar: string | null;
  score: number;
  rank: number;
};

export const GET = withRateLimit("ranking", { limit: 30, windowSec: 60 }, async (request) => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const asked = request.nextUrl.searchParams.get("board");
  const board = RANKING_BOARDS.find((b) => b.value === asked)?.value as RankingBoard | undefined;
  if (!board) return Response.json({ error: "invalid" }, { status: 400 });

  // collections : profils publics seulement, plus moi pour voir ma place
  const me = user.id;
  const size = RANKING_SIZE;
  const rows =
    board === "battle"
      ? await prisma.$queryRaw<Row[]>`
          WITH s AS (
            SELECT u."id", u."discordId", u."username", u."avatar", COUNT(*)::int AS score
            FROM "BattleGame" g JOIN "User" u ON u."id" = g."userId"
            WHERE g."won" AND u."bannedAt" IS NULL
            GROUP BY u."id"
          ), r AS (SELECT s.*, RANK() OVER (ORDER BY score DESC)::int AS rank FROM s)
          SELECT * FROM r WHERE rank <= ${size} OR "id" = ${me}::uuid ORDER BY rank, "username"`
      : await prisma.$queryRaw<Row[]>`
          WITH s AS (
            SELECT u."id", u."discordId", u."username", u."avatar",
              (CASE WHEN ${board}::text = 'points' THEN SUM(CASE c."rarity"::text
                WHEN 'COMMON' THEN 1 WHEN 'UNCOMMON' THEN 2 WHEN 'RARE' THEN 5
                WHEN 'SUPER_RARE' THEN 10 WHEN 'ULTRA_RARE' THEN 15 WHEN 'MYTHIC' THEN 50 ELSE 20 END)
              ELSE COUNT(*) END)::int AS score
            FROM "UserCard" uc
              JOIN "User" u ON u."id" = uc."userId"
              JOIN "Card" c ON c."id" = uc."cardId"
            WHERE u."bannedAt" IS NULL AND (u."isPublic" OR u."id" = ${me}::uuid)
            GROUP BY u."id"
          ), r AS (SELECT s.*, RANK() OVER (ORDER BY score DESC)::int AS rank FROM s)
          SELECT * FROM r WHERE rank <= ${size} OR "id" = ${me}::uuid ORDER BY rank, "username"`;

  const entries: PlayerRankEntry[] = rows.map((r) => ({
    rank: r.rank,
    id: r.id,
    username: r.username,
    avatarUrl: avatarOf(r),
    score: r.score,
    isMe: r.id === me,
  }));
  const top = entries.filter((e) => e.rank <= size);
  const response: PlayerRankingResponse = {
    board,
    entries: top,
    mine: top.some((e) => e.isMe) ? null : (entries.find((e) => e.isMe) ?? null),
    publicOnly: board !== "battle",
  };
  return Response.json(response);
});
