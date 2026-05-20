import { describe, expect, it, beforeEach } from "vitest";
import {
  generateHealthReport,
  AlertRecoveryQueue,
  detectAndEnqueueMissedAlerts,
} from "../src/application/phase5Monitor";
import {
  maskPhoneNumber,
  maskUserId,
  maskName,
  assertDataAccess,
  assertGuardianAccess,
  DataAccessError,
  sanitizeRecordForLog,
  sanitizeProfileForLog,
  InMemoryAuditLogStore,
  auditLog,
  verifyQrTokenWithAudit,
  containsPii,
  redactPii,
} from "../src/application/phase5Security";
import { InMemoryMetricsCollector } from "../src/application/phase3Metrics";

// ──────────────────────────────────────────────
// 모니터링 - 헬스 리포트
// ──────────────────────────────────────────────
describe("generateHealthReport", () => {
  it("returns healthy when no data", () => {
    const collector = new InMemoryMetricsCollector();
    const queue = new AlertRecoveryQueue();
    const report = generateHealthReport({
      metricsCollector: collector,
      recoveryQueue: queue,
      failedAlertStore: [],
      nowIso: "2026-05-20T00:00:00.000Z",
    });
    expect(report.overall).toBe("healthy");
    expect(report.llm.status).toBe("healthy");
    expect(report.guardian.status).toBe("healthy");
  });

  it("marks llm as degraded when failure rate >= 10%", () => {
    const collector = new InMemoryMetricsCollector();
    for (let i = 0; i < 10; i++) {
      collector.record({
        callId: `c${i}`, promptVersion: "v1", signal: "green",
        latencyMs: 100, inputTokens: 10, outputTokens: 5,
        success: i < 9, // 1 failure out of 10 = 10%
        guardrailPassed: true,
        recordedAt: new Date().toISOString(),
      });
    }
    const report = generateHealthReport({
      metricsCollector: collector,
      recoveryQueue: new AlertRecoveryQueue(),
      failedAlertStore: [],
    });
    expect(report.llm.status).toBe("degraded");
    expect(report.overall).toBe("degraded");
  });

  it("marks llm as critical when failure rate >= 30%", () => {
    const collector = new InMemoryMetricsCollector();
    for (let i = 0; i < 10; i++) {
      collector.record({
        callId: `c${i}`, promptVersion: "v1", signal: "green",
        latencyMs: 100, inputTokens: 10, outputTokens: 5,
        success: i < 7, // 3 failures = 30%
        guardrailPassed: true,
        recordedAt: new Date().toISOString(),
      });
    }
    const report = generateHealthReport({
      metricsCollector: collector,
      recoveryQueue: new AlertRecoveryQueue(),
      failedAlertStore: [],
    });
    expect(report.llm.status).toBe("critical");
    expect(report.overall).toBe("critical");
  });

  it("marks guardian as degraded when failed alerts >= 3", () => {
    const collector = new InMemoryMetricsCollector();
    const failedAlerts = Array.from({ length: 4 }, (_, i) => ({
      eventId: `e${i}`, guardianUserId: "g1", channel: "push" as const,
      reason: "down", occurredAt: new Date().toISOString(),
    }));
    const report = generateHealthReport({
      metricsCollector: collector,
      recoveryQueue: new AlertRecoveryQueue(),
      failedAlertStore: failedAlerts,
    });
    expect(report.guardian.status).toBe("degraded");
    expect(report.guardian.failedAlertsCount).toBe(4);
  });

  it("overall is worst of all statuses", () => {
    const collector = new InMemoryMetricsCollector();
    // LLM healthy, guardian critical (10+ issues)
    const failedAlerts = Array.from({ length: 10 }, (_, i) => ({
      eventId: `e${i}`, guardianUserId: "g1", channel: "push" as const,
      reason: "down", occurredAt: new Date().toISOString(),
    }));
    const report = generateHealthReport({
      metricsCollector: collector,
      recoveryQueue: new AlertRecoveryQueue(),
      failedAlertStore: failedAlerts,
    });
    expect(report.overall).toBe("critical");
    expect(report.llm.status).toBe("healthy");
  });
});

