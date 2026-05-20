import { BloodSugarRecord, SignalLevel } from "../domain/types";
import { verifyQrToken, QrSigningConfig } from "./phase2Integration";

// ──────────────────────────────────────────────
// 혈당 기록 저장소 인터페이스
// ──────────────────────────────────────────────
export interface BloodSugarRepository {
  save(record: BloodSugarRecord): Promise<void>;
  findByUserId(userId: string, limit?: number): Promise<BloodSugarRecord[]>;
  findById(recordId: string): Promise<BloodSugarRecord | undefined>;
  deleteById(recordId: string): Promise<boolean>;
}

export class InMemoryBloodSugarRepository implements BloodSugarRepository {
  private store = new Map<string, BloodSugarRecord>();

  async save(record: BloodSugarRecord): Promise<void> {
    this.store.set(record.recordId, record);
  }

  async findByUserId(userId: string, limit = 10): Promise<BloodSugarRecord[]> {
    return [...this.store.values()]
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))
      .slice(0, limit);
  }

  async findById(recordId: string): Promise<BloodSugarRecord | undefined> {
    return this.store.get(recordId);
  }

  async deleteById(recordId: string): Promise<boolean> {
    return this.store.delete(recordId);
  }

  size(): number {
    return this.store.size;
  }
}

// ──────────────────────────────────────────────
// 대시보드 집계 데이터
// ──────────────────────────────────────────────
export interface SignalDistribution {
  critical_low: number;
  low: number;
  green: number;
  yellow: number;
  red: number;
}

export interface DashboardStats {
  totalRecords: number;
  avgGlucoseMgDl: number;
  signalDistribution: SignalDistribution;
  greenRate: number;
  totalMileage: number;
  lastMeasuredAt: string | null;
}

export interface DashboardAlerts {
  hasHighRiskSignal: boolean;
  latestSignal: SignalLevel | null;
  consecutiveRedCount: number;
}

export interface DashboardSummary {
  userId: string;
  generatedAt: string;
  recentRecords: BloodSugarRecord[];
  stats: DashboardStats;
  alerts: DashboardAlerts;
}

function computeStats(records: BloodSugarRecord[]): DashboardStats {
  if (records.length === 0) {
    return {
      totalRecords: 0,
      avgGlucoseMgDl: 0,
      signalDistribution: { critical_low: 0, low: 0, green: 0, yellow: 0, red: 0 },
      greenRate: 0,
      totalMileage: 0,
      lastMeasuredAt: null,
    };
  }

  const dist: SignalDistribution = { critical_low: 0, low: 0, green: 0, yellow: 0, red: 0 };
  let totalGlucose = 0;
  let totalMileage = 0;

  for (const r of records) {
    dist[r.signalLevel]++;
    totalGlucose += r.glucoseMgDl;
    totalMileage += r.earnedMileage;
  }

  const sorted = [...records].sort((a, b) => b.measuredAt.localeCompare(a.measuredAt));

  return {
    totalRecords: records.length,
    avgGlucoseMgDl: Math.round(totalGlucose / records.length),
    signalDistribution: dist,
    greenRate: Number((dist.green / records.length).toFixed(3)),
    totalMileage,
    lastMeasuredAt: sorted[0]?.measuredAt ?? null,
  };
}

function computeAlerts(recentRecords: BloodSugarRecord[]): DashboardAlerts {
  const latest = recentRecords[0] ?? null;
  const latestSignal = latest?.signalLevel ?? null;
  const hasHighRiskSignal = latestSignal === "red" || latestSignal === "critical_low" || latestSignal === "low";

  let consecutiveRedCount = 0;
  for (const r of recentRecords) {
    if (r.signalLevel === "red") consecutiveRedCount++;
    else break;
  }

  return { hasHighRiskSignal, latestSignal, consecutiveRedCount };
}

// ──────────────────────────────────────────────
// QR 토큰 검증 후 대시보드 데이터 조회
// ──────────────────────────────────────────────
export async function getDashboardData(args: {
  qrToken: string;
  nowIso: string;
  signing: QrSigningConfig;
  repository: BloodSugarRepository;
  recentLimit?: number;
}): Promise<DashboardSummary> {
  const verified = verifyQrToken(args.qrToken, args.nowIso, args.signing);
  if (!verified.valid || !verified.userId) {
    throw new Error("유효하지 않은 QR 토큰입니다. 보건소에서 새 QR을 발급받으세요.");
  }

  const limit = args.recentLimit ?? 10;
  const recentRecords = await args.repository.findByUserId(verified.userId, limit);

  // 전체 통계를 위해 모든 기록 조회 (전체 limit을 크게)
  const allRecords = await args.repository.findByUserId(verified.userId, 1000);

  return {
    userId: verified.userId,
    generatedAt: args.nowIso,
    recentRecords,
    stats: computeStats(allRecords),
    alerts: computeAlerts(recentRecords),
  };
}

// 혈당 기록 저장 헬퍼 (controller에서 사용)
export async function saveBloodSugarRecord(
  record: BloodSugarRecord,
  repository: BloodSugarRepository,
): Promise<void> {
  await repository.save(record);
}
