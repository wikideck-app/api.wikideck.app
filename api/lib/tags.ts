import { TAG_NAME_MAX, type TagColor, type TagDto } from "@wikideck/shared";
import type { Tag } from "@/generated/prisma/client";

export const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export const toTagDto = (t: Tag): TagDto => ({
  id: t.id,
  name: t.name,
  color: t.color as TagColor,
});

export function parseTagName(value: unknown) {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= TAG_NAME_MAX ? name : null;
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
