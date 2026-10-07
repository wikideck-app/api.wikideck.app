import { randomInt } from "node:crypto";
import { WHEEL_PRIZES, type WheelSpinResponse } from "@wikideck/shared";
import { parisDay } from "@/lib/day";
import { announceSpin } from "@/lib/wheel-feed";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";

function drawPrize() {
  const total = WHEEL_PRIZES.reduce((sum, p) => sum + p.weight, 0);
  let roll = randomInt(total);
  return WHEEL_PRIZES.findIndex((p) => (roll -= p.weight) < 0);
}

export const POST = withRateLimit("wheel-spin", { limit: 10, windowSec: 60 }, async () => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const today = parisDay();
  const index = drawPrize();
  const prize = WHEEL_PRIZES[index];

  // le filtre sur le jour rend le tirage atomique : un seul tour par jour, même en parallèle
  const claimed = await prisma.$transaction(async (tx) => {
    const done = await tx.user.updateMany({
      where: { id: user.id, OR: [{ lastWheelDay: null }, { lastWheelDay: { not: today } }] },
      data: {
        lastWheelDay: today,
        ...(prize.kind === "wikibits" && { wikibits: { increment: prize.amount } }),
        ...(prize.kind === "packs" && { packs: { increment: prize.amount } }),
        ...(prize.kind === "boost" && { dropBoosts: { increment: prize.amount } }),
      },
    });
    if (done.count === 0) return false;
    await tx.wheelSpin.create({
      data: { userId: user.id, index, kind: prize.kind, amount: prize.amount },
    });
    return true;
  });
  if (!claimed) return Response.json({ error: "already_spun" }, { status: 409 });
  announceSpin(user.isPublic ? user.username : null, prize);

  const me = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { wikibits: true, packs: true, dropBoosts: true },
  });
  return Response.json({ index, prize, ...me } satisfies WheelSpinResponse);
});