// ──────────────────────────────────────────────
// 모니터링 - 재발송 큐
// ──────────────────────────────────────────────
describe("AlertRecoveryQueue", () => {
  const payload = {
    userId: "u1", measuredAt: "2026-05-20T00:00:00.000Z",
    signalLevel: "red" as const, glucoseMgDl: 220,
    mileageTotal: 500, requiresAttention: true, summary: "주의 필요",
  };

  it("enqueues and sizes correctly", () => {
    const q = new AlertRecoveryQueue();
    expect(q.size()).toBe(0);
    q.enqueue({ payload, contact: { guardianUserId: "g1" }, enqueuedAt: "t" });
    expect(q.size()).toBe(1);
  });

  it("processes queue and clears on success", async () => {
    const q = new AlertRecoveryQueue();
    q.enqueue({ payload, contact: { guardianUserId: "g1", phoneNumber: "01012341234" }, enqueuedAt: "t" });

    const result = await q.processAll({
      sms: { async send() { return { messageId: "sms-ok" }; } },
    });

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(q.size()).toBe(0);
  });

  it("keeps failed items in queue for next retry", async () => {
    const q = new AlertRecoveryQueue();
    q.enqueue({ payload, contact: { guardianUserId: "g1", phoneNumber: "010" }, enqueuedAt: "t" });

    const result = await q.processAll({
      sms: { async send() { throw new Error("still down"); } },
    });

    expect(result.failed).toBe(1);
    expect(q.size()).toBe(1);
    expect(q.getAll()[0].lastFailureReason).toContain("still down");
  });

  it("pruneExhausted removes items beyond maxAttempts", async () => {
    const q = new AlertRecoveryQueue();
    q.enqueue({ payload, contact: { guardianUserId: "g1", phoneNumber: "010" }, enqueuedAt: "t" });

    // Fail twice to increment attempts
    await q.processAll({ sms: { async send() { throw new Error("down"); } } });
    await q.processAll({ sms: { async send() { throw new Error("down"); } } });

    const pruned = q.pruneExhausted(2);
    expect(pruned).toHaveLength(1);
    expect(q.size()).toBe(0);
  });
});

// ──────────────────────────────────────────────
// 모니터링 - 누락 감지
// ──────────────────────────────────────────────
describe("detectAndEnqueueMissedAlerts", () => {
  const payload = {
    userId: "u1", measuredAt: "", signalLevel: "red" as const,
    glucoseMgDl: 220, mileageTotal: 0, requiresAttention: true, summary: "",
  };

  it("enqueues recent failed events", () => {
    const q = new AlertRecoveryQueue();
    const failedEvents = [
      { eventId: "e1", guardianUserId: "g1", channel: "push" as const, reason: "FCM down", occurredAt: "2026-05-20T00:00:00.000Z" },
    ];
    const result = detectAndEnqueueMissedAlerts({
      failedEvents,
      contactMap: new Map([["g1", { guardianUserId: "g1", phoneNumber: "010" }]]),
      payloadMap: new Map([["g1", payload]]),
      recoveryQueue: q,
      nowIso: "2026-05-20T00:10:00.000Z",
      maxAgeMs: 60 * 60 * 1000,
    });
    expect(result.missedCount).toBe(1);
    expect(result.enqueuedForRetry).toBe(1);
    expect(q.size()).toBe(1);
  });

  it("skips events older than maxAgeMs", () => {
    const q = new AlertRecoveryQueue();
    const failedEvents = [
      { eventId: "e1", guardianUserId: "g1", channel: "push" as const, reason: "down", occurredAt: "2026-05-20T00:00:00.000Z" },
    ];
    const result = detectAndEnqueueMissedAlerts({
      failedEvents,
      contactMap: new Map([["g1", { guardianUserId: "g1", phoneNumber: "010" }]]),
      payloadMap: new Map([["g1", payload]]),
      recoveryQueue: q,
      nowIso: "2026-05-20T02:00:00.000Z",
      maxAgeMs: 30 * 60 * 1000, // 30분 → 2시간 전 이벤트는 스킵
    });
    expect(result.enqueuedForRetry).toBe(0);
    expect(q.size()).toBe(0);
  });

  it("skips when contact or payload not found", () => {
    const q = new AlertRecoveryQueue();
    const failedEvents = [
      { eventId: "e1", guardianUserId: "unknown-g", channel: "push" as const, reason: "down", occurredAt: "2026-05-20T00:00:00.000Z" },
    ];
    const result = detectAndEnqueueMissedAlerts({
      failedEvents,
      contactMap: new Map(),
      payloadMap: new Map(),
      recoveryQueue: q,
      nowIso: "2026-05-20T00:05:00.000Z",
    });
    expect(result.enqueuedForRetry).toBe(0);
  });
});

