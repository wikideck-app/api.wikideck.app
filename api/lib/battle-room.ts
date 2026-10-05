import { randomInt, randomUUID } from "node:crypto";
import {
  BATTLE_COUNTDOWN_MS,
  BATTLE_DAILY_CAP,
  BATTLE_GAME_BONUS_PER_PLAYER,
  BATTLE_GAME_REWARD,
  BATTLE_MAX_PLAYERS,
  BATTLE_MAX_ROUNDS,
  BATTLE_MIN_PLAYERS,
  BATTLE_REWARD_PLAYERS_CAP,
  BATTLE_ROUND_BONUS_PER_PLAYER,
  BATTLE_ROUND_REWARD,
  type BattlePlayer,
  type BattleRoom,
  type BattleRoomAction,
  type BattleRoomSettings,
} from "@wikideck/shared";
import { normalizeTitle } from "@/lib/battle";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { recordSignal, trustOf } from "@/lib/trust";

const PLAYER_TIMEOUT_MS = 90_000;
const MAX_PATH = 300;

export type Actor = { id: string; name: string; avatarUrl: string | null };
export type ActionError = { code: string; status: number };
export type ActionResult = { error?: ActionError; finished?: boolean };

const fail = (code: string, status: number): ActionResult => ({ error: { code, status } });
const clamp = (n: unknown, min: number, max: number, fallback: number) =>
  typeof n === "number" && Number.isFinite(n)
    ? Math.min(max, Math.max(min, Math.floor(n)))
    : fallback;

const minPlayers = () => clamp(Number(process.env.BATTLE_MIN_PLAYERS), 1, 20, BATTLE_MIN_PLAYERS);

export function newRoom(
  code: string,
  host: Actor,
  settings: Partial<BattleRoomSettings>,
  now: number,
) {
  const room: BattleRoom = {
    code,
    players: [],
    phase: "waiting",
    round: 0,
    totalRounds: 3,
    maxPlayers: 8,
    gameMode: "race",
    searchAllowed: false,
    timeLimit: 0,
    startArticle: "",
    targetArticle: "",
    roundWinner: null,
    rewards: {},
    countdownStart: null,
    roundStart: null,
    createdAt: now,
  };
  applySettings(room, settings);
  room.players.push(newPlayer(host, true, now));
  return room;
}

const newPlayer = (actor: Actor, isHost: boolean, now: number): BattlePlayer => ({
  id: actor.id,
  name: actor.name.slice(0, 24),
  avatarUrl: actor.avatarUrl,
  score: 0,
  roundPoints: 0,
  path: [],
  hasWon: false,
  hasSurrendered: false,
  isHost,
  lastSeen: now,
  wonAt: null,
});

function applySettings(room: BattleRoom, s: Partial<BattleRoomSettings>) {
  if (s.gameMode === "race" || s.gameMode === "all_finish") room.gameMode = s.gameMode;
  if (s.maxPlayers !== undefined)
    room.maxPlayers = Math.max(
      room.players.length,
      clamp(s.maxPlayers, 2, BATTLE_MAX_PLAYERS, room.maxPlayers),
    );
  if (s.totalRounds !== undefined)
    room.totalRounds = clamp(s.totalRounds, 1, BATTLE_MAX_ROUNDS, room.totalRounds);
  if (s.timeLimit !== undefined) room.timeLimit = clamp(s.timeLimit, 0, 3600, room.timeLimit);
  if (typeof s.searchAllowed === "boolean") room.searchAllowed = s.searchAllowed;
}

export function pointsFor(player: BattlePlayer, room: BattleRoom, now: number) {
  const clicks = Math.max(0, player.path.length - 1);
  const clickPts = Math.max(0, 10 - Math.floor(clicks / 5));
  const wonAt = player.wonAt ?? now;
  const elapsed = wonAt - (room.roundStart ?? wonAt);
  const timePts =
    room.timeLimit > 0
      ? Math.max(0, Math.floor(((room.timeLimit * 1000 - elapsed) / (room.timeLimit * 1000)) * 10))
      : Math.max(0, 10 - Math.floor(elapsed / 30_000));
  return clickPts + timePts;
}

