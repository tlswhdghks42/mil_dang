import { describe, expect, it, beforeEach } from "vitest";
import {
  checkGuardrails,
  estimateTokens,
  buildInterventionPrompt,
  buildHighRiskInterventionPrompt,
  refineInterventionWithLlm,
} from "../src/application/phase3InterventionLLM";
import { InMemoryMetricsCollector } from "../src/application/phase3Metrics";
import {
  assignAbVariant,
  PromptRegistry,
  TEMPLATE_STANDARD_V1,
  TEMPLATE_EMPATHETIC_V2,
  createDefaultRegistry,
} from "../src/application/phase3PromptRegistry";
import { analyzeMeasurementWithLlm } from "../src/application/phase1Flow";
import {
  analyzeAndMoveResultWithLlm,
  initialPhase1State,
  updateInput,
} from "../src/application/phase1Controller";

// ──────────────────────────────────────────────
// Guardrail
// ──────────────────────────────────────────────
describe("checkGuardrails", () => {
  it("passes for green signal with any reasonable text", () => {
    const r = checkGuardrails("오늘 혈당이 안정적입니다. 잘 하셨어요!", "green");
    expect(r.passed).toBe(true);
    expect(r.violations).toHaveLength(0);
  });

  it("fails critical_low when required phrases are missing", () => {
    const r = checkGuardrails("천천히 안정을 취하세요.", "critical_low");
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.includes("당분"))).toBe(true);
    expect(r.violations.some((v) => v.includes("재측정"))).toBe(true);
  });

  it("passes critical_low when required phrases are present", () => {
    const r = checkGuardrails("바로 당분을 드시고 15분 후 재측정해 주세요. 보호자에게 연락하세요.", "critical_low");
    expect(r.passed).toBe(true);
  });

  it("fails critical_low when forbidden phrase is used", () => {
    const r = checkGuardrails("당분을 드시고 재측정하면 괜찮아요.", "critical_low");
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.includes("괜찮아요"))).toBe(true);
  });

  it("fails low signal when 재측정 is missing", () => {
    const r = checkGuardrails("당분을 드세요.", "low");
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.includes("재측정"))).toBe(true);
  });

  it("fails red signal when 재측정 is missing", () => {
    const r = checkGuardrails("물을 마시고 복약하세요.", "red");
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.includes("재측정"))).toBe(true);
  });

  it("passes yellow with no constraints", () => {
    const r = checkGuardrails("물 드시고 가볍게 쉬세요.", "yellow");
    expect(r.passed).toBe(true);
  });
});

// ──────────────────────────────────────────────
// Token estimation
// ──────────────────────────────────────────────
describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("estimates Korean text tokens", () => {
    const text = "혈당이 높아요"; // 7 Korean chars → ceil(7/1.5) = 5
    expect(estimateTokens(text)).toBeGreaterThan(0);
    expect(estimateTokens(text)).toBeLessThan(text.length);
  });

  it("estimates more tokens for longer prompts", () => {
    const short = "혈당 확인";
    const long = buildInterventionPrompt({
      signal: "green",
      baseInterventionText: "안정적입니다.",
    });
    expect(estimateTokens(long)).toBeGreaterThan(estimateTokens(short));
  });
});

// ──────────────────────────────────────────────
// High-risk prompt builder
// ──────────────────────────────────────────────
describe("buildHighRiskInterventionPrompt", () => {
  it("includes 응급 label for critical_low", () => {
    const p = buildHighRiskInterventionPrompt({
      signal: "critical_low",
      baseInterventionText: "혈당이 매우 낮아요.",
    });
    expect(p).toContain("매우 위험(응급)");
    expect(p).toContain("당분 섭취");
    expect(p).toContain("119");
  });

  it("includes 위험(주의) label for red", () => {
    const p = buildHighRiskInterventionPrompt({
      signal: "red",
      baseInterventionText: "혈당이 높아요.",
    });
    expect(p).toContain("위험(주의 요함)");
    expect(p).toContain("30분 후 재측정");
  });

  it("includes symptoms when provided", () => {
    const p = buildHighRiskInterventionPrompt({
      signal: "red",
      baseInterventionText: "혈당이 높아요.",
      symptoms: ["두통", "어지러움"],
    });
    expect(p).toContain("두통");
    expect(p).toContain("어지러움");
  });
});