// ──────────────────────────────────────────────
// 보안 - PII 마스킹
// ──────────────────────────────────────────────
describe("PII 마스킹", () => {
  it("masks phone numbers correctly", () => {
    expect(maskPhoneNumber("01012341234")).toBe("010****1234");
    expect(maskPhoneNumber("01091234567")).toBe("010****4567");
  });

  it("masks user IDs", () => {
    expect(maskUserId("u1")).toBe("u-****");
    expect(maskUserId("user-senior-01")).toBe("us****01");
  });

  it("masks names (Korean 2-3 chars)", () => {
    expect(maskName("김")).toBe("*");
    expect(maskName("김철")).toBe("김*");
    expect(maskName("김철수")).toBe("김*수");
    expect(maskName("홍길동박")).toBe("홍**박");
  });
});

// ──────────────────────────────────────────────
// 보안 - 데이터 접근 제어
// ──────────────────────────────────────────────
describe("데이터 접근 제어", () => {
  it("allows access when userId matches", () => {
    expect(() => assertDataAccess("u1", "u1")).not.toThrow();
  });

  it("throws DataAccessError when userId mismatches", () => {
    expect(() => assertDataAccess("u1", "u2")).toThrow(DataAccessError);
    expect(() => assertDataAccess("u1", "u2")).toThrow("접근 거부");
  });

  it("allows guardian access when registered", () => {
    const profile = {
      userId: "u1", name: "김철수", district: "부산광역시 수영구" as const,
      guardianIds: ["g1", "g2"],
    };
    expect(() => assertGuardianAccess("g1", profile)).not.toThrow();
  });

  it("throws when guardian is not registered", () => {
    const profile = {
      userId: "u1", name: "김철수", district: "부산광역시 수영구" as const,
      guardianIds: ["g1"],
    };
    expect(() => assertGuardianAccess("g-unknown", profile)).toThrow(DataAccessError);
  });
});

// ──────────────────────────────────────────────
// 보안 - 새니타이징
// ──────────────────────────────────────────────
describe("데이터 새니타이징", () => {
  it("sanitizeRecordForLog removes sensitive fields", () => {
    const record: any = {
      recordId: "r1", userId: "user-senior-01",
      measuredAt: "2026-05-20T10:00:00.000Z", mealTiming: "fasting",
      glucoseMgDl: 90, inputMethod: "keypad", signalLevel: "green",
      aiInterventionText: "안정적입니다.", earnedMileage: 10,
      symptoms: ["두통"],
      medicationTaken: true,
      dietAnalysis: { glycemicAssessment: "good" },
    };
    const sanitized = sanitizeRecordForLog(record);
    expect(sanitized.userId).toContain("****");
    expect("symptoms" in sanitized).toBe(false);
    expect("medicationTaken" in sanitized).toBe(false);
    expect("dietAnalysis" in sanitized).toBe(false);
    expect(sanitized.glucoseMgDl).toBe(90);
  });

  it("sanitizeProfileForLog removes personal info", () => {
    const profile: any = {
      userId: "u1", name: "김철수", district: "부산광역시 수영구",
      guardianIds: ["g1", "g2"], birthYear: 1950, livesAlone: true,
    };
    const sanitized = sanitizeProfileForLog(profile) as any;
    expect(sanitized.userId).toContain("****");
    expect("name" in sanitized).toBe(false);
    expect("birthYear" in sanitized).toBe(false);
    expect("livesAlone" in sanitized).toBe(false);
    expect(sanitized.guardianCount).toBe(2);
  });
});

