import { describe, expect, it } from "vitest";
import { classifySignal, followUpMinutesFor, makeSafetyEvent } from "../src/domain/logic";
import { analyzeMeasurement } from "../src/application/phase1Flow";

describe("classifySignal boundaries", () => {
  it("classifies hypo and fasting boundaries", () => {
    expect(classifySignal(53, "fasting")).toBe("critical_low");
    expect(classifySignal(54, "fasting")).toBe("low");
    expect(classifySignal(69, "fasting")).toBe("low");
    expect(classifySignal(70, "fasting")).toBe("green");
    expect(classifySignal(99, "fasting")).toBe("green");
    expect(classifySignal(100, "fasting")).toBe("yellow");
    expect(classifySignal(125, "fasting")).toBe("yellow");
    expect(classifySignal(126, "fasting")).toBe("red");
  });

  it("classifies postprandial boundaries", () => {
    expect(classifySignal(139, "postprandial")).toBe("green");
    expect(classifySignal(140, "postprandial")).toBe("yellow");
    expect(classifySignal(199, "postprandial")).toBe("yellow");
    expect(classifySignal(200, "postprandial")).toBe("red");
  });
});

describe("safety followup logic", () => {
  it("returns follow-up minutes", () => {
    expect(followUpMinutesFor("low")).toBe(15);
    expect(followUpMinutesFor("critical_low")).toBe(15);
    expect(followUpMinutesFor("red")).toBe(30);
    expect(followUpMinutesFor("green")).toBeNull();
  });

  it("creates a safety event with due time", () => {
    const ev = makeSafetyEvent({
      eventId: "e1",
      userId: "u1",
      recordId: "r1",
      signalLevel: "red",
      nowIso: "2026-05-19T00:00:00.000Z",
    });
    expect(ev?.type).toBe("hyper_red");
    expect(ev?.followUpDueAt).toBe("2026-05-19T00:30:00.000Z");
  });
});

describe("phase1 analyze flow", () => {
  it("builds signal and intervention", () => {
    const out = analyzeMeasurement({
      glucoseMgDl: 205,
      mealTiming: "postprandial",
      dietAssessment: "risky",
      hasWeatherRisk: true,
      symptoms: ["어지러움"],
    });
    expect(out.signal).toBe("red");
    expect(out.interventionText.length).toBeGreaterThan(0);
  });
});
