import { SignalLevel, WeatherSnapshot } from "../domain/types";

export interface Phase3InterventionInput {
  signal: SignalLevel;
  baseInterventionText: string;
  weather?: WeatherSnapshot;
  dietSummary?: string;
  symptoms?: string[];
  medicationTaken?: boolean;
}

export interface LlmClient {
  complete(prompt: string): Promise<string>;
}

export function buildInterventionPrompt(input: Phase3InterventionInput): string {
  const weatherLine = input.weather
    ? `- 날씨: ${input.weather.condition}, ${input.weather.temperatureC}도, 위험플래그=${input.weather.riskFlags.join(",") || "없음"}`
    : "- 날씨: 정보 없음";
  const dietLine = input.dietSummary ? `- 식단 분석: ${input.dietSummary}` : "- 식단 분석: 정보 없음";
  const symptomLine = input.symptoms?.length ? `- 증상: ${input.symptoms.join(", ")}` : "- 증상: 정보 없음";
  const medLine = typeof input.medicationTaken === "boolean" ? `- 복약 여부: ${input.medicationTaken ? "복약함" : "복약 안함"}` : "- 복약 여부: 정보 없음";

  return [
    "당신은 고령층 당뇨 관리 코치입니다.",
    "아래 조건으로 쉬운 한국어 2~3문장 안내문을 작성하세요.",
    "- 문장은 짧게, 격려형 어조를 유지하세요.",
    "- 반드시 안전행동과 재측정 타이밍(필요 시)을 포함하세요.",
    `- 현재 신호등 상태: ${input.signal}`,
    `- 기본 안내문: ${input.baseInterventionText}`,
    weatherLine,
    dietLine,
    symptomLine,
    medLine,
    "출력은 안내문 본문만 작성하세요.",
  ].join("\n");
}

export async function refineInterventionWithLlm(args: {
  input: Phase3InterventionInput;
  llmClient: LlmClient;
}): Promise<string> {
  const prompt = buildInterventionPrompt(args.input);
  const output = await args.llmClient.complete(prompt);
  const trimmed = output.trim();
  if (!trimmed) {
    return args.input.baseInterventionText;
  }
  return trimmed;
}
