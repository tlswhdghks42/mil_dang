export type MealTiming = "fasting" | "postprandial";

export type SignalLevel =
  | "critical_low"
  | "low"
  | "green"
  | "yellow"
  | "red";

export interface UserProfile {
  userId: string;
  name: string;
  district: "부산광역시 수영구";
  guardianIds: string[];
  birthYear?: number;
  livesAlone?: boolean;
}

export interface WeatherSnapshot {
  district: "수영구";
  observedAt: string;
  temperatureC: number;
  condition: "clear" | "rain" | "snow" | "heatwave" | "coldwave" | "dusty";
  riskFlags: Array<"heatwave" | "coldwave" | "air_quality_bad">;
}

export interface DietAnalysis {
  rawSpeechText?: string;
  normalizedText?: string;
  glycemicAssessment: "good" | "neutral" | "risky";
  reasons: string[];
  recommendedActions: string[];
  confidence: number;
}

export interface BloodSugarRecord {
  recordId: string;
  userId: string;
  measuredAt: string;
  mealTiming: MealTiming;
  glucoseMgDl: number;
  inputMethod: "keypad" | "voice";
  symptoms?: string[];
  lastMealAt?: string;
  medicationTaken?: boolean;
  dietAnalysis?: DietAnalysis;
  weatherAtMeasurement?: WeatherSnapshot;
  signalLevel: SignalLevel;
  aiInterventionText: string;
  earnedMileage: number;
  localChallengeApplied?: {
    challengeId: string;
    multiplier: number;
    proof: "gps" | "steps";
  };
}

export interface SafetyEvent {
  eventId: string;
  userId: string;
  type: "hypo_low" | "hypo_critical" | "hyper_red";
  recordId: string;
  createdAt: string;
  followUpDueAt: string;
  status: "pending" | "resolved" | "escalated";
  escalationTarget?: "guardian" | "nurse" | "ems119";
}

export interface MileageLedger {
  userId: string;
  totalMileage: number;
  updatedAt: string;
}

export interface LocalChallenge {
  challengeId: string;
  name: string;
  place: "광안리 해변 산책로" | "수영사적공원";
  requiredSteps?: number;
  geoFenceRadiusM?: number;
}

export interface QrDashboardMapping {
  userId: string;
  qrToken: string;
  expiresAt: string;
  dashboardUrl: string;
}

export interface GuardianSyncPayload {
  userId: string;
  measuredAt: string;
  signalLevel: SignalLevel;
  glucoseMgDl: number;
  mileageTotal: number;
  requiresAttention: boolean;
  summary: string;
}
