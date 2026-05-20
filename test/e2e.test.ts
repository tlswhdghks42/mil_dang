/**
 * E2E 통합 테스트 - Phase 1~4 전체 흐름 시나리오
 * 실제 외부 서비스 없이 인터페이스 주입으로 전체 파이프라인 검증
 */
import { describe, expect, it, beforeEach } from "vitest";

import { analyzeMeasurementWithLlm } from "../src/application/phase1Flow";
import {
  analyzeAndMoveResultWithLlm,
  initialPhase1State,
  updateInput,
} from "../src/application/phase1Controller";
import { analyzeDietFromSttAudio } from "../src/application/phase2Diet";
import { fetchSuyeongWeather } from "../src/application/phase2Weather";
import { makeKmaSuyeongFetcher } from "../src/application/phase4WeatherAdapter";
import {
  buildGuardianSyncPayload,
  createQrDashboardMapping,
} from "../src/application/phase2Integration";
import { sendGuardianAlert } from "../src/application/phase2GuardianChannel";
import {
  InMemoryGuardianChannel,
  notifyGuardiansOnMeasurement,
} from "../src/application/phase4GuardianAdapters";
import {
  InMemoryBloodSugarRepository,
  getDashboardData,
  saveBloodSugarRecord,
} from "../src/application/phase4Dashboard";
import { InMemoryMetricsCollector } from "../src/application/phase3Metrics";
import { createDefaultRegistry, assignAbVariant } from "../src/application/phase3PromptRegistry";
import { BloodSugarRecord } from "../src/domain/types";

const SIGNING = { secret: "e2e-secret", issuer: "mildang", audience: "suyeong-health-dashboard" };

function makeLlmClient(response: string) {
  return { async complete() { return response; } };
}

// ──────────────────────────────────────────────
// 시나리오 1: 정상 혈당 측정 전체 흐름
// 혈당 입력 → LLM 보정 → 저장 → 보호자 실시간 알림 → 대시보드 조회
// ──────────────────────────────────────────────
describe("E2E 시나리오 1: 정상 혈당 측정 전체 흐름", () => {
  it("green 혈당 측정 후 대시보드까지 정상 연결", async () => {
    const repo = new InMemoryBloodSugarRepository();
    const collector = new InMemoryMetricsCollector();
    const realtimeChannel = new InMemoryGuardianChannel();
    const NOW = "2026-05-20T10:00:00.000Z";

    // 1. 혈당 분류 + LLM 보정
    const analyzed = await analyzeMeasurementWithLlm({
      glucoseMgDl: 90,
      mealTiming: "fasting",
      llmOptions: {
        llmClient: makeLlmClient("오늘 혈당이 안정적이에요. 잘 관리하고 계십니다!"),
        metricsSink: collector,
      },
    });

    expect(analyzed.signal).toBe("green");
    expect(analyzed.interventionText).toContain("안정적");

    // 2. 혈당 기록 저장
    const record: BloodSugarRecord = {
      recordId: "e2e-r1",
      userId: "u-senior-01",
      measuredAt: NOW,
      mealTiming: "fasting",
      glucoseMgDl: 90,
      inputMethod: "keypad",
      signalLevel: analyzed.signal,
      aiInterventionText: analyzed.interventionText,
      earnedMileage: 10,
    };
    await saveBloodSugarRecord(record, repo);

    // 3. 보호자 실시간 알림 (green이므로 requiresAttention=false)
    realtimeChannel.connect("guardian-g1");
    const guardianPayload = buildGuardianSyncPayload(record, 10);
    const notify = await notifyGuardiansOnMeasurement({
      payload: guardianPayload,
      guardianIds: ["guardian-g1", "guardian-g2"],
      realtimeChannel,
      nowIso: NOW,
    });

    expect(notify.realtime).toBe(1);   // g1만 연결됨
    expect(notify.skipped).toBe(1);   // g2 미연결
    expect(realtimeChannel.getLog()[0].event.eventType).toBe("blood_sugar_measured");

    // 4. QR 대시보드 조회
    const qr = createQrDashboardMapping({
      userId: "u-senior-01",
      dashboardBaseUrl: "https://health.suyeong.go.kr/dashboard",
      nowIso: NOW,
      ttlMinutes: 10,
      signing: SIGNING,
    });

    const dashboard = await getDashboardData({
      qrToken: qr.qrToken,
      nowIso: "2026-05-20T10:05:00.000Z",
      signing: SIGNING,
      repository: repo,
    });

    expect(dashboard.stats.totalRecords).toBe(1);
    expect(dashboard.stats.greenRate).toBe(1);
    expect(dashboard.alerts.hasHighRiskSignal).toBe(false);

    // 5. LLM 메트릭 검증
    const metrics = collector.summary();
    expect(metrics.totalCalls).toBe(1);
    expect(metrics.failureRate).toBe(0);
  });
});

