import type { StaffAuditRow, StaffMemberRow, StaffReportRow } from "@wikideck/shared";
import type { MessageReport, StaffAction, User } from "@/generated/prisma/client";
import { staffRoleOf } from "@/lib/staff";
import { avatarOf } from "@/lib/trades";
import { trustOf } from "@/lib/trust";

export async function toMemberRow(
  user: User & { _count?: { cards: number } },
  cards = user._count?.cards ?? 0,
): Promise<StaffMemberRow> {
  return {
    id: user.id,
    username: user.username,
    discordId: user.discordId,
    discordName: user.discordName,
    avatarUrl: avatarOf(user),
    createdAt: user.createdAt.toISOString(),
    wikibits: user.wikibits,
    cards,
    staff: staffRoleOf(user),
    banned: user.bannedAt !== null,
    trust: (await trustOf(user)).level,
  };
}

export const toAuditRow = (a: StaffAction): StaffAuditRow => ({
  id: a.id,
  actorName: a.actorName,
  action: a.action,
  targetId: a.targetId,
  targetName: a.targetName,
  detail: a.detail,
  createdAt: a.createdAt.toISOString(),
});

export const toReportRow = (
  r: MessageReport & { reporter: User; sender: User },
): StaffReportRow => ({
  id: r.id,
  status: r.status === "DISMISSED" || r.status === "DELETED" ? r.status : "OPEN",
  createdAt: r.createdAt.toISOString(),
  reporter: { id: r.reporter.id, username: r.reporter.username },
  sender: { id: r.sender.id, username: r.sender.username },
  body: r.body,
  context: Array.isArray(r.context) ? (r.context as StaffReportRow["context"]) : [],
  handledBy: r.handledBy,
  handledAt: r.handledAt?.toISOString() ?? null,
});
