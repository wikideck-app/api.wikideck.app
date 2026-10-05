import type { MessageDto } from "@wikideck/shared";

export const toMessageDto = (
  m: { id: string; senderId: string; body: string; createdAt: Date; readAt: Date | null },
  me: string,
): MessageDto => ({
  id: m.id,
  mine: m.senderId === me,
  body: m.body,
  createdAt: m.createdAt.toISOString(),
  read: m.readAt !== null,
});
