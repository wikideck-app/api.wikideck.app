import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { touchPresence } from "@/lib/load";
import { redis } from "@/lib/redis";
import { SESSION_COOKIE } from "@/lib/session";

type Limit = { limit: number; windowSec: number };

const SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return { count, redis.call('PTTL', KEYS[1]) }
`;

const REDIS_TIMEOUT_MS = 500;

function clientIp(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function identity(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth && /^Bearer\s+wdk_/i.test(auth))
    return `k:${createHash("sha256").update(auth).digest("hex").slice(0, 24)}`;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) return `s:${createHash("sha256").update(token).digest("hex").slice(0, 24)}`;
  return `ip:${clientIp(request)}`;
}

async function hit(key: string, windowSec: number) {
  const result = (await Promise.race([
    redis.eval(SCRIPT, 1, key, windowSec * 1000),
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), REDIS_TIMEOUT_MS)),
  ])) as [number, number];
  return { count: result[0], ttlMs: Math.max(result[1], 0) };
}

export function withRateLimit<Ctx = unknown>(
  name: string,
  { limit, windowSec }: Limit,
  handler: (request: NextRequest, context: Ctx) => Response | Promise<Response>,
  by: "ip" | "identity" = "identity",
) {
  return async (request: NextRequest, context: Ctx) => {
    const who = by === "ip" ? `ip:${clientIp(request)}` : identity(request);
    if (who.startsWith("s:")) touchPresence(who);
    let headers: Record<string, string> = {};

    try {
      const { count, ttlMs } = await hit(`rl:${name}:${who}`, windowSec);
      const resetSec = Math.ceil(ttlMs / 1000);
      headers = {
        "RateLimit-Limit": String(limit),
        "RateLimit-Remaining": String(Math.max(0, limit - count)),
        "RateLimit-Reset": String(resetSec),
      };
      if (count > limit) {
        return Response.json(
          { error: "rate_limited", retryAfter: resetSec },
          { status: 429, headers: { ...headers, "Retry-After": String(resetSec) } },
        );
      }
    } catch {
      // redis injoignable : on laisse passer plutôt que de bloquer tout le site
      return handler(request, context);
    }

    const response = await handler(request, context);
    try {
      for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
    } catch {}
    return response;
  };
}
