import type { PlayerRelation } from "@wikideck/shared";
import { prisma } from "@/lib/prisma";

export async function relationsWith(me: string, ids: string[]) {
  const rows = await prisma.friendship.findMany({
    where: {
      OR: [
        { requesterId: me, addresseeId: { in: ids } },
        { addresseeId: me, requesterId: { in: ids } },
      ],
    },
  });
  const map = new Map<string, PlayerRelation>();
  for (const f of rows) {
    const other = f.requesterId === me ? f.addresseeId : f.requesterId;
    map.set(
      other,
      f.status === "ACCEPTED" ? "friend" : f.requesterId === me ? "outgoing" : "incoming",
    );
  }
  return (id: string): PlayerRelation => map.get(id) ?? "none";
}
