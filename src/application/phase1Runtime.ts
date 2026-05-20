import { Phase1State, initialPhase1State } from "./phase1Controller";

export interface StateStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const PHASE1_STORAGE_KEY = "mildang.phase1.state.v1";

export function serializeState(state: Phase1State): string {
  return JSON.stringify(state);
}

export function deserializeState(raw: string): Phase1State {
  const parsed = JSON.parse(raw) as Partial<Phase1State>;
  return {
    ...initialPhase1State,
    ...parsed,
    showNurseCallButton: Boolean(parsed.showNurseCallButton),
    redRecheckCount: typeof parsed.redRecheckCount === "number" ? parsed.redRecheckCount : 0,
  };
}

export function saveState(storage: StateStorage, state: Phase1State): void {
  storage.setItem(PHASE1_STORAGE_KEY, serializeState(state));
}

export function loadState(storage: StateStorage): Phase1State {
  const raw = storage.getItem(PHASE1_STORAGE_KEY);
  if (!raw) return initialPhase1State;
  try {
    return deserializeState(raw);
  } catch {
    return initialPhase1State;
  }
}

export function isFollowUpDue(followUpDueAtIso?: string, nowIso = new Date().toISOString()): boolean {
  if (!followUpDueAtIso) return false;
  return new Date(nowIso).getTime() >= new Date(followUpDueAtIso).getTime();
}

export function getResultAlertBanner(state: Phase1State, nowIso: string): string | null {
  const dueAt = state.latestSafetyEvent?.followUpDueAt;
  if (!dueAt) return null;
  return isFollowUpDue(dueAt, nowIso)
    ? "재측정 시간이 되었어요. 지금 다시 혈당을 측정해 주세요."
    : null;
}
