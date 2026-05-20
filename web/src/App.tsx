import { useState } from "react";
import type { LlmClient } from "@core/application/phase3InterventionLLM";
import {
  Phase1State,
  initialPhase1State,
  updateInput,
  analyzeAndMoveResultWithLlm,
  goHome,
} from "@core/application/phase1Controller";
import type { MealTiming } from "@core/domain/types";
import styles from "./App.module.css";

const USER_ID = "web-user-001";

const MEAL_TIMING_LABELS: Record<MealTiming, string> = {
  fasting: "공복",
  postprandial: "식후 2시간",
};

const SIGNAL_CONFIG = {
  critical_low: { emoji: "🆘", bg: "#FFCDD2", label: "매우 위험 (저혈당)", color: "#B71C1C" },
  low:          { emoji: "🔵", bg: "#E3F2FD", label: "주의 (저혈당 경계)", color: "#1565C0" },
  green:        { emoji: "🟢", bg: "#E8F5E9", label: "정상",               color: "#2E7D32" },
  yellow:       { emoji: "🟡", bg: "#FFF8E1", label: "주의 (혈당 경계)",   color: "#F57F17" },
  red:          { emoji: "🔴", bg: "#FFEBEE", label: "위험 (고혈당)",      color: "#C62828" },
};

function createLlmClient(): LlmClient {
  return {
    async complete(prompt: string): Promise<string> {
      try {
        const res = await fetch("/api/llm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "llama-3.1-8b-instant",
            max_tokens: 256,
            messages: [{ role: "user", content: prompt }],
          }),
        });
        if (!res.ok) return "";
        const json = await res.json() as { choices: Array<{ message: { content: string } }> };
        return json.choices[0]?.message.content ?? "";
      } catch {
        return "";
      }
    },
  };
}

const llmClient = createLlmClient();

export default function App() {
  const [state, setState] = useState<Phase1State>(initialPhase1State);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleMeasure() {
    if (!state.glucoseText.trim()) {
      setError("혈당 수치를 입력해 주세요.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const next = await analyzeAndMoveResultWithLlm(
        state,
        new Date().toISOString(),
        { llmClient },
        USER_ID,
      );
      setState(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  if (state.screen === "result" && state.signal) {
    const cfg = SIGNAL_CONFIG[state.signal];
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <h1 className={styles.headerTitle}>밀당</h1>
          <p className={styles.headerSub}>수영구 어르신 혈당 관리</p>
        </header>
        <main className={styles.main}>
          <div className={styles.signalCard} style={{ background: cfg.bg }}>
            <span className={styles.signalEmoji}>{cfg.emoji}</span>
            <p className={styles.signalLabel} style={{ color: cfg.color }}>{cfg.label}</p>
            <p className={styles.glucoseValue}>{state.glucoseText} mg/dL</p>
          </div>
          <div className={styles.interventionBox}>
            <p className={styles.interventionText}>{state.interventionText}</p>
          </div>
          {state.showNurseCallButton && (
            <button
              className={styles.nurseButton}
              onClick={() => alert("보건소에 연락 중입니다.")}
            >
              📞 간호사 호출
            </button>
          )}
          <button className={styles.retryButton} onClick={() => setState(goHome(state))}>
            다시 측정하기
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.headerTitle}>밀당</h1>
        <p className={styles.headerSub}>수영구 어르신 혈당 관리</p>
      </header>
      <main className={styles.main}>
        <h2 className={styles.title}>혈당 입력</h2>
        <p className={styles.subtitle}>수영구 어르신 맞춤 혈당 관리</p>

        <label className={styles.label}>혈당 수치 (mg/dL)</label>
        <input
          className={styles.input}
          type="number"
          value={state.glucoseText}
          onChange={(e) => setState(updateInput(state, { glucoseText: e.target.value }))}
          placeholder="예: 95"
        />

        <label className={styles.label}>측정 시점</label>
        <div className={styles.timingRow}>
          {(Object.keys(MEAL_TIMING_LABELS) as MealTiming[]).map((t) => (
            <button
              key={t}
              className={`${styles.timingButton} ${state.mealTiming === t ? styles.timingActive : ""}`}
              onClick={() => setState(updateInput(state, { mealTiming: t }))}
            >
              {MEAL_TIMING_LABELS[t]}
            </button>
          ))}
        </div>

        {error && <p className={styles.error}>{error}</p>}

        <button
          className={styles.measureButton}
          onClick={handleMeasure}
          disabled={loading}
        >
          {loading ? "분석 중..." : "측정 결과 확인"}
        </button>
      </main>
    </div>
  );
}
