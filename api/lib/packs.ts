import { PACK_MAX, PACK_REGEN_MS, type PackStatus } from "@wikideck/shared";

type PackState = { packs: number; packsRefilledAt: Date };

export function refill(state: PackState, now = new Date()): PackState {
  if (state.packs >= PACK_MAX) return state;
  const gained = Math.floor((now.getTime() - state.packsRefilledAt.getTime()) / PACK_REGEN_MS);
  if (gained <= 0) return state;
  const packs = Math.min(PACK_MAX, state.packs + gained);
  return {
    packs,
    packsRefilledAt:
      packs >= PACK_MAX ? now : new Date(state.packsRefilledAt.getTime() + gained * PACK_REGEN_MS),
  };
}

export function status(state: PackState, now = new Date()): PackStatus {
  return {
    packs: state.packs,
    max: PACK_MAX,
    nextInMs:
      state.packs >= PACK_MAX
        ? null
        : Math.max(0, state.packsRefilledAt.getTime() + PACK_REGEN_MS - now.getTime()),
  };
}
