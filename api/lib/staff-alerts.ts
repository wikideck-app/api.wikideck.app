import type { LiveEvent } from "@wikideck/shared";
import { notifyUser } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { envAdmins } from "@/lib/staff";

const DAY = 86_400_000;
const KEY = "staff:alerts";
const CACHE_SEC = 30;
export const SUSPECT_RISK = 30;

export async function staffAlertCount(): Promise<number> {
  try {
    // compteur en cache, recalculé de temps en temps
    const cached = await redis.get(KEY);
    if (cached !== null) return Number(cached);
  } catch {}
  const grouped = await prisma.abuseSignal.groupBy({
    by: ["userId"],
    where: { createdAt: { gte: new Date(Date.now() - 30 * DAY) } },
    _sum: { weight: true },
    having: { weight: { _sum: { gte: SUSPECT_RISK } } },
  });
  const [flagged, reports, bugs] = await Promise.all([
    grouped.length
      ? prisma.user.count({
          where: {
            id: { in: grouped.map((g) => g.userId) },
            bannedAt: null,
            trustOverride: null,
          },
        })
      : 0,
    prisma.messageReport.count({ where: { status: "OPEN" } }),
    prisma.bugReport.count({ where: { status: "OPEN" } }),
  ]);
  const total = flagged + reports + bugs;
  await redis.set(KEY, String(total), "EX", CACHE_SEC).catch(() => {});
  return total;
}

export const refreshStaffAlerts = () => redis.del(KEY).catch(() => {});

export async function notifyStaff(event: LiveEvent) {
  await refreshStaffAlerts();
  const ids = envAdmins();
  const staff = await prisma.user.findMany({
    where: {
      OR: [{ staffRole: { not: null } }, ...(ids.length ? [{ discordId: { in: ids } }] : [])],
    },
    select: { id: true },
  });
  for (const { id } of staff) notifyUser(id, event);
}
