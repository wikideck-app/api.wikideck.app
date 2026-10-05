import {
  GUILD_DESCRIPTION_MAX,
  GUILD_MAX_MEMBERS,
  GUILD_NAME_MAX,
  GUILD_NAME_MIN,
  GUILD_NAME_PATTERN,
  type GuildsResponse,
} from "@wikideck/shared";
import { Prisma } from "@/generated/prisma/client";
import { GuildError, membershipOf } from "@/lib/guild";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { readJson } from "@/lib/tags";

export const GET = withRateLimit("guilds-list", { limit: 60, windowSec: 60 }, async (request) => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, GUILD_NAME_MAX);

  const guilds = await prisma.guild.findMany({
    where: q ? { name: { contains: q, mode: "insensitive" } } : undefined,
    include: {
      _count: { select: { members: true } },
      members: { where: { role: "OWNER" }, include: { user: true }, take: 1 },
    },
    orderBy: [{ members: { _count: "desc" } }, { createdAt: "asc" }],
    take: 30,
  });
  return Response.json({
    guilds: guilds.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      members: g._count.members,
      owner: g.members[0]?.user.username ?? "",
    })),
  } satisfies GuildsResponse);
});

export const POST = withRateLimit("guilds-create", { limit: 5, windowSec: 60 }, async (request) => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await readJson(request);
  const name = typeof body?.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  const length = [...name].length;
  const description =
    typeof body?.description === "string"
      ? body.description.trim().slice(0, GUILD_DESCRIPTION_MAX)
      : "";
  if (length < GUILD_NAME_MIN || length > GUILD_NAME_MAX || !GUILD_NAME_PATTERN.test(name)) {
    return Response.json({ error: "invalid_guild_name" }, { status: 400 });
  }
  if (await membershipOf(user.id))
    return Response.json({ error: "already_in_guild" }, { status: 409 });
  const taken = await prisma.guild.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
  });
  if (taken) return Response.json({ error: "guild_name_taken" }, { status: 409 });

  try {
    const guild = await prisma.guild.create({
      data: {
        name,
        description: description || null,
        members: { create: { userId: user.id, role: "OWNER" } },
      },
    });
    return Response.json({ id: guild.id, max: GUILD_MAX_MEMBERS }, { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return Response.json({ error: "already_in_guild" }, { status: 409 });
    if (e instanceof GuildError) return Response.json({ error: e.code }, { status: e.status });
    throw e;
  }
});
