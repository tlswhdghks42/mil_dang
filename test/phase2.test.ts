import { describe, expect, it } from "vitest";
import {
  analyzeDietFromSttAudio,
  analyzeDietText,
  normalizeDietSpeech,
  SttProvider,
} from "../src/application/phase2Diet";
import {
  deriveWeatherRiskFlags,
  fetchSuyeongWeather,
  normalizeWeatherCondition,
} from "../src/application/phase2Weather";
import {
  buildGuardianSyncPayload,
  createQrDashboardMapping,
  shouldDoubleMileageByChallenge,
  verifyQrToken,
} from "../src/application/phase2Integration";
import {
  buildGuardianAlertMessage,
  sendGuardianAlert,
} from "../src/application/phase2GuardianChannel";

describe("phase2 weather", () => {
  it("derives risk flags and condition", () => {
    expect(deriveWeatherRiskFlags(35, "clear")).toContain("heatwave");
    expect(deriveWeatherRiskFlags(-7, "clear")).toContain("coldwave");
    expect(normalizeWeatherCondition(20, "미세먼지 나쁨")).toBe("dusty");
  });

  it("fetches and normalizes suyeong weather", async () => {
    const snapshot = await fetchSuyeongWeather(async () => ({
      ok: true,
      async json() {
        return { temperatureC: 34, condition: "sunny" };
      },
    }), "2026-05-19T00:00:00.000Z");

    expect(snapshot.district).toBe("수영구");
    expect(snapshot.condition).toBe("heatwave");
  });

  it("throws when weather payload has no numeric temperature", async () => {
    await expect(
      fetchSuyeongWeather(async () => ({
        ok: true,
        status: 200,
        async json() {
          return { condition: "sunny" };
        },
      })),
    ).rejects.toThrow("온도 정보");
  });

  it("supports custom endpoint config", async () => {
    let called = "";
    await fetchSuyeongWeather(
      async (url) => {
        called = url;
        return {
          ok: true,
          status: 200,
          async json() {
            return { temperatureC: 20, condition: "rain" };
          },
        };
      },
      "2026-05-19T00:00:00.000Z",
      { endpoint: "https://weather.example.org/suyeong" },
    );

    expect(called).toBe("https://weather.example.org/suyeong");
  });
});

describe("phase2 diet", () => {
  it("normalizes and scores diet speech", () => {
    expect(normalizeDietSpeech("  보리밥   된장찌개 ")).toBe("보리밥 된장찌개");
    expect(analyzeDietText("라면과 콜라 먹었어요").glycemicAssessment).toBe("risky");
    expect(analyzeDietText("보리밥 나물 먹었어요").glycemicAssessment).toBe("good");
  });

  it("handles empty diet speech as neutral", () => {
    const out = analyzeDietText("   ");
    expect(out.glycemicAssessment).toBe("neutral");
    expect(out.confidence).toBe(0.2);
  });

  it("considers portion size and negation", () => {
    expect(analyzeDietText("라면 많이 먹었어요").glycemicAssessment).toBe("risky");
    expect(analyzeDietText("라면 안 먹고 보리밥 먹었어요").glycemicAssessment).toBe("good");
  });

  it("analyzes from STT provider", async () => {
    const sttProvider: SttProvider = {
      async transcribeKorean() {
        return { text: "보리밥과 두부 먹었어요", confidence: 0.9 };
      },
    };

    const out = await analyzeDietFromSttAudio("base64-audio", sttProvider);
    expect(out.glycemicAssessment).toBe("good");
    expect(out.confidence).toBeGreaterThan(0.8);
  });

  it("throws on empty STT audio", async () => {
    const sttProvider: SttProvider = {
      async transcribeKorean() {
        return { text: "" };
      },
    };

    await expect(analyzeDietFromSttAudio("   ", sttProvider)).rejects.toThrow("오디오 입력");
  });
});