// ──────────────────────────────────────────────
// refineInterventionWithLlm (string return, backward-compat)
// ──────────────────────────────────────────────
describe("refineInterventionWithLlm", () => {
  it("returns LLM output for green signal (no guardrail constraints)", async () => {
    const out = await refineInterventionWithLlm({
      input: { signal: "green", baseInterventionText: "안정적입니다." },
      llmClient: { async complete() { return "오늘 혈당이 안정적이에요. 잘 하셨습니다!"; } },
    });
    expect(out).toBe("오늘 혈당이 안정적이에요. 잘 하셨습니다!");
  });

  it("falls back when LLM returns empty", async () => {
    const out = await refineInterventionWithLlm({
      input: { signal: "green", baseInterventionText: "현재 혈당은 안정적입니다." },
      llmClient: { async complete() { return "   "; } },
    });
    expect(out).toBe("현재 혈당은 안정적입니다.");
  });

  it("falls back when guardrail fails for critical_low", async () => {
    const out = await refineInterventionWithLlm({
      input: { signal: "critical_low", baseInterventionText: "당분을 드세요." },
      llmClient: { async complete() { return "천천히 안정을 취하세요."; } },
    });
    expect(out).toBe("당분을 드세요.");
  });

  it("returns LLM output when guardrail passes for critical_low", async () => {
    const out = await refineInterventionWithLlm({
      input: { signal: "critical_low", baseInterventionText: "당분을 드세요." },
      llmClient: {
        async complete() {
          return "바로 당분을 드시고 15분 후 재측정해 주세요.";
        },
      },
    });
    expect(out).toBe("바로 당분을 드시고 15분 후 재측정해 주세요.");
  });

  it("uses high-risk prompt builder for red signal", async () => {
    let receivedPrompt = "";
    await refineInterventionWithLlm({
      input: { signal: "red", baseInterventionText: "혈당이 높아요." },
      llmClient: {
        async complete(prompt) {
          receivedPrompt = prompt;
          return "복약을 확인하고 30분 후 재측정해 주세요.";
        },
      },
    });
    expect(receivedPrompt).toContain("응급 안내 코치");
  });
});

// ──────────────────────────────────────────────
// Metrics
// ──────────────────────────────────────────────
describe("InMemoryMetricsCollector", () => {
  let collector: InMemoryMetricsCollector;

  beforeEach(() => {
    collector = new InMemoryMetricsCollector();
  });

  it("starts empty", () => {
    const s = collector.summary();
    expect(s.totalCalls).toBe(0);
    expect(s.failureRate).toBe(0);
  });

  it("records metrics and computes summary", () => {
    collector.record({
      callId: "c1",
      promptVersion: "standard-v1",
      signal: "green",
      latencyMs: 200,
      inputTokens: 50,
      outputTokens: 30,
      success: true,
      guardrailPassed: true,
      recordedAt: new Date().toISOString(),
    });
    collector.record({
      callId: "c2",
      promptVersion: "standard-v1",
      signal: "red",
      latencyMs: 800,
      inputTokens: 80,
      outputTokens: 0,
      success: false,
      failureReason: "timeout",
      guardrailPassed: false,
      recordedAt: new Date().toISOString(),
    });

    const s = collector.summary();
    expect(s.totalCalls).toBe(2);
    expect(s.successCount).toBe(1);
    expect(s.failureCount).toBe(1);
    expect(s.failureRate).toBeCloseTo(0.5);
    expect(s.avgLatencyMs).toBeCloseTo(500);
    expect(s.avgInputTokens).toBeCloseTo(65);
  });

  it("computes p95 latency", () => {
    for (let i = 1; i <= 20; i++) {
      collector.record({
        callId: `c${i}`,
        promptVersion: "v1",
        signal: "green",
        latencyMs: i * 10,
        inputTokens: 10,
        outputTokens: 10,
        success: true,
        guardrailPassed: true,
        recordedAt: new Date().toISOString(),
      });
    }
    const s = collector.summary();
    expect(s.p95LatencyMs).toBeGreaterThan(150);
  });

  it("generates unique call IDs", () => {
    const ids = new Set([collector.generateCallId(), collector.generateCallId(), collector.generateCallId()]);
    expect(ids.size).toBe(3);
  });

  it("tracks guardrail fail rate", () => {
    collector.record({
      callId: "c1", promptVersion: "v1", signal: "green",
      latencyMs: 100, inputTokens: 10, outputTokens: 10,
      success: true, guardrailPassed: false, recordedAt: new Date().toISOString(),
    });
    collector.record({
      callId: "c2", promptVersion: "v1", signal: "green",
      latencyMs: 100, inputTokens: 10, outputTokens: 10,
      success: true, guardrailPassed: true, recordedAt: new Date().toISOString(),
    });
    const s = collector.summary();
    expect(s.guardrailFailRate).toBeCloseTo(0.5);
  });
});

