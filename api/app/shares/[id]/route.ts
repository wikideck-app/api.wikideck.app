import { SHARE_ID, toShareDto } from "@/lib/pack-share";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";

type Ctx = { params: Promise<{ id: string }> };

// tirage partagé : public (sans connexion), pour la page /tirage/<id>
export const GET = withRateLimit<Ctx>("share-read", { limit: 120, windowSec: 60 }, async (_request, { params }) => {
  const { id } = await params;
  if (!SHARE_ID.test(id)) return Response.json({ error: "not_found" }, { status: 404 });
  const share = await prisma.packShare.findUnique({ where: { id } });
  if (!share) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(toShareDto(share), { headers: { "Cache-Control": "public, max-age=300" } });
});
