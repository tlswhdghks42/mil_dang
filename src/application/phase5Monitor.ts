import { InMemoryMetricsCollector, MetricsSummary } from "./phase3Metrics";
import {
  GuardianSyncPayload,
} from "../domain/types";
import {
  GuardianContact,
  GuardianChannelSenders,
  RetryPolicy,
  sendGuardianAlert,
  FailedGuardianEvent,
} from "./phase2GuardianChannel";

// ──────────────────────────────────────────────
// 시스템 헬스 상태
// ──────────────────────────────────────────────
export type HealthStatus = "healthy" | "degraded" | "critical";

export interface LlmHealthStatus {
  failureRate: number;
  guardrailFailRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  totalCalls: number;
  status: HealthStatus;
}

export interface GuardianHealthStatus {
  failedAlertsCount: number;
  pendingRetries: number;
  status: HealthStatus;
}

export interface SystemHealthReport {
  llm: LlmHealthStatus;
  guardian: GuardianHealthStatus;
  overall: HealthStatus;
  generatedAt: string;
}

const LLM_THRESHOLDS = {
  degraded: { failureRate: 0.1, guardrailFailRate: 0.05, p95LatencyMs: 5000 },
  critical: { failureRate: 0.3, guardrailFailRate: 0.15, p95LatencyMs: 15000 },
};

function classifyLlmHealth(summary: MetricsSummary): HealthStatus {
  if (summary.totalCalls === 0) return "healthy";
  if (
    summary.failureRate >= LLM_THRESHOLDS.critical.failureRate ||
    summary.guardrailFailRate >= LLM_THRESHOLDS.critical.guardrailFailRate ||
    summary.p95LatencyMs >= LLM_THRESHOLDS.critical.p95LatencyMs
  ) return "critical";
  if (
    summary.failureRate >= LLM_THRESHOLDS.degraded.failureRate ||
    summary.guardrailFailRate >= LLM_THRESHOLDS.degraded.guardrailFailRate ||
    summary.p95LatencyMs >= LLM_THRESHOLDS.degraded.p95LatencyMs
  ) return "degraded";
  return "healthy";
}

function worstStatus(...statuses: HealthStatus[]): HealthStatus {
  if (statuses.includes("critical")) return "critical";
  if (statuses.includes("degraded")) return "degraded";
  return "healthy";
}

export function generateHealthReport(args: {
  metricsCollector: InMemoryMetricsCollector;
  recoveryQueue: AlertRecoveryQueue;
  failedAlertStore: FailedGuardianEvent[];
  nowIso?: string;
}): SystemHealthReport {
  const summary = args.metricsCollector.summary();
  const llmStatus = classifyLlmHealth(summary);

  const guardianFailed = args.failedAlertStore.length;
  const pendingRetries = args.recoveryQueue.size();
  const guardianStatus: HealthStatus =
    guardianFailed + pendingRetries >= 10 ? "critical" :
    guardianFailed + pendingRetries >= 3 ? "degraded" : "healthy";

  return {
    llm: {
      failureRate: summary.failureRate,
      guardrailFailRate: summary.guardrailFailRate,
      avgLatencyMs: summary.avgLatencyMs,
      p95LatencyMs: summary.p95LatencyMs,
      totalCalls: summary.totalCalls,
      status: llmStatus,
    },
    guardian: {
      failedAlertsCount: guardianFailed,
      pendingRetries,
      status: guardianStatus,
    },
    overall: worstStatus(llmStatus, guardianStatus),
    generatedAt: args.nowIso ?? new Date().toISOString(),
  };
}

// ──────────────────────────────────────────────
// 보호자 알림 재발송 큐
// ──────────────────────────────────────────────
export interface RecoveryQueueItem {
  id: string;
  payload: GuardianSyncPayload;
  contact: GuardianContact;
  enqueuedAt: string;
  attempts: number;
  lastFailureReason?: string;
}

export interface RecoveryResult {
  succeeded: number;
  failed: number;
  remaining: number;
}

export class AlertRecoveryQueue {
  private queue: RecoveryQueueItem[] = [];
  private counter = 0;

  enqueue(item: Omit<RecoveryQueueItem, "id" | "attempts">): void {
    this.queue.push({ ...item, id: `retry-${++this.counter}`, attempts: 0 });
  }

  size(): number {
    return this.queue.length;
  }

  getAll(): RecoveryQueueItem[] {
    return [...this.queue];
  }

  async processAll(
    senders: GuardianChannelSenders,
    retryPolicy?: RetryPolicy,
  ): Promise<RecoveryResult> {
    const remaining: RecoveryQueueItem[] = [];
    let succeeded = 0;
    let failed = 0;

    for (const item of this.queue) {
      const result = await sendGuardianAlert({
        payload: item.payload,
        contact: item.contact,
        senders,
        retryPolicy,
      });

      if (result.success) {
        succeeded++;
      } else {
        failed++;
        remaining.push({
          ...item,
          attempts: item.attempts + 1,
          lastFailureReason: result.errorMessage,
        });
      }
    }

    this.queue = remaining;
    return { succeeded, failed, remaining: remaining.length };
  }

  // 최대 재시도 횟수 초과 항목 제거 후 반환
  pruneExhausted(maxAttempts: number): RecoveryQueueItem[] {
    const exhausted = this.queue.filter((i) => i.attempts >= maxAttempts);
    this.queue = this.queue.filter((i) => i.attempts < maxAttempts);
    return exhausted;
  }
}

// ──────────────────────────────────────────────
// 알림 누락 감지기
// ──────────────────────────────────────────────
export interface MissedAlertDetectionResult {
  missedCount: number;
  missedEvents: FailedGuardianEvent[];
  enqueuedForRetry: number;
}

export function detectAndEnqueueMissedAlerts(args: {
  failedEvents: FailedGuardianEvent[];
  contactMap: Map<string, GuardianContact>;
  payloadMap: Map<string, GuardianSyncPayload>;
  recoveryQueue: AlertRecoveryQueue;
  nowIso: string;
  maxAgeMs?: number;
}): MissedAlertDetectionResult {
  const maxAgeMs = args.maxAgeMs ?? 30 * 60 * 1000; // 기본 30분
  const cutoff = new Date(args.nowIso).getTime() - maxAgeMs;

  const recent = args.failedEvents.filter(
    (e) => new Date(e.occurredAt).getTime() >= cutoff,
  );

  let enqueuedForRetry = 0;
  for (const event of recent) {
    const contact = args.contactMap.get(event.guardianUserId);
    const payload = args.payloadMap.get(event.guardianUserId);
    if (contact && payload) {
      args.recoveryQueue.enqueue({
        payload,
        contact,
        enqueuedAt: args.nowIso,
        lastFailureReason: event.reason,
      });
      enqueuedForRetry++;
    }
  }

  return {
    missedCount: recent.length,
    missedEvents: recent,
    enqueuedForRetry,
  };
}