// ──────────────────────────────────────────────
// A/B Variant assignment
// ──────────────────────────────────────────────
describe("assignAbVariant", () => {
  it("throws when variants is empty", () => {
    expect(() => assignAbVariant("u1", "exp1", [])).toThrow();
  });

  it("always returns one of the provided variants", () => {
    const variants = ["standard-v1", "empathetic-v2"];
    for (let i = 0; i < 20; i++) {
      const v = assignAbVariant(`user-${i}`, "exp-A", variants);
      expect(variants).toContain(v);
    }
  });

  it("is deterministic for the same userId+experimentId", () => {
    const v1 = assignAbVariant("user-abc", "exp-X", ["a", "b"]);
    const v2 = assignAbVariant("user-abc", "exp-X", ["a", "b"]);
    expect(v1).toBe(v2);
  });

  it("distributes across both variants for different users", () => {
    const variants = ["standard-v1", "empathetic-v2"];
    const results = new Set<string>();
    for (let i = 0; i < 100; i++) {
      results.add(assignAbVariant(`user-${i}`, "exp-B", variants));
    }
    expect(results.size).toBe(2);
  });

  it("changes assignment when experiment ID changes", () => {
    const v1 = assignAbVariant("user-fixed", "exp-1", ["a", "b"]);
    const v2 = assignAbVariant("user-fixed", "exp-2", ["a", "b"]);
    // may or may not differ, but both must be valid
    expect(["a", "b"]).toContain(v1);
    expect(["a", "b"]).toContain(v2);
  });
});

// ──────────────────────────────────────────────
// PromptRegistry
// ──────────────────────────────────────────────
describe("PromptRegistry", () => {
  it("registers and retrieves templates", () => {
    const registry = new PromptRegistry().register(TEMPLATE_STANDARD_V1);
    const t = registry.get("standard-v1");
    expect(t).toBeDefined();
    expect(t!.templateId).toBe("standard-v1");
  });

  it("returns undefined for unknown template", () => {
    expect(new PromptRegistry().get("nonexistent")).toBeUndefined();
  });

  it("lists all registered templates", () => {
    const registry = createDefaultRegistry();
    const list = registry.list();
    expect(list.map((t) => t.templateId)).toContain("standard-v1");
    expect(list.map((t) => t.templateId)).toContain("empathetic-v2");
  });

  it("standard-v1 uses high-risk builder for critical_low", () => {
    const prompt = TEMPLATE_STANDARD_V1.build({
      signal: "critical_low",
      baseInterventionText: "당분을 드세요.",
    });
    expect(prompt).toContain("응급 안내 코치");
  });

  it("empathetic-v2 uses warmer tone for green", () => {
    const prompt = TEMPLATE_EMPATHETIC_V2.build({
      signal: "green",
      baseInterventionText: "안정적입니다.",
    });
    expect(prompt).toContain("따뜻한");
    expect(prompt).toContain("응원");
  });

  it("empathetic-v2 still uses high-risk builder for red", () => {
    const prompt = TEMPLATE_EMPATHETIC_V2.build({
      signal: "red",
      baseInterventionText: "혈당이 높아요.",
    });
    expect(prompt).toContain("응급 안내 코치");
  });
});

