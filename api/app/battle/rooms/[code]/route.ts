import type { BattleRoomAction } from "@wikideck/shared";
import { pickPuzzle } from "@/lib/battle";
import { actorOf } from "@/lib/battle-actor";
import { loadRoom, mutateRoom } from "@/lib/battle-room";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { readJson } from "@/lib/tags";

type Ctx = { params: Promise<{ code: string }> };

const ACTIONS = new Set([
  "join",
  "leave",
  "heartbeat",
  "start",
  "play",
  "navigate",
  "surrender",
  "timeUp",
  "reset",
  "settings",
]);

export const GET = withRateLimit<Ctx>(
  "battle-room-get",
  { limit: 120, windowSec: 60 },
  async (_request, { params }) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const room = await loadRoom((await params).code.toUpperCase());
    if (!room) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ room });
  },
);

export const POST = withRateLimit<Ctx>(
  "battle-room-action",
  { limit: 240, windowSec: 60 },
  async (request, { params }) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

    const body = (await readJson(request)) as BattleRoomAction | null;
    if (!body || !ACTIONS.has(body.action))
      return Response.json({ error: "invalid" }, { status: 400 });
    const code = (await params).code.toUpperCase();

    try {
      const puzzle = body.action === "start" ? await pickPuzzle() : undefined;
      const { room, error } = await mutateRoom(code, actorOf(user), body, puzzle);
      if (error) return Response.json({ error: error.code }, { status: error.status });
      return Response.json({ room });
    } catch {
      return Response.json({ error: "busy" }, { status: 503 });
    }
  },
);
