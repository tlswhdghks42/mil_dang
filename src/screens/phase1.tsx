import React from "react";
import { Text, View, StyleSheet, TextInput } from "react-native";
import { MealTiming, SignalLevel } from "../domain/types";
import { LargeButton } from "../ui/components/LargeButton";
import { SignalCard } from "../ui/components/SignalCard";
import { tokens } from "../ui/designTokens";

export type ScreenKey = "home" | "input" | "result" | "exit";

export interface HomeViewProps {
  todayLabel: string;
  greeting: string;
  onStart: () => void;
  onNews: () => void;
  onMileage: () => void;
}

export function HomeView({ todayLabel, greeting, onStart, onNews, onMileage }: HomeViewProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{todayLabel}</Text>
      <Text style={styles.subtitle}>{greeting}</Text>
      <LargeButton label="혈당 기록하기" onPress={onStart} style={styles.mainCta} />
      <LargeButton label="수영구 보건소 소식" onPress={onNews} variant="secondary" />
      <LargeButton label="내 건강 마일리지" onPress={onMileage} variant="secondary" />
    </View>
  );
}

export interface BloodSugarInputViewProps {
  mealTiming: MealTiming;
  glucoseText: string;
  onChangeMealTiming: (timing: MealTiming) => void;
  onChangeGlucoseText: (value: string) => void;
  onVoiceInput: () => void;
  onAnalyze: () => void;
}

export function BloodSugarInputView({
  mealTiming,
  glucoseText,
  onChangeMealTiming,
  onChangeGlucoseText,
  onVoiceInput,
  onAnalyze,
}: BloodSugarInputViewProps) {
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <LargeButton
          label="공복"
          onPress={() => onChangeMealTiming("fasting")}
          variant={mealTiming === "fasting" ? "primary" : "secondary"}
          style={styles.toggle}
        />
        <LargeButton
          label="식후"
          onPress={() => onChangeMealTiming("postprandial")}
          variant={mealTiming === "postprandial" ? "primary" : "secondary"}
          style={styles.toggle}
        />
      </View>

      <Text style={styles.label}>혈당 수치 입력 (mg/dL)</Text>
      <TextInput
        value={glucoseText}
        onChangeText={onChangeGlucoseText}
        keyboardType="number-pad"
        style={styles.input}
        accessibilityLabel="혈당 숫자 입력"
      />

      <LargeButton label="말하기 입력" onPress={onVoiceInput} variant="secondary" />
      <LargeButton label="분석하기" onPress={onAnalyze} />
    </View>
  );
}

export interface ResultViewProps {
  signal: SignalLevel;
  message: string;
  showNurseCallButton?: boolean;
  onCallNurse?: () => void;
  onNext: () => void;
}

export function ResultView({ signal, message, showNurseCallButton, onCallNurse, onNext }: ResultViewProps) {
  return (
    <View style={styles.container}>
      <SignalCard level={signal} message={message} />
      {showNurseCallButton && onCallNurse ? (
        <LargeButton label="수영구 보건소 간호사 연결" onPress={onCallNurse} variant="danger" />
      ) : null}
      <LargeButton label="다음" onPress={onNext} />
    </View>
  );
}

export function ExitView({ onGoHome }: { onGoHome: () => void }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>오늘도 수고하셨어요.</Text>
      <Text style={styles.subtitle}>다음 측정을 알림으로 안내해드릴게요.</Text>
      <LargeButton label="홈으로" onPress={onGoHome} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tokens.color.bg,
    padding: 24,
    gap: tokens.touch.gap,
    justifyContent: "center",
  },
  row: { flexDirection: "row", gap: tokens.touch.gap },
  toggle: { flex: 1 },
  title: { fontSize: tokens.font.xxl, fontWeight: tokens.font.weightBold, color: tokens.color.text },
  subtitle: { fontSize: tokens.font.xl, color: tokens.color.text },
  label: { fontSize: tokens.font.xl, fontWeight: tokens.font.weightBold, color: tokens.color.text },
  mainCta: { minHeight: 220 },
  input: {
    minHeight: tokens.touch.minHeight,
    borderRadius: tokens.touch.radius,
    borderWidth: 2,
    borderColor: tokens.color.gray,
    fontSize: tokens.font.xxl,
    paddingHorizontal: tokens.touch.padding,
    color: tokens.color.text,
  },
});
