import { PROFILE_ALBUMS_MAX } from "@wikideck/shared";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid, readJson } from "@/lib/tags";

// ordre des albums affichés sur le profil : { ids: [...] } du premier au dernier
export const PUT = withRateLimit("albums-order", { limit: 30, windowSec: 60 }, async (request) => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const ids = (await readJson(request))?.ids;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > PROFILE_ALBUMS_MAX ||
    !ids.every(isUuid) ||
    new Set(ids).size !== ids.length
  )
    return Response.json({ error: "invalid" }, { status: 400 });
  const owned = await prisma.album.count({
    where: { id: { in: ids }, userId: user.id, onProfile: true },
  });
  if (owned !== ids.length) return Response.json({ error: "not_found" }, { status: 404 });
  await prisma.$transaction(
    ids.map((id, order) =>
      prisma.album.updateMany({
        where: { id, userId: user.id },
        data: { profileOrder: order },
      }),
    ),
  );
  return new Response(null, { status: 204 });
});