describe("phase2 integration", () => {
  it("builds qr mapping", () => {
    const qr = createQrDashboardMapping({
      userId: "u1",
      dashboardBaseUrl: "https://health.suyeong.go.kr/dashboard",
      nowIso: "2026-05-19T00:00:00.000Z",
      ttlMinutes: 10,
      signing: { secret: "test-secret", issuer: "mildang-test", audience: "suyeong-health-dashboard" },
    });

    expect(qr.dashboardUrl).toContain("token=");
    expect(qr.expiresAt).toBe("2026-05-19T00:10:00.000Z");
  });

  it("verifies signed qr token and rejects expired token", () => {
    const qr = createQrDashboardMapping({
      userId: "u1",
      dashboardBaseUrl: "https://health.suyeong.go.kr/dashboard",
      nowIso: "2026-05-19T00:00:00.000Z",
      ttlMinutes: 10,
      signing: { secret: "test-secret", issuer: "mildang-test", audience: "suyeong-health-dashboard" },
    });

    const valid = verifyQrToken(qr.qrToken, "2026-05-19T00:05:00.000Z", { secret: "test-secret", issuer: "mildang-test", audience: "suyeong-health-dashboard" });
    const expired = verifyQrToken(qr.qrToken, "2026-05-19T00:11:00.000Z", { secret: "test-secret", issuer: "mildang-test", audience: "suyeong-health-dashboard" });

    expect(valid.valid).toBe(true);
    expect(valid.userId).toBe("u1");
    expect(expired.valid).toBe(false);
  });

  it("rejects token with invalid signature", () => {
    const qr = createQrDashboardMapping({
      userId: "u1",
      dashboardBaseUrl: "https://health.suyeong.go.kr/dashboard",
      nowIso: "2026-05-19T00:00:00.000Z",
      ttlMinutes: 10,
      signing: { secret: "test-secret" },
    });

    const invalid = verifyQrToken(qr.qrToken, "2026-05-19T00:05:00.000Z", { secret: "wrong-secret", issuer: "mildang", audience: "suyeong-health-dashboard" });
    expect(invalid.valid).toBe(false);
  });



  it("rejects token with invalid issuer or audience", () => {
    const qr = createQrDashboardMapping({
      userId: "u1",
      dashboardBaseUrl: "https://health.suyeong.go.kr/dashboard",
      nowIso: "2026-05-19T00:00:00.000Z",
      ttlMinutes: 10,
      signing: { secret: "test-secret", issuer: "mildang-test", audience: "suyeong-health-dashboard" },
    });

    const wrongIssuer = verifyQrToken(qr.qrToken, "2026-05-19T00:05:00.000Z", {
      secret: "test-secret",
      issuer: "other-issuer",
      audience: "suyeong-health-dashboard",
    });
    const wrongAudience = verifyQrToken(qr.qrToken, "2026-05-19T00:05:00.000Z", {
      secret: "test-secret",
      issuer: "mildang-test",
      audience: "other-dashboard",
    });

    expect(wrongIssuer.valid).toBe(false);
    expect(wrongAudience.valid).toBe(false);
  });

  it("applies local challenge multiplier predicate", () => {
    expect(
      shouldDoubleMileageByChallenge({
        challenge: { challengeId: "c1", name: "광안리 코스", place: "광안리 해변 산책로", requiredSteps: 5000 },
        walkedSteps: 5200,
      }),
    ).toBe(true);
  });

  it("builds guardian payload", () => {
    const payload = buildGuardianSyncPayload(
      {
        recordId: "r1",
        userId: "u1",
        measuredAt: "2026-05-19T00:00:00.000Z",
        mealTiming: "fasting",
        glucoseMgDl: 210,
        inputMethod: "keypad",
        signalLevel: "red",
        aiInterventionText: "",
        earnedMileage: 100,
      },
      1300,
    );

    expect(payload.requiresAttention).toBe(true);
    expect(payload.mileageTotal).toBe(1300);
  });
});


