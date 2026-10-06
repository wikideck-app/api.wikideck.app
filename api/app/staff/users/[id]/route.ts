import {
  PACK_MAX,
  type StaffMemberDetail,
  type StaffRole,
  type StaffUserAction,
} from "@wikideck/shared";
import { leaveGuild } from "@/lib/guild";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { withRateLimit } from "@/lib/rate-limit";
import { atLeast, isEnvAdmin, logStaff, outranks, requireStaff } from "@/lib/staff";
import { refreshStaffAlerts } from "@/lib/staff-alerts";
import { toAuditRow, toMemberRow } from "@/lib/staff-dto";
import { isUuid, readJson } from "@/lib/tags";
import { discordCreatedAt, trustCacheKey, trustOf } from "@/lib/trust";
import { parseUsername } from "@/lib/usernames";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withRateLimit<Ctx>(
  "staff-user",
  { limit: 120, windowSec: 60 },
  async (_request, { params }) => {
    const auth = await requireStaff("MODERATOR");
    if (auth instanceof Response) return auth;
    const { id } = await params;
    if (!isUuid(id)) return Response.json({ error: "not_found" }, { status: 404 });
    const user = await prisma.user.findUnique({
      where: { id },
      include: { _count: { select: { cards: true } } },
    });
    if (!user) return Response.json({ error: "not_found" }, { status: 404 });

    const [row, trust, signals, devices, played, wins, pulls, actions] = await Promise.all([
      toMemberRow(user),
      trustOf(user),
      prisma.abuseSignal.findMany({
        where: { userId: id },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      prisma.device.findMany({ where: { userId: id }, select: { deviceId: true } }),
      prisma.battleGame.count({ where: { userId: id } }),
      prisma.battleGame.count({ where: { userId: id, won: true } }),
      prisma.pull.count({ where: { userId: id } }),
      prisma.staffAction.findMany({
        where: { targetId: id },
        orderBy: { createdAt: "desc" },
        take: 15,
      }),
    ]);
    const linked = devices.length
      ? await prisma.device.findMany({
          where: { deviceId: { in: devices.map((d) => d.deviceId) }, userId: { not: id } },
          select: { user: { select: { id: true, username: true } } },
          distinct: ["userId"],
        })
      : [];

    return Response.json({
      ...row,
      discordId: user.discordId,
      discordCreatedAt: discordCreatedAt(user.discordId)?.toISOString() ?? null,
      packs: user.packs,
      pulls,
      battle: { played, wins },
      banReason: user.banReason,
      bannedAt: user.bannedAt?.toISOString() ?? null,
      trustOverride:
        user.trustOverride === "TRUSTED" || user.trustOverride === "RESTRICTED"
          ? user.trustOverride
          : null,
      trustScore: trust.trustScore,
      riskScore: trust.riskScore,
      signals: signals.map((s) => ({
        type: s.type,
        weight: s.weight,
        at: s.createdAt.toISOString(),
      })),
      linkedAccounts: linked.map((l) => l.user),
      actions: actions.map(toAuditRow),
    } satisfies StaffMemberDetail);
  },
);

const reasonOf = (v: unknown, required: boolean) => {
  const text = typeof v === "string" ? v.trim().slice(0, 200) : "";
  return text.length >= 3 || (!required && text.length === 0) ? text : null;
};

export const POST = withRateLimit<Ctx>(
  "staff-user-action",
  { limit: 60, windowSec: 60 },
  async (request, { params }) => {
    const auth = await requireStaff("MODERATOR");
    if (auth instanceof Response) return auth;
    const { user: actor, role } = auth;
    const { id } = await params;
    if (!isUuid(id)) return Response.json({ error: "not_found" }, { status: 404 });
    const body = (await readJson(request)) as StaffUserAction | null;
    if (!body || typeof body.action !== "string")
      return Response.json({ error: "invalid" }, { status: 400 });

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return Response.json({ error: "not_found" }, { status: 404 });
    const isSelf = target.id === actor.id;
    const bad = (error: string, status = 400) => Response.json({ error }, { status });
    const mayModerate = !isSelf && outranks(role, target);

    switch (body.action) {
      case "ban": {
        const reason = reasonOf(body.reason, true);
        if (!reason) return bad("invalid_reason");
        if (!mayModerate || isEnvAdmin(target)) return bad("forbidden", 403);
        await prisma.user.update({
          where: { id },
          data: { bannedAt: new Date(), banReason: reason },
        });
        await logStaff(actor, "ban", target, { reason });
        break;
      }
      case "unban": {
        if (!target.bannedAt) return bad("invalid");
        await prisma.user.update({ where: { id }, data: { bannedAt: null, banReason: null } });
        await logStaff(actor, "unban", target);
        break;
      }
      case "rename": {
        const username = parseUsername(body.username);
        if (!username) return bad("invalid_username");
        if (!isSelf && !mayModerate) return bad("forbidden", 403);
        const taken = await prisma.user.findFirst({
          where: { id: { not: id }, username: { equals: username, mode: "insensitive" } },
        });
        if (taken) return bad("username_taken", 409);
        await prisma.user.update({ where: { id }, data: { username } });
        await logStaff(actor, "rename", target, { from: target.username, to: username });
        break;
      }
      case "setTrust": {
        const value = body.override;
        if (value !== null && value !== "TRUSTED" && value !== "RESTRICTED") return bad("invalid");
        if (!mayModerate) return bad("forbidden", 403);
        await prisma.user.update({ where: { id }, data: { trustOverride: value } });
        await redis.del(trustCacheKey(id));
        await logStaff(actor, "set_trust", target, { override: value });
        break;
      }
      case "clearSignals": {
        if (!mayModerate) return bad("forbidden", 403);
        const { count } = await prisma.abuseSignal.deleteMany({ where: { userId: id } });
        await redis.del(trustCacheKey(id));
        await logStaff(actor, "clear_signals", target, { count });
        break;
      }
      case "wikibits": {
        if (!atLeast(role, "ADMIN")) return bad("forbidden", 403);
        const amount = body.amount;
        const reason = reasonOf(body.reason, true);
        if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 1_000_000)
          return bad("invalid");
        if (!reason) return bad("invalid_reason");
        const done = await prisma.user.updateMany({
          where: { id, wikibits: { gte: amount < 0 ? -amount : 0 } },
          data: { wikibits: { increment: amount } },
        });
        if (done.count === 0) return bad("insufficient_funds");
        await logStaff(actor, "wikibits", target, { amount, reason });
        break;
      }
      case "packs": {
        if (!atLeast(role, "ADMIN")) return bad("forbidden", 403);
        const count = body.count;
        if (!Number.isInteger(count) || count < 1 || count > 100) return bad("invalid");
        await prisma.user.update({ where: { id }, data: { packs: { increment: count } } });
        await logStaff(actor, "packs", target, { count, maxRecharge: PACK_MAX });
        break;
      }
      case "setRole": {
        if (!atLeast(role, "ADMIN")) return bad("forbidden", 403);
        const next: StaffRole | null = body.role;
        if (next !== null && next !== "MODERATOR" && next !== "ADMIN") return bad("invalid");
        if (isSelf || isEnvAdmin(target)) return bad("forbidden", 403);
        await prisma.user.update({ where: { id }, data: { staffRole: next } });
        await logStaff(actor, "set_role", target, { from: target.staffRole, to: next });
        break;
      }
      case "delete": {
        if (!atLeast(role, "ADMIN")) return bad("forbidden", 403);
        if (!mayModerate || isEnvAdmin(target)) return bad("forbidden", 403);
        const reason = reasonOf(body.reason, true);
        if (!reason) return bad("invalid_reason");
        if (body.confirm !== target.username) return bad("confirmation_required");
        // enchères en cours : des cartes et des wikibits d'autres joueurs y sont bloqués
        const open = await prisma.auction.count({
          where: { status: "ACTIVE", OR: [{ sellerId: id }, { leaderId: id }] },
        });
        if (open > 0) return bad("target_active_auctions", 409);
        await logStaff(actor, "delete_user", target, { reason, discordId: target.discordId });
        await prisma.$transaction(async (tx) => {
          await leaveGuild(tx, id);
          await tx.user.delete({ where: { id } });
        });
        await refreshStaffAlerts();
        return Response.json({ deleted: true });
      }
      default:
        return bad("invalid");
    }

    if (body.action === "ban" || body.action === "setTrust" || body.action === "clearSignals")
      await refreshStaffAlerts();

    const updated = await prisma.user.findUniqueOrThrow({
      where: { id },
      include: { _count: { select: { cards: true } } },
    });
    return Response.json(await toMemberRow(updated));
  },
);
