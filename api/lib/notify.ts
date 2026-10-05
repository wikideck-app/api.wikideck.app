import { createHmac } from "node:crypto";
import type { LiveEvent, LiveNotify } from "@wikideck/shared";

const URL_BASE = process.env.NTFY_URL?.replace(/\/+$/, "");
const SECRET = process.env.NTFY_SECRET;

export const notifyEnabled = Boolean(URL_BASE && SECRET);

export const topicOf = (userId: string) =>
  `wd-${createHmac("sha256", SECRET ?? "")
    .update(userId)
    .digest("hex")
    .slice(0, 32)}`;

export const notifyConfigFor = (userId: string): LiveNotify | null =>
  notifyEnabled ? { url: URL_BASE!, topic: topicOf(userId) } : null;

export function notifyUser(userId: string | null | undefined, event: LiveEvent) {
  if (!notifyEnabled || !userId) return;
  void fetch(`${URL_BASE}/${topicOf(userId)}`, {
    method: "POST",
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(3000),
  }).catch(() => {});
}
