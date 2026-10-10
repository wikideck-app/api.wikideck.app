import {
  SHOP_DESCRIPTION_MAX,
  SHOP_KINDS,
  SHOP_MAX_AMOUNT,
  SHOP_MAX_PRICE,
  SHOP_NAME_MAX,
  type ShopItemDto,
  type ShopItemKind,
  type StaffShopInput,
  type StaffShopItem,
} from "@wikideck/shared";
import type { ShopItem } from "@/generated/prisma/client";

/** Données d'un article, avec dates réelles (la validation reçoit des dates ISO). */
export type ShopInputData = Omit<StaffShopInput, "availableFrom" | "availableUntil"> & {
  availableFrom: Date | null;
  availableUntil: Date | null;
};

// l'article est-il en vente à cet instant ?
export const isOnSale = (item: Pick<ShopItem, "active" | "availableFrom" | "availableUntil">, now = new Date()) =>
  item.active &&
  (!item.availableFrom || item.availableFrom <= now) &&
  (!item.availableUntil || item.availableUntil > now);

export const toShopItemDto = (
  item: ShopItem,
  purchased: number,
  purchasedToday: number,
): ShopItemDto => ({
  id: item.id,
  name: item.name,
  description: item.description,
  kind: item.kind,
  amount: item.amount,
  price: item.price,
  maxPerUser: item.maxPerUser,
  maxPerUserPerDay: item.maxPerUserPerDay,
  stock: item.stock,
  purchased,
  purchasedToday,
  availableUntil: item.availableUntil?.toISOString() ?? null,
});

export const toStaffShopItem = (item: ShopItem, sold: number): StaffShopItem => ({
  id: item.id,
  name: item.name,
  description: item.description,
  kind: item.kind,
  amount: item.amount,
  price: item.price,
  maxPerUser: item.maxPerUser,
  maxPerUserPerDay: item.maxPerUserPerDay,
  stock: item.stock,
  active: item.active,
  availableFrom: item.availableFrom?.toISOString() ?? null,
  availableUntil: item.availableUntil?.toISOString() ?? null,
  sortOrder: item.sortOrder,
  sold,
});

const int = (value: unknown, min: number, max: number) =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null;

const optionalInt = (value: unknown, min: number, max: number): number | null | undefined =>
  value === null || value === undefined ? null : (int(value, min, max) ?? undefined);

/** Valide le corps d'une création ou d'une modification ; null si quelque chose est invalide. */
// date ISO, null ou absent → null ; texte qui n'est pas une date → undefined (invalide)
function optionalDate(value: unknown): Date | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function parseShopInput(body: unknown): ShopInputData | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim().replace(/\s+/g, " ") : "";
  const description =
    typeof b.description === "string" && b.description.trim() ? b.description.trim() : null;
  const kind = (SHOP_KINDS as readonly unknown[]).includes(b.kind)
    ? (b.kind as ShopItemKind)
    : null;
  const amount = int(b.amount, 1, SHOP_MAX_AMOUNT);
  const price = int(b.price, 1, SHOP_MAX_PRICE);
  const maxPerUser = optionalInt(b.maxPerUser, 1, 1_000_000);
  const maxPerUserPerDay = optionalInt(b.maxPerUserPerDay, 1, 1_000_000);
  const stock = optionalInt(b.stock, 0, 1_000_000);
  const sortOrder = b.sortOrder === undefined ? 0 : int(b.sortOrder, -1000, 1000);
  const availableFrom = optionalDate(b.availableFrom);
  const availableUntil = optionalDate(b.availableUntil);
  if (
    !name ||
    name.length > SHOP_NAME_MAX ||
    (description && description.length > SHOP_DESCRIPTION_MAX) ||
    !kind ||
    amount === null ||
    price === null ||
    maxPerUser === undefined ||
    maxPerUserPerDay === undefined ||
    stock === undefined ||
    sortOrder === null ||
    availableFrom === undefined ||
    availableUntil === undefined ||
    (availableFrom && availableUntil && availableUntil <= availableFrom)
  )
    return null;
  return {
    name,
    description,
    kind,
    amount,
    price,
    maxPerUser,
    maxPerUserPerDay,
    stock,
    active: b.active !== false,
    availableFrom,
    availableUntil,
    sortOrder,
  };
}

// ce que l'achat accorde au joueur ; la réduction des doublons prolonge la fin déjà en cours
export const grantOf = (
  kind: ShopItemKind,
  amount: number,
  reduceUntil: Date | null = null,
  now = new Date(),
) =>
  kind === "WIKIPEDIA_PACKS"
    ? { packs: { increment: amount } }
    : kind === "ANIME_PACKS"
      ? { animePacks: { increment: amount } }
      : kind === "LUCK_BOOST"
        ? { dropBoosts: { increment: amount } }
        : kind === "DUPLICATE_SHIELD"
          ? { dupShieldPacks: { increment: amount } }
          : {
              // amount = heures
              dupReduceUntil: new Date(
                Math.max(now.getTime(), reduceUntil?.getTime() ?? 0) + amount * 3_600_000,
              ),
            };
