import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { relationsWith } from "@/lib/friends";
import { toPlayer } from "@/lib/trades";

export const GET = withRateLimit(
  "players-search",
  { limit: 40, windowSec: 60 },
  async (request) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 40);
    if ([...q].length < 2) return Response.json({ players: [] });

    // pour l'ajout d'amis on cherche par le début du nom discord (jamais le pseudo de profil) :
    // on ne retrouve pas un joueur par un morceau du milieu, et 2 caractères au moins sont requis
    const byDiscord = request.nextUrl.searchParams.get("by") === "discord";
    const handle = q.replace(/^@/, "");
    const players = await prisma.user.findMany({
      where: {
        id: { not: user.id },
        bannedAt: null,
        ...(byDiscord
          ? { discordName: { startsWith: handle, mode: "insensitive" } }
          : { username: { contains: q, mode: "insensitive" } }),
      },
      orderBy: { username: "asc" },
      take: 8,
    });
    const relation = await relationsWith(
      user.id,
      players.map((p) => p.id),
    );
    return Response.json({
      players: players.map((p) => ({
        ...toPlayer(p),
        relation: relation(p.id),
        ...(byDiscord && { discordName: p.discordName }),
      })),
    });
  },
);
