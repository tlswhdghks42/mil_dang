import { describe, expect, it, beforeEach } from "vitest";
import {
  WeatherCache,
  makeKmaSuyeongFetcher,
  parseKmaApiResponse,
  fetchWithRetry,
} from "../src/application/phase4WeatherAdapter";
import { fetchSuyeongWeather } from "../src/application/phase2Weather";
import {
  FcmPushSender,
  AligoSmsSender,
  InMemoryGuardianChannel,
  notifyGuardiansOnMeasurement,
} from "../src/application/phase4GuardianAdapters";
import {
  InMemoryBloodSugarRepository,
  getDashboardData,
  saveBloodSugarRecord,
} from "../src/application/phase4Dashboard";
import { createQrDashboardMapping } from "../src/application/phase2Integration";

// ──────────────────────────────────────────────
// 4-1: 날씨 API 어댑터
// ──────────────────────────────────────────────
describe("phase4 weather adapter - parseKmaApiResponse", () => {
  it("parses normal KMA response with temperature and PTY=0", () => {
    const data = {
      response: {
        header: { resultCode: "00" },
        body: {
          items: {
            item: [
              { category: "T1H", obsrValue: "25" },
              { category: "PTY", obsrValue: "0" },
              { category: "SKY", obsrValue: "1" },
            ],
          },
        },
      },
    };
    const result = parseKmaApiResponse(data);
    expect(result.temperatureC).toBe(25);
    expect(result.conditionText).toBe("clear");
  });

  it("maps PTY=1 (rain) correctly", () => {
    const data = {
      response: {
        header: { resultCode: "00" },
        body: { items: { item: [{ category: "T1H", obsrValue: "22" }, { category: "PTY", obsrValue: "1" }] } },
      },
    };
    expect(parseKmaApiResponse(data).conditionText).toBe("rain");
  });

  it("maps PTY=3 (snow) correctly", () => {
    const data = {
      response: {
        header: { resultCode: "00" },
        body: { items: { item: [{ category: "T1H", obsrValue: "-3" }, { category: "PTY", obsrValue: "3" }] } },
      },
    };
    const r = parseKmaApiResponse(data);
    expect(r.conditionText).toBe("snow");
  });

  it("overrides to heatwave when temperature >= 33", () => {
    const data = {
      response: {
        header: { resultCode: "00" },
        body: { items: { item: [{ category: "T1H", obsrValue: "35" }, { category: "PTY", obsrValue: "0" }] } },
      },
    };
    expect(parseKmaApiResponse(data).conditionText).toBe("heatwave");
  });

  it("overrides to coldwave when temperature <= -5", () => {
    const data = {
      response: {
        header: { resultCode: "00" },
        body: { items: { item: [{ category: "T1H", obsrValue: "-10" }, { category: "PTY", obsrValue: "0" }] } },
      },
    };
    expect(parseKmaApiResponse(data).conditionText).toBe("coldwave");
  });

  it("throws when resultCode is not 00", () => {
    const data = {
      response: { header: { resultCode: "30", resultMsg: "NO_DATA_ERROR" }, body: {} },
    };
    expect(() => parseKmaApiResponse(data)).toThrow("기상청 API 오류");
  });

  it("throws when T1H is missing", () => {
    const data = {
      response: {
        header: { resultCode: "00" },
        body: { items: { item: [{ category: "PTY", obsrValue: "0" }] } },
      },
    };
    expect(() => parseKmaApiResponse(data)).toThrow("온도 정보");
  });
});

describe("phase4 weather adapter - WeatherCache", () => {
  it("returns undefined when empty", () => {
    const cache = new WeatherCache();
    expect(cache.get("key")).toBeUndefined();
  });

  it("returns cached value within TTL", async () => {
    const cache = new WeatherCache();
    const fakeResponse = { ok: true, status: 200, async json() { return {}; } };
    cache.set("key", fakeResponse, 10_000);
    expect(cache.get("key")).toBe(fakeResponse);
  });

  it("returns undefined after TTL expiry", async () => {
    const cache = new WeatherCache();
    const fakeResponse = { ok: true, status: 200, async json() { return {}; } };
    cache.set("key", fakeResponse, -1); // already expired
    expect(cache.get("key")).toBeUndefined();
  });

  it("invalidate removes the entry", () => {
    const cache = new WeatherCache();
    const fakeResponse = { ok: true, status: 200, async json() { return {}; } };
    cache.set("key", fakeResponse, 10_000);
    cache.invalidate("key");
    expect(cache.get("key")).toBeUndefined();
  });
});

