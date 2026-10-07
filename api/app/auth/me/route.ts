import { cookies } from "next/headers";
import { DAILY_BONUS, normalizeSettings, type MeResponse } from "@wikideck/shared";
import { SESSION_COOKIE, getSessionUser } from "@/lib/session";
import { notifyConfigFor } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { staffAlertCount } from "@/lib/staff-alerts";
import { staffRoleOf } from "@/lib/staff";
import { trustOf } from "@/lib/trust";
import { withRateLimit } from "@/lib/rate-limit";

const parisDay = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" });

export const GET = withRateLimit("auth-me", { limit: 120, windowSec: 60 }, async () => {
  const user = await getSessionUser((await cookies()).get(SESSION_COOKIE)?.value);
  // bonus quotidien : le filtre sur le jour rend la réclamation atomique, une seule fois par jour
  let dailyBonus = 0;
  if (user) {
    const today = parisDay.format(new Date());
    const claimed = await prisma.user.updateMany({
      where: { id: user.id, OR: [{ dailyBonusDay: null }, { dailyBonusDay: { not: today } }] },
      data: { dailyBonusDay: today, wikibits: { increment: DAILY_BONUS } },
    });
    if (claimed.count) {
      dailyBonus = DAILY_BONUS;
      user.wikibits += DAILY_BONUS;
    }
  }
  const pendingTrades = user
    ? await prisma.trade.count({
        where: { recipientId: user.id, status: "PENDING", expiresAt: { gt: new Date() } },
      })
    : 0;
  const pendingFriends = user
    ? await prisma.friendship.count({ where: { addresseeId: user.id, status: "PENDING" } })
    : 0;
  const unreadMessages = user
    ? await prisma.message.count({ where: { recipientId: user.id, readAt: null } })
    : 0;
  const claimableAchievements = user
    ? await prisma.userAchievement.count({ where: { userId: user.id, claimedAt: null } })
    : 0;
  const staff = user ? staffRoleOf(user) : null;
  const staffAlerts = staff ? await staffAlertCount().catch(() => 0) : 0;
  // l'affichage du niveau de confiance ne doit jamais faire planter /auth/me
  const trust = user ? await trustOf(user).catch(() => null) : null;
  return Response.json({
    user: user && {
      id: user.id,
      username: user.username,
      settings: normalizeSettings(user.settings),
      pendingTrades,
      wikibits: user.wikibits,
      dailyBonus,
      pendingFriends,
      unreadMessages,
      claimableAchievements,
      live: notifyConfigFor(user.id),
      trust: { level: trust?.level ?? "TRUSTED" },
      staff,
      staffAlerts,
      avatarUrl: user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.${
            user.avatar.startsWith("a_") ? "gif" : "png"
          }?size=128`
        : null,
    },
  } satisfies MeResponse);
});