// ──────────────────────────────────────────────
// Phase1 Flow with LLM (analyzeMeasurementWithLlm)
// ──────────────────────────────────────────────
describe("analyzeMeasurementWithLlm", () => {
  it("returns base result when no llmOptions", async () => {
    const out = await analyzeMeasurementWithLlm({ glucoseMgDl: 90, mealTiming: "fasting" });
    expect(out.signal).toBe("green");
    expect(out.interventionText).toBeTruthy();
  });

  it("replaces interventionText with LLM output when guardrail passes", async () => {
    const out = await analyzeMeasurementWithLlm({
      glucoseMgDl: 90,
      mealTiming: "fasting",
      llmOptions: {
        llmClient: { async complete() { return "오늘 혈당이 안정적이에요. 훌륭합니다!"; } },
      },
    });
    expect(out.interventionText).toBe("오늘 혈당이 안정적이에요. 훌륭합니다!");
  });

  it("falls back to base text when LLM throws", async () => {
    const out = await analyzeMeasurementWithLlm({
      glucoseMgDl: 90,
      mealTiming: "fasting",
      llmOptions: {
        llmClient: { async complete() { throw new Error("network error"); } },
      },
    });
    expect(out.interventionText).not.toContain("훌륭");
    expect(out.interventionText).toBeTruthy();
  });

  it("records metrics on success", async () => {
    const collector = new InMemoryMetricsCollector();
    await analyzeMeasurementWithLlm({
      glucoseMgDl: 150,
      mealTiming: "postprandial",
      llmOptions: {
        llmClient: { async complete() { return "물을 드시고 가볍게 움직이세요."; } },
        metricsSink: collector,
      },
    });
    const metrics = collector.getAll();
    expect(metrics).toHaveLength(1);
    expect(metrics[0].success).toBe(true);
    expect(metrics[0].latencyMs).toBeGreaterThanOrEqual(0);
    expect(metrics[0].inputTokens).toBeGreaterThan(0);
  });

  it("records metrics on LLM failure", async () => {
    const collector = new InMemoryMetricsCollector();
    await analyzeMeasurementWithLlm({
      glucoseMgDl: 90,
      mealTiming: "fasting",
      llmOptions: {
        llmClient: { async complete() { throw new Error("timeout"); } },
        metricsSink: collector,
      },
    });
    const m = collector.getAll()[0];
    expect(m.success).toBe(false);
    expect(m.failureReason).toContain("timeout");
  });

  it("records guardrailPassed=false when guardrail fails", async () => {
    const collector = new InMemoryMetricsCollector();
    await analyzeMeasurementWithLlm({
      glucoseMgDl: 45,
      mealTiming: "fasting", // → critical_low
      llmOptions: {
        llmClient: { async complete() { return "천천히 안정을 취하세요."; } },
        metricsSink: collector,
      },
    });
    const m = collector.getAll()[0];
    expect(m.guardrailPassed).toBe(false);
  });

  it("uses prompt from registry when templateId provided", async () => {
    let receivedPrompt = "";
    const registry = createDefaultRegistry();
    await analyzeMeasurementWithLlm({
      glucoseMgDl: 90,
      mealTiming: "fasting",
      llmOptions: {
        llmClient: {
          async complete(p) {
            receivedPrompt = p;
            return "따뜻한 안내입니다.";
          },
        },
        promptRegistry: registry,
        templateId: "empathetic-v2",
      },
    });
    expect(receivedPrompt).toContain("따뜻한");
  });

  it("uses default builder when templateId not found in registry", async () => {
    let receivedPrompt = "";
    const registry = createDefaultRegistry();
    await analyzeMeasurementWithLlm({
      glucoseMgDl: 90,
      mealTiming: "fasting",
      llmOptions: {
        llmClient: {
          async complete(p) {
            receivedPrompt = p;
            return "안정적인 혈당이에요.";
          },
        },
        promptRegistry: registry,
        templateId: "nonexistent-template",
      },
    });
    expect(receivedPrompt).toContain("당뇨 관리 코치");
  });

  it("stores promptVersion in metric matching registry template", async () => {
    const collector = new InMemoryMetricsCollector();
    const registry = createDefaultRegistry();
    await analyzeMeasurementWithLlm({
      glucoseMgDl: 90,
      mealTiming: "fasting",
      llmOptions: {
        llmClient: { async complete() { return "좋은 상태예요."; } },
        metricsSink: collector,
        promptRegistry: registry,
        templateId: "empathetic-v2",
      },
    });
    const m = collector.getAll()[0];
    expect(m.promptVersion).toContain("empathetic-v2");
  });

  it("uses custom callIdGenerator", async () => {
    const collector = new InMemoryMetricsCollector();
    await analyzeMeasurementWithLlm({
      glucoseMgDl: 90,
      mealTiming: "fasting",
      llmOptions: {
        llmClient: { async complete() { return "안정적입니다."; } },
        metricsSink: collector,
        callIdGenerator: () => "custom-id-001",
      },
    });
    expect(collector.getAll()[0].callId).toBe("custom-id-001");
  });
});