describe("phase4 weather adapter - makeKmaSuyeongFetcher", () => {
  it("fetches and transforms KMA response into WeatherSnapshot via fetchSuyeongWeather", async () => {
    const kmaData = {
      response: {
        header: { resultCode: "00" },
        body: {
          items: {
            item: [
              { category: "T1H", obsrValue: "28" },
              { category: "PTY", obsrValue: "0" },
              { category: "SKY", obsrValue: "1" },
            ],
          },
        },
      },
    };

    let calledUrl = "";
    const rawFetcher = async (url: string) => {
      calledUrl = url;
      return { ok: true, status: 200, async json() { return kmaData; } };
    };

    const fetcher = makeKmaSuyeongFetcher(
      { serviceKey: "test-key", cacheTtlMs: 0 },
      rawFetcher,
    );

    const snapshot = await fetchSuyeongWeather(fetcher, "2026-05-20T10:00:00.000Z");
    expect(snapshot.district).toBe("수영구");
    expect(snapshot.temperatureC).toBe(28);
    expect(snapshot.condition).toBe("clear");
    expect(calledUrl).toContain("test-key");
    expect(calledUrl).toContain("nx=99");
  });

  it("caches response and skips second HTTP call", async () => {
    let callCount = 0;
    const rawFetcher = async () => {
      callCount++;
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            response: {
              header: { resultCode: "00" },
              body: { items: { item: [{ category: "T1H", obsrValue: "20" }, { category: "PTY", obsrValue: "0" }] } },
            },
          };
        },
      };
    };

    const cache = new WeatherCache();
    const fetcher = makeKmaSuyeongFetcher({ serviceKey: "k", cacheTtlMs: 60_000 }, rawFetcher, cache);

    await fetchSuyeongWeather(fetcher);
    await fetchSuyeongWeather(fetcher);

    expect(callCount).toBe(1); // second call served from cache
  });

  it("does not cache on HTTP error response", async () => {
    let callCount = 0;
    const rawFetcher = async () => {
      callCount++;
      return { ok: false, status: 503, async json() { return {}; } };
    };

    const cache = new WeatherCache();
    const fetcher = makeKmaSuyeongFetcher({ serviceKey: "k", cacheTtlMs: 60_000 }, rawFetcher, cache);

    await expect(fetchSuyeongWeather(fetcher)).rejects.toThrow();
    await expect(fetchSuyeongWeather(fetcher)).rejects.toThrow();
    expect(callCount).toBe(2); // no caching on error
  });
});

describe("phase4 weather adapter - fetchWithRetry", () => {
  it("returns on first success", async () => {
    let calls = 0;
    const fetcher = async () => { calls++; return { ok: true, status: 200, async json() { return {}; } }; };
    const res = await fetchWithRetry(fetcher, "http://example.com", 3, 0);
    expect(res.ok).toBe(true);
    expect(calls).toBe(1);
  });

  it("retries on failure and succeeds", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      if (calls < 3) throw new Error("timeout");
      return { ok: true, status: 200, async json() { return {}; } };
    };
    const res = await fetchWithRetry(fetcher, "http://example.com", 3, 0);
    expect(res.ok).toBe(true);
    expect(calls).toBe(3);
  });

  it("throws after all attempts exhausted", async () => {
    const fetcher = async () => { throw new Error("network down"); };
    await expect(fetchWithRetry(fetcher, "http://example.com", 2, 0)).rejects.toThrow("network down");
  });
});

// ──────────────────────────────────────────────
// 4-2: 보호자 동기화 어댑터
// ──────────────────────────────────────────────
describe("phase4 FcmPushSender", () => {
  it("sends push notification and returns messageId", async () => {
    let captured: unknown;
    const fetcher = async (_url: string, init?: { body?: string }) => {
      captured = JSON.parse(init?.body ?? "{}");
      return { ok: true, status: 200, async json() { return { name: "projects/p/messages/msg-001" }; } };
    };

    const sender = new FcmPushSender({ projectId: "proj", accessToken: "tok" }, fetcher);
    const result = await sender.send({
      guardianUserId: "fcm-token-g1",
      title: "주의 알림",
      body: "혈당이 높아요.",
      data: { signalLevel: "red" },
    });

    expect(result.messageId).toBe("projects/p/messages/msg-001");
    expect((captured as any).message.token).toBe("fcm-token-g1");
    expect((captured as any).message.notification.title).toBe("주의 알림");
  });

  it("includes Authorization header", async () => {
    let capturedHeaders: Record<string, string> = {};
    const fetcher = async (_url: string, init?: { headers?: Record<string, string> }) => {
      capturedHeaders = init?.headers ?? {};
      return { ok: true, status: 200, async json() { return { name: "msg-1" }; } };
    };

    const sender = new FcmPushSender({ projectId: "p", accessToken: "my-token" }, fetcher);
    await sender.send({ guardianUserId: "t", title: "T", body: "B", data: {} });
    expect(capturedHeaders["Authorization"]).toBe("Bearer my-token");
  });

  it("throws on HTTP error response", async () => {
    const fetcher = async () => ({
      ok: false,
      status: 401,
      async json() { return { error: { message: "UNAUTHORIZED" } }; },
    });

    const sender = new FcmPushSender({ projectId: "p", accessToken: "bad" }, fetcher);
    await expect(
      sender.send({ guardianUserId: "t", title: "T", body: "B", data: {} }),
    ).rejects.toThrow("FCM 전송 실패 (401)");
  });
});

