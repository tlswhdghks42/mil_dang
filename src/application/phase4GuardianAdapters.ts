import { PushSender, SmsSender } from "./phase2GuardianChannel";
import { GuardianSyncPayload } from "../domain/types";

// ──────────────────────────────────────────────
// FCM HTTP v1 PushSender
// ──────────────────────────────────────────────
export interface FcmConfig {
  projectId: string;
  accessToken: string;
  endpoint?: string;
}

type HttpFetcher = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class FcmPushSender implements PushSender {
  private readonly endpoint: string;

  constructor(
    private readonly config: FcmConfig,
    private readonly fetcher: HttpFetcher,
  ) {
    this.endpoint =
      config.endpoint ??
      `https://fcm.googleapis.com/v1/projects/${config.projectId}/messages:send`;
  }

  async send(args: {
    guardianUserId: string;
    title: string;
    body: string;
    data: Record<string, string>;
  }): Promise<{ messageId: string }> {
    const res = await this.fetcher(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token: args.guardianUserId,
          notification: { title: args.title, body: args.body },
          data: args.data,
          android: { priority: "high" },
        },
      }),
    });

    // Buffer response body once — HTTP Response body is a single-consumption stream
    const body = await res.json().catch(() => null) as Record<string, unknown> | null;
    if (!res.ok) {
      throw new Error(`FCM 전송 실패 (${res.status}): ${JSON.stringify(body ?? {})}`);
    }
    return { messageId: (body?.name as string | undefined) ?? `fcm-${Date.now()}` };
  }
}

// ──────────────────────────────────────────────
// 알리고 SMS SmsSender
// ──────────────────────────────────────────────
export interface AligoConfig {
  apiKey: string;
  userId: string;
  sender: string;
  endpoint?: string;
}

const ALIGO_ENDPOINT = "https://apis.aligo.in/send/";

export class AligoSmsSender implements SmsSender {
  constructor(
    private readonly config: AligoConfig,
    private readonly fetcher: HttpFetcher,
  ) {}

  async send(args: { phoneNumber: string; message: string }): Promise<{ messageId: string }> {
    const body = new URLSearchParams({
      key: this.config.apiKey,
      user_id: this.config.userId,
      sender: this.config.sender,
      receiver: args.phoneNumber,
      msg: args.message,
      msg_type: "SMS",
    });

    const res = await this.fetcher(this.config.endpoint ?? ALIGO_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      throw new Error(`알리고 SMS 전송 실패 (${res.status})`);
    }

    const json = (await res.json()) as { result_code?: number; message?: string; msg_id?: string };
    if ((json.result_code ?? 0) < 1) {
      throw new Error(`알리고 SMS 오류: ${json.message ?? json.result_code}`);
    }

    return { messageId: json.msg_id ?? `aligo-${Date.now()}` };
  }
}

// ──────────────────────────────────────────────
// 실시간 보호자 알림 채널 (SSE/WebSocket 추상화)
// ──────────────────────────────────────────────
export interface GuardianRealtimeEvent {
  eventType: "blood_sugar_measured" | "safety_alert" | "resolved";
  payload: GuardianSyncPayload;
  emittedAt: string;
}

export interface GuardianRealtimeChannel {
  emit(guardianUserId: string, event: GuardianRealtimeEvent): Promise<void>;
  hasConnection(guardianUserId: string): boolean;
}

// 테스트 및 개발용 인메모리 채널 (실제 배포 시 SSE/WebSocket 구현체로 교체)
export class InMemoryGuardianChannel implements GuardianRealtimeChannel {
  private connections = new Set<string>();
  private log: Array<{ guardianUserId: string; event: GuardianRealtimeEvent }> = [];

  connect(guardianUserId: string): void {
    this.connections.add(guardianUserId);
  }

  disconnect(guardianUserId: string): void {
    this.connections.delete(guardianUserId);
  }

  hasConnection(guardianUserId: string): boolean {
    return this.connections.has(guardianUserId);
  }

  async emit(guardianUserId: string, event: GuardianRealtimeEvent): Promise<void> {
    if (!this.connections.has(guardianUserId)) return;
    this.log.push({ guardianUserId, event });
  }

  getLog(): Array<{ guardianUserId: string; event: GuardianRealtimeEvent }> {
    return [...this.log];
  }

  clearLog(): void {
    this.log = [];
  }
}

// 혈당 측정 후 보호자 실시간 + 채널 알림을 동시에 발송
export async function notifyGuardiansOnMeasurement(args: {
  payload: GuardianSyncPayload;
  guardianIds: string[];
  realtimeChannel: GuardianRealtimeChannel;
  nowIso?: string;
}): Promise<{ realtime: number; skipped: number; allSkippedHighRisk: boolean }> {
  const nowIso = args.nowIso ?? new Date().toISOString();
  const event: GuardianRealtimeEvent = {
    eventType: args.payload.requiresAttention ? "safety_alert" : "blood_sugar_measured",
    payload: args.payload,
    emittedAt: nowIso,
  };

  let realtime = 0;
  let skipped = 0;

  for (const gId of args.guardianIds) {
    if (args.realtimeChannel.hasConnection(gId)) {
      await args.realtimeChannel.emit(gId, event);
      realtime++;
    } else {
      skipped++;
    }
  }

  // requiresAttention=true 인데 연결된 보호자가 없으면 caller가 감지할 수 있도록 플래그 반환
  const allSkippedHighRisk = args.payload.requiresAttention && realtime === 0 && args.guardianIds.length > 0;
  return { realtime, skipped, allSkippedHighRisk };
}

// 환경변수 기반 FCM 설정 로더
export function loadFcmConfigFromEnv(): FcmConfig {
  const projectId = process.env.FCM_PROJECT_ID ?? "";
  const accessToken = process.env.FCM_ACCESS_TOKEN ?? "";
  if (!projectId || !accessToken) {
    throw new Error("FCM_PROJECT_ID, FCM_ACCESS_TOKEN 환경변수가 필요합니다.");
  }
  return { projectId, accessToken };
}

// 환경변수 기반 알리고 설정 로더
export function loadAligoConfigFromEnv(): AligoConfig {
  const apiKey = process.env.ALIGO_API_KEY ?? "";
  const userId = process.env.ALIGO_USER_ID ?? "";
  const sender = process.env.ALIGO_SENDER ?? "";
  if (!apiKey || !userId || !sender) {
    throw new Error("ALIGO_API_KEY, ALIGO_USER_ID, ALIGO_SENDER 환경변수가 필요합니다.");
  }
  return { apiKey, userId, sender };
}
