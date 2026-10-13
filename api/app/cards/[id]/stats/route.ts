import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid } from "@/lib/tags";

type Ctx = { params: Promise<{ id: string }> };

// nombre de fois où la carte a été tirée dans un paquet, tous joueurs confondus
// (une légendaire compte aussi les tirages de sa version mythique)
export const GET = withRateLimit<Ctx>("card-stats", { limit: 120, windowSec: 60 }, async (_request, { params }) => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: "not_found" }, { status: 404 });
  const card = await prisma.card.findUnique({ where: { id }, select: { id: true, mythic: { select: { id: true } } } });
  if (!card) return Response.json({ error: "not_found" }, { status: 404 });
  const drawn = await prisma.pull.count({
    where: { cardId: { in: card.mythic ? [card.id, card.mythic.id] : [card.id] } },
  });
  return Response.json({ drawn });
});
