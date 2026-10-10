import { QUESTS, type QuestClaimResponse } from "@wikideck/shared";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { cardsFor } from "@/lib/quests";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

// l'identifiant contient « : » (title:scholar, anime:sensei) : il arrive encodé dans l'adresse
export const POST = withRateLimit<Ctx>(
  "quests-claim",
  { limit: 30, windowSec: 60 },
  async (_request, { params }) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const id = decodeURIComponent((await params).id);
    const quest = QUESTS.find((q) => q.id === id);
    if (!quest) return Response.json({ error: "not_found" }, { status: 404 });

    const cards = await cardsFor(user.id, quest.kind);
    if (cards < quest.target) return Response.json({ error: "quest_not_ready" }, { status: 409 });

    try {
      // la contrainte d'unicité empêche de récupérer deux fois, même avec deux requêtes simultanées
      const [, me] = await prisma.$transaction([
        prisma.questClaim.create({ data: { userId: user.id, questId: quest.id, reward: quest.reward } }),
        prisma.user.update({
          where: { id: user.id },
          data: { wikibits: { increment: quest.reward } },
          select: { wikibits: true },
        }),
      ]);
      return Response.json({ wikibits: me.wikibits, reward: quest.reward } satisfies QuestClaimResponse);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
        return Response.json({ error: "quest_already_claimed" }, { status: 409 });
      throw e;
    }
  },
);
