import type { User } from "@/generated/prisma/client";
import type { Actor } from "@/lib/battle-room";
import { avatarOf } from "@/lib/trades";

export const actorOf = (user: User): Actor => ({
  id: user.id,
  name: user.username,
  avatarUrl: avatarOf(user),
});
