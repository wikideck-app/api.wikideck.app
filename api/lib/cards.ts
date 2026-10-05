import type { CardDto } from "@wikideck/shared";
import type { Card } from "@/generated/prisma/client";

export const toCardDto = (c: Card): CardDto => ({
  id: c.id,
  title: c.title,
  description: c.description,
  extract: c.extract,
  imageUrl: c.imageUrl,
  url: c.url,
  rarity: c.rarity,
  views: c.views,
});
