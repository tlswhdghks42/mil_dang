import { describe, expect, it } from "vitest";
import {
  analyzeAndMoveResult,
  getFollowUpDueText,
  goHome,
  goToInput,
  initialPhase1State,
  nextFromResult,
  updateInput,
} from "../src/application/phase1Controller";

describe("phase1 controller transitions", () => {
  it("moves home -> input -> result -> exit -> home", () => {
    let s = initialPhase1State;
    s = goToInput(s);
    expect(s.screen).toBe("input");

    s = updateInput(s, { mealTiming: "postprandial", glucoseText: "210" });
    s = analyzeAndMoveResult(s, "2026-05-19T00:00:00.000Z");
    expect(s.screen).toBe("result");
    expect(s.signal).toBe("red");

    s = nextFromResult(s);
    expect(s.screen).toBe("exit");

    s = goHome(s);
    expect(s.screen).toBe("home");
  });

  it("shows nurse button after consecutive red recheck", () => {
    let s = goToInput(initialPhase1State);
    s = updateInput(s, { mealTiming: "postprandial", glucoseText: "210" });
    s = analyzeAndMoveResult(s, "2026-05-19T00:00:00.000Z");
    expect(s.showNurseCallButton).toBe(false);

    s = updateInput(s, { glucoseText: "220" });
    s = analyzeAndMoveResult(s, "2026-05-19T00:31:00.000Z");
    expect(s.showNurseCallButton).toBe(true);
  });

  it("returns follow-up due text by signal", () => {
    let s = goToInput(initialPhase1State);
    s = updateInput(s, { mealTiming: "fasting", glucoseText: "60" });
    s = analyzeAndMoveResult(s, "2026-05-19T00:00:00.000Z");
    expect(getFollowUpDueText(s)).toBe("15분 후 재측정이 필요해요.");
  });
});