describe("phase4 AligoSmsSender", () => {
  it("sends SMS and returns messageId", async () => {
    let capturedBody = "";
    const fetcher = async (_url: string, init?: { body?: string }) => {
      capturedBody = init?.body ?? "";
      return { ok: true, status: 200, async json() { return { result_code: 1, msg_id: "sms-999" }; } };
    };

    const sender = new AligoSmsSender(
      { apiKey: "key", userId: "uid", sender: "01012341234" },
      fetcher,
    );
    const result = await sender.send({ phoneNumber: "01099998888", message: "혈당 주의 알림입니다." });
    expect(result.messageId).toBe("sms-999");
    expect(capturedBody).toContain("receiver=01099998888");
    expect(capturedBody).toContain("sender=01012341234");
  });

  it("throws when result_code < 1", async () => {
    const fetcher = async () => ({
      ok: true,
      status: 200,
      async json() { return { result_code: -1, message: "인증 실패" }; },
    });

    const sender = new AligoSmsSender({ apiKey: "k", userId: "u", sender: "0" }, fetcher);
    await expect(sender.send({ phoneNumber: "010", message: "test" })).rejects.toThrow("알리고 SMS 오류");
  });

  it("throws on HTTP error", async () => {
    const fetcher = async () => ({ ok: false, status: 500, async json() { return {}; } });
    const sender = new AligoSmsSender({ apiKey: "k", userId: "u", sender: "0" }, fetcher);
    await expect(sender.send({ phoneNumber: "010", message: "x" })).rejects.toThrow("알리고 SMS 전송 실패");
  });
});

describe("phase4 InMemoryGuardianChannel", () => {
  it("tracks connections", () => {
    const ch = new InMemoryGuardianChannel();
    expect(ch.hasConnection("g1")).toBe(false);
    ch.connect("g1");
    expect(ch.hasConnection("g1")).toBe(true);
    ch.disconnect("g1");
    expect(ch.hasConnection("g1")).toBe(false);
  });

  it("emits events to connected guardians", async () => {
    const ch = new InMemoryGuardianChannel();
    ch.connect("g1");

    await ch.emit("g1", {
      eventType: "safety_alert",
      payload: {
        userId: "u1",
        measuredAt: "2026-05-20T00:00:00.000Z",
        signalLevel: "red",
        glucoseMgDl: 220,
        mileageTotal: 1000,
        requiresAttention: true,
        summary: "주의 필요",
      },
      emittedAt: "2026-05-20T00:00:00.000Z",
    });

    expect(ch.getLog()).toHaveLength(1);
    expect(ch.getLog()[0].guardianUserId).toBe("g1");
    expect(ch.getLog()[0].event.eventType).toBe("safety_alert");
  });

  it("does not emit to disconnected guardian", async () => {
    const ch = new InMemoryGuardianChannel();
    await ch.emit("g2", {
      eventType: "blood_sugar_measured",
      payload: { userId: "u1", measuredAt: "", signalLevel: "green", glucoseMgDl: 90, mileageTotal: 0, requiresAttention: false, summary: "" },
      emittedAt: "",
    });
    expect(ch.getLog()).toHaveLength(0);
  });
});