const everyoneDone = (room: BattleRoom) => room.players.every((p) => p.hasWon || p.hasSurrendered);

function finishRound(room: BattleRoom, now: number) {
  if (room.gameMode === "all_finish") {
    const winners = room.players.filter((p) => p.hasWon);
    for (const p of winners) {
      p.roundPoints = pointsFor(p, room, now);
      p.score += p.roundPoints;
    }
    room.roundWinner =
      [...winners].sort(
        (a, b) => b.roundPoints - a.roundPoints || (a.wonAt ?? 0) - (b.wonAt ?? 0),
      )[0]?.id ?? null;
  }
  room.phase = "results";
}

function settle(room: BattleRoom, now: number): boolean {
  if (room.phase !== "playing") return false;
  const finished = everyoneDone(room);
  if (finished) finishRound(room, now);
  return finished;
}

const isHost = (room: BattleRoom, id: string) => room.players.find((p) => p.id === id)?.isHost;

export function applyAction(
  room: BattleRoom,
  actor: Actor,
  act: BattleRoomAction,
  now: number,
  puzzle?: { start: string; target: string } | null,
): ActionResult {
  const me = room.players.find((p) => p.id === actor.id);

  if (room.phase === "waiting") {
    room.players = room.players.filter((p) => p.isHost || now - p.lastSeen < PLAYER_TIMEOUT_MS);
  }

  if (act.action === "join") {
    if (me) {
      me.lastSeen = now;
      me.name = actor.name.slice(0, 24);
      me.avatarUrl = actor.avatarUrl;
      return {};
    }
    if (room.phase !== "waiting" && room.phase !== "results") return fail("in_progress", 409);
    if (room.players.length >= room.maxPlayers) return fail("room_full", 409);
    room.players.push(newPlayer(actor, false, now));
    return {};
  }
  if (!me) return fail("not_member", 403);
  me.lastSeen = now;

  switch (act.action) {
    case "heartbeat":
      return {};

    case "leave": {
      room.players = room.players.filter((p) => p.id !== actor.id);
      if (room.players.length && !room.players.some((p) => p.isHost)) room.players[0].isHost = true;
      return { finished: settle(room, now) };
    }

    case "settings": {
      if (!isHost(room, actor.id)) return fail("forbidden", 403);
      if (room.phase !== "waiting" && room.phase !== "results") return fail("in_progress", 409);
      applySettings(room, act.settings ?? {});
      return {};
    }

    case "start": {
      if (!isHost(room, actor.id)) return fail("forbidden", 403);
      const fresh = room.phase === "waiting";
      const next = room.phase === "results" && room.round < room.totalRounds;
      if (!fresh && !next) return fail("in_progress", 409);
      if (room.players.length < minPlayers()) return fail("not_enough_players", 400);
      if (!puzzle) return fail("no_catalog", 503);
      if (room.round === 0) for (const p of room.players) p.score = 0;
      room.round += 1;
      room.startArticle = puzzle.start;
      room.targetArticle = puzzle.target;
      room.roundWinner = null;
      room.rewards = {};
      room.phase = "countdown";
      room.countdownStart = now;
      room.roundStart = null;
      for (const p of room.players) {
        p.path = [puzzle.start];
        p.roundPoints = 0;
        p.hasWon = false;
        p.hasSurrendered = false;
        p.wonAt = null;
        p.lastSeen = now;
      }
      return {};
    }

    case "play": {
      if (
        room.phase === "countdown" &&
        now - (room.countdownStart ?? 0) >= BATTLE_COUNTDOWN_MS - 150
      ) {
        room.phase = "playing";
        room.roundStart = now;
      }
      return {};
    }

    case "navigate": {
      if (room.phase !== "playing") return {};
      if (me.hasWon || me.hasSurrendered) return {};
      const article = act.article;
      if (typeof article !== "string" || !article.length || article.length > 300)
        return fail("invalid", 400);
      if (me.path.length >= MAX_PATH) return fail("invalid", 400);
      me.path.push(article);
      if (normalizeTitle(article) === normalizeTitle(room.targetArticle)) {
        me.hasWon = true;
        me.wonAt = now;
        if (room.gameMode === "race" && !room.players.some((p) => p.hasWon && p.id !== me.id)) {
          me.roundPoints = pointsFor(me, room, now);
          me.score += me.roundPoints;
          room.roundWinner = me.id;
          room.phase = "results";
          return { finished: true };
        }
      }
      return { finished: settle(room, now) };
    }

    case "surrender": {
      if (room.phase !== "playing" || me.hasWon || me.hasSurrendered) return {};
      me.hasSurrendered = true;
      return { finished: settle(room, now) };
    }

    case "timeUp": {
      if (room.phase !== "playing" || !room.timeLimit || !room.roundStart) return {};
      if (now - room.roundStart < room.timeLimit * 1000 - 1000) return {};
      for (const p of room.players) if (!p.hasWon) p.hasSurrendered = true;
      finishRound(room, now);
      return { finished: true };
    }

    case "reset": {
      if (!isHost(room, actor.id)) return fail("forbidden", 403);
      room.phase = "waiting";
      room.round = 0;
      room.roundWinner = null;
      room.rewards = {};
      room.countdownStart = null;
      room.roundStart = null;
      room.startArticle = "";
      room.targetArticle = "";
      for (const p of room.players) {
        p.score = 0;
        p.roundPoints = 0;
        p.path = [];
        p.hasWon = false;
        p.hasSurrendered = false;
        p.wonAt = null;
        p.lastSeen = now;
      }
      return {};
    }

    default:
      return fail("invalid", 400);
  }
}

