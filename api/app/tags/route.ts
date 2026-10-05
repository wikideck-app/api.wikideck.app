import { TAG_MAX_PER_USER, normalizeTagColor } from "@wikideck/shared";
import { checkAchievements } from "@/lib/achievements";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { parseTagName, readJson, toTagDto } from "@/lib/tags";

export const GET = withRateLimit("tags-list", { limit: 60, windowSec: 60 }, async () => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const tags = await prisma.tag.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } });
  return Response.json({ tags: tags.map(toTagDto) });
});

export const POST = withRateLimit("tags-create", { limit: 30, windowSec: 60 }, async (request) => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await readJson(request);
  const name = parseTagName(body?.name);
  const color = normalizeTagColor(body?.color);
  if (!name || !color) return Response.json({ error: "invalid" }, { status: 400 });

  const [count, existing] = await Promise.all([
    prisma.tag.count({ where: { userId: user.id } }),
    prisma.tag.findFirst({
      where: { userId: user.id, name: { equals: name, mode: "insensitive" } },
    }),
  ]);
  if (existing) return Response.json({ error: "exists" }, { status: 409 });
  if (count >= TAG_MAX_PER_USER) return Response.json({ error: "too_many" }, { status: 403 });

  const tag = await prisma.tag.create({ data: { userId: user.id, name, color } });
  checkAchievements(user.id);
  return Response.json(toTagDto(tag), { status: 201 });
});
