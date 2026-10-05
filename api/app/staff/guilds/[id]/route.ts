import {
  GUILD_DESCRIPTION_MAX,
  GUILD_NAME_MAX,
  GUILD_NAME_MIN,
  GUILD_NAME_PATTERN,
  type StaffGuildAction,
  type StaffGuildDetail,
} from "@wikideck/shared";
import { leaveGuild } from "@/lib/guild";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { atLeast, logStaff, requireStaff } from "@/lib/staff";
import { isUuid, readJson } from "@/lib/tags";

type Ctx = { params: Promise<{ id: string }> };

async function detailOf(id: string): Promise<StaffGuildDetail | null> {
  const g = await prisma.guild.findUnique({
    where: { id },
    include: {
      members: { include: { user: true }, orderBy: [{ role: "asc" }, { joinedAt: "asc" }] },
      _count: { select: { wishes: { where: { status: "OPEN" } } } },
    },
  });
  if (!g) return null;
  const owner = g.members.find((m) => m.role === "OWNER");
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    members: g.members.length,
    owner: owner?.user.username ?? null,
    createdAt: g.createdAt.toISOString(),
    openWishes: g._count.wishes,
    memberList: g.members.map((m) => ({
      id: m.userId,
      username: m.user.username,
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
    })),
  };
}

export const GET = withRateLimit<Ctx>(
  "staff-guild",
  { limit: 120, windowSec: 60 },
  async (_request, { params }) => {
    const auth = await requireStaff("MODERATOR");
    if (auth instanceof Response) return auth;
    const { id } = await params;
    const detail = isUuid(id) ? await detailOf(id) : null;
    return detail ? Response.json(detail) : Response.json({ error: "not_found" }, { status: 404 });
  },
);

export const POST = withRateLimit<Ctx>(
  "staff-guild-action",
  { limit: 30, windowSec: 60 },
  async (request, { params }) => {
    const auth = await requireStaff("MODERATOR");
    if (auth instanceof Response) return auth;
    const { id } = await params;
    if (!isUuid(id)) return Response.json({ error: "not_found" }, { status: 404 });
    const guild = await prisma.guild.findUnique({ where: { id } });
    if (!guild) return Response.json({ error: "not_found" }, { status: 404 });
    const body = (await readJson(request)) as StaffGuildAction | null;
    const bad = (error: string, status = 400) => Response.json({ error }, { status });

    switch (body?.action) {
      case "edit": {
        const data: { name?: string; description?: string | null } = {};
        if (body.name !== undefined) {
          const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
          const length = [...name].length;
          if (length < GUILD_NAME_MIN || length > GUILD_NAME_MAX || !GUILD_NAME_PATTERN.test(name))
            return bad("invalid_guild_name");
          const taken = await prisma.guild.findFirst({
            where: { id: { not: id }, name: { equals: name, mode: "insensitive" } },
          });
          if (taken) return bad("guild_name_taken", 409);
          data.name = name;
        }
        if (body.description !== undefined) {
          if (typeof body.description !== "string") return bad("invalid");
          data.description = body.description.trim().slice(0, GUILD_DESCRIPTION_MAX) || null;
        }
        if (!Object.keys(data).length) return bad("invalid");
        await prisma.guild.update({ where: { id }, data });
        await logStaff(auth.user, "guild_edit", null, {
          guild: guild.name,
          ...(data.name !== undefined && { name: { from: guild.name, to: data.name } }),
          ...(data.description !== undefined && {
            description: { from: guild.description, to: data.description },
          }),
        });
        break;
      }
      case "kick": {
        if (!isUuid(body.userId)) return bad("invalid");
        const member = await prisma.guildMember.findUnique({
          where: { userId: body.userId },
          include: { user: true },
        });
        if (!member || member.guildId !== id) return bad("not_found", 404);
        await prisma.$transaction((tx) => leaveGuild(tx, body.userId));
        await logStaff(auth.user, "guild_kick", member.user, { guild: guild.name });
        break;
      }
      case "dissolve": {
        if (!atLeast(auth.role, "ADMIN")) return bad("forbidden", 403);
        if (body.confirmName !== guild.name) return bad("confirmation_required");
        const members = await prisma.guildMember.count({ where: { guildId: id } });
        await prisma.guild.delete({ where: { id } });
        await logStaff(auth.user, "guild_dissolve", null, { guild: guild.name, members });
        return Response.json({ deleted: true });
      }
      default:
        return bad("invalid");
    }
    return Response.json(await detailOf(id));
  },
);
