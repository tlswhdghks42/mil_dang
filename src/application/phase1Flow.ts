import { classifySignal } from "../domain/logic";
import { MealTiming, SignalLevel } from "../domain/types";
import { composeInterventionText } from "./intervention";

export interface AnalyzeInput {
  glucoseMgDl: number;
  mealTiming: MealTiming;
  dietAssessment?: "good" | "neutral" | "risky";
  hasWeatherRisk?: boolean;
  symptoms?: string[];
}

export interface AnalyzeOutput {
  signal: SignalLevel;
  interventionText: string;
}

export function analyzeMeasurement(input: AnalyzeInput): AnalyzeOutput {
  const signal = classifySignal(input.glucoseMgDl, input.mealTiming);
  const interventionText = composeInterventionText({
    signal,
    dietAssessment: input.dietAssessment,
    symptoms: input.symptoms,
    weather: input.hasWeatherRisk
      ? {
          district: "수영구",
          observedAt: new Date().toISOString(),
          temperatureC: 0,
          condition: "coldwave",
          riskFlags: ["coldwave"],
        }
      : undefined,
  });

  return { signal, interventionText };
}
