import { SignalLevel } from "../domain/types";
import {
  Phase3InterventionInput,
  buildInterventionPrompt,
  buildHighRiskInterventionPrompt,
} from "./phase3InterventionLLM";

export interface PromptTemplate {
  templateId: string;
  version: string;
  description: string;
  signalScope: SignalLevel[] | "all";
  build(input: Phase3InterventionInput): string;
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function assignAbVariant(userId: string, experimentId: string, variants: string[]): string {
  if (variants.length === 0) throw new Error("variants must not be empty");
  return variants[hashString(`${experimentId}:${userId}`) % variants.length];
}

export class PromptRegistry {
  private store = new Map<string, PromptTemplate>();

  register(template: PromptTemplate): this {
    this.store.set(template.templateId, template);
    return this;
  }

  get(templateId: string): PromptTemplate | undefined {
    return this.store.get(templateId);
  }

  list(): PromptTemplate[] {
    return [...this.store.values()];
  }
}

export const TEMPLATE_STANDARD_V1: PromptTemplate = {
  templateId: "standard-v1",
  version: "1.0.0",
  description: "표준 지시형 안내문",
  signalScope: "all",
  build: (input) => {
    const isHighRisk = input.signal === "critical_low" || input.signal === "red";
    return isHighRisk ? buildHighRiskInterventionPrompt(input) : buildInterventionPrompt(input);
  },
};

export const TEMPLATE_EMPATHETIC_V2: PromptTemplate = {
  templateId: "empathetic-v2",
  version: "1.0.0",
  description: "따뜻한 공감형 안내문",
  signalScope: "all",
  build(input: Phase3InterventionInput): string {
    const isHighRisk = input.signal === "critical_low" || input.signal === "red";
    if (isHighRisk) return buildHighRiskInterventionPrompt(input);

    const weatherLine = input.weather
      ? `- 날씨: ${input.weather.condition}, ${input.weather.temperatureC}도`
      : "";
    const dietLine = input.dietSummary ? `- 식사: ${input.dietSummary}` : "";
    const symptomLine = input.symptoms?.length ? `- 증상: ${input.symptoms.join(", ")}` : "";

    return [
      "당신은 따뜻한 당뇨 건강 도우미입니다. 어르신께 친근하고 격려하는 말투로 안내해주세요.",
      "아래 상황을 참고해 한국어 2~3문장의 따뜻한 응원 메시지를 작성하세요.",
      "- 어르신의 노력을 인정하고 다음 행동을 부드럽게 안내하세요.",
      `- 현재 혈당 상태: ${input.signal}`,
      `- 기본 안내문: ${input.baseInterventionText}`,
      weatherLine,
      dietLine,
      symptomLine,
      "출력은 안내문 본문만 작성하세요.",
    ]
      .filter(Boolean)
      .join("\n");
  },
};

export function createDefaultRegistry(): PromptRegistry {
  return new PromptRegistry().register(TEMPLATE_STANDARD_V1).register(TEMPLATE_EMPATHETIC_V2);
}
