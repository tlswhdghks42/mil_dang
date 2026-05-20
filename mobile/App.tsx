import { StatusBar } from "expo-status-bar";
import React from "react";
import { Platform, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { MeasurementScreen } from "./screens/MeasurementScreen";
import type { LlmClient } from "../src/application/phase3InterventionLLM";

const GROQ_BODY = (prompt: string) =>
  JSON.stringify({
    model: "llama-3.1-8b-instant",
    max_tokens: 256,
    messages: [{ role: "user", content: prompt }],
  });

// 웹: /api/llm 프록시 경유 (API 키 서버에서 보관)
// 네이티브: GROQ_API_KEY 환경변수로 직접 호출
function createLlmClient(): LlmClient {
  return {
    async complete(prompt: string): Promise<string> {
      try {
        if (Platform.OS === "web") {
          const res = await fetch("/api/llm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: GROQ_BODY(prompt),
          });
          if (!res.ok) return "";
          const json = (await res.json()) as { choices: Array<{ message: { content: string } }> };
          return json.choices[0]?.message.content ?? "";
        } else {
          const apiKey = process.env.GROQ_API_KEY ?? "";
          if (!apiKey) return "";
          const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKey}`,
            },
            body: GROQ_BODY(prompt),
          });
          if (!res.ok) return "";
          const json = (await res.json()) as { choices: Array<{ message: { content: string } }> };
          return json.choices[0]?.message.content ?? "";
        }
      } catch {
        return "";
      }
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
