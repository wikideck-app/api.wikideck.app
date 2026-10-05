import { normalizeSettings } from "@wikideck/shared";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";

export const GET = withRateLimit("me-export", { limit: 5, windowSec: 60 }, async () => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const [full, cards, tags, pulls, trades, friendships, messages, battleGames, devices, signals] =
    await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { showcaseCard: true } }),
      prisma.userCard.findMany({
        where: { userId: user.id },
        include: { card: true, tags: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.tag.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } }),
      prisma.pull.findMany({
        where: { userId: user.id },
        include: { card: { select: { title: true } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 20_000,
      }),
      prisma.trade.findMany({
        where: { OR: [{ proposerId: user.id }, { recipientId: user.id }] },
        include: {
          proposer: { select: { username: true } },
          recipient: { select: { username: true } },
          items: { include: { card: { select: { title: true } } } },
        },
        orderBy: { createdAt: "asc" },
        take: 5_000,
      }),
      prisma.friendship.findMany({
        where: { OR: [{ requesterId: user.id }, { addresseeId: user.id }] },
        include: {
          requester: { select: { username: true } },
          addressee: { select: { username: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.message.findMany({
        where: { OR: [{ senderId: user.id }, { recipientId: user.id }] },
        include: {
          sender: { select: { username: true } },
          recipient: { select: { username: true } },
        },
        orderBy: { createdAt: "asc" },
        take: 20_000,
      }),
      prisma.battleGame.findMany({
        where: { userId: user.id },
        orderBy: { playedAt: "asc" },
        take: 20_000,
      }),
      prisma.device.count({ where: { userId: user.id } }),
      prisma.abuseSignal.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    ]);

  const exportedAt = new Date();
  const data = {
    exportedAt: exportedAt.toISOString(),
    profile: {
      id: full.id,
      discordId: full.discordId,
      username: full.username,
      createdAt: full.createdAt.toISOString(),
      isPublic: full.isPublic,
      showcase: full.showcaseCard?.title ?? null,
      settings: normalizeSettings(full.settings),
      packsAvailable: full.packs,
      importedCards: full.importedCount,
    },
    collection: cards.map((c) => ({
      title: c.card.title,
      wikipediaPageId: c.card.pageId,
      url: c.card.url,
      rarity: c.card.rarity,
      quantity: c.quantity,
      imported: c.imported,
      obtainedAt: c.createdAt.toISOString(),
      tags: c.tags.map((t) => t.name),
    })),
    tags: tags.map((t) => ({ name: t.name, color: t.color })),
    pulls: pulls.map((p) => ({
      openedAt: p.createdAt.toISOString(),
      openingId: p.openingId,
      card: p.card.title,
      rarity: p.rarity,
    })),
    security: {
      browsers: devices,
      signals: signals.map((x) => ({ type: x.type, at: x.createdAt.toISOString() })),
    },
    battle: battleGames.map((g) => ({
      playedAt: g.playedAt.toISOString(),
      start: g.startArticle,
      target: g.targetArticle,
      path: g.path,
      clicks: g.clicks,
      timeSeconds: g.timeSeconds,
      won: g.won,
    })),
    friends: friendships.map((f) => ({
      since: (f.respondedAt ?? f.createdAt).toISOString(),
      status: f.status,
      requester: f.requester.username,
      addressee: f.addressee.username,
    })),
    messages: messages.map((m) => ({
      sentAt: m.createdAt.toISOString(),
      from: m.sender.username,
      to: m.recipient.username,
      body: m.body,
    })),
    trades: trades.map((t) => ({
      createdAt: t.createdAt.toISOString(),
      respondedAt: t.respondedAt?.toISOString() ?? null,
      status: t.status,
      proposer: t.proposer.username,
      recipient: t.recipient.username,
      offered: t.items
        .filter((i) => i.side === "OFFER")
        .map((i) => ({ card: i.card.title, quantity: i.quantity })),
      requested: t.items
        .filter((i) => i.side === "REQUEST")
        .map((i) => ({ card: i.card.title, quantity: i.quantity })),
    })),
  };

  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="wikideck-export-${exportedAt
        .toISOString()
        .slice(0, 10)}.json"`,
    },
  });
});
