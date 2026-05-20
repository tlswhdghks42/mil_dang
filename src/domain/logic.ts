import { MealTiming, SafetyEvent, SignalLevel } from "./types";

export function classifySignal(glucoseMgDl: number, mealTiming: MealTiming): SignalLevel {
  if (glucoseMgDl < 54) return "critical_low";
  if (glucoseMgDl < 70) return "low";

  if (mealTiming === "fasting") {
    if (glucoseMgDl >= 126) return "red";
    if (glucoseMgDl >= 100) return "yellow";
    return "green";
  }

  if (glucoseMgDl >= 200) return "red";
  if (glucoseMgDl >= 140) return "yellow";
  return "green";
}

export function followUpMinutesFor(signal: SignalLevel): number | null {
  switch (signal) {
    case "critical_low":
    case "low":
      return 15;
    case "red":
      return 30;
    default:
      return null;
  }
}

export function makeSafetyEvent(args: {
  eventId: string;
  userId: string;
  recordId: string;
  signalLevel: SignalLevel;
  nowIso: string;
}): SafetyEvent | null {
  const followUp = followUpMinutesFor(args.signalLevel);
  if (!followUp) return null;

  const dueAt = new Date(new Date(args.nowIso).getTime() + followUp * 60_000).toISOString();

  if (args.signalLevel === "critical_low") {
    return {
      eventId: args.eventId,
      userId: args.userId,
      type: "hypo_critical",
      recordId: args.recordId,
      createdAt: args.nowIso,
      followUpDueAt: dueAt,
      status: "pending",
      escalationTarget: "guardian",
    };
  }

  if (args.signalLevel === "low") {
    return {
      eventId: args.eventId,
      userId: args.userId,
      type: "hypo_low",
      recordId: args.recordId,
      createdAt: args.nowIso,
      followUpDueAt: dueAt,
      status: "pending",
    };
  }

  return {
    eventId: args.eventId,
    userId: args.userId,
    type: "hyper_red",
    recordId: args.recordId,
    createdAt: args.nowIso,
    followUpDueAt: dueAt,
    status: "pending",
    escalationTarget: "nurse",
  };
}
