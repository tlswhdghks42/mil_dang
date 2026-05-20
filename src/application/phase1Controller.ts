import { analyzeMeasurement, analyzeMeasurementWithLlm, LlmRefinementOptions } from "./phase1Flow";
import { followUpMinutesFor, makeSafetyEvent } from "../domain/logic";
import { MealTiming, SignalLevel, SafetyEvent } from "../domain/types";
import { ScreenKey } from "../screens/phase1";

export interface Phase1State {
  screen: ScreenKey;
  mealTiming: MealTiming;
  glucoseText: string;
  signal?: SignalLevel;
  interventionText?: string;
  latestSafetyEvent?: SafetyEvent;
  showNurseCallButton: boolean;
  redRecheckCount: number;
}

export const initialPhase1State: Phase1State = {
  screen: "home",
  mealTiming: "fasting",
  glucoseText: "",
  showNurseCallButton: false,
  redRecheckCount: 0,
};

export function goToInput(state: Phase1State): Phase1State {
  return { ...state, screen: "input" };
}

export function updateInput(state: Phase1State, patch: Partial<Pick<Phase1State, "mealTiming" | "glucoseText">>): Phase1State {
  return { ...state, ...patch };
}

export function analyzeAndMoveResult(state: Phase1State, nowIso: string, userId = "demo-user"): Phase1State {
  const glucoseMgDl = Number(state.glucoseText);
  if (!Number.isFinite(glucoseMgDl) || glucoseMgDl <= 0) {
    throw new Error("혈당 수치는 0보다 큰 숫자여야 합니다.");
  }

  const analyzed = analyzeMeasurement({
    glucoseMgDl,
    mealTiming: state.mealTiming,
  });

  const latestSafetyEvent = makeSafetyEvent({
    eventId: `ev-${nowIso}`,
    userId,
    recordId: `rec-${nowIso}`,
    signalLevel: analyzed.signal,
    nowIso,
  });

  const redRecheckCount = analyzed.signal === "red" ? state.redRecheckCount + 1 : 0;
  const showNurseCallButton = redRecheckCount >= 2;

  return {
    ...state,
    screen: "result",
    signal: analyzed.signal,
    interventionText: analyzed.interventionText,
    latestSafetyEvent: latestSafetyEvent ?? undefined,
    redRecheckCount,
    showNurseCallButton,
  };
}

export async function analyzeAndMoveResultWithLlm(
  state: Phase1State,
  nowIso: string,
  llmOptions: LlmRefinementOptions,
  userId = "demo-user",
): Promise<Phase1State> {
  const glucoseMgDl = Number(state.glucoseText);
  if (!Number.isFinite(glucoseMgDl) || glucoseMgDl <= 0) {
    throw new Error("혈당 수치는 0보다 큰 숫자여야 합니다.");
  }

  const analyzed = await analyzeMeasurementWithLlm({
    glucoseMgDl,
    mealTiming: state.mealTiming,
    llmOptions,
  });

  const latestSafetyEvent = makeSafetyEvent({
    eventId: `ev-${nowIso}`,
    userId,
    recordId: `rec-${nowIso}`,
    signalLevel: analyzed.signal,
    nowIso,
  });

  const redRecheckCount = analyzed.signal === "red" ? state.redRecheckCount + 1 : 0;
  const showNurseCallButton = redRecheckCount >= 2;

  return {
    ...state,
    screen: "result",
    signal: analyzed.signal,
    interventionText: analyzed.interventionText,
    latestSafetyEvent: latestSafetyEvent ?? undefined,
    redRecheckCount,
    showNurseCallButton,
  };
}

export function getFollowUpDueText(state: Phase1State): string | null {
  const signal = state.signal;
  if (!signal) return null;
  const minutes = followUpMinutesFor(signal);
  if (!minutes) return null;
  return `${minutes}분 후 재측정이 필요해요.`;
}

export function nextFromResult(state: Phase1State): Phase1State {
  return { ...state, screen: "exit" };
}

export function goHome(state: Phase1State): Phase1State {
  return {
    ...initialPhase1State,
    mealTiming: state.mealTiming,
  };
}
