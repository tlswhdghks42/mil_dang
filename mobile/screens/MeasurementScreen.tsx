import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import {
  Phase1State,
  initialPhase1State,
  updateInput,
  analyzeAndMoveResultWithLlm,
  goHome,
} from "../../src/application/phase1Controller";
import type { LlmClient } from "../../src/application/phase3InterventionLLM";
import type { MealTiming } from "../../src/domain/types";

const MEAL_TIMING_LABELS: Record<MealTiming, string> = {
  fasting: "공복",
  preprandial: "식전",
  postprandial: "식후 2시간",
};

const SIGNAL_CONFIG = {
  critical_low: { emoji: "🆘", bg: "#FFCDD2", label: "매우 위험 (저혈당)", color: "#B71C1C" },
  low: { emoji: "🔵", bg: "#E3F2FD", label: "주의 (저혈당 경계)", color: "#1565C0" },
  green: { emoji: "🟢", bg: "#E8F5E9", label: "정상", color: "#2E7D32" },
  yellow: { emoji: "🟡", bg: "#FFF8E1", label: "주의 (혈당 경계)", color: "#F57F17" },
  red: { emoji: "🔴", bg: "#FFEBEE", label: "위험 (고혈당)", color: "#C62828" },
};

interface Props {
  llmClient: LlmClient;
  userId: string;
}

export function MeasurementScreen({ llmClient, userId }: Props) {
  const [state, setState] = useState<Phase1State>(initialPhase1State);
  const [loading, setLoading] = useState(false);

  async function handleMeasure() {
    if (!state.glucoseText.trim()) {
      Alert.alert("입력 오류", "혈당 수치를 입력해 주세요.");
      return;
    }
    setLoading(true);
    try {
      const next = await analyzeAndMoveResultWithLlm(
        state,
        new Date().toISOString(),
        { llmClient },
        userId,
      );
      setState(next);
    } catch (err) {
      Alert.alert("오류", err instanceof Error ? err.message : "측정 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  function handleRetry() {
    setState(goHome(state));
  }

  if (state.screen === "result" && state.signal) {
    const cfg = SIGNAL_CONFIG[state.signal];
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <View style={[styles.signalCard, { backgroundColor: cfg.bg }]}>
          <Text style={styles.signalEmoji}>{cfg.emoji}</Text>
          <Text style={[styles.signalLabel, { color: cfg.color }]}>{cfg.label}</Text>
          <Text style={styles.glucoseValue}>{state.glucoseText} mg/dL</Text>
        </View>

        <View style={styles.interventionBox}>
          <Text style={styles.interventionText}>{state.interventionText}</Text>
        </View>

        {state.showNurseCallButton && (
          <Pressable style={styles.nurseButton} onPress={() => Alert.alert("간호사 호출", "보건소에 연락 중입니다.")}>
            <Text style={styles.nurseButtonText}>📞 간호사 호출</Text>
          </Pressable>
        )}

        <Pressable style={styles.retryButton} onPress={handleRetry}>
          <Text style={styles.retryButtonText}>다시 측정하기</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>혈당 입력</Text>
      <Text style={styles.subtitle}>수영구 어르신 맞춤 혈당 관리</Text>

      <Text style={styles.label}>혈당 수치 (mg/dL)</Text>
      <TextInput
        style={styles.input}
        value={state.glucoseText}
        onChangeText={(text) => setState(updateInput(state, { glucoseText: text }))}
        keyboardType="numeric"
        placeholder="예: 95"
        placeholderTextColor="#9E9E9E"
        accessibilityLabel="혈당 수치 입력"
        returnKeyType="done"
      />

      <Text style={styles.label}>측정 시점</Text>
      <View style={styles.timingRow}>
        {(Object.keys(MEAL_TIMING_LABELS) as MealTiming[]).map((t) => (
          <Pressable
            key={t}
            style={[styles.timingButton, state.mealTiming === t && styles.timingButtonActive]}
            onPress={() => setState(updateInput(state, { mealTiming: t }))}
            accessibilityLabel={MEAL_TIMING_LABELS[t]}
          >
            <Text style={[styles.timingText, state.mealTiming === t && styles.timingTextActive]}>
              {MEAL_TIMING_LABELS[t]}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#1565C0" style={{ marginTop: 24 }} />
      ) : (
        <Pressable style={styles.measureButton} onPress={handleMeasure}>
          <Text style={styles.measureButtonText}>측정 결과 확인</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24, backgroundColor: "#F5F5F5" },
  title: { fontSize: 28, fontWeight: "700", color: "#1A237E", marginBottom: 4 },
  subtitle: { fontSize: 16, color: "#5C6BC0", marginBottom: 32 },
  label: { fontSize: 16, fontWeight: "600", color: "#424242", marginBottom: 8, marginTop: 16 },
  input: {
    backgroundColor: "#FFF",
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#1565C0",
    paddingHorizontal: 20,
    paddingVertical: 16,
    fontSize: 28,
    fontWeight: "700",
    color: "#1A237E",
    textAlign: "center",
    minHeight: 64,
  },
  timingRow: { flexDirection: "row", gap: 8 },
  timingButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#BDBDBD",
    backgroundColor: "#FFF",
    alignItems: "center",
  },
  timingButtonActive: { borderColor: "#1565C0", backgroundColor: "#E3F2FD" },
  timingText: { fontSize: 14, fontWeight: "600", color: "#757575" },
  timingTextActive: { color: "#1565C0" },
  measureButton: {
    backgroundColor: "#1565C0",
    borderRadius: 16,
    paddingVertical: 20,
    marginTop: 32,
    alignItems: "center",
    minHeight: 64,
  },
  measureButtonText: { fontSize: 20, fontWeight: "700", color: "#FFF" },
  signalCard: { borderRadius: 24, padding: 32, alignItems: "center", marginBottom: 20 },
  signalEmoji: { fontSize: 64, marginBottom: 8 },
  signalLabel: { fontSize: 20, fontWeight: "700", marginBottom: 8 },
  glucoseValue: { fontSize: 36, fontWeight: "800", color: "#1A237E" },
  interventionBox: { backgroundColor: "#FFF", borderRadius: 16, padding: 20, marginBottom: 16 },
  interventionText: { fontSize: 18, lineHeight: 32, color: "#212121" },
  nurseButton: {
    backgroundColor: "#C62828",
    borderRadius: 16,
    paddingVertical: 20,
    marginBottom: 12,
    alignItems: "center",
    minHeight: 64,
  },
  nurseButtonText: { fontSize: 20, fontWeight: "700", color: "#FFF" },
  retryButton: {
    backgroundColor: "#E0E0E0",
    borderRadius: 16,
    paddingVertical: 20,
    alignItems: "center",
    minHeight: 64,
  },
  retryButtonText: { fontSize: 18, fontWeight: "600", color: "#424242" },
});
