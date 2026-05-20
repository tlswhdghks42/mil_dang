export interface LlmCallMetric {
  callId: string;
  promptVersion: string;
  signal: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  success: boolean;
  failureReason?: string;
  guardrailPassed: boolean;
  recordedAt: string;
}

export interface MetricsSummary {
  totalCalls: number;
  successCount: number;
  failureCount: number;
  failureRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  guardrailFailRate: number;
}

export interface MetricsSink {
  record(metric: LlmCallMetric): void;
}

export class InMemoryMetricsCollector implements MetricsSink {
  private metrics: LlmCallMetric[] = [];
  private counter = 0;

  constructor(private readonly maxSize = 10_000) {}

  generateCallId(): string {
    return `call-${++this.counter}-${Date.now()}`;
  }

  record(metric: LlmCallMetric): void {
    if (this.metrics.length >= this.maxSize) {
      this.metrics.shift();
    }
    this.metrics.push(metric);
  }

  getAll(): LlmCallMetric[] {
    return [...this.metrics];
  }

  clear(): void {
    this.metrics = [];
    this.counter = 0;
  }

  summary(): MetricsSummary {
    const total = this.metrics.length;
    if (total === 0) {
      return {
        totalCalls: 0,
        successCount: 0,
        failureCount: 0,
        failureRate: 0,
        avgLatencyMs: 0,
        p95LatencyMs: 0,
        avgInputTokens: 0,
        avgOutputTokens: 0,
        guardrailFailRate: 0,
      };
    }

    const failures = this.metrics.filter((m) => !m.success);
    const guardrailFails = this.metrics.filter((m) => m.success && !m.guardrailPassed);
    const latencies = [...this.metrics.map((m) => m.latencyMs)].sort((a, b) => a - b);
    // ceil 기반 nearest-rank: floor는 N=20일 때 index 19(100th percentile)를 반환하는 문제
    const p95Idx = Math.min(Math.ceil(latencies.length * 0.95) - 1, latencies.length - 1);

    return {
      totalCalls: total,
      successCount: total - failures.length,
      failureCount: failures.length,
      failureRate: failures.length / total,
      avgLatencyMs: latencies.reduce((a, b) => a + b, 0) / total,
      p95LatencyMs: latencies[p95Idx],
      avgInputTokens: this.metrics.reduce((a, m) => a + m.inputTokens, 0) / total,
      avgOutputTokens: this.metrics.reduce((a, m) => a + m.outputTokens, 0) / total,
      guardrailFailRate: guardrailFails.length / total,
    };
  }
}
