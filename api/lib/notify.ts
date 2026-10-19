import { createHmac } from "node:crypto";
import type { LiveEvent, LiveNotify } from "@wikideck/shared";
import { pushToUser } from "@/lib/web-push";

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
  if (!userId) return;
  // notification sur les appareils abonnés (téléphone), même quand le site est fermé
  void pushToUser(userId, event).catch(() => {});
  if (!notifyEnabled) return;
  const send = () =>
    fetch(`${URL_BASE}/${topicOf(userId)}`, {
      method: "POST",
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(3000),
    }).then((res) => {
      if (!res.ok) throw new Error(String(res.status));
    });
  // un second essai : un raté ponctuel du serveur de notifications ne doit pas perdre l'évènement
  void send().catch(() => new Promise((r) => setTimeout(r, 800)).then(send)).catch(() => {});
}