describe("phase4 notifyGuardiansOnMeasurement", () => {
  const payload = {
    userId: "u1",
    measuredAt: "2026-05-20T00:00:00.000Z",
    signalLevel: "red" as const,
    glucoseMgDl: 220,
    mileageTotal: 1000,
    requiresAttention: true,
    summary: "주의가 필요합니다.",
  };

  it("emits to all connected guardians", async () => {
    const ch = new InMemoryGuardianChannel();
    ch.connect("g1");
    ch.connect("g2");

    const result = await notifyGuardiansOnMeasurement({
      payload,
      guardianIds: ["g1", "g2", "g3"],
      realtimeChannel: ch,
      nowIso: "2026-05-20T00:00:00.000Z",
    });

    expect(result.realtime).toBe(2);
    expect(result.skipped).toBe(1); // g3 not connected
    expect(ch.getLog()).toHaveLength(2);
  });

  it("uses safety_alert eventType for requiresAttention=true", async () => {
    const ch = new InMemoryGuardianChannel();
    ch.connect("g1");

    await notifyGuardiansOnMeasurement({
      payload: { ...payload, requiresAttention: true },
      guardianIds: ["g1"],
      realtimeChannel: ch,
    });

    expect(ch.getLog()[0].event.eventType).toBe("safety_alert");
  });

  it("uses blood_sugar_measured for normal measurement", async () => {
    const ch = new InMemoryGuardianChannel();
    ch.connect("g1");

    await notifyGuardiansOnMeasurement({
      payload: { ...payload, signalLevel: "green", requiresAttention: false },
      guardianIds: ["g1"],
      realtimeChannel: ch,
    });

    expect(ch.getLog()[0].event.eventType).toBe("blood_sugar_measured");
  });
});

// ──────────────────────────────────────────────
// 4-3: 대시보드 서비스
// ──────────────────────────────────────────────
const SIGNING = { secret: "test-secret", issuer: "mildang-test", audience: "suyeong-health-dashboard" };

function makeRecord(
  overrides: Partial<import("../src/domain/types").BloodSugarRecord> = {},
): import("../src/domain/types").BloodSugarRecord {
  return {
    recordId: `rec-${Math.random()}`,
    userId: "u1",
    measuredAt: "2026-05-20T10:00:00.000Z",
    mealTiming: "fasting",
    glucoseMgDl: 90,
    inputMethod: "keypad",
    signalLevel: "green",
    aiInterventionText: "안정적입니다.",
    earnedMileage: 10,
    ...overrides,
  };
}

describe("phase4 InMemoryBloodSugarRepository", () => {
  let repo: InMemoryBloodSugarRepository;

  beforeEach(() => { repo = new InMemoryBloodSugarRepository(); });

  it("saves and retrieves a record", async () => {
    const rec = makeRecord();
    await repo.save(rec);
    expect(await repo.findById(rec.recordId)).toEqual(rec);
  });

  it("finds records by userId sorted desc by measuredAt", async () => {
    await repo.save(makeRecord({ recordId: "r1", measuredAt: "2026-05-20T08:00:00.000Z" }));
    await repo.save(makeRecord({ recordId: "r2", measuredAt: "2026-05-20T12:00:00.000Z" }));
    await repo.save(makeRecord({ recordId: "r3", userId: "other", measuredAt: "2026-05-20T10:00:00.000Z" }));

    const records = await repo.findByUserId("u1");
    expect(records).toHaveLength(2);
    expect(records[0].recordId).toBe("r2"); // latest first
  });

  it("respects limit", async () => {
    for (let i = 0; i < 5; i++) {
      await repo.save(makeRecord({ recordId: `r${i}` }));
    }
    const records = await repo.findByUserId("u1", 3);
    expect(records).toHaveLength(3);
  });

  it("deletes a record", async () => {
    const rec = makeRecord();
    await repo.save(rec);
    const deleted = await repo.deleteById(rec.recordId);
    expect(deleted).toBe(true);
    expect(await repo.findById(rec.recordId)).toBeUndefined();
  });

  it("returns false when deleting non-existent record", async () => {
    expect(await repo.deleteById("nonexistent")).toBe(false);
  });
});