export function computeRewards(room: BattleRoom): Record<string, number> {
  const out: Record<string, number> = {};
  if (room.players.length < 2) return out;
  const opponents = Math.min(room.players.length, BATTLE_REWARD_PLAYERS_CAP) - 1;
  const active = (p: BattlePlayer) => p.hasWon || p.path.length > 1;

  const winner = room.roundWinner;
  if (winner && room.players.some((p) => p.id !== winner && active(p)))
    out[winner] = BATTLE_ROUND_REWARD + BATTLE_ROUND_BONUS_PER_PLAYER * opponents;

  if (room.round >= room.totalRounds) {
    const ranked = [...room.players].sort((a, b) => b.score - a.score);
    const champion = ranked[0];
    if (
      champion.score > 0 &&
      champion.score > (ranked[1]?.score ?? 0) &&
      room.players.some((p) => p.id !== champion.id && (p.score > 0 || active(p)))
    )
      out[champion.id] =
        (out[champion.id] ?? 0) + BATTLE_GAME_REWARD + BATTLE_GAME_BONUS_PER_PLAYER * opponents;
  }
  return out;
}

const TTL_SEC = 2 * 60 * 60;
const roomKey = (code: string) => `bt:room:${code}`;
const userKey = (id: string) => `bt:user:${id}`;
export const roomChannel = (code: string) => `bt:ch:${code}`;

export async function loadRoom(code: string): Promise<BattleRoom | null> {
  const raw = await redis.get(roomKey(code));
  return raw ? (JSON.parse(raw) as BattleRoom) : null;
}

async function persist(room: BattleRoom) {
  await redis.set(roomKey(room.code), JSON.stringify(room), "EX", TTL_SEC);
  await Promise.all(room.players.map((p) => redis.set(userKey(p.id), room.code, "EX", TTL_SEC)));
  await redis.publish(roomChannel(room.code), JSON.stringify(room));
}

