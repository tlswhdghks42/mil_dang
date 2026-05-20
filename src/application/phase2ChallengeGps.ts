import { LocalChallenge } from "../domain/types";

export interface GpsPoint {
  lat: number;
  lng: number;
  accuracyM: number;
  recordedAt: string;
}

export interface ChallengeVerificationRecord {
  verificationId: string;
  challengeId: string;
  userId: string;
  verified: boolean;
  reason: string;
  recordedAt: string;
}

export interface ChallengeVerificationStore {
  save(record: ChallengeVerificationRecord): Promise<void>;
}

export interface GeofenceProvider {
  isWithinRadius(args: { point: GpsPoint; challengeId: string; radiusM: number }): Promise<boolean>;
}

export async function verifyChallengeGps(args: {
  challenge: LocalChallenge;
  userId: string;
  point: GpsPoint;
  geofenceProvider: GeofenceProvider;
  verificationStore?: ChallengeVerificationStore;
}): Promise<boolean> {
  const radiusM = args.challenge.geoFenceRadiusM ?? 120;

  const badAccuracy = args.point.accuracyM > 80;
  if (badAccuracy) {
    if (args.verificationStore) {
      await args.verificationStore.save({
        verificationId: `gps-${Date.parse(args.point.recordedAt)}`,
        challengeId: args.challenge.challengeId,
        userId: args.userId,
        verified: false,
        reason: "GPS 정확도가 낮아 검증 실패",
        recordedAt: args.point.recordedAt,
      });
    }
    return false;
  }

  const isInside = await args.geofenceProvider.isWithinRadius({
    point: args.point,
    challengeId: args.challenge.challengeId,
    radiusM,
  });

  if (args.verificationStore) {
    await args.verificationStore.save({
      verificationId: `gps-${Date.parse(args.point.recordedAt)}`,
      challengeId: args.challenge.challengeId,
      userId: args.userId,
      verified: isInside,
      reason: isInside ? "지오펜스 검증 통과" : "지오펜스 범위 밖",
      recordedAt: args.point.recordedAt,
    });
  }

  return isInside;
}
