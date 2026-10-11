import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { readJson } from "@/lib/tags";

const PUSH_MAX_PER_USER = 10;

const text = (v: unknown, max: number) =>
  typeof v === "string" && v.length > 0 && v.length <= max ? v : null;

// abonne l'appareil : { endpoint, keys: { p256dh, auth } } (PushSubscription.toJSON())
export const POST = withRateLimit("push-subscribe", { limit: 20, windowSec: 60 }, async (request) => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await readJson(request);
  const keys = body?.keys as { p256dh?: unknown; auth?: unknown } | undefined;
  const endpoint = text(body?.endpoint, 1000);
  const p256dh = text(keys?.p256dh, 200);
  const auth = text(keys?.auth, 100);
  if (!endpoint || !p256dh || !auth || !endpoint.startsWith("https://"))
    return Response.json({ error: "invalid" }, { status: 400 });

  const mine = await prisma.pushSubscription.count({ where: { userId: user.id } });
  const known = await prisma.pushSubscription.findUnique({ where: { endpoint } });
  if (!known && mine >= PUSH_MAX_PER_USER)
    return Response.json({ error: "too_many_devices" }, { status: 409 });
  // le même appareil peut changer de compte : l'abonnement suit le dernier connecté
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { userId: user.id, endpoint, p256dh, auth },
    update: { userId: user.id, p256dh, auth },
  });
  return new Response(null, { status: 204 });
});

// désabonne l'appareil : { endpoint }
export const DELETE = withRateLimit("push-unsubscribe", { limit: 20, windowSec: 60 }, async (request) => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const endpoint = text((await readJson(request))?.endpoint, 1000);
  if (!endpoint) return Response.json({ error: "invalid" }, { status: 400 });
  await prisma.pushSubscription.deleteMany({ where: { userId: user.id, endpoint } });
  return new Response(null, { status: 204 });
});