describe("phase4 getDashboardData", () => {
  let repo: InMemoryBloodSugarRepository;

  beforeEach(() => { repo = new InMemoryBloodSugarRepository(); });

  async function makeQrToken(userId = "u1", nowIso = "2026-05-20T10:00:00.000Z") {
    return createQrDashboardMapping({
      userId,
      dashboardBaseUrl: "https://health.suyeong.go.kr/dashboard",
      nowIso,
      ttlMinutes: 10,
      signing: SIGNING,
    });
  }

  it("throws on invalid QR token", async () => {
    await expect(
      getDashboardData({
        qrToken: "invalid.token",
        nowIso: "2026-05-20T10:00:00.000Z",
        signing: SIGNING,
        repository: repo,
      }),
    ).rejects.toThrow("유효하지 않은 QR 토큰");
  });

  it("throws on expired QR token", async () => {
    const qr = await makeQrToken("u1", "2026-05-20T09:00:00.000Z");
    await expect(
      getDashboardData({
        qrToken: qr.qrToken,
        nowIso: "2026-05-20T09:20:00.000Z", // 20분 후, TTL 10분 초과
        signing: SIGNING,
        repository: repo,
      }),
    ).rejects.toThrow("유효하지 않은 QR 토큰");
  });

  it("returns empty summary when no records", async () => {
    const qr = await makeQrToken();
    const summary = await getDashboardData({
      qrToken: qr.qrToken,
      nowIso: "2026-05-20T10:05:00.000Z",
      signing: SIGNING,
      repository: repo,
    });

    expect(summary.userId).toBe("u1");
    expect(summary.stats.totalRecords).toBe(0);
    expect(summary.stats.lastMeasuredAt).toBeNull();
    expect(summary.alerts.latestSignal).toBeNull();
  });

  it("computes stats correctly from multiple records", async () => {
    await repo.save(makeRecord({ recordId: "r1", glucoseMgDl: 90, signalLevel: "green", earnedMileage: 10, measuredAt: "2026-05-20T08:00:00.000Z" }));
    await repo.save(makeRecord({ recordId: "r2", glucoseMgDl: 110, signalLevel: "yellow", earnedMileage: 5, measuredAt: "2026-05-20T09:00:00.000Z" }));
    await repo.save(makeRecord({ recordId: "r3", glucoseMgDl: 220, signalLevel: "red", earnedMileage: 0, measuredAt: "2026-05-20T10:00:00.000Z" }));

    const qr = await makeQrToken();
    const summary = await getDashboardData({
      qrToken: qr.qrToken,
      nowIso: "2026-05-20T10:05:00.000Z",
      signing: SIGNING,
      repository: repo,
    });

    expect(summary.stats.totalRecords).toBe(3);
    expect(summary.stats.avgGlucoseMgDl).toBe(140); // (90+110+220)/3
    expect(summary.stats.signalDistribution.green).toBe(1);
    expect(summary.stats.signalDistribution.yellow).toBe(1);
    expect(summary.stats.signalDistribution.red).toBe(1);
    expect(summary.stats.totalMileage).toBe(15);
    expect(summary.stats.greenRate).toBeCloseTo(0.333, 2);
  });

  it("alerts on high risk latest signal", async () => {
    await repo.save(makeRecord({ recordId: "r1", signalLevel: "red", measuredAt: "2026-05-20T10:00:00.000Z" }));

    const qr = await makeQrToken();
    const summary = await getDashboardData({
      qrToken: qr.qrToken,
      nowIso: "2026-05-20T10:05:00.000Z",
      signing: SIGNING,
      repository: repo,
    });

    expect(summary.alerts.hasHighRiskSignal).toBe(true);
    expect(summary.alerts.latestSignal).toBe("red");
  });

  it("counts consecutive red signals", async () => {
    await repo.save(makeRecord({ recordId: "r1", signalLevel: "red", measuredAt: "2026-05-20T08:00:00.000Z" }));
    await repo.save(makeRecord({ recordId: "r2", signalLevel: "red", measuredAt: "2026-05-20T09:00:00.000Z" }));
    await repo.save(makeRecord({ recordId: "r3", signalLevel: "green", measuredAt: "2026-05-20T07:00:00.000Z" }));

    const qr = await makeQrToken();
    const summary = await getDashboardData({
      qrToken: qr.qrToken,
      nowIso: "2026-05-20T10:05:00.000Z",
      signing: SIGNING,
      repository: repo,
    });

    expect(summary.alerts.consecutiveRedCount).toBe(2);
  });

  it("returns only recentLimit records in recentRecords but all in stats", async () => {
    for (let i = 0; i < 15; i++) {
      await repo.save(makeRecord({
        recordId: `r${i}`,
        measuredAt: `2026-05-20T${String(i).padStart(2, "0")}:00:00.000Z`,
      }));
    }

    const qr = await makeQrToken("u1", "2026-05-20T16:00:00.000Z");
    const summary = await getDashboardData({
      qrToken: qr.qrToken,
      nowIso: "2026-05-20T16:05:00.000Z",
      signing: SIGNING,
      repository: repo,
      recentLimit: 5,
    });

    expect(summary.recentRecords).toHaveLength(5);
    expect(summary.stats.totalRecords).toBe(15);
  });
});

describe("phase4 saveBloodSugarRecord", () => {
  it("persists record to repository", async () => {
    const repo = new InMemoryBloodSugarRepository();
    const rec = makeRecord({ recordId: "rec-save-test" });
    await saveBloodSugarRecord(rec, repo);
    expect(await repo.findById("rec-save-test")).toEqual(rec);
  });
});