// ──────────────────────────────────────────────
// 시나리오 2: 저혈당 응급 상황
// critical_low 감지 → SafetyEvent 생성 → 보호자 push 알림 → 대시보드 고위험 경보
// ──────────────────────────────────────────────
describe("E2E 시나리오 2: 저혈당 응급 상황", () => {
  it("critical_low 감지 시 SafetyEvent 생성 및 보호자 알림 발송", async () => {
    const repo = new InMemoryBloodSugarRepository();
    const NOW = "2026-05-20T08:00:00.000Z";

    // 1. 컨트롤러 레벨 측정 (critical_low)
    const state = updateInput(initialPhase1State, { glucoseText: "45", mealTiming: "fasting" });
    const resultState = await analyzeAndMoveResultWithLlm(
      state,
      NOW,
      {
        llmClient: makeLlmClient("바로 당분을 드시고 15분 후 재측정해 주세요. 보호자에게 연락하세요."),
      },
      "u-senior-01",
    );

    expect(resultState.signal).toBe("critical_low");
    expect(resultState.latestSafetyEvent).toBeDefined();
    expect(resultState.latestSafetyEvent?.type).toBe("hypo_critical");
    expect(resultState.latestSafetyEvent?.status).toBe("pending");
    expect(resultState.interventionText).toContain("당분");

    // 2. 보호자 push 알림 (실채널 시뮬레이션)
    const record: BloodSugarRecord = {
      recordId: "e2e-critical-r1",
      userId: "u-senior-01",
      measuredAt: NOW,
      mealTiming: "fasting",
      glucoseMgDl: 45,
      inputMethod: "keypad",
      signalLevel: "critical_low",
      aiInterventionText: resultState.interventionText ?? "",
      earnedMileage: 0,
    };
    await repo.save(record);

    const guardianPayload = buildGuardianSyncPayload(record, 0);
    expect(guardianPayload.requiresAttention).toBe(true);

    let pushSent = false;
    const alertResult = await sendGuardianAlert({
      payload: guardianPayload,
      contact: { guardianUserId: "g1", prefersPush: true, phoneNumber: "01012341234" },
      senders: {
        push: {
          async send() {
            pushSent = true;
            return { messageId: "push-emergency-001" };
          },
        },
      },
    });

    expect(alertResult.success).toBe(true);
    expect(alertResult.channel).toBe("push");
    expect(pushSent).toBe(true);

    // 3. 대시보드 고위험 경보 확인
    const qr = createQrDashboardMapping({
      userId: "u-senior-01",
      dashboardBaseUrl: "https://health.suyeong.go.kr",
      nowIso: NOW,
      ttlMinutes: 10,
      signing: SIGNING,
    });

    const dashboard = await getDashboardData({
      qrToken: qr.qrToken,
      nowIso: "2026-05-20T08:05:00.000Z",
      signing: SIGNING,
      repository: repo,
    });

    expect(dashboard.alerts.hasHighRiskSignal).toBe(true);
    expect(dashboard.alerts.latestSignal).toBe("critical_low");
  });
});

