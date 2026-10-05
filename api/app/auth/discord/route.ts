import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { STATE_COOKIE } from "@/lib/session";
import { withRateLimit } from "@/lib/rate-limit";

export const GET = withRateLimit(
  "auth-discord",
  { limit: 10, windowSec: 60 },
  async () => {
    const state = randomBytes(16).toString("hex");
    (await cookies()).set(STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });

    const url = new URL("https://discord.com/oauth2/authorize");
    url.search = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID!,
      redirect_uri: `${process.env.API_URL}/auth/discord/callback`,
      response_type: "code",
      scope: "identify",
      state,
      prompt: "none",
    }).toString();
    return NextResponse.redirect(url);
  },
  "ip",
);
