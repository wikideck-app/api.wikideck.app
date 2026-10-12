import { PACK_MAX, PACK_REGEN_MS, PACK_SPEEDUP_DIVISOR, type PackStatus } from "@wikideck/shared";

type PackState = { packs: number; packsRefilledAt: Date };

// délai avant le paquet suivant, pour une attente qui commence à `since` (divisé tant que l'article de la boutique est actif)
const regenMs = (since: number, speedUntil: Date | null) =>
  speedUntil && since < speedUntil.getTime() ? PACK_REGEN_MS / PACK_SPEEDUP_DIVISOR : PACK_REGEN_MS;

export function refill(state: PackState, now = new Date(), speedUntil: Date | null = null): PackState {
  if (state.packs >= PACK_MAX) return state;
  let packs = state.packs;
  let since = state.packsRefilledAt.getTime();
  while (packs < PACK_MAX) {
    const step = regenMs(since, speedUntil);
    if (since + step > now.getTime()) break;
    since += step;
    packs++;
  }
  if (packs === state.packs) return state;
  return { packs, packsRefilledAt: packs >= PACK_MAX ? now : new Date(since) };
}

export function status(state: PackState, now = new Date(), speedUntil: Date | null = null): PackStatus {
  const since = state.packsRefilledAt.getTime();
  return {
    packs: state.packs,
    max: PACK_MAX,
    nextInMs:
      state.packs >= PACK_MAX ? null : Math.max(0, since + regenMs(since, speedUntil) - now.getTime()),
    speedUpUntil: speedUntil && speedUntil > now ? speedUntil.toISOString() : null,
  };
}
