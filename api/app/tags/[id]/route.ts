import { normalizeTagColor } from "@wikideck/shared";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid, parseTagName, readJson, toTagDto } from "@/lib/tags";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withRateLimit<Ctx>(
  "tags-update",
  { limit: 60, windowSec: 60 },
  async (request, { params }) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!isUuid(id)) return Response.json({ error: "not_found" }, { status: 404 });

    const tag = await prisma.tag.findFirst({ where: { id, userId: user.id } });
    if (!tag) return Response.json({ error: "not_found" }, { status: 404 });

    const body = await readJson(request);
    const data: { name?: string; color?: string } = {};
    if (body?.name !== undefined) {
      const name = parseTagName(body.name);
      if (!name) return Response.json({ error: "invalid" }, { status: 400 });
      const clash = await prisma.tag.findFirst({
        where: { userId: user.id, id: { not: id }, name: { equals: name, mode: "insensitive" } },
      });
      if (clash) return Response.json({ error: "exists" }, { status: 409 });
      data.name = name;
    }
    if (body?.color !== undefined) {
      const color = normalizeTagColor(body.color);
      if (!color) return Response.json({ error: "invalid" }, { status: 400 });
      data.color = color;
    }

    return Response.json(toTagDto(await prisma.tag.update({ where: { id }, data })));
  },
);

export const DELETE = withRateLimit<Ctx>(
  "tags-delete",
  { limit: 60, windowSec: 60 },
  async (_request, { params }) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!isUuid(id)) return Response.json({ error: "not_found" }, { status: 404 });

    const { count } = await prisma.tag.deleteMany({ where: { id, userId: user.id } });
    return count
      ? new Response(null, { status: 204 })
      : Response.json({ error: "not_found" }, { status: 404 });
  },
);
