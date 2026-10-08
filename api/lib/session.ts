import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";

export const SESSION_COOKIE = "wikideck_session";
export const SESSION_TTL = 60 * 60 * 24 * 30;
export const STATE_COOKIE = "wikideck_oauth_state";
export const DEVICE_COOKIE = "wikideck_device";
export const DEVICE_TTL = 60 * 60 * 24 * 365;

const key = (token: string) => `session:${token}`;

export const webOrigin = () => process.env.WEB_ORIGIN ?? "http://localhost:3000";

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  await redis.set(key(token), userId, "EX", SESSION_TTL);
  return token;
}

export async function destroySession(token: string) {
  await redis.del(key(token));
}

export async function getSessionUser(token: string | undefined) {
  if (!token) return null;
  const userId = await redis.get(key(token));
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return user?.bannedAt ? null : user;
}

export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
    domain: process.env.COOKIE_DOMAIN || undefined,
  };
}

export async function currentUser() {
  const { cookies } = await import("next/headers");
  return getSessionUser((await cookies()).get(SESSION_COOKIE)?.value);
}

// session OU clé API (en-tête Authorization: Bearer wdk_…) : réservé aux routes /staff, voir requireStaff
export async function currentUserOrKey() {
  const { headers } = await import("next/headers");
  const { bearerToken, userForApiKey } = await import("@/lib/api-keys");
  const token = bearerToken((await headers()).get("authorization"));
  return token ? userForApiKey(token) : currentUser();
}
