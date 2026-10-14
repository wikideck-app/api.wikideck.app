import { SHARE_ID } from "@/lib/pack-share";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { renderShareImage } from "@/lib/share-image";
import type { PackShareCard } from "@wikideck/shared";

type Ctx = { params: Promise<{ id: string }> };

// image PNG (1600 x 900) d'un tirage partagé : aperçu des réseaux sociaux (Open Graph) et téléchargement
export const GET = withRateLimit<Ctx>("share-image", { limit: 60, windowSec: 60 }, async (_request, { params }) => {
  const { id } = await params;
  if (!SHARE_ID.test(id)) return Response.json({ error: "not_found" }, { status: 404 });
  const share = await prisma.packShare.findUnique({ where: { id } });
  if (!share) return Response.json({ error: "not_found" }, { status: 404 });
  const cards = share.cards as PackShareCard[];
  return renderShareImage(
    cards.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      extract: c.extract,
      imageUrl: c.imageUrl,
      rarity: c.rarity,
      source: c.source ?? "WIKIPEDIA",
    })),
    new Set(cards.filter((c) => c.isNew).map((c) => c.id)),
    // le contenu d'un lien ne change jamais : les réseaux sociaux et le navigateur peuvent le garder
    "public, max-age=86400, s-maxage=86400, immutable",
  );
});
