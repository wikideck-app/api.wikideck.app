import { normalizeSettings } from "@wikideck/shared";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { readJson } from "@/lib/tags";

export const PUT = withRateLimit("me-settings", { limit: 120, windowSec: 60 }, async (request) => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await readJson(request);
  if (!body || typeof body.settings !== "object") {
    return Response.json({ error: "invalid" }, { status: 400 });
  }

  const settings = normalizeSettings(body.settings);
  await prisma.user.update({ where: { id: user.id }, data: { settings } });
  return Response.json({ settings });
});
