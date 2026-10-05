import { redis } from "@/lib/redis";

const PRESENCE_KEY = "load:presence";
const PRESENCE_WINDOW_MS = 5 * 60_000;

export function touchPresence(member: string) {
  const now = Date.now();
  redis.zadd(PRESENCE_KEY, now, member).catch(() => {});
  if (Math.random() < 0.01) {
    redis.zremrangebyscore(PRESENCE_KEY, 0, now - PRESENCE_WINDOW_MS).catch(() => {});
  }
}

export async function activeUsers() {
  await redis.zremrangebyscore(PRESENCE_KEY, 0, Date.now() - PRESENCE_WINDOW_MS);
  return redis.zcard(PRESENCE_KEY);
}

const INFLIGHT_KEY = "load:open-inflight";
const SLOT_TTL_MS = 60_000;

export const MAX_CONCURRENT_OPENS = Number(process.env.MAX_CONCURRENT_OPENS ?? 30);

const ACQUIRE = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, tonumber(ARGV[1]) - tonumber(ARGV[2]))
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then return 0 end
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[4])
return 1
`;

export async function acquireOpenSlot(id: string) {
  try {
    const ok = await redis.eval(
      ACQUIRE,
      1,
      INFLIGHT_KEY,
      Date.now(),
      SLOT_TTL_MS,
      MAX_CONCURRENT_OPENS,
      id,
    );
    return ok === 1;
  } catch {
    return true;
  }
}

export function releaseOpenSlot(id: string) {
  return redis.zrem(INFLIGHT_KEY, id).catch(() => {});
}

export async function openingsInFlight() {
  await redis.zremrangebyscore(INFLIGHT_KEY, 0, Date.now() - SLOT_TTL_MS);
  return redis.zcard(INFLIGHT_KEY);
}
