import { randomInt } from "node:crypto";
import {
  REFERRAL_CODE_PATTERN,
  REFERRAL_MAX,
  REFERRAL_REWARD_PACKS,
  type ReferralInfo,
} from "@wikideck/shared";
import type { User } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { trustOf } from "@/lib/trust";

export const REFERRAL_COOKIE = "wikideck_ref";

// sans les caractères qui se confondent (0/o, 1/l/i)
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const newCode = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

export async function referralInfo(user: Pick<User, "id" | "referralCode">): Promise<ReferralInfo> {
  let code = user.referralCode;
  for (let attempt = 0; !code && attempt < 5; attempt++) {
    const candidate = newCode();
    // updateMany : ne pose le code que s'il n'y en a pas déjà un (deux onglets en parallèle)
    const done = await prisma.user
      .updateMany({ where: { id: user.id, referralCode: null }, data: { referralCode: candidate } })
      .catch(() => null); // collision sur l'unicité : on retente
    if (done?.count) code = candidate;
    else if (done) code = (await prisma.user.findUnique({ where: { id: user.id } }))?.referralCode ?? null;
  }
  if (!code) throw new Error("referral: code non généré");
  const referrals = await prisma.user.count({ where: { referredById: user.id } });
  return { code, referrals, max: REFERRAL_MAX, reward: REFERRAL_REWARD_PACKS };
}

/**
 * Récompense le parrain et le filleul (une seule fois par filleul). Retourne false, sans rien
 * donner, si le code est inconnu ou si le parrainage ressemble à un abus.
 */
export async function applyReferral(user: User, code: string, deviceId: string): Promise<boolean> {
  if (!REFERRAL_CODE_PATTERN.test(code) || user.referredById) return false;
  const referrer = await prisma.user.findUnique({ where: { referralCode: code } });
  if (!referrer || referrer.id === user.id || referrer.bannedAt) return false;

  // même navigateur que le parrain : c'est un second compte du parrain, pas un nouveau joueur
  const sameDevice = await prisma.device.findFirst({
    where: { deviceId, userId: referrer.id },
    select: { userId: true },
  });
  if (sameDevice) return false;
  if ((await trustOf(referrer)).level === "RESTRICTED") return false;
  if ((await prisma.user.count({ where: { referredById: referrer.id } })) >= REFERRAL_MAX)
    return false;

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.user.updateMany({
      where: { id: user.id, referredById: null },
      data: { referredById: referrer.id, packs: { increment: REFERRAL_REWARD_PACKS } },
    });
    if (claimed.count === 0) return false;
    await tx.user.update({
      where: { id: referrer.id },
      data: { packs: { increment: REFERRAL_REWARD_PACKS } },
    });
    return true;
  });
}
