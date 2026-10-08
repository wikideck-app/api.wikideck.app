import type { StaffRole } from "@wikideck/shared";
import type { User } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { currentUser, sessionUser } from "@/lib/session";

const RANK: Record<StaffRole, number> = { MODERATOR: 1, ADMIN: 2 };

export const envAdmins = () =>
  (process.env.ADMIN_DISCORD_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export function staffRoleOf(user: Pick<User, "discordId" | "staffRole">): StaffRole | null {
  if (envAdmins().includes(user.discordId)) return "ADMIN";
  return user.staffRole ?? null;
}

export const isEnvAdmin = (user: Pick<User, "discordId">) => envAdmins().includes(user.discordId);

export const atLeast = (role: StaffRole | null, min: StaffRole) =>
  role !== null && RANK[role] >= RANK[min];

export function outranks(actor: StaffRole, target: Pick<User, "discordId" | "staffRole">) {
  const t = staffRoleOf(target);
  return t === null || RANK[actor] > RANK[t];
}

// sessionOnly : refuse les clés API (gestion des clés elles-mêmes, pour qu'une clé ne puisse pas en créer d'autres)
export async function requireStaff(
  min: StaffRole,
  { sessionOnly = false }: { sessionOnly?: boolean } = {},
): Promise<{ user: User; role: StaffRole } | Response> {
  const user = await (sessionOnly ? sessionUser() : currentUser());
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const role = staffRoleOf(user);
  if (!role) return Response.json({ error: "not_found" }, { status: 404 });
  if (!atLeast(role, min)) return Response.json({ error: "forbidden" }, { status: 403 });
  return { user, role };
}

export async function logStaff(
  actor: Pick<User, "id" | "username">,
  action: string,
  target?: Pick<User, "id" | "username"> | null,
  detail?: Record<string, unknown>,
) {
  await prisma.staffAction.create({
    data: {
      actorId: actor.id,
      actorName: actor.username,
      action,
      targetId: target?.id ?? null,
      targetName: target?.username ?? null,
      detail: (detail ?? undefined) as object | undefined,
    },
  });
}
