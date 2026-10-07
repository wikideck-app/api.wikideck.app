import {
  BULK_LIST_MAX,
  BULK_MAX_CARD_IDS,
  DROP_RARITIES,
  RECYCLE_VALUES,
  type BulkItem,
  type BulkPreviewResponse,
  type Rarity,
} from "@wikideck/shared";
import { bulkCandidates, valueOf } from "@/lib/bulk-recycle";
import { withRateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";
import { isUuid, readJson } from "@/lib/tags";

export const POST = withRateLimit(
  "collection-bulk-preview",
  { limit: 60, windowSec: 60 },
  async (request) => {
    const user = await currentUser();
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const body = await readJson(request);
    const maxViews = body?.maxViews;
    const ids = body?.cardIds;
    const known: string[] = DROP_RARITIES.map((r) => r.value);
    const wanted = body?.rarities;
    if (
      typeof maxViews !== "number" ||
      !Number.isInteger(maxViews) ||
      maxViews < 1 ||
      maxViews > 10_000_000 ||
      (ids !== undefined &&
        (!Array.isArray(ids) || ids.length > BULK_MAX_CARD_IDS || !ids.every((i) => isUuid(i)))) ||
      (wanted !== undefined &&
        (!Array.isArray(wanted) || !wanted.every((r) => known.includes(r as string))))
    )
      return Response.json({ error: "invalid" }, { status: 400 });

    const { candidates, protectedCards, reasons } = await bulkCandidates(user.id, {
      maxViews,
      cardIds: ids as string[] | undefined,
    });
    const rarities = DROP_RARITIES.map((r) => {
      const mine = candidates.filter((c) => c.rarity === r.value);
      const copies = mine.reduce((n, c) => n + c.quantity, 0);
      return {
        rarity: r.value,
        cards: mine.length,
        copies,
        wikibits: copies * RECYCLE_VALUES[r.value],
      };
    }).filter((r) => r.cards > 0);

    const response: BulkPreviewResponse = { rarities, protectedCards, protectedReasons: reasons };
    if (body?.list === true) {
      const rank = (r: Rarity) => known.indexOf(r);
      const picked = candidates
        .filter((c) => !wanted || (wanted as string[]).includes(c.rarity))
        .sort(
          (a, b) =>
            rank(b.rarity) - rank(a.rarity) || a.views - b.views || a.title.localeCompare(b.title),
        );
      response.truncated = picked.length > BULK_LIST_MAX;
      response.items = picked.slice(0, BULK_LIST_MAX).map((c): BulkItem => ({
        id: c.cardId,
        title: c.title,
        rarity: c.rarity,
        views: c.views,
        quantity: c.quantity,
        wikibits: valueOf(c),
      }));
    }
    return Response.json(response);
  },
);
