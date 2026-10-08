import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { logStaff, requireStaff } from "@/lib/staff";
import { isUuid } from "@/lib/tags";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = withRateLimit<Ctx>(
  "staff-api-key-revoke",
  { limit: 30, windowSec: 60 },
  async (_request, { params }) => {
    const auth = await requireStaff("ADMIN", { sessionOnly: true });
    if (auth instanceof Response) return auth;
    const { id } = await params;
    if (!isUuid(id)) return Response.json({ error: "not_found" }, { status: 404 });
    const key = await prisma.apiKey.findUnique({ where: { id } });
    if (!key || key.revokedAt) return Response.json({ error: "not_found" }, { status: 404 });
    await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    await logStaff(auth.user, "api_key_revoke", null, { name: key.name });
    return new Response(null, { status: 204 });
  },
);
