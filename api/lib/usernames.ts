import { USERNAME_MAX, USERNAME_MIN, USERNAME_PATTERN } from "@wikideck/shared";

export function parseUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  const length = [...name].length;
  return length >= USERNAME_MIN && length <= USERNAME_MAX && USERNAME_PATTERN.test(name)
    ? name
    : null;
}
