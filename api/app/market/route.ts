import {
  MARKET_DURATIONS,
  MARKET_MAX_LISTINGS,
  MARKET_MAX_PRICE,
  MARKET_PAGE_SIZE,
  MARKET_SORTS,
  COLLECTION_SEARCH_MAX,
  RARITIES,
  type AuctionDto,
  type MarketResponse,
  type MarketView,
} from "@wikideck/shared";
import type { Prisma } from "@/generated/prisma/client";
import { lockedCards } from "@/lib/card-locks";
import { MarketError, auctionInclude, settleDue, takeCard, toAuctionDto } from "@/lib/market";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid, readJson } from "@/lib/tags";
import { transactionBlock } from "@/lib/trust";

const ORDER = {
  ending: [{ endsAt: "asc" }, { id: "asc" }],
  new: [{ createdAt: "desc" }, { id: "asc" }],
  price_asc: [
    { currentBid: { sort: "asc", nulls: "first" } },
    { startPrice: "asc" },
    { id: "asc" },
  ],
  price_desc: [
    { currentBid: { sort: "desc", nulls: "last" } },
    { startPrice: "desc" },
    { id: "asc" },
  ],
} satisfies Record<string, Prisma.AuctionOrderByWithRelationInput[]>;

export const GET = withRateLimit("market-list", { limit: 90, windowSec: 60 }, async (request) => {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  await settleDue(20);

  const params = request.nextUrl.searchParams;
  const view: MarketView = ["selling", "bidding"].includes(params.get("view") ?? "")
    ? (params.get("view") as MarketView)
    : "all";
  const sort = MARKET_SORTS.find((s) => s.value === params.get("sort"))?.value ?? "ending";
  const query = (params.get("q") ?? "").trim().slice(0, COLLECTION_SEARCH_MAX);
  const rarities = RARITIES.filter((r) =>
    (params.get("rarity") ?? "").split(",").includes(r.code),
  ).map((r) => r.value);

  const where: Prisma.AuctionWhereInput = {
    ...(view === "all" && { status: "ACTIVE" }),
    ...(view === "selling" && { sellerId: user.id }),
    ...(view === "bidding" && { bids: { some: { bidderId: user.id } } }),
    ...((rarities.length || query) && {
      card: {
        ...(rarities.length && { rarity: { in: rarities } }),
        ...(query && { title: { contains: query, mode: "insensitive" as const } }),
      },
    }),
  };

  const total = await prisma.auction.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / MARKET_PAGE_SIZE));
  const requested = Number(params.get("page"));
  const page = Math.min(totalPages, Math.max(1, Number.isInteger(requested) ? requested : 1));
  const rows = await prisma.auction.findMany({
    where,
    include: auctionInclude(user.id),
    orderBy: view === "all" ? ORDER[sort] : [{ status: "asc" }, ...ORDER.new],
    skip: (page - 1) * MARKET_PAGE_SIZE,
    take: MARKET_PAGE_SIZE,
  });

  return Response.json({
    auctions: rows.map((a) => toAuctionDto(a, user.id)),
    total,
    page,
    pageSize: MARKET_PAGE_SIZE,
    totalPages,
    view,
    sort,
    rarities,
    query,
    wikibits: user.wikibits,
  } satisfies MarketResponse);
});

export const POST = withRateLimit(
  "market-create",
  { limit: 15, windowSec: 60 },
  async (request) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const blocked = await transactionBlock(user);
    if (blocked) return Response.json({ error: blocked }, { status: 403 });
    const body = await readJson(request);
    const startPrice = body?.startPrice;
    const hours = body?.hours;
    if (
      !isUuid(body?.cardId) ||
      typeof startPrice !== "number" ||
      !Number.isInteger(startPrice) ||
      startPrice < 1 ||
      startPrice > MARKET_MAX_PRICE ||
      !(MARKET_DURATIONS as readonly unknown[]).includes(hours)
    ) {
      return Response.json({ error: "invalid" }, { status: 400 });
    }
    const cardId = body.cardId as string;
    if ((await lockedCards(user.id)).has(cardId))
      return Response.json({ error: "card_locked" }, { status: 409 });

    try {
      const auction = await prisma.$transaction(async (tx) => {
        const active = await tx.auction.count({ where: { sellerId: user.id, status: "ACTIVE" } });
        if (active >= MARKET_MAX_LISTINGS) throw new MarketError("too_many_listings", 403);
        await takeCard(tx, user.id, cardId, 1);
        return tx.auction.create({
          data: {
            sellerId: user.id,
            cardId,
            startPrice,
            endsAt: new Date(Date.now() + (hours as number) * 3_600_000),
          },
          include: auctionInclude(user.id),
        });
      });
      return Response.json(toAuctionDto(auction, user.id) satisfies AuctionDto, { status: 201 });
    } catch (e) {
      if (e instanceof MarketError) return Response.json({ error: e.code }, { status: e.status });
      throw e;
    }
  },
);
