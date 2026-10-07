import type { WheelHistoryEntry, WheelHistoryResponse, WheelPrize } from "@wikideck/shared";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";

const toPrize = (row: { kind: string; amount: number }) => ({
  kind: row.kind as WheelPrize["kind"],
  amount: row.amount,
});

export const GET = withRateLimit("wheel-history", { limit: 30, windowSec: 60 }, async () => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const [mine, recent] = await Promise.all([
    prisma.wheelSpin.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.wheelSpin.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { user: { select: { username: true, isPublic: true } } },
    }),
  ]);
  return Response.json({
    mine: mine.map((r): WheelHistoryEntry => ({
      at: r.createdAt.toISOString(),
      prize: toPrize(r),
    })),
    // seuls les joueurs au profil public apparaissent sous leur pseudo
    recent: recent.map((r): WheelHistoryEntry => ({
      at: r.createdAt.toISOString(),
      prize: toPrize(r),
      player: r.user.isPublic ? r.user.username : null,
    })),
  } satisfies WheelHistoryResponse);
});
