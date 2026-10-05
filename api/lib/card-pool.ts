import { redis } from "@/lib/redis";
import { drawRandomCards, type WikiCard } from "@/lib/wikipedia";

const KEY = "cardpool";
const LOCK = "lock:cardpool-refill";
const TARGET = 150;
const LOW_WATERMARK = 60;
const TTL_SEC = 6 * 60 * 60;
const BATCH = 5;
const PARALLEL = 4;

export async function poolSize() {
  return redis.llen(KEY).catch(() => 0);
}

export async function takeFromPool(count: number): Promise<WikiCard[]> {
  let taken: WikiCard[] = [];
  try {
    const raw = await redis.lpop(KEY, count);
    taken = (raw ?? []).map((r) => JSON.parse(r) as WikiCard);
    const remaining = await redis.llen(KEY);
    if (remaining < LOW_WATERMARK) void refillPool();
  } catch {
    return [];
  }
  return [...new Map(taken.map((c) => [c.pageId, c])).values()];
}

export function warmPool() {
  redis
    .llen(KEY)
    .then((n) => (n < LOW_WATERMARK ? refillPool() : undefined))
    .catch(() => {});
}

export async function refillPool() {
  try {
    if (!(await redis.set(LOCK, "1", "EX", 90, "NX"))) return;
    try {
      for (let round = 0; round < 6 && (await redis.llen(KEY)) < TARGET; round++) {
        const batches = await Promise.all(
          Array.from({ length: PARALLEL }, () => drawRandomCards(BATCH)),
        );
        const cards = [...new Map(batches.flat().map((c) => [c.pageId, c])).values()];
        if (!cards.length) break;
        await redis.rpush(KEY, ...cards.map((c) => JSON.stringify(c)));
        await redis.expire(KEY, TTL_SEC);
      }
    } finally {
      // on libère le verrou même si le remplissage a planté
      await redis.del(LOCK);
    }
  } catch {}
}
