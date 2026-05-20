import { StatusBar } from "expo-status-bar";
import React from "react";
import { SafeAreaView, StyleSheet, Text, View } from "react-native";
import { MeasurementScreen } from "./screens/MeasurementScreen";
import type { LlmClient } from "../src/application/phase3InterventionLLM";

// Anthropic Claude API 기반 LLM 클라이언트
// 실제 배포 시 ANTHROPIC_API_KEY 환경변수를 EAS Build secret으로 설정
function createClaudeClient(): LlmClient {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";

  return {
    async complete(prompt: string): Promise<string> {
      if (!apiKey) {
        // 키가 없을 경우 기본 문구 반환 (개발/테스트용)
        return "";
      }
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 256,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) throw new Error(`Claude API 오류: ${res.status}`);
      const json = (await res.json()) as { content: Array<{ text: string }> };
      return json.content[0]?.text ?? "";
    },
  };
}

const llmClient = createClaudeClient();
const APP_USER_ID = "suyeong-resident-001"; // 실제 앱에서는 인증 후 발급

export default function App() {
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" backgroundColor="#1565C0" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>밀당</Text>
        <Text style={styles.headerSub}>수영구 어르신 혈당 관리</Text>
      </View>
      <MeasurementScreen llmClient={llmClient} userId={APP_USER_ID} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#1565C0" },
  header: {
    backgroundColor: "#1565C0",
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  headerTitle: { fontSize: 28, fontWeight: "800", color: "#FFF" },
  headerSub: { fontSize: 14, color: "#90CAF9", marginTop: 2 },
});
