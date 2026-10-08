import { createHash, randomBytes } from "node:crypto";
import type { StaffApiKeyRow } from "@wikideck/shared";
import type { ApiKey, User } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export const API_KEY_PREFIX = "wdk_";
const TOUCH_EVERY_MS = 60_000;

export const hashApiKey = (key: string) => createHash("sha256").update(key).digest("hex");

export function generateApiKey() {
  const key = `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { key, prefix: key.slice(0, API_KEY_PREFIX.length + 6), hash: hashApiKey(key) };
}

export const bearerToken = (header: string | null) => {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return match && match[1].startsWith(API_KEY_PREFIX) ? match[1] : null;
};

// l'utilisateur qui possède la clé, ou null si elle est inconnue, révoquée ou que son titulaire est suspendu
export async function userForApiKey(token: string): Promise<User | null> {
  const found = await prisma.apiKey.findUnique({
    where: { hash: hashApiKey(token) },
    include: { user: true },
  });
  if (!found || found.revokedAt || found.user.bannedAt) return null;
  if (!found.lastUsedAt || Date.now() - found.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
    void prisma.apiKey
      .update({ where: { id: found.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});
  }
  return found.user;
}

export const toApiKeyRow = (k: ApiKey & { user: Pick<User, "username"> }): StaffApiKeyRow => ({
  id: k.id,
  name: k.name,
  prefix: k.prefix,
  ownerName: k.user.username,
  createdAt: k.createdAt.toISOString(),
  lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
});
