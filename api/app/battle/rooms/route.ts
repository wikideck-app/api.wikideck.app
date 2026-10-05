import type { BattleRoomResponse, BattleRoomSettings } from "@wikideck/shared";
import { createRoom } from "@/lib/battle-room";
import { actorOf } from "@/lib/battle-actor";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { readJson } from "@/lib/tags";

export const POST = withRateLimit(
  "battle-room-create",
  { limit: 10, windowSec: 60 },
  async (request) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const body = (await readJson(request)) as Partial<BattleRoomSettings> | null;
    try {
      const room = await createRoom(actorOf(user), body ?? {});
      return Response.json({ room } satisfies BattleRoomResponse, { status: 201 });
    } catch {
      return Response.json({ error: "busy" }, { status: 503 });
    }
  },
);
