import type { LiveEvent } from "@wikideck/shared";
import { notifyUser } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { envAdmins } from "@/lib/staff";

const DAY = 86_400_000;
const KEY = "staff:alerts";
const CACHE_SEC = 30;
export const SUSPECT_RISK = 30;

// une alerte « lue » ne revient que si un nouvel indice arrive après
export const isUnreviewed = (reviewedAt: Date | null, lastSignal: Date | null | undefined) =>
  !reviewedAt || (lastSignal != null && lastSignal > reviewedAt);

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
    _max: { createdAt: true },
    having: { weight: { _sum: { gte: SUSPECT_RISK } } },
  });
  const [flagged, reports, bugs] = await Promise.all([
    grouped.length
      ? prisma.user
          .findMany({
            where: {
              id: { in: grouped.map((g) => g.userId) },
              bannedAt: null,
              trustOverride: null,
            },
            select: { id: true, alertsReviewedAt: true },
          })
          .then((users) => {
            const last = new Map(grouped.map((g) => [g.userId, g._max.createdAt]));
            return users.filter((u) => isUnreviewed(u.alertsReviewedAt, last.get(u.id))).length;
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
