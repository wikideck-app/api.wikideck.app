import { loadRoom, roomChannel } from "@/lib/battle-room";
import { redis } from "@/lib/redis";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const code = (await params).code.toUpperCase();
  const room = await loadRoom(code);
  if (!room || !room.players.some((p) => p.id === user.id))
    return Response.json({ error: "not_member" }, { status: 403 });

  const subscriber = redis.duplicate();
  const encoder = new TextEncoder();
  let keepAlive: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {}
      };
      const close = () => {
        clearInterval(keepAlive);
        subscriber.disconnect();
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
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