// ──────────────────────────────────────────────
// 시나리오 3: 고혈당 반복 → 간호사 호출 버튼 활성화
// ──────────────────────────────────────────────
describe("E2E 시나리오 3: 고혈당 반복 측정 흐름", () => {
  it("red 2회 연속 시 showNurseCallButton=true, 대시보드 consecutiveRedCount=2", async () => {
    const repo = new InMemoryBloodSugarRepository();
    const NOW = "2026-05-20T09:00:00.000Z";
    const llm = makeLlmClient("복약을 확인하고 30분 후 재측정해 주세요.");

    let state = updateInput(initialPhase1State, { glucoseText: "220", mealTiming: "postprandial" });

    // 1회 측정
    state = await analyzeAndMoveResultWithLlm(state, NOW, { llmClient: llm });
    expect(state.signal).toBe("red");
    expect(state.showNurseCallButton).toBe(false);
    await repo.save({
      recordId: "e2e-red-1", userId: "u1", measuredAt: NOW,
      mealTiming: "postprandial", glucoseMgDl: 220, inputMethod: "keypad",
      signalLevel: "red", aiInterventionText: state.interventionText ?? "", earnedMileage: 0,
    });

    // 2회 측정
    state = await analyzeAndMoveResultWithLlm(state, "2026-05-20T09:30:00.000Z", { llmClient: llm });
    expect(state.showNurseCallButton).toBe(true);
    await repo.save({
      recordId: "e2e-red-2", userId: "u1", measuredAt: "2026-05-20T09:30:00.000Z",
      mealTiming: "postprandial", glucoseMgDl: 215, inputMethod: "keypad",
      signalLevel: "red", aiInterventionText: state.interventionText ?? "", earnedMileage: 0,
    });

    // 대시보드 연속 red 감지
    const qr = createQrDashboardMapping({
      userId: "u1", dashboardBaseUrl: "https://health.suyeong.go.kr",
      nowIso: "2026-05-20T09:35:00.000Z", ttlMinutes: 10, signing: SIGNING,
    });
    const dashboard = await getDashboardData({
      qrToken: qr.qrToken, nowIso: "2026-05-20T09:38:00.000Z",
      signing: SIGNING, repository: repo,
    });

    expect(dashboard.alerts.consecutiveRedCount).toBe(2);
    expect(dashboard.stats.signalDistribution.red).toBe(2);
  });
});

// ──────────────────────────────────────────────
// 시나리오 4: 식단 분석 + 날씨 컨텍스트 → LLM 프롬프트 포함
// ──────────────────────────────────────────────
describe("E2E 시나리오 4: 식단·날씨 컨텍스트 통합", () => {
  it("식단 STT + 날씨 API → LLM 프롬프트에 컨텍스트 포함", async () => {
    // 1. 식단 STT 분석
    const dietAnalysis = await analyzeDietFromSttAudio("audio-base64", {
      async transcribeKorean() { return { text: "라면 많이 먹었어요", confidence: 0.9 }; },
    });
    expect(dietAnalysis.glycemicAssessment).toBe("risky");

    // 2. KMA 날씨 어댑터
    const kmaData = {
      response: {
        header: { resultCode: "00" },
        body: { items: { item: [{ category: "T1H", obsrValue: "35" }, { category: "PTY", obsrValue: "0" }] } },
      },
    };
    const rawFetcher = async () => ({ ok: true, status: 200, async json() { return kmaData; } });
    const weatherFetcher = makeKmaSuyeongFetcher({ serviceKey: "key", cacheTtlMs: 0 }, rawFetcher);
    const weather = await fetchSuyeongWeather(weatherFetcher, "2026-05-20T14:00:00.000Z");

    expect(weather.condition).toBe("heatwave");
    expect(weather.riskFlags).toContain("heatwave");

    // 3. LLM 보정 — 프롬프트에 식단·날씨 포함 확인
    let capturedPrompt = "";
    const analyzed = await analyzeMeasurementWithLlm({
      glucoseMgDl: 110,
      mealTiming: "postprandial",
      llmOptions: {
        llmClient: {
          async complete(prompt) {
            capturedPrompt = prompt;
            return "물을 드시고 가볍게 움직이세요.";
          },
        },
        weather,
        dietSummary: dietAnalysis.reasons[0],
      },
    });

    expect(capturedPrompt).toContain("heatwave");
    expect(capturedPrompt).toContain("라면"); // dietAnalysis.reasons[0]에 포함된 키워드
    expect(analyzed.signal).toBe("green"); // 110 postprandial → green
  });
});

