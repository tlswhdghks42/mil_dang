import { createHmac, timingSafeEqual } from "node:crypto";
import { QrDashboardMapping, GuardianSyncPayload, BloodSugarRecord, LocalChallenge } from "../domain/types";

export interface QrSigningConfig {
  secret: string;
  issuer?: string;
  audience?: string;
}

interface QrTokenPayload {
  userId: string;
  exp: string;
  iat: string;
  iss: string;
  aud: string;
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(payloadBase64Url: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadBase64Url).digest("base64url");
}

export function createQrDashboardMapping(args: {
  userId: string;
  dashboardBaseUrl: string;
  nowIso: string;
  ttlMinutes?: number;
  signing: QrSigningConfig;
}): QrDashboardMapping {
  const ttl = args.ttlMinutes ?? 10;
  const expiresAt = new Date(new Date(args.nowIso).getTime() + ttl * 60_000).toISOString();
  const payload: QrTokenPayload = {
    userId: args.userId,
    iat: args.nowIso,
    exp: expiresAt,
    iss: args.signing.issuer ?? "mildang",
    aud: args.signing.audience ?? "suyeong-health-dashboard",
  };

  const payloadEncoded = encodeBase64Url(JSON.stringify(payload));
  const signature = signPayload(payloadEncoded, args.signing.secret);
  const qrToken = `${payloadEncoded}.${signature}`;

  return {
    userId: args.userId,
    qrToken,
    expiresAt,
    dashboardUrl: `${args.dashboardBaseUrl}?token=${encodeURIComponent(qrToken)}`,
  };
}

export function verifyQrToken(token: string, nowIso: string, signing: QrSigningConfig): { valid: boolean; userId?: string } {
  const [payloadEncoded, signature] = token.split(".");
  if (!payloadEncoded || !signature) return { valid: false };

  const expected = signPayload(payloadEncoded, signing.secret);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false };
  }

  const parsed = JSON.parse(decodeBase64Url(payloadEncoded)) as QrTokenPayload;
  if (!parsed.userId || !parsed.exp || !parsed.iss || !parsed.aud) return { valid: false };

  const expectedIssuer = signing.issuer ?? "mildang";
  const expectedAudience = signing.audience ?? "suyeong-health-dashboard";
  if (parsed.iss !== expectedIssuer) return { valid: false };
  if (parsed.aud !== expectedAudience) return { valid: false };

  if (new Date(nowIso).getTime() > new Date(parsed.exp).getTime()) return { valid: false };

  return { valid: true, userId: parsed.userId };
}

export function shouldDoubleMileageByChallenge(args: {
  challenge: LocalChallenge;
  walkedSteps?: number;
  visitedGeofence?: boolean;
}): boolean {
  const stepPass = typeof args.challenge.requiredSteps === "number"
    ? (args.walkedSteps ?? 0) >= args.challenge.requiredSteps
    : false;
  const geoPass = args.challenge.geoFenceRadiusM ? Boolean(args.visitedGeofence) : false;
  return stepPass || geoPass;
}

export function buildGuardianSyncPayload(record: BloodSugarRecord, mileageTotal: number): GuardianSyncPayload {
  const requiresAttention =
    record.signalLevel === "red" || record.signalLevel === "critical_low" || record.signalLevel === "low";
  return {
    userId: record.userId,
    measuredAt: record.measuredAt,
    signalLevel: record.signalLevel,
    glucoseMgDl: record.glucoseMgDl,
    mileageTotal,
    requiresAttention,
    summary: requiresAttention
      ? "주의가 필요한 혈당 상태가 감지되었습니다. 측정 결과를 확인해주세요."
      : "혈당이 안정 구간입니다. 오늘도 잘 관리 중입니다.",
  };
}
