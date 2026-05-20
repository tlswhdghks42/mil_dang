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

export interface GuardrailResult {
  passed: boolean;
  violations: string[];
}

const FORBIDDEN_BY_SIGNAL: Partial<Record<SignalLevel, string[]>> = {
  critical_low: ["괜찮아요", "안심하세요", "별거 아니에요"],
  low: ["괜찮아요", "안심하세요"],
  red: ["괜찮아요", "안심하세요", "별거 아니에요"],
};

const REQUIRED_BY_SIGNAL: Partial<Record<SignalLevel, string[]>> = {
  critical_low: ["당분", "재측정"],
  low: ["재측정"],
  red: ["재측정"],
};

export function checkGuardrails(text: string, signal: SignalLevel): GuardrailResult {
  const violations: string[] = [];

  for (const phrase of FORBIDDEN_BY_SIGNAL[signal] ?? []) {
    if (text.includes(phrase)) {
      violations.push(`금지 표현 포함: "${phrase}"`);
    }
  }

  for (const phrase of REQUIRED_BY_SIGNAL[signal] ?? []) {
    if (!text.includes(phrase)) {
      violations.push(`필수 표현 누락: "${phrase}"`);
    }
  }

  return { passed: violations.length === 0, violations };
}

// Korean: ~1.5 chars/token, others: ~4 chars/token
export function estimateTokens(text: string): number {
  const koreanChars = (text.match(/[가-힣]/g) ?? []).length;
  const otherChars = text.length - koreanChars;
  return Math.ceil(koreanChars / 1.5 + otherChars / 4);
}

export function buildInterventionPrompt(input: Phase3InterventionInput): string {
  const weatherLine = input.weather
    ? `- 날씨: ${input.weather.condition}, ${input.weather.temperatureC}도, 위험플래그=${input.weather.riskFlags.join(",") || "없음"}`
    : "- 날씨: 정보 없음";
  const dietLine = input.dietSummary ? `- 식단 분석: ${input.dietSummary}` : "- 식단 분석: 정보 없음";
  const symptomLine = input.symptoms?.length ? `- 증상: ${input.symptoms.join(", ")}` : "- 증상: 정보 없음";
  const medLine =
    typeof input.medicationTaken === "boolean"
      ? `- 복약 여부: ${input.medicationTaken ? "복약함" : "복약 안함"}`
      : "- 복약 여부: 정보 없음";

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

export function buildHighRiskInterventionPrompt(input: Phase3InterventionInput): string {
  const isCritical = input.signal === "critical_low";
  const urgency = isCritical ? "매우 위험(응급)" : "위험(주의 요함)";
  const mustHave = isCritical
    ? "반드시 당분 섭취, 15분 후 재측정, 보호자/119 연락을 포함하세요."
    : "반드시 복약 확인과 30분 후 재측정을 포함하세요.";

  const symptomLine = input.symptoms?.length ? `- 증상: ${input.symptoms.join(", ")}` : "- 증상: 없음";
  const medLine =
    typeof input.medicationTaken === "boolean"
      ? `- 복약: ${input.medicationTaken ? "복약함" : "복약 안함"}`
      : "- 복약: 정보 없음";

  return [
    `당신은 고령층 당뇨 응급 안내 코치입니다. 현재 혈당 상태는 [${urgency}]입니다.`,
    "짧고 명확한 한국어 2~3문장으로 즉각 행동 지침을 작성하세요.",
    mustHave,
    "- 어르신이 혼자 있을 수 있으니 행동 순서를 명확히 하세요.",
    `- 신호 단계: ${input.signal}`,
    `- 기본 안내문: ${input.baseInterventionText}`,
    symptomLine,
    medLine,
    "출력은 안내문 본문만 작성하세요.",
  ].join("\n");
}

export async function refineInterventionWithLlm(args: {
  input: Phase3InterventionInput;
  llmClient: LlmClient;
}): Promise<string> {
  const isHighRisk = args.input.signal === "critical_low" || args.input.signal === "red";
  const prompt = isHighRisk
    ? buildHighRiskInterventionPrompt(args.input)
    : buildInterventionPrompt(args.input);

  const output = await args.llmClient.complete(prompt);
  const trimmed = output.trim();

  if (!trimmed) return args.input.baseInterventionText;

  const guardrail = checkGuardrails(trimmed, args.input.signal);
  if (!guardrail.passed) return args.input.baseInterventionText;

  return trimmed;
}