// ──────────────────────────────────────────────
// 시나리오 5: A/B 프롬프트 + 메트릭 집계
// ──────────────────────────────────────────────
describe("E2E 시나리오 5: A/B 프롬프트 실험 + 메트릭 집계", () => {
  it("다수 사용자를 A/B 변형에 배정하고 두 변형 모두 사용 확인", async () => {
    const collector = new InMemoryMetricsCollector();
    const registry = createDefaultRegistry();
    const variants = ["standard-v1", "empathetic-v2"];

    // 10명으로 충분한 다양성을 확보해 두 변형이 모두 배정될 확률 보장
    const users = [
      "u-alpha", "u-beta", "u-gamma", "u-delta", "u-epsilon",
      "u-zeta", "u-eta", "u-theta", "u-iota", "u-kappa",
    ];
    const assignments = users.map((u) => assignAbVariant(u, "phase5-exp-01", variants));

    // 모든 배정이 유효한 변형이어야 함
    for (const v of assignments) {
      expect(variants).toContain(v);
    }
    // 해시 기반 결정론적 배정이 두 변형 모두를 커버하는지 검증 (A/B 분산 확인)
    expect(assignments).toContain("standard-v1");
    expect(assignments).toContain("empathetic-v2");

    // 각 사용자별로 측정 + LLM 실행
    for (const [i, userId] of users.entries()) {
      const templateId = assignAbVariant(userId, "phase5-exp-01", variants);
      await analyzeMeasurementWithLlm({
        glucoseMgDl: 90 + (i % 5) * 10,
        mealTiming: "fasting",
        llmOptions: {
          llmClient: makeLlmClient("안정적인 혈당이에요."),
          metricsSink: collector,
          promptRegistry: registry,
          templateId,
          callIdGenerator: () => `${userId}-call`,
        },
      });
    }

    const summary = collector.summary();
    expect(summary.totalCalls).toBe(10);
    expect(summary.failureRate).toBe(0);

    // 메트릭에서 두 변형(template@version) 모두 사용됐는지 확인
    const usedVersions = new Set(collector.getAll().map((m) => m.promptVersion));
    expect(usedVersions.size).toBeGreaterThanOrEqual(2);
  });
});

// ──────────────────────────────────────────────
// 시나리오 6: push 실패 → SMS fallback → 재발송 큐
// ──────────────────────────────────────────────
describe("E2E 시나리오 6: 보호자 알림 장애 복구 흐름", () => {
  it("push 실패 후 SMS로 fallback, 최종 실패 시 재발송 큐에 적재", async () => {
    const { AlertRecoveryQueue, detectAndEnqueueMissedAlerts } = await import(
      "../src/application/phase5Monitor"
    );

    const failedEvents: any[] = [];
    const recoveryQueue = new AlertRecoveryQueue();
    const payload = {
      userId: "u1",
      measuredAt: "2026-05-20T00:00:00.000Z",
      signalLevel: "red" as const,
      glucoseMgDl: 220,
      mileageTotal: 500,
      requiresAttention: true,
      summary: "주의가 필요합니다.",
    };

    // 1. push + SMS 모두 실패
    const result = await sendGuardianAlert({
      payload,
      contact: { guardianUserId: "g1", prefersPush: true, phoneNumber: "01012341234" },
      senders: {
        push: { async send() { throw new Error("FCM down"); } },
        sms: { async send() { throw new Error("Aligo down"); } },
      },
      failedEventStore: {
        async save(event) { failedEvents.push(event); },
      },
      nowIso: "2026-05-20T00:00:00.000Z",
    });

    expect(result.success).toBe(false);
    expect(failedEvents).toHaveLength(1);

    // 2. 누락 감지 → 재발송 큐 적재
    const contactMap = new Map([["g1", { guardianUserId: "g1", prefersPush: false, phoneNumber: "01012341234" }]]);
    const payloadMap = new Map([["g1", payload]]);

    const detection = detectAndEnqueueMissedAlerts({
      failedEvents,
      contactMap,
      payloadMap,
      recoveryQueue,
      nowIso: "2026-05-20T00:15:00.000Z",
      maxAgeMs: 60 * 60 * 1000,
    });

    expect(detection.missedCount).toBe(1);
    expect(detection.enqueuedForRetry).toBe(1);
    expect(recoveryQueue.size()).toBe(1);

    // 3. SMS 복구 성공 시 큐 소진
    const processResult = await recoveryQueue.processAll({
      sms: { async send() { return { messageId: "sms-recovery-001" }; } },
    });

    expect(processResult.succeeded).toBe(1);
    expect(processResult.failed).toBe(0);
    expect(recoveryQueue.size()).toBe(0);
  });
});