// ──────────────────────────────────────────────
// 보안 - 감사 로그
// ──────────────────────────────────────────────
describe("감사 로그", () => {
  let store: InMemoryAuditLogStore;

  beforeEach(() => { store = new InMemoryAuditLogStore(); });

  it("appends audit entries", async () => {
    await auditLog(
      store,
      {
        eventType: "data_access",
        actorId: "u1",
        resourceUserId: "u1",
        success: true,
        timestamp: "2026-05-20T10:00:00.000Z",
      },
      store.generateEventId.bind(store),
    );
    expect(store.getAll()).toHaveLength(1);
    expect(store.getAll()[0].eventType).toBe("data_access");
  });

  it("finds by event type", async () => {
    await auditLog(store, { eventType: "qr_verify", actorId: "u1", resourceUserId: "u1", success: true, timestamp: "t" }, store.generateEventId.bind(store));
    await auditLog(store, { eventType: "data_access", actorId: "u1", resourceUserId: "u1", success: true, timestamp: "t" }, store.generateEventId.bind(store));

    expect(store.findByType("qr_verify")).toHaveLength(1);
    expect(store.findByType("data_access")).toHaveLength(1);
  });

  it("finds failures", async () => {
    await auditLog(store, { eventType: "qr_verify_failed", actorId: "u1", resourceUserId: "u1", success: false, timestamp: "t" }, store.generateEventId.bind(store));
    await auditLog(store, { eventType: "data_access", actorId: "u1", resourceUserId: "u1", success: true, timestamp: "t" }, store.generateEventId.bind(store));

    expect(store.findFailures()).toHaveLength(1);
    expect(store.findFailures()[0].eventType).toBe("qr_verify_failed");
  });
});

// ──────────────────────────────────────────────
// 보안 - QR 토큰 감사 래퍼
// ──────────────────────────────────────────────
describe("verifyQrTokenWithAudit", () => {
  const SIGNING = { secret: "s", issuer: "mildang", audience: "suyeong-health-dashboard" };

  it("logs success on valid token", async () => {
    const { createQrDashboardMapping } = await import("../src/application/phase2Integration");
    const store = new InMemoryAuditLogStore();
    const qr = createQrDashboardMapping({
      userId: "u1", dashboardBaseUrl: "https://health.suyeong.go.kr",
      nowIso: "2026-05-20T10:00:00.000Z", ttlMinutes: 10, signing: SIGNING,
    });

    const result = await verifyQrTokenWithAudit({
      qrToken: qr.qrToken,
      nowIso: "2026-05-20T10:05:00.000Z",
      signing: SIGNING,
      requestorId: "nurse-01",
      auditStore: store,
      generateId: store.generateEventId.bind(store),
    });

    expect(result.valid).toBe(true);
    expect(store.findByType("qr_verify")).toHaveLength(1);
    expect(store.findFailures()).toHaveLength(0);
  });

  it("logs failure on invalid token", async () => {
    const store = new InMemoryAuditLogStore();
    const result = await verifyQrTokenWithAudit({
      qrToken: "bad.token",
      nowIso: "2026-05-20T10:05:00.000Z",
      signing: SIGNING,
      requestorId: "unknown",
      auditStore: store,
      generateId: store.generateEventId.bind(store),
    });

    expect(result.valid).toBe(false);
    expect(store.findByType("qr_verify_failed")).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────
// 보안 - PII 스캔/제거
// ──────────────────────────────────────────────
describe("PII 스캔 및 제거", () => {
  it("detects phone number in text", () => {
    expect(containsPii("연락처: 010-1234-5678")).toBe(true);
    expect(containsPii("정상 혈당입니다. 잘 하셨어요!")).toBe(false);
  });

  it("detects email in text", () => {
    expect(containsPii("이메일: user@example.com")).toBe(true);
  });

  it("redacts phone numbers", () => {
    const redacted = redactPii("연락처는 010-1234-5678입니다.");
    expect(redacted).toContain("[전화번호 삭제]");
    expect(redacted).not.toContain("010-1234-5678");
  });

  it("redacts emails", () => {
    const redacted = redactPii("이메일: user@hospital.kr 로 보내주세요.");
    expect(redacted).toContain("[이메일 삭제]");
  });

  it("leaves clean text unchanged", () => {
    const text = "오늘 혈당이 안정적입니다.";
    expect(redactPii(text)).toBe(text);
  });
});
