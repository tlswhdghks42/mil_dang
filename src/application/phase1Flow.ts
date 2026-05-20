import { classifySignal } from "../domain/logic";
import { MealTiming, SignalLevel, WeatherSnapshot } from "../domain/types";
import { composeInterventionText } from "./intervention";
import {
  LlmClient,
  Phase3InterventionInput,
  buildInterventionPrompt,
  buildHighRiskInterventionPrompt,
  checkGuardrails,
  estimateTokens,
} from "./phase3InterventionLLM";
import { MetricsSink, LlmCallMetric } from "./phase3Metrics";
import { PromptRegistry } from "./phase3PromptRegistry";

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

export interface LlmRefinementOptions {
  llmClient: LlmClient;
  metricsSink?: MetricsSink;
  promptRegistry?: PromptRegistry;
  templateId?: string;
  weather?: WeatherSnapshot;
  dietSummary?: string;
  callIdGenerator?: () => string;
}

export interface AnalyzeInputWithLlm extends AnalyzeInput {
  llmOptions?: LlmRefinementOptions;
}

let _callCounter = 0;

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

export async function analyzeMeasurementWithLlm(input: AnalyzeInputWithLlm): Promise<AnalyzeOutput> {
  const base = analyzeMeasurement(input);
  if (!input.llmOptions) return base;

  const { llmClient, metricsSink, promptRegistry, templateId, weather, dietSummary, callIdGenerator } =
    input.llmOptions;

  const callId = callIdGenerator?.() ?? `call-${++_callCounter}-${Date.now()}`;

  const phase3Input: Phase3InterventionInput = {
    signal: base.signal,
    baseInterventionText: base.interventionText,
    weather,
    dietSummary,
    symptoms: input.symptoms,
  };

  const isHighRisk = base.signal === "critical_low" || base.signal === "red";

  let promptBuilder: (i: Phase3InterventionInput) => string;
  let promptVersion = isHighRisk ? "high-risk-v1" : "standard-v1";

  if (promptRegistry && templateId) {
    const template = promptRegistry.get(templateId);
    if (template) {
      promptBuilder = (i) => template.build(i);
      promptVersion = `${template.templateId}@${template.version}`;
    } else {
      promptBuilder = isHighRisk ? buildHighRiskInterventionPrompt : buildInterventionPrompt;
    }
  } else {
    promptBuilder = isHighRisk ? buildHighRiskInterventionPrompt : buildInterventionPrompt;
  }

  const prompt = promptBuilder(phase3Input);
  const inputTokens = estimateTokens(prompt);
  const startMs = Date.now();

  let rawOutput = "";
  let success = true;
  let failureReason: string | undefined;
  let guardrailPassed = true;

  try {
    rawOutput = await llmClient.complete(prompt);
  } catch (err) {
    success = false;
    failureReason = String(err);
  }

  const latencyMs = Date.now() - startMs;
  const trimmed = rawOutput.trim();
  const outputTokens = estimateTokens(trimmed);

  let refinedText = base.interventionText;

  if (success && trimmed) {
    const guardrail = checkGuardrails(trimmed, base.signal);
    guardrailPassed = guardrail.passed;
    if (guardrail.passed) {
      refinedText = trimmed;
    }
  }

  if (metricsSink) {
    const metric: LlmCallMetric = {
      callId,
      promptVersion,
      signal: base.signal,
      latencyMs,
      inputTokens,
      outputTokens,
      success,
      failureReason,
      guardrailPassed,
      recordedAt: new Date().toISOString(),
    };
    metricsSink.record(metric);
  }

  return { ...base, interventionText: refinedText };
}
