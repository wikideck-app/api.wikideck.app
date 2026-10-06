import { hostname } from "node:os";
import { API_VERSION, type HealthResponse } from "@wikideck/shared";
import { poolSize } from "@/lib/card-pool";
import { MAX_CONCURRENT_OPENS, activeUsers, openingsInFlight } from "@/lib/load";

const INSTANCE = hostname();

export async function GET() {
  const [users, opening, pool] = await Promise.all([
    activeUsers().catch(() => null),
    openingsInFlight().catch(() => null),
    poolSize(),
  ]);
  return Response.json({
    status: "ok",
    service: "wikideck-api",
    version: API_VERSION,
    instance: INSTANCE,
    load: {
      activeUsers: users,
      openingsInFlight: opening,
      maxConcurrentOpenings: MAX_CONCURRENT_OPENS,
      cardPool: pool,
    },
  } satisfies HealthResponse);
}
