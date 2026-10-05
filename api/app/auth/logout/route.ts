import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, cookieOptions, destroySession, webOrigin } from "@/lib/session";
import { withRateLimit } from "@/lib/rate-limit";

export const POST = withRateLimit("auth-logout", { limit: 20, windowSec: 60 }, async () => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await destroySession(token);
  store.set(SESSION_COOKIE, "", cookieOptions(0));
  return NextResponse.redirect(webOrigin(), 303);
});
