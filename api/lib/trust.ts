import type { TrustInfo, TrustLevel } from "@wikideck/shared";
import type { User } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { SUSPECT_RISK as ALERT_RISK, notifyStaff } from "@/lib/staff-alerts";

export const SIGNAL_WEIGHTS = {
  SHARED_DEVICE: 25,
  YOUNG_DISCORD: 10,
  BATTLE_PAIR: 15,
} as const;
export type SignalType = keyof typeof SIGNAL_WEIGHTS;

const DAY = 86_400_000;
const RISK_WINDOW_DAYS = 30;
const SUSPECT_RISK = ALERT_RISK;
const RESTRICTED_RISK = 60;
const YOUNG_DISCORD_DAYS = 7;
const CACHE_SEC = 60;

export function discordCreatedAt(discordId: string): Date | null {
  try {
    return new Date(Number(BigInt(discordId) >> BigInt(22)) + 1420070400000);
  } catch {
    return null;
  }
}

export type Trust = TrustInfo & {
  trustScore: number;
  riskScore: number;
};

type Subject = Pick<User, "id" | "createdAt" | "discordId"> & Partial<Pick<User, "trustOverride">>;
export const trustCacheKey = (id: string) => `trust:v2:${id}`;
const cacheKey = trustCacheKey;

export async function trustOf(user: Subject, now = Date.now()): Promise<Trust> {
  try {
    const cached = await redis.get(cacheKey(user.id));
    if (cached) return JSON.parse(cached) as Trust;
  } catch {}

  const ageDays = (now - user.createdAt.getTime()) / DAY;
  const discord = discordCreatedAt(user.discordId);
  const discordDays = discord ? (now - discord.getTime()) / DAY : 0;
  const risk = await prisma.abuseSignal.aggregate({
    where: { userId: user.id, createdAt: { gte: new Date(now - RISK_WINDOW_DAYS * DAY) } },
    _sum: { weight: true },
  });
  const riskScore = Math.min(100, risk._sum.weight ?? 0);
  const trustScore = Math.max(
    0,
    Math.round(
      Math.min(60, (ageDays / 14) * 60) + Math.min(40, (discordDays / 180) * 40) - riskScore,
    ),
  );

  let level: TrustLevel = "TRUSTED";
  if (riskScore >= RESTRICTED_RISK) level = "RESTRICTED";
  else if (riskScore >= SUSPECT_RISK) level = "SUSPECT";

  if (user.trustOverride === "TRUSTED" || user.trustOverride === "RESTRICTED")
    level = user.trustOverride;

  const trust: Trust = {
    level,
    trustScore,
    riskScore,
  };
  await redis.set(cacheKey(user.id), JSON.stringify(trust), "EX", CACHE_SEC).catch(() => {});
  return trust;
}

export async function transactionBlock(user: Subject): Promise<string | null> {
  const { level } = await trustOf(user);
  if (level === "RESTRICTED") return "account_restricted";
  return null;
}

export async function recordSignal(
  userId: string,
  type: SignalType,
  key: string,
  detail: Record<string, unknown> = {},
) {
  const exists = await prisma.abuseSignal.findFirst({
    where: { userId, type, detail: { path: ["key"], equals: key } },
    select: { id: true },
  });
  if (exists) return false;
  await prisma.abuseSignal.create({
    data: { userId, type, weight: SIGNAL_WEIGHTS[type], detail: { ...detail, key } },
  });
  await redis.del(cacheKey(userId)).catch(() => {});
  const total = await prisma.abuseSignal.aggregate({
    where: { userId, createdAt: { gte: new Date(Date.now() - RISK_WINDOW_DAYS * DAY) } },
    _sum: { weight: true },
  });
  const risk = total._sum.weight ?? 0;
  if (risk >= ALERT_RISK && risk - SIGNAL_WEIGHTS[type] < ALERT_RISK)
    await notifyStaff({ type: "staff", kind: "alert" });
  return true;
}

export async function checkNewAccount(user: Subject) {
  const created = discordCreatedAt(user.discordId);
  if (created && Date.now() - created.getTime() < YOUNG_DISCORD_DAYS * DAY)
    await recordSignal(user.id, "YOUNG_DISCORD", "signup", {});
}

export async function registerDevice(userId: string, deviceId: string) {
  await prisma.device.upsert({
    where: { deviceId_userId: { deviceId, userId } },
    update: { lastSeenAt: new Date() },
    create: { deviceId, userId },
  });
  const others = await prisma.device.findMany({
    where: { deviceId, userId: { not: userId } },
    select: { userId: true },
  });
  for (const { userId: other } of others) {
    await recordSignal(userId, "SHARED_DEVICE", `device:${other}`, { with: other });
    await recordSignal(other, "SHARED_DEVICE", `device:${userId}`, { with: userId });
  }
  void purgeOld();
}

async function purgeOld() {
  try {
    if (!(await redis.set("trust:purge", "1", "EX", 3600, "NX"))) return;
    await prisma.abuseSignal.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - 90 * DAY) } },
    });
    await prisma.device.deleteMany({
      where: { lastSeenAt: { lt: new Date(Date.now() - 400 * DAY) } },
    });
  } catch {}
}
