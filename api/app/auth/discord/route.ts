import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { REFERRAL_CODE_PATTERN } from "@wikideck/shared";
import { REFERRAL_COOKIE } from "@/lib/referral";
import { STATE_COOKIE } from "@/lib/session";
import { withRateLimit } from "@/lib/rate-limit";

export const GET = withRateLimit(
  "auth-discord",
  { limit: 10, windowSec: 60 },
  async (request: NextRequest) => {
    const state = randomBytes(16).toString("hex");
    (await cookies()).set(STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });

    // code de parrainage : gardé le temps de la connexion, appliqué seulement à une création de compte
    const ref = request.nextUrl.searchParams.get("ref")?.toLowerCase() ?? "";
    if (REFERRAL_CODE_PATTERN.test(ref)) {
      (await cookies()).set(REFERRAL_COOKIE, ref, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 3600,
      });
    }

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