describe("phase2 guardian channel", () => {
  const payload = {
    userId: "u1",
    measuredAt: "2026-05-20T00:00:00.000Z",
    signalLevel: "red" as const,
    glucoseMgDl: 210,
    mileageTotal: 1200,
    requiresAttention: true,
    summary: "주의가 필요한 혈당 상태가 감지되었습니다. 측정 결과를 확인해주세요.",
  };

  it("builds guardian alert message", () => {
    const message = buildGuardianAlertMessage(payload);
    expect(message.title).toContain("주의 알림");
    expect(message.body).toContain("210mg/dL");
  });

  it("sends push when preferred and available", async () => {
    const result = await sendGuardianAlert({
      payload,
      contact: { guardianUserId: "g1", prefersPush: true, phoneNumber: "01012341234" },
      senders: {
        push: {
          async send() {
            return { messageId: "push-1" };
          },
        },
      },
    });

    expect(result.success).toBe(true);
    expect(result.channel).toBe("push");
  });

  it("falls back to sms when push fails", async () => {
    const result = await sendGuardianAlert({
      payload,
      contact: { guardianUserId: "g1", prefersPush: true, phoneNumber: "01012341234" },
      senders: {
        push: {
          async send() {
            throw new Error("push down");
          },
        },
        sms: {
          async send() {
            return { messageId: "sms-1" };
          },
        },
      },
    });

    expect(result.success).toBe(true);
    expect(result.channel).toBe("sms");
  });

  it("returns error when no channel available", async () => {
    const result = await sendGuardianAlert({
      payload,
      contact: { guardianUserId: "g1", prefersPush: false },
      senders: {},
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("채널");
  });
});

describe("phase2 guardian channel retry", () => {
  const payload = {
    userId: "u1",
    measuredAt: "2026-05-20T00:00:00.000Z",
    signalLevel: "red" as const,
    glucoseMgDl: 210,
    mileageTotal: 1200,
    requiresAttention: true,
    summary: "주의가 필요한 혈당 상태가 감지되었습니다. 측정 결과를 확인해주세요.",
  };

  it("retries push then succeeds", async () => {
    let callCount = 0;
    const sleeps: number[] = [];

    const { sendGuardianAlert } = await import("../src/application/phase2GuardianChannel");
    const result = await sendGuardianAlert({
      payload,
      contact: { guardianUserId: "g1", prefersPush: true },
      senders: {
        push: {
          async send() {
            callCount += 1;
            if (callCount < 2) throw new Error("temporary");
            return { messageId: "push-ok" };
          },
        },
      },
      retryPolicy: {
        maxAttempts: 2,
        backoffMsByAttempt: [100],
        async sleep(ms: number) {
          sleeps.push(ms);
        },
      },
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
    expect(sleeps).toEqual([100]);
  });

  it("stores failure event when all channels fail", async () => {
    const saved: any[] = [];
    const { sendGuardianAlert } = await import("../src/application/phase2GuardianChannel");

    const result = await sendGuardianAlert({
      payload,
      contact: { guardianUserId: "g1", prefersPush: true },
      senders: {
        push: {
          async send() {
            throw new Error("down");
          },
        },
      },
      retryPolicy: { maxAttempts: 1, backoffMsByAttempt: [], sleep: async () => {} },
      failedEventStore: {
        async save(event) {
          saved.push(event);
        },
      },
      nowIso: "2026-05-20T00:00:00.000Z",
    });

    expect(result.success).toBe(false);
    expect(saved.length).toBe(1);
    expect(saved[0].reason).toContain("down");
  });
});

describe("phase2 challenge gps", () => {
  it("verifies gps and stores audit record", async () => {
    const saved: any[] = [];
    const { verifyChallengeGps } = await import("../src/application/phase2ChallengeGps");

    const ok = await verifyChallengeGps({
      challenge: { challengeId: "c1", name: "광안리", place: "광안리 해변 산책로", geoFenceRadiusM: 150 },
      userId: "u1",
      point: { lat: 35.1, lng: 129.1, accuracyM: 15, recordedAt: "2026-05-20T00:00:00.000Z" },
      geofenceProvider: {
        async isWithinRadius() {
          return true;
        },
      },
      verificationStore: { async save(rec) { saved.push(rec); } },
    });

    expect(ok).toBe(true);
    expect(saved[0].verified).toBe(true);
  });

  it("rejects low accuracy gps", async () => {
    const { verifyChallengeGps } = await import("../src/application/phase2ChallengeGps");
    const ok = await verifyChallengeGps({
      challenge: { challengeId: "c1", name: "광안리", place: "광안리 해변 산책로" },
      userId: "u1",
      point: { lat: 35.1, lng: 129.1, accuracyM: 120, recordedAt: "2026-05-20T00:00:00.000Z" },
      geofenceProvider: { async isWithinRadius() { return true; } },
    });
    expect(ok).toBe(false);
  });
});

// Diet robustness: unknown menu phrasing

describe("phase2 diet robustness", () => {
  it("infers risk from generic carb-heavy statement", () => {
    const out = analyzeDietText("오늘 점심에 밥 곱빼기랑 달달한 라떼 먹었어요");
    expect(out.glycemicAssessment).toBe("risky");
  });

  it("returns neutral for hard-to-classify free text but still analyzes", () => {
    const out = analyzeDietText("오늘은 그냥 평소처럼 먹었어요");
    expect(["neutral", "good", "risky"]).toContain(out.glycemicAssessment);
    expect(out.reasons.length).toBeGreaterThan(0);
  });
});

describe("phase3 intervention llm chain", () => {
  it("builds prompt with core context", async () => {
    const { buildInterventionPrompt } = await import("../src/application/phase3InterventionLLM");
    const prompt = buildInterventionPrompt({
      signal: "yellow",
      baseInterventionText: "물을 드시고 가볍게 움직이세요.",
      dietSummary: "탄수화물 비중이 높음",
      symptoms: ["어지러움"],
      medicationTaken: false,
      weather: {
        district: "수영구",
        observedAt: "2026-05-20T00:00:00.000Z",
        temperatureC: 34,
        condition: "heatwave",
        riskFlags: ["heatwave"],
      },
    });

    expect(prompt).toContain("현재 신호등 상태: yellow");
    expect(prompt).toContain("식단 분석: 탄수화물 비중이 높음");
  });

  it("falls back to base text when llm output is empty", async () => {
    const { refineInterventionWithLlm } = await import("../src/application/phase3InterventionLLM");
    const out = await refineInterventionWithLlm({
      input: {
        signal: "green",
        baseInterventionText: "현재 혈당은 안정적입니다.",
      },
      llmClient: {
        async complete() {
          return "   ";
        },
      },
    });

    expect(out).toBe("현재 혈당은 안정적입니다.");
  });
});