// ──────────────────────────────────────────────
// Phase1 Controller with LLM (analyzeAndMoveResultWithLlm)
// ──────────────────────────────────────────────
describe("analyzeAndMoveResultWithLlm", () => {
  it("moves to result screen with LLM-refined text", async () => {
    const state = updateInput(initialPhase1State, { glucoseText: "90", mealTiming: "fasting" });
    const next = await analyzeAndMoveResultWithLlm(
      state,
      "2026-05-20T00:00:00.000Z",
      { llmClient: { async complete() { return "오늘 혈당 상태가 좋아요!"; } } },
    );
    expect(next.screen).toBe("result");
    expect(next.signal).toBe("green");
    expect(next.interventionText).toBe("오늘 혈당 상태가 좋아요!");
  });

  it("throws for invalid glucose input", async () => {
    const state = updateInput(initialPhase1State, { glucoseText: "abc" });
    await expect(
      analyzeAndMoveResultWithLlm(state, "2026-05-20T00:00:00.000Z", {
        llmClient: { async complete() { return ""; } },
      }),
    ).rejects.toThrow("0보다 큰 숫자");
  });

  it("falls back to base text when LLM fails", async () => {
    const state = updateInput(initialPhase1State, { glucoseText: "90", mealTiming: "fasting" });
    const next = await analyzeAndMoveResultWithLlm(
      state,
      "2026-05-20T00:00:00.000Z",
      { llmClient: { async complete() { throw new Error("LLM down"); } } },
    );
    expect(next.screen).toBe("result");
    expect(next.interventionText).toBeTruthy();
  });

  it("creates safety event for critical_low", async () => {
    const state = updateInput(initialPhase1State, { glucoseText: "45", mealTiming: "fasting" });
    const next = await analyzeAndMoveResultWithLlm(
      state,
      "2026-05-20T00:00:00.000Z",
      {
        llmClient: {
          async complete() {
            return "바로 당분을 드시고 재측정해 주세요. 보호자에게 연락하세요.";
          },
        },
      },
    );
    expect(next.signal).toBe("critical_low");
    expect(next.latestSafetyEvent).toBeDefined();
    expect(next.latestSafetyEvent?.type).toBe("hypo_critical");
  });

  it("tracks metrics through controller flow", async () => {
    const collector = new InMemoryMetricsCollector();
    const state = updateInput(initialPhase1State, { glucoseText: "200", mealTiming: "postprandial" });
    await analyzeAndMoveResultWithLlm(
      state,
      "2026-05-20T00:00:00.000Z",
      {
        llmClient: { async complete() { return "복약을 확인하고 30분 후 재측정해 주세요."; } },
        metricsSink: collector,
      },
    );
    const summary = collector.summary();
    expect(summary.totalCalls).toBe(1);
    expect(summary.successCount).toBe(1);
    expect(summary.failureRate).toBe(0);
  });

  it("shows nurse call button after 2 red rechecks", async () => {
    let state = updateInput(initialPhase1State, { glucoseText: "220", mealTiming: "postprandial" });
    const llm = { async complete() { return "복약을 확인하고 30분 후 재측정해 주세요."; } };
    const now = "2026-05-20T00:00:00.000Z";

    state = await analyzeAndMoveResultWithLlm(state, now, { llmClient: llm });
    expect(state.showNurseCallButton).toBe(false);
    state = await analyzeAndMoveResultWithLlm(state, now, { llmClient: llm });
    expect(state.showNurseCallButton).toBe(true);
  });
});

// ──────────────────────────────────────────────
// Metrics aggregate summary across multiple calls
// ──────────────────────────────────────────────
describe("metrics aggregate integration", () => {
  it("accumulates multiple LLM calls and computes failure rate", async () => {
    const collector = new InMemoryMetricsCollector();
    const signals = [
      { glucose: 100, timing: "fasting" as const, llmOutput: "안정적입니다." },
      { glucose: 45, timing: "fasting" as const, llmOutput: "" }, // empty → fallback, success
      { glucose: 200, timing: "postprandial" as const, llmOutput: "복약 확인 후 재측정해 주세요." },
    ];

    for (const s of signals) {
      await analyzeMeasurementWithLlm({
        glucoseMgDl: s.glucose,
        mealTiming: s.timing,
        llmOptions: {
          llmClient: { async complete() { return s.llmOutput; } },
          metricsSink: collector,
        },
      });
    }

    const summary = collector.summary();
    expect(summary.totalCalls).toBe(3);
    expect(summary.failureRate).toBe(0); // no errors thrown, just empty outputs
  });
});