export async function roomOf(userId: string): Promise<BattleRoom | null> {
  const code = await redis.get(userKey(userId));
  if (!code) return null;
  const room = await loadRoom(code);
  if (room?.players.some((p) => p.id === userId)) return room;
  await redis.del(userKey(userId));
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withLock<T>(code: string, fn: () => Promise<T>): Promise<T> {
  const key = `bt:lock:${code}`;
  const token = randomUUID();
  for (let i = 0; i < 50; i++) {
    if (await redis.set(key, token, "PX", 5000, "NX")) {
      try {
        return await fn();
      } finally {
        if ((await redis.get(key)) === token) await redis.del(key);
      }
    }
    await sleep(40);
  }
  throw new Error("busy");
}

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const randomCode = () =>
  Array.from({ length: 4 }, () => LETTERS[randomInt(LETTERS.length)]).join("");

export async function createRoom(host: Actor, settings: Partial<BattleRoomSettings>) {
  const previous = await roomOf(host.id);
  if (previous) await mutateRoom(previous.code, host, { action: "leave" });
  const now = Date.now();
  for (let i = 0; i < 30; i++) {
    const code = randomCode();
    const room = newRoom(code, host, settings, now);
    if (await redis.set(roomKey(code), JSON.stringify(room), "EX", TTL_SEC, "NX")) {
      await persist(room);
      return room;
    }
  }
  throw new Error("no_code");
}

async function grantWithinCap(userId: string, amount: number) {
  const key = `bt:earn:${userId}:${new Date().toISOString().slice(0, 10)}`;
  const earned = Number((await redis.get(key)) ?? 0);
  const grant = Math.max(0, Math.min(amount, BATTLE_DAILY_CAP - earned));
  if (grant > 0) {
    await redis.incrby(key, grant);
    await redis.expire(key, 36 * 60 * 60);
  }
  return grant;
}

const PAIR_ROUNDS_PER_DAY = 6;

async function pairFarming(room: BattleRoom, winnerId: string) {
  const day = new Date().toISOString().slice(0, 10);
  let farming = false;
  for (const p of room.players) {
    if (p.id === winnerId || !(p.hasWon || p.path.length > 1)) continue;
    const pair = [winnerId, p.id].sort().join(":");
    const key = `bt:pair:${pair}:${day}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 36 * 60 * 60);
    if (count > PAIR_ROUNDS_PER_DAY) {
      farming = true;
      await recordSignal(winnerId, "BATTLE_PAIR", `pair:${p.id}:${day}`, { with: p.id });
    }
  }
  return farming;
}

async function payRewards(room: BattleRoom) {
  const due = computeRewards(room);
  const paid: Record<string, number> = {};
  for (const [userId, amount] of Object.entries(due)) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) continue;
    const { level } = await trustOf(user);
    const farming = userId === room.roundWinner && (await pairFarming(room, userId));
    if (level === "RESTRICTED" || farming) {
      paid[userId] = -1;
      continue;
    }
    const grant = await grantWithinCap(
      userId,
      level === "SUSPECT" ? Math.floor(amount / 2) : amount,
    );
    if (grant > 0)
      await prisma.user.update({ where: { id: userId }, data: { wikibits: { increment: grant } } });
    paid[userId] = grant;
  }
  room.rewards = paid;
}

export type MutationResult = { room: BattleRoom | null; error?: ActionError };

export async function mutateRoom(
  code: string,
  actor: Actor,
  act: BattleRoomAction,
  puzzle?: { start: string; target: string } | null,
): Promise<MutationResult> {
  let finishedRoom: BattleRoom | null = null;
  const result = await withLock(code, async (): Promise<MutationResult> => {
    const room = await loadRoom(code);
    if (!room) return { room: null, error: { code: "not_found", status: 404 } };
    const now = Date.now();
    const outcome = applyAction(room, actor, act, now, puzzle);
    if (outcome.error) return { room, error: outcome.error };

    if (outcome.finished && room.players.length) await payRewards(room);
    if (act.action === "leave") await redis.del(userKey(actor.id));
    if (!room.players.length) {
      await redis.del(roomKey(code));
      return { room: null };
    }
    await persist(room);
    if (outcome.finished) finishedRoom = structuredClone(room);
    return { room };
  });
  if (finishedRoom)
    void recordRound(finishedRoom).catch((e) => console.error("battle: manche non enregistrée", e));
  return result;
}

async function recordRound(room: BattleRoom) {
  const rows = room.players
    .filter((p) => p.hasWon || p.path.length > 1)
    .map((p) => ({
      userId: p.id,
      startArticle: room.startArticle,
      targetArticle: room.targetArticle,
      path: p.path,
      clicks: Math.max(0, p.path.length - 1),
      timeSeconds:
        Math.round(((p.wonAt ?? Date.now()) - (room.roundStart ?? Date.now())) / 100) / 10,
      won: p.hasWon,
      mode: "multi",
    }));
  if (rows.length) await prisma.battleGame.createMany({ data: rows });
}
