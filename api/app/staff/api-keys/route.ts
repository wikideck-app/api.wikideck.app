import { API_KEY_MAX_PER_USER, type StaffApiKeyCreated } from "@wikideck/shared";
import { generateApiKey, toApiKeyRow } from "@/lib/api-keys";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { logStaff, requireStaff } from "@/lib/staff";
import { readJson } from "@/lib/tags";

export const GET = withRateLimit("staff-api-keys", { limit: 60, windowSec: 60 }, async () => {
  const auth = await requireStaff("ADMIN", { sessionOnly: true });
  if (auth instanceof Response) return auth;
  const keys = await prisma.apiKey.findMany({
    where: { revokedAt: null },
    include: { user: { select: { username: true } } },
    orderBy: { createdAt: "desc" },
  });
  return Response.json({ keys: keys.map(toApiKeyRow) });
});

export const POST = withRateLimit("staff-api-key-create", { limit: 10, windowSec: 60 }, async (request) => {
  const auth = await requireStaff("ADMIN", { sessionOnly: true });
  if (auth instanceof Response) return auth;
  const name = String(((await readJson(request)) as { name?: unknown } | null)?.name ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!name || name.length > 40) return Response.json({ error: "invalid" }, { status: 400 });

  const active = await prisma.apiKey.count({ where: { userId: auth.user.id, revokedAt: null } });
  if (active >= API_KEY_MAX_PER_USER)
    return Response.json({ error: "too_many_keys" }, { status: 409 });

  const { key, prefix, hash } = generateApiKey();
  const row = await prisma.apiKey.create({
    data: { userId: auth.user.id, name, prefix, hash },
    include: { user: { select: { username: true } } },
  });
  await logStaff(auth.user, "api_key_create", null, { name });
  return Response.json({ key, row: toApiKeyRow(row) } satisfies StaffApiKeyCreated, { status: 201 });
});
