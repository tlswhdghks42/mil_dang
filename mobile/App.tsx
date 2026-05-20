import { StatusBar } from "expo-status-bar";
import React from "react";
import { SafeAreaView, StyleSheet, Text, View } from "react-native";
import { MeasurementScreen } from "./screens/MeasurementScreen";
import type { LlmClient } from "../src/application/phase3InterventionLLM";

// Groq 무료 API 기반 LLM 클라이언트 (console.groq.com에서 무료 키 발급)
function createLlmClient(): LlmClient {
  const apiKey = process.env.GROQ_API_KEY ?? "";

  return {
    async complete(prompt: string): Promise<string> {
      if (!apiKey) return "";
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          max_tokens: 256,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) throw new Error(`Groq API 오류: ${res.status}`);
      const json = (await res.json()) as { choices: Array<{ message: { content: string } }> };
      return json.choices[0]?.message.content ?? "";
    },
  };
}

const llmClient = createLlmClient();
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
