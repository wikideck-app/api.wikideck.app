import webpush from "web-push";
import type { LiveEvent } from "@wikideck/shared";
import { prisma } from "@/lib/prisma";

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:contact@wikideck.app";

export const webPushEnabled = Boolean(PUBLIC_KEY && PRIVATE_KEY);
export const vapidPublicKey = PUBLIC_KEY ?? null;

if (webPushEnabled) webpush.setVapidDetails(SUBJECT, PUBLIC_KEY!, PRIVATE_KEY!);

// envoie l'évènement à tous les appareils abonnés ; le service worker en fait le texte de la notification
export async function pushToUser(userId: string, event: LiveEvent) {
  if (!webPushEnabled) return;
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  const body = JSON.stringify(event);
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { TTL: 60 * 60 * 24, urgency: "normal", timeout: 5000 },
        );
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        // appareil désinscrit ou abonnement expiré : on l'oublie
        if (status === 404 || status === 410)
          await prisma.pushSubscription.deleteMany({ where: { id: s.id } });
      }
    }),
  );
}
