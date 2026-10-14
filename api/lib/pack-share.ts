import { randomBytes } from "node:crypto";
import type { PackShareCard, PackShareDto } from "@wikideck/shared";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

// jeton de 10 caractères (environ 59 bits) : inutile de deviner l'adresse d'un tirage
export function newShareId() {
  const bytes = randomBytes(10);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export const SHARE_ID = /^[0-9a-zA-Z]{10}$/;

export const toShareDto = (row: {
  id: string;
  ownerName: string | null;
  createdAt: Date;
  cards: unknown;
}): PackShareDto => ({
  id: row.id,
  ownerName: row.ownerName,
  createdAt: row.createdAt.toISOString(),
  cards: row.cards as PackShareCard[],
});
