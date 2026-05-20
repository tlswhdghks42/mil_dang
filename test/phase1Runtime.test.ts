import { describe, expect, it } from "vitest";
import { initialPhase1State } from "../src/application/phase1Controller";
import {
  deserializeState,
  getResultAlertBanner,
  isFollowUpDue,
  loadState,
  saveState,
} from "../src/application/phase1Runtime";

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

describe("phase1 runtime persistence", () => {
  it("saves and loads state", () => {
    const storage = new MemoryStorage();
    const state = { ...initialPhase1State, glucoseText: "123", redRecheckCount: 1 };
    saveState(storage, state);

    const loaded = loadState(storage);
    expect(loaded.glucoseText).toBe("123");
    expect(loaded.redRecheckCount).toBe(1);
  });

  it("falls back to initial state for broken JSON", () => {
    const broken = deserializeState('{"screen":"input"}');
    expect(broken.showNurseCallButton).toBe(false);
    expect(broken.redRecheckCount).toBe(0);
  });
});

describe("phase1 runtime follow-up timer", () => {
  it("detects due follow-up", () => {
    expect(isFollowUpDue("2026-05-19T00:30:00.000Z", "2026-05-19T00:30:00.000Z")).toBe(true);
    expect(isFollowUpDue("2026-05-19T00:30:00.000Z", "2026-05-19T00:29:59.000Z")).toBe(false);
  });

  it("returns alert banner when due", () => {
    const state = {
      ...initialPhase1State,
      latestSafetyEvent: {
        eventId: "e1",
        userId: "u1",
        type: "hyper_red" as const,
        recordId: "r1",
        createdAt: "2026-05-19T00:00:00.000Z",
        followUpDueAt: "2026-05-19T00:30:00.000Z",
        status: "pending" as const,
        escalationTarget: "nurse" as const,
      },
    };

    expect(getResultAlertBanner(state, "2026-05-19T00:31:00.000Z")).toContain("재측정 시간");
    expect(getResultAlertBanner(state, "2026-05-19T00:20:00.000Z")).toBeNull();
  });
});
