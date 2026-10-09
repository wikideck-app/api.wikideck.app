import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { REFERRAL_COOKIE, applyReferral } from "@/lib/referral";
import { checkNewAccount, registerDevice } from "@/lib/trust";
import {
  SESSION_COOKIE,
  SESSION_TTL,
  DEVICE_TTL,
  DEVICE_COOKIE,
  STATE_COOKIE,
  cookieOptions,
  createSession,
  webOrigin,
} from "@/lib/session";
import { withRateLimit } from "@/lib/rate-limit";

type DiscordUser = {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
};

const fail = (reason: string) => NextResponse.redirect(`${webOrigin()}/?auth_error=${reason}`);

export const GET = withRateLimit(
  "auth-callback",
  { limit: 20, windowSec: 60 },
  async (request: NextRequest) => {
    const { searchParams } = request.nextUrl;
    const code = searchParams.get("code");
    const store = await cookies();
    const expectedState = store.get(STATE_COOKIE)?.value;
    store.delete(STATE_COOKIE);

    if (searchParams.get("error")) return fail("denied");
    if (!code || !expectedState || searchParams.get("state") !== expectedState)
      return fail("state");

    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID!,
        client_secret: process.env.DISCORD_CLIENT_SECRET!,
        grant_type: "authorization_code",
        code,
        redirect_uri: `${process.env.API_URL}/auth/discord/callback`,
      }),
    });
    if (!tokenRes.ok) return fail("token");
    const { access_token } = (await tokenRes.json()) as { access_token: string };

    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!userRes.ok) return fail("profile");
    const profile = (await userRes.json()) as DiscordUser;

    const user = await prisma.user.upsert({
      where: { discordId: profile.id },
      update: { avatar: profile.avatar, discordName: profile.username },
      create: {
        discordId: profile.id,
        // le pseudo vient de discord seulement à l'inscription, après il appartient au joueur
        username: profile.global_name ?? profile.username,
        discordName: profile.username,
        avatar: profile.avatar,
      },
    });

    // anti-doublons : si ça plante on laisse quand même se connecter
    const deviceId = store.get(DEVICE_COOKIE)?.value ?? randomUUID();
    store.set(DEVICE_COOKIE, deviceId, cookieOptions(DEVICE_TTL));
    const referralCode = store.get(REFERRAL_COOKIE)?.value;
    store.delete(REFERRAL_COOKIE);
    try {
      const isNew = user.createdAt.getTime() > Date.now() - 60_000;
      if (isNew) await checkNewAccount(user);
      // avant d'enregistrer le navigateur du filleul : on compare avec celui du parrain
      if (isNew && referralCode) await applyReferral(user, referralCode, deviceId);
      await registerDevice(user.id, deviceId);
    } catch {}

    if (user.bannedAt) return fail("banned");

    store.set(SESSION_COOKIE, await createSession(user.id), cookieOptions(SESSION_TTL));
    return NextResponse.redirect(webOrigin());
  },
  "ip",
);
