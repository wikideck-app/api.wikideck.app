import { loadRoom, roomChannel } from "@/lib/battle-room";
import { redis } from "@/lib/redis";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string }> };

// flux ouverts en même temps par un joueur : chacun garde une connexion redis, on plafonne
const MAX_STREAMS = 3;
const STREAM_TTL = 120;

export const GET = withRateLimit<Ctx>("battle-stream", { limit: 20, windowSec: 60 }, stream);

async function stream(request: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const code = (await params).code.toUpperCase();
  const room = await loadRoom(code);
  if (!room || !room.players.some((p) => p.id === user.id))
    return Response.json({ error: "not_member" }, { status: 403 });

  const counter = `sse:battle:${user.id}`;
  const open = await redis.incr(counter);
  await redis.expire(counter, STREAM_TTL);
  if (open > MAX_STREAMS) {
    await redis.decr(counter);
    return Response.json({ error: "too_many_streams" }, { status: 429 });
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    redis
      .decr(counter)
      .then((n) => (n <= 0 ? redis.del(counter) : undefined))
      .catch(() => {});
  };

  const subscriber = redis.duplicate();
  const encoder = new TextEncoder();
  let keepAlive: ReturnType<typeof setInterval> | undefined;

  const body = new ReadableStream({
    async start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {}
      };
      const close = () => {
        clearInterval(keepAlive);
        subscriber.disconnect();
        release();
        try {
          controller.close();
        } catch {}
      };
      request.signal.addEventListener("abort", close);

      subscriber.on("message", (_channel, message) => send(message));
      subscriber.on("error", close);
      await subscriber.subscribe(roomChannel(code));
      send(JSON.stringify(room));
      keepAlive = setInterval(() => {
        // le compteur expire tout seul si le serveur plante : on le renouvelle tant que le flux vit
        redis.expire(counter, STREAM_TTL).catch(() => {});
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          close();
        }
      }, 20_000);
    },
    cancel() {
      clearInterval(keepAlive);
      subscriber.disconnect();
      release();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
