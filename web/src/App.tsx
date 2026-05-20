import { useEffect, useRef, useState } from "react";
import type { LlmClient } from "@core/application/phase3InterventionLLM";
import type { WeatherSnapshot } from "@core/domain/types";
import {
  Phase1State,
  initialPhase1State,
  updateInput,
  analyzeAndMoveResultWithLlm,
  goHome,
} from "@core/application/phase1Controller";
import type { MealTiming } from "@core/domain/types";
import styles from "./App.module.css";

// ── 타입 ──────────────────────────────────────────────────────────────────────

interface Measurement {
  id: string;
  glucose: number;
  meal_timing: string;
  signal: string;
  temperature_c: number | null;
  weather_condition: string | null;
  created_at: string;
}

// ── 사용자 ID (localStorage 영속) ────────────────────────────────────────────

function getUserId(): string {
  const key = "mildang_user_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(key, id);
  }
  return id;
}

// ── LLM 클라이언트 ───────────────────────────────────────────────────────────

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
      } catch { return ""; }
    },
  };
}

const llmClient = createLlmClient();

// ── 상수 ──────────────────────────────────────────────────────────────────────

const MEAL_LABELS: Record<MealTiming, string> = {
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

const WEATHER_EMOJI: Record<string, string> = {
  clear: "☀️", rain: "🌧️", snow: "❄️", heatwave: "🥵", coldwave: "🥶", dusty: "😷",
};

const SIGNAL_KO: Record<string, string> = {
  critical_low: "매우 위험", low: "저혈당 주의", green: "정상", yellow: "경계", red: "고혈당 위험",
};

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

type Tab = "measure" | "history";

export default function App() {
  const [tab, setTab] = useState<Tab>("measure");
  const [state, setState] = useState<Phase1State>(initialPhase1State);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [history, setHistory] = useState<Measurement[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const userId = useRef(getUserId());

  // 날씨 로드
  useEffect(() => {
    fetch("/api/weather")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => d && setWeather(d as WeatherSnapshot))
      .catch(() => null);
  }, []);

  // 히스토리 탭 전환 시 로드
  useEffect(() => {
    if (tab !== "history") return;
    setHistoryLoading(true);
    fetch(`/api/measurements?userId=${encodeURIComponent(userId.current)}`)
      .then((r) => r.ok ? r.json() : [])
      .then((d) => setHistory(d as Measurement[]))
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false));
  }, [tab]);

  async function handleMeasure() {
    if (!state.glucoseText.trim()) { setError("혈당 수치를 입력해 주세요."); return; }
    setError("");
    setLoading(true);
    try {
      const next = await analyzeAndMoveResultWithLlm(
        state,
        new Date().toISOString(),
        { llmClient, weather: weather ?? undefined },
        userId.current,
      );
      setState(next);

      // 측정 결과 저장
      await fetch("/api/measurements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: userId.current,
          glucose: Number(next.glucoseText),
          mealTiming: next.mealTiming,
          signal: next.signal,
          interventionText: next.interventionText,
          temperatureC: weather?.temperatureC ?? null,
          weatherCondition: weather?.condition ?? null,
        }),
      }).catch(() => null); // 저장 실패해도 UX에 영향 없게
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.headerTitle}>밀당</h1>
          <p className={styles.headerSub}>수영구 어르신 혈당 관리</p>
        </div>
        {weather && (
          <div className={styles.weatherBadge}>
            <span>{WEATHER_EMOJI[weather.condition] ?? "🌤️"}</span>
            <span>{weather.temperatureC.toFixed(1)}°C</span>
            {weather.riskFlags.length > 0 && (
              <span className={styles.weatherRisk}>
                {weather.riskFlags.includes("heatwave") ? "폭염 주의" : "한파 주의"}
              </span>
            )}
          </div>
        )}
      </header>

      <nav className={styles.tabBar}>
        <button
          className={`${styles.tabBtn} ${tab === "measure" ? styles.tabActive : ""}`}
          onClick={() => setTab("measure")}
        >
          혈당 측정
        </button>
        <button
          className={`${styles.tabBtn} ${tab === "history" ? styles.tabActive : ""}`}
          onClick={() => setTab("history")}
        >
          측정 기록
        </button>
      </nav>

      {tab === "measure" ? (
        <MeasureTab
          state={state}
          setState={setState}
          loading={loading}
          error={error}
          onMeasure={handleMeasure}
        />
      ) : (
        <HistoryTab history={history} loading={historyLoading} />
      )}
    </div>
  );
}

// ── 측정 탭 ──────────────────────────────────────────────────────────────────

function MeasureTab({
  state, setState, loading, error, onMeasure,
}: {
  state: Phase1State;
  setState: (s: Phase1State) => void;
  loading: boolean;
  error: string;
  onMeasure: () => void;
}) {
  if (state.screen === "result" && state.signal) {
    const cfg = SIGNAL_CONFIG[state.signal];
    return (
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
          <button className={styles.nurseButton} onClick={() => alert("보건소에 연락 중입니다.")}>
            📞 간호사 호출
          </button>
        )}
        <button className={styles.retryButton} onClick={() => setState(goHome(state))}>
          다시 측정하기
        </button>
      </main>
    );
  }

  return (
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
        {(Object.keys(MEAL_LABELS) as MealTiming[]).map((t) => (
          <button
            key={t}
            className={`${styles.timingButton} ${state.mealTiming === t ? styles.timingActive : ""}`}
            onClick={() => setState(updateInput(state, { mealTiming: t }))}
          >
            {MEAL_LABELS[t]}
          </button>
        ))}
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <button className={styles.measureButton} onClick={onMeasure} disabled={loading}>
        {loading ? "분석 중..." : "측정 결과 확인"}
      </button>
    </main>
  );
}

// ── 히스토리 탭 ───────────────────────────────────────────────────────────────

function HistoryTab({ history, loading }: { history: Measurement[]; loading: boolean }) {
  if (loading) return <main className={styles.main}><p className={styles.subtitle}>불러오는 중...</p></main>;
  if (!history.length) return (
    <main className={styles.main}>
      <p className={styles.subtitle} style={{ marginTop: 40, textAlign: "center" }}>
        아직 측정 기록이 없습니다.
      </p>
    </main>
  );

  return (
    <main className={styles.main}>
      <h2 className={styles.title}>최근 측정 기록</h2>
      <div className={styles.historyList}>
        {history.map((m) => {
          const cfg = SIGNAL_CONFIG[m.signal as keyof typeof SIGNAL_CONFIG];
          const date = new Date(m.created_at);
          const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
          return (
            <div key={m.id} className={styles.historyItem} style={{ borderLeftColor: cfg?.color ?? "#9E9E9E" }}>
              <div className={styles.historyLeft}>
                <span className={styles.historyEmoji}>{cfg?.emoji ?? "•"}</span>
                <div>
                  <p className={styles.historyGlucose}>{m.glucose} <span>mg/dL</span></p>
                  <p className={styles.historyMeta}>{MEAL_LABELS[m.meal_timing as MealTiming] ?? m.meal_timing} · {SIGNAL_KO[m.signal] ?? m.signal}</p>
                </div>
              </div>
              <div className={styles.historyRight}>
                <p className={styles.historyDate}>{dateStr}</p>
                {m.temperature_c != null && (
                  <p className={styles.historyWeather}>
                    {WEATHER_EMOJI[m.weather_condition ?? "clear"] ?? "🌤️"} {m.temperature_c.toFixed(1)}°C
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
