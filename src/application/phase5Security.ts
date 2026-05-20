import { BloodSugarRecord, UserProfile } from "../domain/types";

// ──────────────────────────────────────────────
// PII 마스킹
// ──────────────────────────────────────────────
export function maskPhoneNumber(phone: string): string {
  return phone.replace(/(\d{3})\d{3,4}(\d{4})/, "$1****$2");
}

export function maskUserId(userId: string): string {
  if (userId.length <= 4) return "u-****";
  return userId.slice(0, 2) + "****" + userId.slice(-2);
}

export function maskName(name: string): string {
  if (name.length <= 1) return "*";
  if (name.length === 2) return name[0] + "*";
  return name[0] + "*".repeat(name.length - 2) + name[name.length - 1];
}

// ──────────────────────────────────────────────
// 데이터 접근 제어
// ──────────────────────────────────────────────
export class DataAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataAccessError";
  }
}

export function assertDataAccess(requestUserId: string, resourceUserId: string): void {
  if (requestUserId !== resourceUserId) {
    throw new DataAccessError(
      `접근 거부: 사용자 ${maskUserId(requestUserId)}는 ${maskUserId(resourceUserId)}의 데이터에 접근할 수 없습니다.`,
    );
  }
}

export function assertGuardianAccess(guardianId: string, profile: UserProfile): void {
  if (!profile.guardianIds.includes(guardianId)) {
    throw new DataAccessError(
      `접근 거부: ${maskUserId(guardianId)}는 등록된 보호자가 아닙니다.`,
    );
  }
}

// ──────────────────────────────────────────────
// 민감 데이터 새니타이징 (로그용)
// ──────────────────────────────────────────────
export interface SanitizedRecord {
  recordId: string;
  userId: string;       // 마스킹됨
  signalLevel: string;
  glucoseMgDl: number;
  measuredAt: string;
  mealTiming: string;
  earnedMileage: number;
}

export function sanitizeRecordForLog(record: BloodSugarRecord): SanitizedRecord {
  return {
    recordId: record.recordId,
    userId: maskUserId(record.userId),
    signalLevel: record.signalLevel,
    glucoseMgDl: record.glucoseMgDl,
    measuredAt: record.measuredAt,
    mealTiming: record.mealTiming,
    earnedMileage: record.earnedMileage,
    // symptoms, medicationTaken, dietAnalysis 등 민감 필드 제외
  };
}

export function sanitizeProfileForLog(profile: UserProfile): object {
  return {
    userId: maskUserId(profile.userId),
    district: profile.district,
    guardianCount: profile.guardianIds.length,
    // name, birthYear, livesAlone 제외
  };
}

// ──────────────────────────────────────────────
// 감사 로그 (Audit Log)
// ──────────────────────────────────────────────
export type AuditEventType =
  | "data_access"
  | "qr_verify"
  | "qr_verify_failed"
  | "guardian_alert_sent"
  | "guardian_alert_failed"
  | "dashboard_view"
  | "record_saved"
  | "unauthorized_access_attempt";

export interface AuditLogEntry {
  eventId: string;
  eventType: AuditEventType;
  actorId: string;
  resourceUserId: string;
  success: boolean;
  timestamp: string;
  detail?: string;
}

export interface AuditLogStore {
  append(entry: AuditLogEntry): Promise<void>;
}

export class InMemoryAuditLogStore implements AuditLogStore {
  private entries: AuditLogEntry[] = [];
  private counter = 0;

  async append(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }

  generateEventId(): string {
    return `audit-${++this.counter}-${Date.now()}`;
  }

  getAll(): AuditLogEntry[] {
    return [...this.entries];
  }

  findByType(eventType: AuditEventType): AuditLogEntry[] {
    return this.entries.filter((e) => e.eventType === eventType);
  }

  findByResourceUser(userId: string): AuditLogEntry[] {
    return this.entries.filter((e) => e.resourceUserId === userId);
  }

  findFailures(): AuditLogEntry[] {
    return this.entries.filter((e) => !e.success);
  }
}

export async function auditLog(
  store: AuditLogStore,
  entry: Omit<AuditLogEntry, "eventId">,
  generateId: () => string,
): Promise<void> {
  await store.append({ ...entry, eventId: generateId() });
}

// ──────────────────────────────────────────────
// QR 토큰 보안 검증 래퍼 (감사 로그 포함)
// ──────────────────────────────────────────────
import { verifyQrToken, QrSigningConfig } from "./phase2Integration";

export async function verifyQrTokenWithAudit(args: {
  qrToken: string;
  nowIso: string;
  signing: QrSigningConfig;
  requestorId: string;
  auditStore: AuditLogStore;
  generateId: () => string;
}): Promise<{ valid: boolean; userId?: string }> {
  const result = verifyQrToken(args.qrToken, args.nowIso, args.signing);

  await auditLog(
    args.auditStore,
    {
      eventType: result.valid ? "qr_verify" : "qr_verify_failed",
      actorId: maskUserId(args.requestorId),
      resourceUserId: result.userId ? maskUserId(result.userId) : "unknown",
      success: result.valid,
      timestamp: args.nowIso,
      detail: result.valid ? undefined : "QR 토큰 검증 실패",
    },
    args.generateId,
  );

  return result;
}

// ──────────────────────────────────────────────
// 민감 정보 포함 여부 스캔 (LLM 출력 검증용)
// ──────────────────────────────────────────────
const PII_PATTERNS = [
  /\d{3}-\d{3,4}-\d{4}/,          // 전화번호
  /\d{6}-[1-4]\d{6}/,             // 주민등록번호
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/, // 이메일
];

export function containsPii(text: string): boolean {
  return PII_PATTERNS.some((pattern) => pattern.test(text));
}

export function redactPii(text: string): string {
  let result = text;
  result = result.replace(/\d{3}-\d{3,4}-\d{4}/g, "[전화번호 삭제]");
  result = result.replace(/\d{6}-[1-4]\d{6}/g, "[주민번호 삭제]");
  result = result.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[이메일 삭제]");
  return result;
}
